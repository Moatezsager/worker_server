import { StringSession } from 'telegram/sessions';
import { appConfig } from '../config';
import { db, supabase, supabaseKey } from '../db';

const SESSION_KEY = 'worker_telegram_auth';
let lastCloudSession: string | null = null;
let savedCredentials: {apiId: number; apiHash: string; sessionString: string} | null = null;
let restoreComplete = false;
let restoreFailed = false;
let restoreRetryAt = 0;
let restoring: Promise<boolean> | null = null;
let saving: Promise<void> = Promise.resolve();
let sessionVersion = 0;

export function getTelegramCredentials() {
  if (savedCredentials) return { ...savedCredentials, sessionString: restoreFailed ? '' : savedCredentials.sessionString };
  return {
    apiId: Number(appConfig.telegramApiId || process.env.TELEGRAM_API_ID || process.env.VITE_TELEGRAM_API_ID),
    apiHash: (appConfig.telegramApiHash || process.env.TELEGRAM_API_HASH || process.env.VITE_TELEGRAM_API_HASH || '').trim(),
    sessionString: restoreFailed ? '' : (appConfig.telegramSessionString || process.env.TELEGRAM_SESSION || process.env.TG_SESSION_V2 || process.env.VITE_TELEGRAM_SESSION || '').trim()
  };
}

function validate(credentials: ReturnType<typeof getTelegramCredentials>) {
  if (!Number.isSafeInteger(credentials.apiId) || credentials.apiId <= 0 ||
      !/^[a-f0-9]{32}$/i.test(credentials.apiHash) || typeof credentials.sessionString !== 'string' ||
      credentials.sessionString.length > 5000 || new StringSession(credentials.sessionString)._key?.length !== 256) {
    throw new Error('Invalid Telegram session credentials; no saved session was replaced.');
  }
}

function apply(credentials: ReturnType<typeof getTelegramCredentials>) {
  savedCredentials = { ...credentials };
  restoreComplete = true;
  restoreFailed = false;
  process.env.TELEGRAM_API_ID = String(credentials.apiId);
  process.env.TELEGRAM_API_HASH = credentials.apiHash;
  process.env.TELEGRAM_SESSION = credentials.sessionString;
}

export async function saveTelegramSession(apiId: number, apiHash: string, sessionString: string): Promise<void> {
  const operation = saving.catch(() => {}).then(async () => {
    const credentials = { apiId, apiHash: apiHash.trim(), sessionString: sessionString.trim() };
    validate(credentials);
    const value = JSON.stringify(credentials);
    if (lastCloudSession === value) { apply(credentials); return; }
    if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) {
      throw new Error('Private Telegram session storage is unavailable.');
    }
    const { error } = await supabase.from('server_config').upsert({
      key: SESSION_KEY, value, updated_at: new Date().toISOString()
    }).abortSignal(AbortSignal.timeout(10000));
    if (error) throw new Error('Failed to save Telegram session privately; retry before restarting Worker.');
    lastCloudSession = value;
    sessionVersion++;
    try { db.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run(SESSION_KEY, value); } catch {}
    apply(credentials);
  });
  saving = operation;
  return operation;
}

export function restoreTelegramSession(force = false): Promise<boolean> {
  if (restoring) return restoring;
  if (!force && (restoreComplete || Date.now() < restoreRetryAt)) return Promise.resolve(!!savedCredentials);
  restoring = restoreSessionJob().then(found => {
    restoreComplete = true;
    restoreFailed = false;
    return found;
  }).catch(() => {
    restoreComplete = false;
    restoreFailed = true;
    restoreRetryAt = Date.now() + 60000;
    throw new Error('Private Telegram checkpoint is temporarily unreadable; account connection deferred.');
  }).finally(() => { restoring = null; });
  return restoring;
}

async function restoreSessionJob(): Promise<boolean> {
  const version = sessionVersion;
  let value: string | undefined;
  let fromCloud = false;
  let readFailed = false;
  if (supabase && supabaseKey && !supabaseKey.includes('dummy')) {
    try {
      const { data, error } = await supabase.from('server_config').select('value').eq('key', SESSION_KEY)
        .abortSignal(AbortSignal.timeout(10000)).maybeSingle();
      if (!error && data?.value) { value = data.value; fromCloud = true; }
      else if (error) readFailed = true;
    } catch { readFailed = true; }
  }
  if (!value) {
    try { value = (db.prepare('SELECT value FROM server_config WHERE key = ?').get(SESSION_KEY) as {value: string} | undefined)?.value; } catch {}
  }
  if (version !== sessionVersion) return !!savedCredentials;
  if (!value && readFailed) throw new Error('Private checkpoint read failed');
  if (!value) return false;
  const credentials = JSON.parse(value);
  validate(credentials);
  if (fromCloud) lastCloudSession = value;
  try { db.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run(SESSION_KEY, value); } catch {}
  apply(credentials);
  return true;
}
