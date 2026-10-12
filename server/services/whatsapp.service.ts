import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  normalizeMessageContent,
  fetchLatestBaileysVersion,
  WAMessage,
  WASocket
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { db, supabase, supabaseKey } from '../db';
import { appConfig } from '../config';
import type { WhatsAppSourceConfig } from '../types';
import { processWhatsAppMessage, isWhatsAppFetchEnabled, setWhatsAppFetchEnabled } from './scraper.service';
import { logErrorArabic } from './db.service';
import { ensureAccountLease, ownsAccountLease } from './accountLease.service';

export interface WhatsAppServiceStatus {
  status: 'disconnected' | 'connecting' | 'scan_qr' | 'connected' | 'error';
  qrCodeUrl: string | null;
  phoneNumber: string | null;
  userName: string | null;
  connectedAt: string | null;
  lastMessageTime: string | null;
  lastError: string | null;
  messagesReceivedCount: number;
  ratesExtractedCount: number;
  autoProcessEnabled: boolean;
  activeChatsCount: number;
  hasSavedSession: boolean;
}

export interface WhatsAppChatSummary {
  id: string;
  name: string;
  type: 'channel' | 'group' | 'chat';
  messagesCount: number;
  lastMessageTime: string | null;
  lastSnippet: string;
  isReadable: boolean;
  participantsCount?: number;
}

const AUTH_DIR = path.resolve(process.cwd(), 'whatsapp_auth');
let backupDebounceTimer: NodeJS.Timeout | null = null;
let lastSavedAuthHash: string | null = null;
let lastSavedAuthTime = 0;
let authBackupWrite: Promise<void> = Promise.resolve();
let authBackupPaused = false;
let authFileWrite: Promise<void> = Promise.resolve();
let checkpointError: string | null = null;
let checkpointFailures = 0;

function isRegisteredSession(content: unknown): boolean {
  if (typeof content !== 'string') return false;
  try {
    const creds = JSON.parse(content);
    // Baileys QR pairing sets me/account; registered is only set on some pairing flows.
    return creds?.registered === true || (typeof creds?.me?.id === 'string' && !!creds.me.id &&
      !!creds.account && typeof creds.account === 'object' && !Array.isArray(creds.account));
  }
  catch { return false; }
}

export function isAutomaticWhatsAppSource(jid: unknown): boolean {
  return typeof jid === 'string' && (jid.endsWith('@newsletter') || jid.endsWith('@g.us'));
}

/**
 * Backs up all session authentication files from disk to local SQLite and Supabase cloud.
 * Hashes the complete bundle to suppress duplicate uploads within the checkpoint window.
 */
export function backupAuthToStorage(): Promise<void> {
  if (authBackupPaused) return Promise.resolve();
  authBackupWrite = authBackupWrite.catch(() => {}).then(backupAuthJob);
  return authBackupWrite;
}

async function backupAuthJob(): Promise<void> {
  await authFileWrite;
  if (authBackupPaused) return;
  try {
    if (!fs.existsSync(AUTH_DIR)) return;

    const files = fs.readdirSync(AUTH_DIR).sort();
    if (files.length === 0) return;

    const bundle: Record<string, string> = {};
    for (const file of files) {
      try {
        const filePath = path.join(AUTH_DIR, file);
        if (/^[a-zA-Z0-9_@.-]+\.json$/.test(file) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath, 'utf8');
          JSON.parse(content);
          bundle[file] = content;
        }
      } catch { return; } // Never replace a complete checkpoint with a partial read.
    }

    // Only backup if valid credentials exist
    if (!isRegisteredSession(bundle['creds.json'])) return;

    // Session keys can change without changing creds.json.
    const currentHash = crypto.createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
    const now = Date.now();
    const isUnchanged = (currentHash === lastSavedAuthHash) && (now - lastSavedAuthTime < 60 * 60 * 1000);

    // 2. Local SQLite fallback (instant, zero network bandwidth)
    try {
      const upsertStmt = db.prepare('INSERT OR REPLACE INTO whatsapp_auth (filename, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
      db.transaction(() => {
        db.prepare('DELETE FROM whatsapp_auth').run();
        for (const file of Object.keys(bundle)) {
          upsertStmt.run(file, bundle[file]);
        }
        db.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run('whatsapp_session_backup', JSON.stringify(bundle));
      })();
    } catch (dbErr) {}

    // Skip unchanged bundles.
    if (isUnchanged) {
      return;
    }

    // Keep Worker sessions outside the shared application configuration.
    if (!ownsAccountLease()) return; // Standby instances must not overwrite the active socket's keys.
    if (supabase && supabaseKey && !supabaseKey.includes('dummy')) {
      try {
        const { error } = await supabase
          .from('server_config')
          .upsert({ key: 'worker_whatsapp_auth', value: JSON.stringify(bundle), updated_at: new Date().toISOString() })
          .abortSignal(AbortSignal.timeout(10000));
        if (error) {
          throw new Error('Checkpoint write failed');
        } else {
          checkpointError = null;
          checkpointFailures = 0;
          lastSavedAuthHash = currentHash;
          lastSavedAuthTime = now;
          console.log(`[WhatsApp] Successfully saved ${Object.keys(bundle).length} auth files to Supabase cloud (new credentials saved).`);
        }
      } catch {
        checkpointError = 'تعذر حفظ جلسة واتساب سحابياً. تحقق من صلاحيات server_config قبل إعادة نشر السيرفر.';
        console.error('[WhatsApp] Private session checkpoint failed; local session preserved.');
        if (++checkpointFailures <= 3) queueAuthBackup();
      }
    } else {
      checkpointError = 'الحفظ السحابي لجلسة واتساب غير متاح. تحقق من إعدادات Supabase قبل إعادة نشر السيرفر.';
    }

  } catch (err) {
    console.error('[WhatsApp] Error in backupAuthToStorage:', err);
  }
}

/**
 * Debounced backup to prevent overwhelming Supabase during rapid key handshakes
 */
export function queueAuthBackup(): void {
  if (authBackupPaused) return;
  if (backupDebounceTimer) return;
  backupDebounceTimer = setTimeout(() => {
    backupDebounceTimer = null;
    backupAuthToStorage().catch(console.error);
  }, 30000); // Fixed window: continuous key activity must not postpone persistence.
  backupDebounceTimer.unref();
}

/**
 * Restores session authentication files from Supabase cloud into local ephemeral container auth folder.
 */
export async function restoreAuthFromStorage(): Promise<boolean> {
  if (authBackupPaused) return false;
  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    let bundle: Record<string, string> | undefined;
    try {
      const row = db.prepare('SELECT value FROM server_config WHERE key = ?').get('whatsapp_session_backup') as {value: string} | undefined;
      if (row?.value) {
        bundle = JSON.parse(row.value);
        if (!bundle?.['creds.json']) return false;
      }
    } catch {}
    if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
      try {
        if (isRegisteredSession(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8'))) return true;
      } catch {}
    }
    if (supabase && supabaseKey && !supabaseKey.includes('dummy')) {
      const { data, error } = await supabase.from('server_config').select('value').eq('key', 'worker_whatsapp_auth')
        .abortSignal(AbortSignal.timeout(10000)).single();
      if (error && error.code !== 'PGRST116' && !bundle) {
        throw new Error('Saved WhatsApp session is temporarily unavailable; retry before pairing.');
      }
      if (!error && data?.value) {
        bundle = JSON.parse(data.value);
        if (!bundle?.['creds.json']) return false; // A private tombstone prevents restoring a logged-out legacy session.
      }
    }
    if (!bundle) {
      try {
        const row = db.prepare('SELECT value FROM server_config WHERE key = ?').get('whatsapp_session_backup') as {value: string} | undefined;
        if (row?.value) bundle = JSON.parse(row.value);
      } catch {}
    }
    bundle ||= appConfig.whatsappAuth;
    if (!isRegisteredSession(bundle?.['creds.json'])) return false;
    for (const [filename, content] of Object.entries(bundle)) {
      if (!/^[a-zA-Z0-9_@.-]+\.json$/.test(filename) || typeof content !== 'string') return false;
      JSON.parse(content);
    }
    // Commit credentials last so a failed key restore cannot look like a complete session.
    const entries = Object.entries(bundle).sort(([a], [b]) => Number(a === 'creds.json') - Number(b === 'creds.json'));
    for (const [filename, content] of entries) fs.writeFileSync(path.join(AUTH_DIR, filename), content, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    console.error('[WhatsApp] Saved-session restore failed; credentials were not exposed.');
    throw new Error('Unable to restore saved WhatsApp session safely. Retry connection later.');
  }
}

/**
 * Checks local saved-session evidence without making a cloud request.
 */
export function hasSavedSession(): boolean {
  if (authBackupPaused) return false;
  try {
    const row = db.prepare('SELECT value FROM server_config WHERE key = ?').get('whatsapp_session_backup') as {value: string} | undefined;
    if (row?.value && !JSON.parse(row.value)?.['creds.json']) return false;
    if (fs.existsSync(path.join(AUTH_DIR, 'creds.json')) && isRegisteredSession(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8'))) return true;
    if (row?.value && isRegisteredSession(JSON.parse(row.value)?.['creds.json'])) return true;
  } catch (e) {}
  return isRegisteredSession(appConfig.whatsappAuth?.['creds.json']);
}

let cachedBaileysVersion: [number, number, number] | null = null;

class WhatsAppManager {
  private closing = false;
  private sock: WASocket | null = null;
  private status: WhatsAppServiceStatus['status'] = 'disconnected';
  private qrCodeUrl: string | null = null;
  private phoneNumber: string | null = null;
  private userName: string | null = null;
  private connectedAt: string | null = null;
  private lastMessageTime: string | null = null;
  private lastError: string | null = null;
  private messagesReceivedCount = 0;
  private ratesExtractedCount = 0;
  private activeChats = new Set<string>();
  private chatNamesCache = new Map<string, string>();
  private knownChats = new Map<string, WhatsAppChatSummary>();
  private isInitializing = false;
  private reconnectAttempts = 0;
  private autoReconnectBlocked = false;
  private maxReconnectAttempts = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor() {
    if (!fs.existsSync(AUTH_DIR)) {
      try {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      } catch (e) {
        console.error('[WhatsApp] Failed to create auth directory:', e);
      }
    }
  }

  public getStatus(): WhatsAppServiceStatus {
    return {
      status: this.status,
      qrCodeUrl: this.qrCodeUrl,
      phoneNumber: this.phoneNumber,
      userName: this.userName,
      connectedAt: this.connectedAt,
      lastMessageTime: this.lastMessageTime,
      lastError: this.lastError || checkpointError,
      messagesReceivedCount: this.messagesReceivedCount,
      ratesExtractedCount: this.ratesExtractedCount,
      autoProcessEnabled: isWhatsAppFetchEnabled,
      activeChatsCount: this.activeChats.size,
      hasSavedSession: hasSavedSession()
    };
  }

  public setAutoProcess(enabled: boolean) {
    setWhatsAppFetchEnabled(enabled);
  }

  public getSources(): WhatsAppSourceConfig[] {
    const sources = new Map<string, WhatsAppSourceConfig>();
    for (const source of appConfig.whatsappSources || []) {
      if (typeof source?.jid !== 'string') continue;
      sources.set(source.jid, { ...source,
        type: source.jid.endsWith('@newsletter') ? 'channel' : source.jid.endsWith('@g.us') ? 'group' : source.type,
        enabled: isAutomaticWhatsAppSource(source.jid) || source.enabled === true });
    }
    for (const chat of this.knownChats.values()) {
      const configured = sources.get(chat.id);
      sources.set(chat.id, { jid: chat.id,
        name: isAutomaticWhatsAppSource(chat.id) ? chat.name : configured?.name || chat.name, type: chat.type,
        enabled: isAutomaticWhatsAppSource(chat.id) || configured?.enabled === true });
    }
    return [...sources.values()];
  }

  private rememberChats(chats: { id?: string; name?: string | null; subject?: string }[]): void {
    for (const chat of chats) {
      if (!isAutomaticWhatsAppSource(chat.id)) continue;
      const id = chat.id!;
      const previous = this.knownChats.get(id);
      const name = chat.subject || chat.name || previous?.name ||
        appConfig.whatsappSources?.find(source => source.jid === id)?.name ||
        (id.endsWith('@newsletter') ? 'قناة أسعار واتساب' : 'مجموعة أسعار واتساب');
      this.chatNamesCache.set(id, name);
      this.knownChats.set(id, { id, name, type: id.endsWith('@newsletter') ? 'channel' : 'group',
        messagesCount: previous?.messagesCount || 0, lastMessageTime: previous?.lastMessageTime || null,
        lastSnippet: previous?.lastSnippet || '', isReadable: true, participantsCount: previous?.participantsCount });
    }
  }

  public async reconnectSavedSession(): Promise<void> {
    if (authBackupPaused || this.autoReconnectBlocked || this.connectPromise || this.reconnectTimer ||
        this.status === 'connected' || this.status === 'scan_qr') return;
    if (await restoreAuthFromStorage()) await this.initClient();
  }

  public async initClient(): Promise<void> {
    authBackupPaused = false;
    if (this.autoReconnectBlocked) { this.reconnectAttempts = 0; this.autoReconnectBlocked = false; }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock && this.status === 'connected') {
      console.log('[WhatsApp] Already actively connected.');
      return;
    }

    if (this.connectPromise) {
      console.log('[WhatsApp] Client initialization already in progress, awaiting existing attempt...');
      return this.connectPromise;
    }

    this.connectPromise = this.doInitClient().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private async doInitClient(): Promise<void> {
    this.closing = false;
    this.isInitializing = true;
    this.status = 'connecting';
    this.lastError = null;

    try {
      if (!await ensureAccountLease()) {
        this.status = 'disconnected';
        this.lastError = 'بانتظار تسليم اتصال الحسابات من نسخة Worker الأخرى أو استعادة قاعدة البيانات.';
        return;
      }
      console.log('[WhatsApp] Initializing Baileys client with Supabase cloud persistent session...');
      
      // Step 1: Restore session files from Supabase cloud into container folder
      await authFileWrite.catch(() => {});
      await restoreAuthFromStorage();

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const persist = (write: () => Promise<void>): Promise<void> => {
        const operation = authFileWrite.catch(() => {}).then(write);
        authFileWrite = operation;
        return operation;
      };
      const setKeys = state.keys.set.bind(state.keys);
      state.keys.set = async (data) => {
        await persist(() => setKeys(data));
        queueAuthBackup();
      };
      if (!cachedBaileysVersion) {
        const result = await fetchLatestBaileysVersion().catch(() => ({
          version: [2, 3000, 1015901307] as [number, number, number],
          isLatest: true
        }));
        cachedBaileysVersion = result.version;
        console.log(`[WhatsApp] Fetched Baileys version: ${cachedBaileysVersion.join('.')} (cached for session)`);
      }
      const version = cachedBaileysVersion;

      const logger = pino({ level: 'silent' });

      // Step 2: Clean up previous socket if exists before creating new one
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners('connection.update');
          this.sock.end(undefined);
        } catch (e) {}
        this.sock = null;
      }

      // Step 3: Instantiate socket
      if (this.closing || !await ensureAccountLease()) return;
      const makeSocketFn = (makeWASocket as any).default || makeWASocket;
      this.sock = makeSocketFn({
        version,
        logger,
        printQRInTerminal: false,
        auth: state,
        browser: ['Dinar Indicator', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 2000
      });

      if (!this.sock) {
        throw new Error('Failed to create WhatsApp socket instance');
      }

      // Step 4: Handle credentials update and mirror directly to Supabase cloud
      this.sock.ev.on('creds.update', async () => {
        try {
          await persist(saveCreds);
          if (!lastSavedAuthHash) await backupAuthToStorage();
          else queueAuthBackup();
        } catch (err) {
          console.error('[WhatsApp] Error in creds.update handler:', err);
        }
      });

      // Step 5: Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        if (this.closing || authBackupPaused) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('[WhatsApp] New QR code generated for pairing.');
          this.status = 'scan_qr';
          try {
            this.qrCodeUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              scale: 6,
              color: { dark: '#000000', light: '#ffffff' }
            });
          } catch (qrErr) {
            console.error('[WhatsApp] Failed to convert QR to DataURL:', qrErr);
          }
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          console.log(`[WhatsApp] Connection closed. Status code: ${statusCode}.`);

          if (this.stableTimer) {
            clearTimeout(this.stableTimer);
            this.stableTimer = null;
          }

          this.status = 'disconnected';
          this.qrCodeUrl = null;

          // Never delete auth files on disconnect!
          // 1. Handle 440: Connection Replaced (another device or session connected to WhatsApp)
          if (statusCode === 440 || statusCode === DisconnectReason.connectionReplaced) {
            this.autoReconnectBlocked = true;
            console.warn('[WhatsApp] Disconnect reason 440 (connectionReplaced): Another device or session connected with this WhatsApp number. Stopping auto-reconnect to prevent bandwidth abuse and number banning.');
            this.status = 'error';
            this.lastError = 'تم تسجيل الدخول إلى هذا الرقم من جهاز أو متصفح آخر (رمز 440). تم إيقاف إعادة الاتصال تلقائياً لمنع استهلاك الباندويث وحظر الرقم. يمكنك إعادة الاتصال من لوحة التحكم عند الحاجة.';
            return;
          }

          // 2. Handle 401: Logged Out
          if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
            this.autoReconnectBlocked = true;
            console.warn('[WhatsApp] Disconnect reason 401 (loggedOut): Session was logged out. Halting auto-reconnect.');
            this.status = 'error';
            this.lastError = 'تم تسجيل الخروج من جلسة واتساب. يرجى مسح رمز الاستجابة السريعة (QR) من جديد.';
            return;
          }

          // 3. Stop reconnecting after max attempts to prevent bandwidth drain
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.autoReconnectBlocked = true;
            console.error(`[WhatsApp] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Stopping auto-reconnect to prevent bandwidth abuse. Restart from admin panel.`);
            this.status = 'error';
            this.lastError = `فشل الاتصال بعد ${this.maxReconnectAttempts} محاولة. أعد الاتصال يدوياً من لوحة التحكم.`;
            return;
          }

          // Exponential backoff: 15s, 30s, 60s, 120s, 240s, 300s max
          const delay = Math.min(15000 * Math.pow(2, this.reconnectAttempts), 300000);
          this.reconnectAttempts++;
          console.log(`[WhatsApp] Reconnecting in ${Math.round(delay / 1000)}s (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

          this.reconnectTimer = setTimeout(() => {
            this.isInitializing = false;
            this.initClient().catch(console.error);
          }, delay);
        } else if (connection === 'open') {
          console.log('[WhatsApp] Connection established successfully and persistent!');
          this.status = 'connected';
          this.qrCodeUrl = null;
          this.connectedAt = new Date().toISOString();
          this.lastError = null;

          if (this.sock?.user) {
            this.phoneNumber = this.sock.user.id ? this.sock.user.id.split(':')[0] : null;
            this.userName = this.sock.user.name || null;
            console.log(`[WhatsApp] Connected permanently as: ${this.userName || 'Bot'} (${this.phoneNumber})`);
          }

          // Reset reconnect attempts ONLY after 5 minutes of continuous stable connection
          // This prevents rapid disconnect-reconnect flapping from resetting the counter
          if (this.stableTimer) clearTimeout(this.stableTimer);
          this.stableTimer = setTimeout(() => {
            if (this.status === 'connected') {
              this.reconnectAttempts = 0;
              console.log('[WhatsApp] Connection has remained stable for 5 minutes. Reconnect attempts counter reset.');
            }
          }, 5 * 60 * 1000);
          await persist(saveCreds);
          await backupAuthToStorage();
          await this.getReachableChats();
        }
      });

      const socket = this.sock;
      const rememberChats = (chats: Parameters<WhatsAppManager['rememberChats']>[0]) => {
        if (this.sock === socket && !this.closing && !authBackupPaused) this.rememberChats(chats);
      };
      socket.ev.on('chats.upsert', rememberChats);
      socket.ev.on('chats.update', rememberChats);
      socket.ev.on('groups.upsert', rememberChats);
      socket.ev.on('groups.update', rememberChats);
      socket.ev.on('messaging-history.set', ({ chats }) => rememberChats(chats));
      socket.ev.on('newsletter-settings.update', ({ id, update }) => rememberChats([{ id, name: update.name }]));

      // History events above discover sources only; prices still use the existing message pipeline.
      socket.ev.on('messages.upsert', async (m) => {
        for (const msg of m.messages) {
          if (this.sock !== socket || this.closing || authBackupPaused) break;
          try {
            await this.handleIncomingMessage(msg);
          } catch (msgErr) {
            console.error('[WhatsApp] Error handling incoming message:', msgErr);
          }
        }
      });

    } catch (err: any) {
      console.error('[WhatsApp] Initialization error:', err);
      this.status = 'error';
      this.lastError = err?.message || String(err);
      await logErrorArabic(`خطأ في تهيئة عميل واتساب: ${this.lastError}`, 'واتساب');
    } finally {
      this.isInitializing = false;
    }
  }

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    if (!msg.message) return;
    if (msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid || 'unknown';
    this.rememberChats([{ id: remoteJid,
      name: remoteJid.endsWith('@newsletter') && !this.chatNamesCache.has(remoteJid) ? msg.pushName : undefined }]);
    const mObj = normalizeMessageContent(msg.message);
    if (!mObj) return;
    const text =
      mObj.conversation ||
      mObj.extendedTextMessage?.text ||
      mObj.imageMessage?.caption ||
      mObj.videoMessage?.caption ||
      mObj.documentMessage?.caption ||
      '';

    if (!text || text.trim().length < 4) return;
    const timestamp = msg.messageTimestamp as number | string | { toNumber(): number } | undefined;
    const seconds = typeof timestamp === 'number' || typeof timestamp === 'string' ? Number(timestamp) : timestamp?.toNumber?.();
    const msgTime = Number(seconds) * 1000;
    if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(msgTime) || msgTime <= 0 || msgTime > Date.now() + 300000) return;

    this.messagesReceivedCount++;
    this.lastMessageTime = new Date().toISOString();

    this.activeChats.add(remoteJid);

    const chatName = this.chatNamesCache.get(remoteJid) ||
      (msg.pushName ? `محادثة (${msg.pushName})` : 'محادثة خاصة');

    const isChannel = remoteJid.endsWith('@newsletter');
    const isGroup = remoteJid.endsWith('@g.us');
    const snippet = text.replace(/\s+/g, ' ').substring(0, 100);
    const prev = this.knownChats.get(remoteJid);
    this.knownChats.set(remoteJid, {
      id: remoteJid,
      name: chatName,
      type: isChannel ? 'channel' : isGroup ? 'group' : 'chat',
      messagesCount: (prev?.messagesCount || 0) + 1,
      lastMessageTime: new Date(msgTime).toISOString(),
      lastSnippet: snippet,
      isReadable: true,
      participantsCount: prev?.participantsCount
    });
    if (!isWhatsAppFetchEnabled ||
        (!isAutomaticWhatsAppSource(remoteJid) &&
         !appConfig.whatsappSources?.some(source => source.jid === remoteJid && source.enabled === true))) return;
    const result = await processWhatsAppMessage(chatName, text, msgTime);
    if (result.processed) this.ratesExtractedCount += result.extractedCount;
  }

  public async getReachableChats(): Promise<WhatsAppChatSummary[]> {
    const socket = this.sock;
    if (this.sock && this.status === 'connected') {
      try {
        const groups = await socket!.groupFetchAllParticipating();
        if (groups && this.sock === socket && this.status === 'connected') {
          for (const jid in groups) {
            const g = groups[jid];
            const existing = this.knownChats.get(jid);
            this.knownChats.set(jid, {
              id: jid,
              name: g.subject || existing?.name || 'مجموعة تجار أسعار',
              type: 'group',
              messagesCount: existing?.messagesCount || 0,
              lastMessageTime: existing?.lastMessageTime || null,
              lastSnippet: existing?.lastSnippet || 'متصل وقابل للقراءة بنجاح',
              isReadable: true,
              participantsCount: g.participants ? g.participants.length : undefined
            });
            if (g.subject) {
              this.chatNamesCache.set(jid, g.subject);
            }
          }
        }
      } catch (err) {
        console.warn('[WhatsApp] groupFetchAllParticipating warning:', err);
      }
    }
    return Array.from(this.knownChats.values()).sort((a, b) => {
      const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return bTime - aTime;
    });
  }

  public closeOnly(): void {
    this.closing = true;
    this.status = 'disconnected';
    this.qrCodeUrl = null;
    if (backupDebounceTimer) clearTimeout(backupDebounceTimer);
    backupDebounceTimer = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    if (this.sock) {
      try {
        console.log('[WhatsApp] Gracefully closing socket for server shutdown (preserving Supabase session)...');
        this.sock.end(undefined);
        this.sock = null;
      } catch (e) {}
    }
  }

  public async disconnect(): Promise<void> {
    this.closing = true;
    authBackupPaused = true;
    if (backupDebounceTimer) clearTimeout(backupDebounceTimer);
    backupDebounceTimer = null;
    await authBackupWrite;
    await authFileWrite.catch(() => {});
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    try {
      if (this.sock) {
        console.log('[WhatsApp] Disconnecting socket upon explicit admin request...');
        await this.sock.logout().catch(() => {});
        this.sock.end(undefined);
        this.sock = null;
      }
    } catch (e) {
      console.warn('[WhatsApp] Error during socket logout:', e);
    } finally {
      let cleanupError: Error | undefined;
      try { await this.clearAuthFromSupabaseAndDisk(); }
      catch (error) { cleanupError = error instanceof Error ? error : new Error(String(error)); }
      lastSavedAuthHash = null;
      checkpointError = null;
      checkpointFailures = 0;
      this.status = 'disconnected';
      this.qrCodeUrl = null;
      this.phoneNumber = null;
      this.userName = null;
      this.connectedAt = null;
      this.knownChats.clear();
      this.chatNamesCache.clear();
      this.activeChats.clear();
      this.lastError = cleanupError?.message || null;
      this.reconnectAttempts = 0;
      if (cleanupError) throw cleanupError;
      console.log('[WhatsApp] Disconnected and saved session cleared.');
    }
  }

  private async clearAuthFromSupabaseAndDisk(): Promise<void> {
    let failed = false;
    // 1. Remove from in-memory appConfig & Supabase cloud
    appConfig.whatsappAuth = {};
    if (supabase && supabaseKey && !supabaseKey.includes('dummy')) {
      try {
        const { error } = await supabase.from('server_config').upsert({ key: 'worker_whatsapp_auth', value: '{}', updated_at: new Date().toISOString() })
          .abortSignal(AbortSignal.timeout(10000));
        if (error) throw error;
        console.log('[WhatsApp] Session removed from Supabase cloud.');
      } catch (e) { failed = true; }
    }

    // 2. Clear disk files
    if (fs.existsSync(AUTH_DIR)) {
      try {
        const files = fs.readdirSync(AUTH_DIR);
        for (const file of files) {
          try { fs.unlinkSync(path.join(AUTH_DIR, file)); }
          catch { failed = true; }
        }
      } catch (err) { failed = true; }
    }

    // 3. Clear SQLite fallback
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM whatsapp_auth').run();
        db.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run('whatsapp_session_backup', '{}');
      })();
    } catch (dbErr) { failed = true; }
    if (failed) throw new Error('Disconnected locally, but session cleanup was not confirmed. Retry disconnect before reconnecting.');
  }
}

export const whatsappManager = new WhatsAppManager();
