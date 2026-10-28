import { TelegramManager, getTelegramManager } from '../../telegramClient';
import { getTelegramCredentials } from './telegramSession.service';
import { appConfig, telegramManager, setTelegramManager } from '../config';
import { rates } from '../state';
import { db, supabase, supabaseKey } from '../db';
import { addBroadcastLog } from './broadcastLog.service';
import { ensureWebRatesReady, getWebRatesSyncError } from './db.service';
import { addLog, sanitizeErrorMessage } from '../utils/logger';
import { delay, getPublicAppUrl, getLibyaTimeInfo, getTelegramShareUrl, getFacebookPostTimes, facebookPostText } from '../utils/helpers';
import { ensureAccountLease, ownsAccountLease, getAccountLeaseGeneration } from './accountLease.service';

interface FacebookApiResponse {
  error?: {
    message?: string;
    code?: number;
    [key: string]: any;
  };
  id?: string;
  [key: string]: any;
}

export let facebookBroadcastStatus = {
  status: 'ok',
  lastError: '',
  lastErrorTime: '',
  lastSuccessTime: ''
};

export let telegramBroadcastStatus = {
  status: 'ok',
  lastError: '',
  lastErrorTime: '',
  lastSuccessTime: ''
};

export let lastSocialBroadcastTime = 0;

// ─── Smart Broadcast Rate Limiter ──────────────────────────────────────────
/** حد أقصى لعدد المنشورات في الساعة الواحدة عبر كل المنصات */
const BROADCAST_HOURLY_LIMIT = 6;

/** مصفوفة تحتفظ بطوابع زمنية لآخر {BROADCAST_HOURLY_LIMIT} منشورات */
const recentBroadcastTimestamps: number[] = [];

export async function loadRecentBroadcastTimestamps(): Promise<void> {
  try {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    // محاولة Supabase أولاً
    if (supabase) {
      const { data, error } = await supabase
        .from('broadcast_log')
        .select('created_at')
        .eq('status', 'success').eq('platform', 'telegram')
        .gte('created_at', new Date(oneHourAgo).toISOString())
        .order('created_at', { ascending: true });

      if (error) addLog('warn', 'النشر', 'تعذر استعادة حد النشر من السحابة؛ استخدام السجل المحلي', { error: error.message });

      if (!error && data && data.length > 0) {
        recentBroadcastTimestamps.length = 0;
        for (const row of data) {
          const t = typeof row.created_at === 'number' ? row.created_at : new Date(row.created_at).getTime();
          if (!isNaN(t)) {
            recentBroadcastTimestamps.push(t);
          }
        }
        console.log(
          `[SmartBroadcast] Loaded ${recentBroadcastTimestamps.length} recent broadcasts from Supabase`
        );
        return;
      }
    }

    // Fallback: SQLite
    if (db) {
      const rows = db
        .prepare(
          `SELECT created_at FROM broadcast_log
           WHERE status = 'success' AND platform = 'telegram' AND created_at >= ?`
        )
        .all(oneHourAgo) as { created_at: string | number }[];

      recentBroadcastTimestamps.length = 0;
      for (const row of rows) {
        const t = typeof row.created_at === 'number' ? row.created_at : new Date(row.created_at).getTime();
        if (!isNaN(t)) {
          recentBroadcastTimestamps.push(t);
        }
      }
      console.log(
        `[SmartBroadcast] Loaded ${recentBroadcastTimestamps.length} recent broadcasts from SQLite`
      );
    }
  } catch (err) {
    console.warn('[SmartBroadcast] Could not load recent broadcast timestamps:', err);
  }
}

/** حالة آخر بث منشور لكل عملة (السعر ووقت النشر) - محفوظة في SQLite و Supabase وتُحمّل عند الإقلاع */
export let lastBroadcastState: Record<string, { price: number; time: number }> = {};

/** الحد الأدنى للتغيير المطلق في السعر للعملات العادية (د.ل) - قرش واحد (0.01 د.ل) */
const MIN_PRICE_CHANGE = 0.01;

/** الحد الأدنى للتغيير النسبي للمعادن الثمينة (ذهب / فضة) → 0.5% */
const MIN_PRICE_CHANGE_PCT_PRECIOUS = 0.005;
// ───────────────────────────────────────────────────────────────────────────


// ─── Retry Engine (إعادة المحاولة عند فشل الإرسال) ────────────────────────
export function getRetryQueueCount(): number {
  return [...smartBroadcastQueue.values()].filter(item => item.lastError).length;
}

/** الحد الأقصى لمحاولات الإعادة = 3 */
const MAX_RETRY_ATTEMPTS = 3;

/** مضاعف التأخير بين المحاولات (Exponential Backoff) بالميللي ثانية */
const RETRY_BASE_DELAY_MS = 30 * 1000; // 30 ثانية، 60، 120


// ───────────────────────────────────────────────────────────────────────────



export function getOrInitTelegramManager(): TelegramManager {
  const { apiId, apiHash, sessionString } = getTelegramCredentials();
  const botToken = process.env.TELEGRAM_BOT_TOKEN || appConfig.telegramBotToken || "";
  
  const manager = getTelegramManager(apiId, apiHash, sessionString, botToken);
  setTelegramManager(manager);
  return manager;
}

// ─── Smart Broadcast Helpers ────────────────────────────────────────────────

/**
 * يحدد إذا كانت العملة تصنّف كمعدن ثمين (ذهب / فضة)
 * نستخدم نسبة مئوية بدلاً من قيمة ثابتة لأن أسعارها بالمئات
 */
function isPreciousMetal(id?: string): boolean {
  if (!id) return false;
  return id.startsWith('GOLD') || id.startsWith('SILVER');
}

/**
 * تفلتر قائمة التحديثات بحيث تكون العملة مؤهلة للبث إذا تحقق أحد الشرطين:
 *   1. التغير في السعر كبير بما يكفي بمفرده (MIN_PRICE_CHANGE للعملات، MIN_PRICE_CHANGE_PCT_PRECIOUS للمعادن).
 *   أو
 *   2. السعر تغير فعلياً (newVal !== oldVal) ومضت 60 دقيقة على الأقل منذ آخر نشر مؤكد للعملة
 *      باستخدام lastBroadcastState (يعتبر عدم وجود إدخال سابق مؤهلاً فورياً للنشر الأول).
 *   - الأولوية تُعطى للأقدم نشراً أولاً.
 */
function filterEligibleUpdates(
  updates: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[]
): { id?: string; name: string; oldVal: number; newVal: number; flag: string }[] {
  const now = Date.now();
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const THREE_HOURS_MS = 3 * ONE_HOUR_MS;

  return updates
    .filter(u => {
      const lastEntry = (u.id && lastBroadcastState[u.id]) || (u.name && lastBroadcastState[u.name]);
      const lastTime = lastEntry?.time || 0;
      const lastPrice = lastEntry?.price ?? u.oldVal;

      // ── شرط 0: انقطاع طويل (أكثر من 3 ساعات أو منذ أمس) ──────────────
      // إذا مر وقت طويل دون أي منشور للمتابعين (مثل اليوم التالي)، والبيانات مستخرجة وطازجة،
      // يتم اعتماد النشر لتزويد المتابعين بنشرة السوق المحدثة حتى لو كان السعر مستقراً.
      if (lastTime === 0 || (now - lastTime) >= THREE_HOURS_MS) {
        console.log(`[SmartBroadcast] 📢 Eligible "${u.name}": catch-up broadcast (last broadcast was ${lastTime === 0 ? 'never' : Math.floor((now - lastTime) / 3600000) + ' hours ago'})`);
        return true;
      }

      const diffFromOld = Math.abs(u.newVal - u.oldVal);
      const diffFromLastBroadcast = Math.abs(u.newVal - lastPrice);
      const effectiveDiff = Math.max(diffFromOld, diffFromLastBroadcast);

      // ── شرط 1: حجم التغيير كبير بما يكفي بمفرده ──────────────────────────────────
      let isLargeChange = false;
      const minThreshold = appConfig.minPriceChangeThreshold ?? MIN_PRICE_CHANGE;
      if (isPreciousMetal(u.id)) {
        // للمعادن: نسبة مئوية (0.5%) أو فارق مطلق 1 د.ل
        const baseVal = lastPrice > 0 ? lastPrice : (u.oldVal > 0 ? u.oldVal : 1);
        const pct = effectiveDiff / baseVal;
        isLargeChange = pct >= MIN_PRICE_CHANGE_PCT_PRECIOUS || effectiveDiff >= 1.0;
      } else {
        // للعملات العادية: فارق مطلق من الإعدادات
        isLargeChange = effectiveDiff >= minThreshold;
      }

      if (isLargeChange) {
        return true;
      }

      // ── شرط 2: تغير السعر فعلياً ومضت 60 دقيقة على الأقل منذ آخر نشر مؤكد ──
      const hasChanged = effectiveDiff > 0.0001;
      if (hasChanged && (now - lastTime) >= ONE_HOUR_MS) {
        return true;
      }

      const elapsedMin = Math.floor((now - lastTime) / 60000);
      console.log(
        `[SmartBroadcast] ⏳ Skipped "${u.name}": small change (${effectiveDiff.toFixed(4)}) and only ${elapsedMin}m elapsed since last broadcast`
      );
      return false;
    })
    // ── ترتيب الأولوية: الأقدم نشراً يُنشر أولاً ──────────────────────────
    .sort((a, b) => {
      const tA = (a.id && lastBroadcastState[a.id]?.time) || (a.name && lastBroadcastState[a.name]?.time) || 0;
      const tB = (b.id && lastBroadcastState[b.id]?.time) || (b.name && lastBroadcastState[b.name]?.time) || 0;
      return tA - tB;
    });
}

/**
 * يتحقق إذا كان مسموحاً بإرسال منشور جديد وفق الحد الأقصى للساعة.
 * يُنظّف الطوابع الزمنية القديمة (> ساعة) تلقائياً قبل الفحص.
 */
function canBroadcastNow(): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const limit = appConfig.hourlyPostLimit ?? BROADCAST_HOURLY_LIMIT;

  // إزالة الطوابع الأقدم من ساعة
  while (recentBroadcastTimestamps.length > 0 && recentBroadcastTimestamps[0] < oneHourAgo) {
    recentBroadcastTimestamps.shift();
  }

  if (recentBroadcastTimestamps.length >= limit) {
    const oldestMs = recentBroadcastTimestamps[0];
    const resetInMin = Math.ceil((oldestMs + 60 * 60 * 1000 - now) / 60000);
    console.log(
      `[SmartBroadcast] 🚫 Hourly limit reached (${recentBroadcastTimestamps.length}/${limit}). Next slot in ~${resetInMin}m`
    );
    return false;
  }

  return true;
}

/**
 * يسجّل وقت وسعر النشر في lastBroadcastState وفي SQLite و Supabase بعد كل بث ناجح فقط.
 */
function recordBroadcast(updates: { id?: string; name: string; newVal?: number; oldVal?: number; [key: string]: any }[]): void {
  const now = Date.now();
  recentBroadcastTimestamps.push(now);
  lastSocialBroadcastTime = now;

  for (const u of updates) {
    const key = u.id || u.name;
    if (!key) continue;

    const price = typeof u.newVal === 'number'
      ? u.newVal
      : (u.id && rates.parallel[u.id])
        ? rates.parallel[u.id]
        : (lastBroadcastState[key]?.price ?? 0);

    lastBroadcastState[key] = { price, time: now };
    if (u.id && u.name && u.name !== u.id) {
      lastBroadcastState[u.name] = { price, time: now };
    }

    // حفظ في SQLite
    try {
      db.prepare(`
        INSERT INTO broadcast_state (term_id, last_price, last_broadcast_time) 
        VALUES (?, ?, ?)
        ON CONFLICT(term_id) DO UPDATE SET 
          last_price = excluded.last_price,
          last_broadcast_time = excluded.last_broadcast_time
      `).run(key, price, now);
    } catch (err) {
      console.error("[BroadcastState] Local DB save error:", err);
    }

    // مزامنة مع Supabase في الخلفية
    if (supabase && supabaseKey && !supabaseKey.includes('dummy')) {
      supabase.from('broadcast_state').upsert({
        term_id: key,
        last_price: price,
        last_broadcast_time: now
      }).then(({ error }) => {
        if (error) console.error("[BroadcastState] Supabase sync error:", error);
      }, err => {
        console.error("[BroadcastState] Supabase sync error:", err);
      });
    }
  }

  console.log(
    `[SmartBroadcast] ✅ Recorded broadcast for: [${updates.map(u => u.id || u.name).join(', ')}] | Posts this hour: ${recentBroadcastTimestamps.length}/${BROADCAST_HOURLY_LIMIT}`
  );
}

export async function broadcastToSocialMedia(
  message: string,
  isTest: boolean = false,
  target: 'all' | 'telegram' | 'facebook' = 'all',
  isManual: boolean = false,
  market?: 'parallel' | 'official' | 'both',
  scheduledFacebook = false
) {
  const sentTargets: ('telegram' | 'facebook')[] = [];
  if (!await ensurePublishingOwnership()) throw new Error('النشر متوقف في هذه النسخة بانتظار استلام ملكية Worker أو استعادة حالة الطابور.');

  const isOfficial = market === 'official' || (!market && (message.includes('مصرف ليبيا المركزي') || message.includes('نشرة أسعار مصرف ليبيا المركزي')));
  const targetMarket: 'parallel' | 'official' | 'both' = market || (isOfficial ? 'official' : 'parallel');

  const hasPriceLink = message.includes('https://tinyurl.com/2j7667u2') ||
    message.includes(new URL(process.env.WEB_SERVER_URL || 'https://dollar-price-qp14.onrender.com/').origin);
  if (!isTest && hasPriceLink && !await ensureWebRatesReady(targetMarket)) {
    throw new Error(getWebRatesSyncError(targetMarket));
  }

  const manager = target !== 'facebook' ? getOrInitTelegramManager() : null;

  // Telegram
  const shouldPostTg = (target === 'telegram' || target === 'all') && (isManual || (!isTest && appConfig.telegramAutoPost) || isTest);
  if (shouldPostTg) {
    let tgChannel = (appConfig.telegramPostChannel || "").trim();
    if (tgChannel.includes('t.me/')) {
      tgChannel = tgChannel.split('t.me/')[1].split('/')[0].split('?')[0];
    }
    tgChannel = tgChannel.replace('@', '').trim();

    if (!tgChannel) {
      console.warn("[Telegram Broadcast] Skipping: No channel configured (telegramPostChannel is empty)");
      telegramBroadcastStatus = {
        status: 'error',
        lastError: 'لم يتم تحديد القناة',
        lastErrorTime: new Date().toISOString(),
        lastSuccessTime: telegramBroadcastStatus.lastSuccessTime
      };
      if (isTest && target === 'telegram') throw new Error("لا توجد قناة تيليجرام محددة للنشر.");
    } else if (!manager) {
      console.error("[Telegram Broadcast] Failed: Telegram credentials not initialized or missing");
      telegramBroadcastStatus = {
        status: 'error',
        lastError: 'بيانات أو جلسة تيليجرام غير مفعلة',
        lastErrorTime: new Date().toISOString(),
        lastSuccessTime: telegramBroadcastStatus.lastSuccessTime
      };
      if (isTest && target === 'telegram') throw new Error("بيانات تيليجرام غير مكتملة أو الجلسة غير مفعلة.");
    } else {
      let success = false;
      let lastErrMessage = "";
      const maxRetries = isTest ? 1 : 2;

      // One fresh website URL per publication; immediate retries reuse it.
      const shareUrl = getTelegramShareUrl();
      const tgText = isOfficial ? message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : message;
      const safeShareUrl = shareUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const tgMessage = tgText.replace(/https:\/\/tinyurl\.com\/2j7667u2|https:\/\/dollar-price-qp14\.onrender\.com(?:\/[^\s<>"')\]]*)?/g,
        () => isOfficial ? `<a href="${safeShareUrl}">tinyurl.com/2j7667u2</a>` : shareUrl);

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (publishingStopped || !ownsAccountLease()) throw new Error('توقفت ملكية النشر أثناء الإرسال.');
          success = await manager.sendMessage(tgChannel, tgMessage, { linkPreview: true, ...(isOfficial ? { parseMode: 'html' as const } : {}) });
          if (success) {
            break;
          } else {
            lastErrMessage = (manager as any).lastError || "فشل غير معروف";
            if ((manager as any).isAuthRevoked || lastErrMessage.includes("AUTH_KEY_DUPLICATED")) {
              console.warn(`[Telegram Broadcast] Telegram authorization invalidated (AUTH_KEY_DUPLICATED). Halting retry attempts.`);
              break;
            }
            if (attempt < maxRetries) {
              console.warn(`[Telegram Broadcast] Attempt ${attempt} failed: ${lastErrMessage}. Retrying in 2s...`);
              await delay(2000);
            }
          }
        } catch (e: any) {
          lastErrMessage = e.message || String(e);
          if ((manager as any).isAuthRevoked || lastErrMessage.includes("AUTH_KEY_DUPLICATED")) {
            console.warn(`[Telegram Broadcast] Telegram authorization invalidated (${lastErrMessage}). Halting retry attempts.`);
            break;
          }
          if (attempt < maxRetries) {
            console.warn(`[Telegram Broadcast] Exception in attempt ${attempt}: ${lastErrMessage}. Retrying in 2s...`);
            await delay(2000);
          }
        }
      }

      if (!success) {
        telegramBroadcastStatus = {
          status: 'error',
          lastError: lastErrMessage || "فشل إرسال الرسالة",
          lastErrorTime: new Date().toISOString(),
          lastSuccessTime: telegramBroadcastStatus.lastSuccessTime
        };
        console.error(`[Telegram Broadcast] Failed to send message to ${tgChannel}: ${lastErrMessage}`);
        if (isTest && target === 'telegram') {
          if (lastErrMessage.includes('CHAT_WRITE_FORBIDDEN') || lastErrMessage.includes('CHAT_ADMIN_REQUIRED')) {
            throw new Error(`حساب تيليجرام المربوط ليس مشرفاً في القناة @${tgChannel} أو لا يملك صلاحية نشر الرسائل.`);
          }
          throw new Error(`فشل إرسال الرسالة إلى القناة @${tgChannel}: ${lastErrMessage}`);
        }
      } else {
        telegramBroadcastStatus = {
          status: 'ok',
          lastError: '',
          lastErrorTime: telegramBroadcastStatus.lastErrorTime,
          lastSuccessTime: new Date().toISOString()
        };
        lastSocialBroadcastTime = Date.now();
        sentTargets.push('telegram');
        console.log(`[Telegram Broadcast] Successfully sent message to ${tgChannel}`);
      }
    }
  }

  // Facebook
  const localPublicationTime = getLibyaTimeInfo();
  const officialMorning = isOfficial && localPublicationTime.dayIndex < 5 && localPublicationTime.hour >= 9 && localPublicationTime.hour < 12;
  const shouldPostFb = (target === 'facebook' || target === 'all') &&
    (isManual || isTest || appConfig.facebookAutoPost && (scheduledFacebook || officialMorning));
  if (shouldPostFb) {
    if (!appConfig.facebookPageId || !appConfig.facebookAccessToken) {
      console.warn("[Facebook Broadcast] Skipping Facebook post: Page ID or Access Token missing");
      facebookBroadcastStatus = {
        status: 'error',
        lastError: 'معرف الصفحة أو رمز الوصول مفقود',
        lastErrorTime: new Date().toISOString(),
        lastSuccessTime: facebookBroadcastStatus.lastSuccessTime
      };
      if (isTest && target === 'facebook') throw new Error("بيانات فيسبوك غير مكتملة. يرجى إدخال معرف الصفحة ورمز وصول الصفحة أولاً.");
    } else {
      const fbMessage = facebookPostText(message);
      
      const maxRetries = isTest || scheduledFacebook ? 1 : 2;
      let lastFbError = "";

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (publishingStopped || !ownsAccountLease()) throw new Error('توقفت ملكية النشر أثناء الإرسال.');
          const targetId = appConfig.facebookPageId.trim() || 'me';
          const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(targetId)}/feed`;
          
          const payload: any = { message: fbMessage, access_token: appConfig.facebookAccessToken };

          let fbRes = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          let fbData = (await fbRes.json()) as FacebookApiResponse;

          if (!scheduledFacebook && fbData.error && (fbData.error.code === 100 || fbData.error.message?.includes('global id'))) {
            console.log("[Facebook Broadcast] Trying fallback to /me/feed...");
            const fallbackUrl = `https://graph.facebook.com/v20.0/me/feed`;
            const fallbackRes = await fetch(fallbackUrl, {
              signal: AbortSignal.timeout(15000),
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: fbMessage, access_token: appConfig.facebookAccessToken })
            });
            const fallbackData = (await fallbackRes.json()) as FacebookApiResponse;
            if (!fallbackData.error) {
              fbData = fallbackData;
              fbRes = fallbackRes;
            }
          }

          if (fbData.error || !fbRes.ok || !fbData.id) {
            if (!fbData.error) throw new Error(`Facebook acknowledgement missing (HTTP ${fbRes.status})`);
            lastFbError = fbData.error.message || "خطأ غير معروف في واجهة فيسبوك";
            if (attempt < maxRetries) {
              console.warn(`[Facebook Broadcast] Attempt ${attempt} failed: ${lastFbError}. Retrying in 2s...`);
              await delay(2000);
              continue;
            }
            facebookBroadcastStatus = { status: 'error', lastError: lastFbError, lastErrorTime: new Date().toISOString(), lastSuccessTime: facebookBroadcastStatus.lastSuccessTime };
            console.error("[Facebook Broadcast] Error:", lastFbError);
            if (isTest && target === 'facebook') {
              if (lastFbError.includes('global id') || fbData.error.code === 100) {
                throw new Error("المعرف المدخل هو معرف حساب شخصي وليس معرف صفحة عامة (Page). يجب استخدام معرف صفحة فيسبوك ورمز وصول الصفحة (Page Token).");
              }
              throw new Error(lastFbError);
            }
          } else {
            sentTargets.push('facebook');
            console.log("[Facebook Broadcast] Successfully posted, ID:", fbData.id);
            facebookBroadcastStatus = { status: 'ok', lastError: '', lastErrorTime: facebookBroadcastStatus.lastErrorTime, lastSuccessTime: new Date().toISOString() };
            // Facebook slots must not postpone Telegram's independent queue.
            
            // Add comment safely without breaking the main post status
            await addFacebookLinksComment(fbData.id!);
            break; // Done successfully
          }
        } catch(e: any) {
          lastFbError = e.message || String(e);
          if (attempt < maxRetries) {
            console.warn(`[Facebook Broadcast] Exception on attempt ${attempt}: ${lastFbError}. Retrying in 2s...`);
            await delay(2000);
            continue;
          }
          facebookBroadcastStatus = { status: 'error', lastError: lastFbError, lastErrorTime: new Date().toISOString(), lastSuccessTime: facebookBroadcastStatus.lastSuccessTime };
          console.error("[Facebook Broadcast] Failed:", e);
          if (isTest && target === 'facebook') throw e;
        }
      }
    }
  }

  if ((shouldPostTg && !sentTargets.includes('telegram')) || (shouldPostFb && !sentTargets.includes('facebook'))) {
    const errorDetails: string[] = [];
    if (shouldPostTg) errorDetails.push(`تيليجرام: ${telegramBroadcastStatus.lastError || 'فشل الاتصال'}`);
    if (shouldPostFb) errorDetails.push(`فيسبوك: ${facebookBroadcastStatus.lastError || 'فشل الاتصال'}`);
    throw Object.assign(new Error(`فشل النشر عبر الشبكات: ${errorDetails.join(' | ')}`), { sentTargets });
  }
  return { sentTargets };
}

async function addFacebookLinksComment(postId: string) {
  try {
    const response = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(postId)}/comments`, {
      signal: AbortSignal.timeout(15000), method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '📢 لمتابعة التحديثات لحظة بلحظة على تيليجرام:\n👉 https://tinyurl.com/m3m4jrd2\n\n🌐 الرسوم البيانية والتفاصيل الكاملة:\n👉 https://tinyurl.com/2j7667u2', access_token: appConfig.facebookAccessToken })
    });
    const result = await response.json() as FacebookApiResponse;
    if (response.ok === false || result.error || !result.id) throw new Error(result.error?.message || `HTTP ${response.status}`);
  } catch (error) {
    addLog('warn', 'نشر فيسبوك', 'نُشر المحتوى، لكن تعذر إضافة تعليق الروابط؛ لن يُكرر المنشور.', { stage: 'facebook-comment', postId, error: sanitizeErrorMessage(error) });
  }
}

export let lastOfficialBroadcastDate = "";
let officialSending = false;
let officialDelivery: {
  date: string;
  delivered: Partial<Record<'telegram' | 'facebook', boolean>>;
  attempts: Partial<Record<'telegram' | 'facebook', number>>;
  retryAt: Partial<Record<'telegram' | 'facebook', number>>;
  lastError?: string;
} = { date: '', delivered: {}, attempts: {}, retryAt: {} };
(async () => {
  try {
    if (db) {
      const row = db.prepare('SELECT value FROM server_config WHERE key = ?').get('last_official_broadcast_date') as { value: string } | undefined;
      if (row?.value) {
        lastOfficialBroadcastDate = row.value;
        console.log(`[Official Broadcast] Loaded lastOfficialBroadcastDate from SQLite: ${row.value}`);
      }
    }
    if (supabase) {
      const { data } = await supabase
        .from('server_config')
        .select('value')
        .eq('key', 'last_official_broadcast_date')
        .single();
      if (data?.value) {
        lastOfficialBroadcastDate = data.value;
        console.log(`[Official Broadcast] Loaded lastOfficialBroadcastDate from Supabase: ${data.value}`);
        if (db) {
          try {
            db.prepare(`
              INSERT INTO server_config (key, value) VALUES ('last_official_broadcast_date', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(data.value);
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('[Official Broadcast] Could not load lastOfficialBroadcastDate on startup:', e);
  }
})();

// Smart Queue (Debounce Buffer) to aggregate rapid price updates safely


const OFFICIAL_CURRENCIES_INFO: Record<string, { name: string; flag: string; rank: number }> = {
  USD: { name: 'دولار أمريكي', flag: '💵', rank: 1 },
  EUR: { name: 'يورو أوروبي', flag: '💶', rank: 2 },
  GBP: { name: 'جنيه إسترليني', flag: '💷', rank: 3 },
  TND: { name: 'دينار تونسي', flag: '🇹🇳', rank: 4 },
  EGP: { name: 'جنيه مصري', flag: '🇪🇬', rank: 5 },
  TRY: { name: 'ليرة تركية', flag: '🇹🇷', rank: 6 },
  AED: { name: 'درهم إماراتي', flag: '🇦🇪', rank: 7 },
  SAR: { name: 'ريال سعودي', flag: '🇸🇦', rank: 8 },
  JOD: { name: 'دينار أردني', flag: '🇯🇴', rank: 9 },
  KWD: { name: 'دينار كويتي', flag: '🇰🇼', rank: 10 },
  BHD: { name: 'دينار بحريني', flag: '🇧🇭', rank: 11 },
  QAR: { name: 'ريال قطري', flag: '🇶🇦', rank: 12 },
  CNY: { name: 'يوان صيني', flag: '🇨🇳', rank: 13 },
  CHF: { name: 'فرنك سويسري', flag: '🇨🇭', rank: 16 },
};

export function formatOfficialBulletin(
  prices: Record<string, number>, bulletinTime: Date | null,
  previous?: { prices: Record<string, number>; recordedAt: string }
) {
  const dateLabel = bulletinTime ? '' : 'وقت إعداد النشرة: ';
  bulletinTime = bulletinTime || new Date();
  const valid = (value: number) => Number.isFinite(value) && value > 0;
  const previousTime = Date.parse(previous?.recordedAt || '');
  const bulletinDay = getLibyaTimeInfo(bulletinTime).dateStr;
  const previousDay = Number.isFinite(previousTime) ? getLibyaTimeInfo(new Date(previousTime)).dateStr : '';
  const comparable = previousDay && previousDay < bulletinDay ? previous : undefined;
  const difference = (code: string) => comparable && valid(comparable.prices[code]) && valid(prices[code])
    ? (Math.round(prices[code] * 10000) - Math.round(comparable.prices[code] * 10000)) / 10000 : null;
  const date = bulletinTime.toLocaleDateString('ar-LY-u-nu-latn', { timeZone: 'Africa/Tripoli', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = bulletinTime.toLocaleTimeString('ar-LY-u-nu-latn', { timeZone: 'Africa/Tripoli', hour: '2-digit', minute: '2-digit', hour12: true });
  const lines = ['🏦 نشرة مصرف ليبيا المركزي الرسمية', `📅 ${dateLabel}${date} | ⏰ ${time} · طرابلس`, '━━━━━━━━━━━━━━━━━━━', ''];
  const currencyIds: string[] = [];
  for (const [title, codes] of [
    ['', ['USD', 'EUR', 'GBP', 'TND', 'EGP']],
    ['دول الخليج', ['AED', 'SAR', 'KWD', 'QAR', 'BHD']],
    ['عملات أخرى', ['JOD', 'TRY', 'CNY', 'CHF']],
  ] as const) {
    const available = codes.filter(code => valid(prices[code]));
    if (!available.length) continue;
    if (title) lines.push('', `─ ─ ─ ${title} ─ ─ ─`);
    for (const code of available) {
      const info = OFFICIAL_CURRENCIES_INFO[code], delta = !title ? difference(code) : null;
      lines.push(`${info.flag} ${info.name}  ${prices[code].toFixed(4)} د.ل${delta === null ? '' : delta > 0 ? '  ↑' : delta < 0 ? '  ↓' : '  ━'}`);
      currencyIds.push('OFFICIAL_' + code);
    }
  }
  const delta = difference('USD');
  const yesterday = getLibyaTimeInfo(new Date(Date.parse(bulletinDay + 'T00:00:00+02:00') - 86400000)).dateStr;
  const comparison = previousDay === yesterday ? 'بالأمس' : `بنشرة ${previousDay.split('-').reverse().join('/')}`;
  const summary = delta === null ? 'لم تتوفر قراءة سابقة موثوقة للدولار للمقارنة.'
    : delta === 0 ? `الدولار ثابت مقارنة ${comparison}`
    : `الدولار ${delta > 0 ? 'ارتفع' : 'انخفض'} ${Math.abs(delta).toFixed(4)} د.ل مقارنة ${comparison}`;
  lines.push('━━━━━━━━━━━━━━━━━━━', `💡 ${summary}`, '', '🌐 https://tinyurl.com/2j7667u2', '📱 المصدر: مصرف ليبيا المركزي');
  return { message: lines.join('\n'), currencyIds };
}

export async function broadcastOfficialRates(
  isTest: boolean = false, 
  target: 'all' | 'telegram' | 'facebook' = 'all',
  isManual: boolean = false
): Promise<boolean> {
  if (!await ensurePublishingOwnership()) return false;
  if (!Number.isFinite(rates.official.USD) || rates.official.USD <= 0) return false;
  const now = new Date();
  const libyaDateObj = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Tripoli' }));
  const yyyy = libyaDateObj.getFullYear();
  const mm = String(libyaDateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(libyaDateObj.getDate()).padStart(2, '0');
  const todayLibyaKey = `${yyyy}-${mm}-${dd}`;
  const dateStr = now.toLocaleDateString('ar-LY', { timeZone: 'Africa/Tripoli' });
  
  if (!isTest && !isManual && (lastOfficialBroadcastDate === todayLibyaKey || lastOfficialBroadcastDate === dateStr)) {
    console.log(`[Official Broadcast] Already broadcasted for today (${todayLibyaKey}). Skipping duplicate post.`);
    return true;
  }
  if (!isTest && !await ensureWebRatesReady('official')) {
    const error = getWebRatesSyncError('official');
    console.warn('[Official Broadcast]', error);
    addLog('warn', 'النشر الرسمي', 'النشرة محفوظة؛ لم تبدأ مرحلة الإرسال', { stage: 'web-sync', market: 'official', error });
    return false;
  }

  const prices = { ...rates.official };
  let bulletinTime: Date | null = null, previous: { prices: Record<string, number>; recordedAt: string } | undefined;
  if (supabase) {
    try {
      const latest = await supabase.from('official_rates').select('usd,rates,recorded_at')
        .lte('recorded_at', now.toISOString()).order('recorded_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(5000));
      if (latest.error) throw latest.error;
      const row = latest.data?.[0], time = Date.parse(row?.recorded_at || '');
      const saved = { ...row?.rates, USD: row?.rates?.USD ?? row?.usd };
      // previousOfficial remembers a different price, not necessarily yesterday's bulletin.
      if (Number.isFinite(time) && time > 0 && time <= now.getTime() && Object.keys(OFFICIAL_CURRENCIES_INFO).filter(code => Number.isFinite(prices[code]) && prices[code] > 0)
        .every(code => Number.isFinite(saved[code]) && Math.round(saved[code] * 10000) === Math.round(prices[code] * 10000))) {
        bulletinTime = new Date(time);
        const start = new Date(getLibyaTimeInfo(bulletinTime).dateStr + 'T00:00:00+02:00').toISOString();
        const older = await supabase.from('official_rates').select('usd,rates,recorded_at')
          .lt('recorded_at', start).order('recorded_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(5000));
        if (older.error) throw older.error;
        const prior = older.data?.[0];
        if (prior) previous = { prices: { ...prior.rates, USD: prior.rates?.USD ?? prior.usd }, recordedAt: prior.recorded_at };
      }
    } catch (error) {
      addLog('warn', 'النشر الرسمي', 'تعذرت قراءة النشرة السابقة؛ سيُنشر السعر دون مقارنة غير مؤكدة', { error: sanitizeErrorMessage(error) });
    }
  }
  const { message, currencyIds } = formatOfficialBulletin(prices, bulletinTime, previous);

  if (officialSending) return false;
  officialSending = true;
  try {
    const required: ('telegram' | 'facebook')[] = ['telegram', 'facebook'].filter(platform =>
      (target === 'all' || target === platform) && (isTest || isManual ||
       (platform === 'telegram' ? appConfig.telegramAutoPost : appConfig.facebookAutoPost && libyaDateObj.getDay() < 5 && libyaDateObj.getHours() >= 9 && libyaDateObj.getHours() < 12))) as ('telegram' | 'facebook')[];
    if (!required.length) {
      console.log("[Official Broadcast] No target platforms enabled for broadcast (telegramAutoPost/facebookAutoPost are off). Holding broadcast until enabled or manually triggered.");
      return false;
    }
    if (officialDelivery.date !== todayLibyaKey) officialDelivery = { date: todayLibyaKey, delivered: {}, attempts: {}, retryAt: {} };
    for (const platform of required) {
      if (!isTest && !isManual && (officialDelivery.delivered[platform] ||
          (officialDelivery.attempts[platform] || 0) > MAX_RETRY_ATTEMPTS ||
          (officialDelivery.retryAt[platform] || 0) > Date.now())) continue;
      try {
        await broadcastToSocialMedia(message, isTest, platform, isManual || isTest, 'official');
        if (!isTest) officialDelivery.delivered[platform] = true;
        addBroadcastLog({ platform, currency_ids: currencyIds,
          status: 'success', attempts: 1, is_test: isTest ? 1 : isManual ? 2 : 0 });
      } catch (err: any) {
        if (isTest) throw err;
        const attempt = (officialDelivery.attempts[platform] || 0) + 1;
        officialDelivery.attempts[platform] = attempt;
        officialDelivery.retryAt[platform] = Date.now() + RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 3);
        officialDelivery.lastError = sanitizeErrorMessage(err) || 'فشل النشر الرسمي';
        addBroadcastLog({ platform, currency_ids: currencyIds,
          status: 'failed', attempts: attempt, error_message: officialDelivery.lastError, is_test: isManual ? 2 : 0 });
      }
      if (!isTest) {
        persistBroadcastQueue();
        await flushBroadcastQueueState();
      }
    }
    const complete = isTest || required.every(platform => officialDelivery.delivered[platform]);
    if (complete && !isTest) {
      lastOfficialBroadcastDate = todayLibyaKey;
      db?.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run('last_official_broadcast_date', todayLibyaKey);
      if (supabase) {
        const { error } = await supabase.from('server_config').upsert({
          key: 'last_official_broadcast_date', value: todayLibyaKey, updated_at: new Date().toISOString()
        });
        if (error) console.error('[Official] Completion checkpoint failed:', error.message);
      }
      persistBroadcastQueue();
    }
    return complete;
  } finally { officialSending = false; }
}

/**
 * توحيد وفلترة تحديثات النشر:
 * - استبعاد صكوك المصارف (صكوك التجاري، صكوك الجمهورية، إلخ) من النشر نهائياً
 * - الاكتفاء بنشر "دولار أمريكي (صكوك)" (USD_CHECKS) فقط
 * - في حال وجود أي تحديث لصكوك تجاري أو جمهورية، يُحوّل إلى USD_CHECKS وتدمج التحديثات
 */
export function sanitizeBroadcastUpdates(
  updates: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[],
  isManual: boolean = false
): { id?: string; name: string; oldVal: number; newVal: number; flag: string }[] {
  const result: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[] = [];
  let checkUpdate: { id: string; name: string; oldVal: number; newVal: number; flag: string } | null = null;
  let cashUsdUpdate: { id?: string; name: string; oldVal: number; newVal: number; flag: string } | null = null;

  for (const u of updates) {
    const id = (u.id || '').toUpperCase();
    const name = u.name || '';

    if (id === 'USD') {
      cashUsdUpdate = u;
      result.push({
        ...u,
        name: 'دولار أمريكي (كاش)'
      });
      continue;
    }

    // التحقق إذا كان التحديث يخص الصكوك
    const isBankCheck = 
      id === 'USD_JBANK' || 
      id === 'USD_NCB' || 
      id === 'USD_BCD' || 
      id === 'USD_AB' || 
      id === 'USD_WB' ||
      name.includes('الجمهورية') || 
      name.includes('التجاري') ||
      name.includes('التجارة') ||
      name.includes('الأمان') ||
      name.includes('الامان') ||
      name.includes('الوحدة');

    const isGenericCheck = id === 'USD_CHECKS' || id === 'USD_SUKUK' || name.includes('صكوك') || name.includes('شيك');

    if (isBankCheck || isGenericCheck) {
      if (!checkUpdate) {
        checkUpdate = {
          id: 'USD_CHECKS',
          name: 'دولار أمريكي (صكوك مصرفية)',
          oldVal: u.oldVal,
          newVal: u.newVal,
          flag: 'us'
        };
      } else {
        // نأخذ القيمة الأحدث إذا تكررت الصكوك
        checkUpdate.newVal = u.newVal;
      }
    } else {
      result.push(u);
    }
  }

  if (checkUpdate) {
    // 🛡️ فحص أمان صارم: التأكد من أن سعر الصكوك ليس مطابقاً بالخطأ لسعر الكاش
    const cashPrice = cashUsdUpdate?.newVal || rates?.parallel?.['USD'] || 0;
    if (!isManual && cashPrice > 0 && Math.abs(checkUpdate.newVal - cashPrice) < 0.05) {
      console.warn(`[SanitizeBroadcast] ⚠️ تم استبعاد دولار الصكوك من المنشور لأن سعره (${checkUpdate.newVal}) مطابق لسعر الدولار كاش (${cashPrice}).`);
    } else {
      result.push(checkUpdate);
    }
  }

  return result;
}

// ─── Smart Broadcast Queue State & Interface ─────────────────────────────────
export interface QueuedRateUpdate {
  manual?: boolean;
  id: string;
  name: string;
  oldVal: number;
  newVal: number;
  flag: string;
  firstSeenAt: number;
  lastSeenAt: number;
  updateCount: number;
  delivered?: Partial<Record<'telegram' | 'facebook', boolean>>;
  attempts?: Partial<Record<'telegram' | 'facebook', number>>;
  retryAt?: Partial<Record<'telegram' | 'facebook', number>>;
  lastError?: string;
  targets?: ('telegram' | 'facebook')[];
  headerTitle?: string;
}

function canDeliverQueuedItem(item: QueuedRateUpdate, platform: 'telegram' | 'facebook', isManual = false) {
  return (isManual || platform === 'telegram') && (!item.targets || item.targets.includes(platform)) && !item.delivered?.[platform] &&
    (isManual || (item.attempts?.[platform] || 0) <= MAX_RETRY_ATTEMPTS && (item.retryAt?.[platform] || 0) <= Date.now());
}

export let smartBroadcastQueue: Map<string, QueuedRateUpdate> = new Map();
export let smartBroadcastAggregationTimer: NodeJS.Timeout | null = null;
export let smartBroadcastAggregationTimerStartedAt: number | null = null;
export let smartBroadcastWatchdogInterval: NodeJS.Timeout | null = null;

export function isQuietHoursActive(): { isActive: boolean; reason?: string; quietStart: string; quietEnd: string } {
  const quietStart = appConfig.quietHoursStart || "01:00";
  const quietEnd = appConfig.quietHoursEnd || "08:30";

  if (!appConfig.quietHoursEnabled) {
    return { isActive: false, quietStart, quietEnd };
  }

  const [startH, startM] = quietStart.split(':').map(Number);
  const [endH, endM] = quietEnd.split(':').map(Number);

  const now = new Date();
  const libya = getLibyaTimeInfo(now);
  const curMinutes = libya.hour * 60 + libya.minute;
  const startMinutes = (isNaN(startH) ? 1 : startH) * 60 + (isNaN(startM) ? 0 : startM);
  const endMinutes = (isNaN(endH) ? 8 : endH) * 60 + (isNaN(endM) ? 30 : endM);

  let inRange = false;
  if (startMinutes <= endMinutes) {
    inRange = curMinutes >= startMinutes && curMinutes < endMinutes;
  } else {
    inRange = curMinutes >= startMinutes || curMinutes < endMinutes;
  }

  return {
    isActive: inRange,
    reason: inRange ? `وضع الصمت الليلي نشط (${quietStart} إلى ${quietEnd})` : undefined,
    quietStart,
    quietEnd
  };
}

export function removeQueueItem(itemIdOrKey: string): { success: boolean; removedName?: string; remainingCount: number } {
  if (!itemIdOrKey) return { success: false, remainingCount: smartBroadcastQueue.size };
  const targetKey = itemIdOrKey.toUpperCase();
  let foundKey: string | null = null;
  let removedName = "";

  for (const [key, item] of smartBroadcastQueue.entries()) {
    if (key === targetKey || (item.id && item.id.toUpperCase() === targetKey) || item.name === itemIdOrKey) {
      foundKey = key;
      removedName = item.name;
      break;
    }
  }

  if (foundKey) {
    smartBroadcastQueue.delete(foundKey);
    persistBroadcastQueue();
    if (smartBroadcastQueue.size === 0 && smartBroadcastAggregationTimer) {
      clearTimeout(smartBroadcastAggregationTimer);
      smartBroadcastAggregationTimer = null;
      smartBroadcastAggregationTimerStartedAt = null;
    }
    return { success: true, removedName, remainingCount: smartBroadcastQueue.size };
  }

  return { success: false, remainingCount: smartBroadcastQueue.size };
}

export function getBroadcastQueuePreview(): { 
  message: string; 
  itemCount: number; 
  charactersCount: number; 
  linesCount: number;
  items: { id: string; name: string; newVal: number; oldVal: number; diff: number; flag: string }[] 
} {
  const rawQueuedItems = Array.from(smartBroadcastQueue.values()).map(item => ({
    id: item.id,
    name: item.name,
    oldVal: item.oldVal,
    newVal: item.newVal,
    flag: item.flag
  }));

  if (rawQueuedItems.length === 0) {
    return {
      message: "⚠️ طابور التحديثات فارغ حالياً (لا توجد عملات بانتظار النشر).",
      itemCount: 0,
      charactersCount: 0,
      linesCount: 0,
      items: []
    };
  }

  const sanitized = sanitizeBroadcastUpdates(rawQueuedItems, false);
  const message = formatSmartBroadcastMessage(sanitized);

  return {
    message,
    itemCount: sanitized.length,
    charactersCount: message.length,
    linesCount: message.split('\n').length,
    items: sanitized.map(u => ({
      id: u.id || '',
      name: u.name,
      newVal: u.newVal,
      oldVal: u.oldVal,
      diff: Number((u.newVal - u.oldVal).toFixed(3)),
      flag: u.flag
    }))
  };
}

export function getBroadcastQueueStatus() {
  const now = Date.now();
  const minIntervalMs = Math.max(1, appConfig.minBroadcastIntervalMinutes ?? 20) * 60 * 1000;
  const timeSinceLast = lastSocialBroadcastTime ? (now - lastSocialBroadcastTime) : 999999999;
  const isCooldownActive = timeSinceLast < minIntervalMs;
  const cooldownRemainingMs = isCooldownActive ? Math.max(0, minIntervalMs - timeSinceLast) : 0;
  const cooldownRemainingSeconds = Math.ceil(cooldownRemainingMs / 1000);
  const cooldownTotalSeconds = Math.round(minIntervalMs / 1000);

  // Quiet hours check
  const quietHours = isQuietHoursActive();

  // Aggregation window status
  const aggWindowMs = Math.max(10, appConfig.aggregationWindowSeconds ?? 45) * 1000;
  let aggregationRemainingMs = 0;
  if (smartBroadcastAggregationTimer && smartBroadcastAggregationTimerStartedAt) {
    aggregationRemainingMs = Math.max(0, aggWindowMs - (now - smartBroadcastAggregationTimerStartedAt));
  }
  const isAggregating = !!smartBroadcastAggregationTimer;
  const aggregationRemainingSeconds = Math.ceil(aggregationRemainingMs / 1000);

  // Next broadcast wait seconds
  let nextBroadcastWaitSeconds = 0;
  if (isCooldownActive) {
    nextBroadcastWaitSeconds = cooldownRemainingSeconds;
  } else if (isAggregating) {
    nextBroadcastWaitSeconds = aggregationRemainingSeconds;
  }

  const items = Array.from(smartBroadcastQueue.values()).map(item => ({
    id: item.id,
    name: item.name,
    oldVal: item.oldVal,
    newVal: item.newVal,
    diff: Number((item.newVal - item.oldVal).toFixed(3)),
    flag: item.flag,
    ageSeconds: Math.floor((now - item.firstSeenAt) / 1000),
    updateCount: item.updateCount,
    targets: item.targets || [],
    delivered: item.delivered || {},
    attempts: item.attempts || {},
    retryAt: item.retryAt || {},
    lastError: item.lastError || ''
  }));

  return {
    queueSize: smartBroadcastQueue.size,
    checkpoint: { ...queueCheckpointStatus },
    weekly: { date: weeklyDelivery.date, delivered: weeklyDelivery.delivered, attempts: weeklyDelivery.attempts,
      retryAt: weeklyDelivery.retryAt, lastError: weeklyDelivery.lastError || '' },
    facebookSchedule: { ...facebookSchedule, times: getFacebookPostTimes(appConfig.facebookPostTimes), enabled: !!appConfig.facebookAutoPost },
    items,
    lastSocialBroadcastTime,
    isCooldownActive,
    cooldownRemainingMs,
    cooldownRemainingSeconds,
    cooldownTotalSeconds,
    cooldownRemainingMinutes: Math.ceil(cooldownRemainingMs / 60000),
    isAggregating,
    aggregationRemainingSeconds,
    nextBroadcastWaitSeconds,
    quietHours,
    quietHoursEnabled: !!appConfig.quietHoursEnabled,
    quietHoursStart: appConfig.quietHoursStart || "01:00",
    quietHoursEnd: appConfig.quietHoursEnd || "08:30",
    minBroadcastIntervalMinutes: appConfig.minBroadcastIntervalMinutes ?? 20,
    minIntervalMinutes: appConfig.minBroadcastIntervalMinutes ?? 20,
    minPriceChangeThreshold: appConfig.minPriceChangeThreshold ?? 0.015,
    aggregationWindowSeconds: appConfig.aggregationWindowSeconds ?? 45,
    hourlyPostLimit: appConfig.hourlyPostLimit ?? 4,
    recentPostsThisHour: recentBroadcastTimestamps.filter(t => t > now - 3600000).length
  };
}

export function clearBroadcastQueue(resetCooldown: boolean = true): { count: number; cooldownReset: boolean; cooldownRemainingSeconds: number } {
  if (smartBroadcastAggregationTimer) {
    clearTimeout(smartBroadcastAggregationTimer);
    smartBroadcastAggregationTimer = null;
  }
  smartBroadcastAggregationTimerStartedAt = null;
  const count = smartBroadcastQueue.size;
  smartBroadcastQueue.clear();
  persistBroadcastQueue();

  if (resetCooldown) {
    // تصفير وقت الانتظار وبدء العد التنازلي من جديد من اللحظة الحالية
    lastSocialBroadcastTime = Date.now();
  }

  const minIntervalMs = Math.max(1, appConfig.minBroadcastIntervalMinutes ?? 20) * 60 * 1000;
  const cooldownRemainingSeconds = resetCooldown 
    ? Math.round(minIntervalMs / 1000) 
    : Math.max(0, Math.ceil((minIntervalMs - (Date.now() - (lastSocialBroadcastTime || 0))) / 1000));

  return {
    count,
    cooldownReset: resetCooldown,
    cooldownRemainingSeconds
  };
}

export function resetBroadcastCooldown(toZero: boolean = false): { cooldownRemainingSeconds: number } {
  if (toZero) {
    lastSocialBroadcastTime = 0;
    return { cooldownRemainingSeconds: 0 };
  } else {
    lastSocialBroadcastTime = Date.now();
    const minIntervalMs = Math.max(1, appConfig.minBroadcastIntervalMinutes ?? 20) * 60 * 1000;
    return { cooldownRemainingSeconds: Math.round(minIntervalMs / 1000) };
  }
}

let queueSending = false;
let publishingStopped = false;
let publishingGeneration = -1;
let publishingRestore: Promise<boolean> | null = null;
export const queueCheckpointStatus = { lastSavedAt: 0, lastError: '' };
let weeklyDelivery: {
  date: string; message: string;
  imageBase64?: string;
  delivered: Partial<Record<'telegram' | 'facebook', boolean>>;
  attempts: Partial<Record<'telegram' | 'facebook', number>>;
  retryAt: Partial<Record<'telegram' | 'facebook', number>>;
  lastError?: string;
} = { date: '', message: '', delivered: {}, attempts: {}, retryAt: {} };
let weeklySending = false;

let facebookSchedule: { date: string; slots: Record<string, 'sending' | 'posted' | 'skipped' | 'uncertain'>; revision: string; lastError: string } =
  { date: '', slots: {}, revision: '', lastError: '' };
let facebookScheduleSending = false;
let facebookScheduleRetryAt = 0;

export async function processFacebookSchedule(): Promise<boolean> {
  if (!appConfig.facebookAutoPost || publishingStopped || facebookScheduleSending || Date.now() < facebookScheduleRetryAt) return false;
  const now = new Date(), local = getLibyaTimeInfo(now);
  const minute = local.hour * 60 + local.minute;
  const times = getFacebookPostTimes(appConfig.facebookPostTimes);
  const slot = times.find(time => { const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)); return minute >= start && minute < start + 30; });
  if (!slot || facebookSchedule.date === local.dateStr && facebookSchedule.slots[slot]) return false;
  facebookScheduleSending = true;
  let sending = false;
  try {
    if (!await ensurePublishingOwnership()) return false;
    if (facebookSchedule.date !== local.dateStr) facebookSchedule = { date: local.dateStr, slots: {}, revision: facebookSchedule.revision, lastError: '' };
    if (facebookSchedule.slots[slot] || Object.values(facebookSchedule.slots).filter(status => status !== 'skipped').length >= 3) return false;
    if (!appConfig.facebookPageId || !appConfig.facebookAccessToken || !supabase) throw new Error('إعدادات صفحة فيسبوك أو قاعدة البيانات غير مكتملة.');
    const weeklyAge = now.getTime() - Date.parse(weeklyDelivery.date + 'T23:59:59+02:00');
    const weeklyPending = weeklyDelivery.message && !weeklyDelivery.delivered.facebook && weeklyAge >= 0 && weeklyAge < 7 * 86400000;
    if (weeklyPending && weeklySending) return false;
    let message = '', revision = facebookSchedule.revision;
    if (!weeklyPending) {
      const result = await supabase.from('parallel_rates').select('usd,rates,recorded_at')
        .order('recorded_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(5000));
      if (result.error) throw result.error;
      const row = result.data?.[0], timestamp = Date.parse(row?.recorded_at || '');
      const prices: Record<string, number> = { ...row?.rates, USD: row?.rates?.USD ?? row?.usd };
      if (!Number.isFinite(timestamp) || timestamp > now.getTime() || now.getTime() - timestamp > 12 * 3600000 ||
          !Number.isFinite(prices.USD) || prices.USD <= 0 || !Number.isFinite(prices.EUR) || prices.EUR <= 0) throw new Error('الأسعار المحفوظة غير مكتملة أو أقدم من 12 ساعة؛ لن تنشر نشرة قديمة.');
      if (!await ensureWebRatesReady('parallel')) throw new Error(getWebRatesSyncError('parallel'));
      if (prices.USD !== rates.parallel.USD || prices.EUR !== rates.parallel.EUR) throw new Error('تغيرت الأسعار أثناء تجهيز النشرة؛ إعادة التحقق في المحاولة القادمة.');
      const currencies = [['USD', 'دولار كاش'], ['USD_CHECKS', 'دولار صكوك'], ['EUR', 'يورو'], ['GBP', 'جنيه إسترليني'], ['TND', 'دينار تونسي'], ['EGP', 'جنيه مصري']];
      const metals = [['GOLD_SCRAP_18', 'ذهب كسر 18'], ['GOLD_SCRAP_21', 'ذهب كسر 21'], ['GOLD_CAST_24', 'ذهب مسبوك 24'], ['SILVER_CAST_1000', 'مسبوك فضة']];
      const available = (items: string[][]) => items.filter(([id]) => Number.isFinite(prices[id]) && prices[id] > 0);
      const shownCurrencies = available(currencies), shownMetals = available(metals);
      revision = JSON.stringify([...shownCurrencies, ...shownMetals].map(([id]) => [id, prices[id]]));
      if (revision === facebookSchedule.revision) {
        facebookSchedule.slots[slot] = 'skipped';
        addLog('info', 'نشرات فيسبوك', `تجاوز نشرة ${slot}: لا تغير في الأسعار منذ آخر نشرة.`, { stage: 'facebook-schedule', date: local.dateStr, slot });
        persistBroadcastQueue(); await flushBroadcastQueueState(); return false;
      }
      const period = local.hour < 12 ? 'صباحًا' : local.hour < 16 ? 'ظهرًا' : 'مساءً';
      const time = `${String(local.hour % 12 || 12).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
      const title = `تحديث ${time} ${period} | سوق المشير`;
      const previousPrices = new Map<string, number>();
      try {
        const saved = JSON.parse(facebookSchedule.revision || '[]');
        if (Array.isArray(saved)) for (const entry of saved) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0) previousPrices.set(entry[0], entry[1]);
        }
      } catch { /* An older checkpoint without prices cannot establish a comparison. */ }
      const lines = (items: string[][]) => items.map(([id, name]) => {
        const digits = id === 'EGP' ? 4 : 3;
        const price = prices[id].toFixed(digits), previous = previousPrices.get(id);
        const change = previous === undefined ? '' : Number(price) - Number(previous.toFixed(digits));
        const direction = change === '' ? '' : change > 0 ? ' ↑' : change < 0 ? ' ↓' : ' ━';
        return `${name}: ${price} د.ل${direction}`;
      }).join('\n');
      const comparison = [...shownCurrencies, ...shownMetals].some(([id]) => previousPrices.has(id))
        ? '\n\nمقارنة بآخر نشرة فيسبوك: ↑ ارتفاع · ↓ انخفاض · ━ استقرار' : '';
      const difference = prices.USD_CHECKS - prices.USD;
      const gap = prices.USD_CHECKS > 0 ? Math.abs(difference) < 0.0005 ? '\nسعر الدولار بالكاش والصكوك متقارب؛ الفارق أقل من 0.001 د.ل.' :
        `\nالدولار بالصكوك ${difference > 0 ? 'أعلى من' : 'أقل من'} الكاش بـ ${Math.abs(difference).toFixed(3)} د.ل لكل دولار.` : '';
      message = `${title}\nمؤشر الدينار | العملات والمعادن\n\nالسوق الموازي · الأسعار المتاحة لكل وحدة عملة\n${lines(shownCurrencies)}${shownMetals.length ? '\n\nالمعادن · سعر الجرام\n' + lines(shownMetals) : ''}${comparison}\n${gap}\n\nالأسعار للاسترشاد وليست عروض تنفيذ ملزمة.`;
    }
    if (Date.now() >= Date.parse(`${local.dateStr}T${slot}:00+02:00`) + 30 * 60000) return false;
    // A crash after provider acceptance is ambiguous: never blindly replay this slot.
    facebookSchedule.slots[slot] = 'sending'; facebookSchedule.lastError = '';
    persistBroadcastQueue(); await flushBroadcastQueueState();
    if (queueCheckpointStatus.lastError || !ownsAccountLease() || publishingStopped) {
      delete facebookSchedule.slots[slot]; throw new Error(queueCheckpointStatus.lastError || 'توقفت ملكية النشر.');
    }
    sending = true;
    if (weeklyPending) {
      await processWeeklyBroadcastQueue(true);
      if (!weeklyDelivery.delivered.facebook) throw new Error(weeklyDelivery.lastError || 'تعذر نشر صورة الحصاد.');
    } else {
      const result = await broadcastToSocialMedia(message, false, 'facebook', false, 'parallel', true);
      if (!result.sentTargets.includes('facebook')) throw new Error('لم تؤكد صفحة فيسبوك إرسال النشرة.');
    }
    facebookSchedule.slots[slot] = 'posted'; facebookSchedule.revision = revision;
    addBroadcastLog({ platform: 'facebook', currency_ids: weeklyPending ? ['WEEKLY'] : ['MARKET_SNAPSHOT'], status: 'success', attempts: 1 });
    addLog('info', 'نشرات فيسبوك', `نُشرت نشرة ${slot}؛ الروابط في أول تعليق.`, { stage: 'facebook-schedule', date: local.dateStr, slot });
    persistBroadcastQueue(); await flushBroadcastQueueState();
    return true;
  } catch (error) {
    facebookSchedule.lastError = sanitizeErrorMessage(error) || 'تعذر تجهيز نشرة فيسبوك.';
    if (sending && slot) facebookSchedule.slots[slot] = 'uncertain';
    facebookScheduleRetryAt = Date.now() + 5 * 60000;
    addLog('error', 'نشرات فيسبوك', sending ? 'تعذر تأكيد النشر؛ راجع الصفحة قبل أي إعادة إرسال يدوية.' : 'تعذر تجهيز النشرة؛ ستُعاد المحاولة ضمن نافذة الموعد فقط.', {
      stage: 'facebook-schedule', date: local.dateStr, slot, error: facebookSchedule.lastError, requiresManualReview: sending
    });
    persistBroadcastQueue(); await flushBroadcastQueueState();
    return false;
  } finally { facebookScheduleSending = false; }
}

export async function queueWeeklyReport(message: string, date: string, imageBase64?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !message || message.length > 10000 ||
      imageBase64 !== undefined && (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) || imageBase64.length > 7 * 1024 * 1024)) throw new Error('Invalid weekly bulletin');
  if (!await ensurePublishingOwnership()) throw new Error('بانتظار ملكية Worker لتجهيز النشرة الأسبوعية.');
  if (weeklyDelivery.date !== date) weeklyDelivery = { date, message, imageBase64, delivered: {}, attempts: {}, retryAt: {} };
  persistBroadcastQueue();
  await flushBroadcastQueueState();
  return processWeeklyBroadcastQueue();
}

export async function processWeeklyBroadcastQueue(facebookSlot = false): Promise<boolean> {
  if (weeklySending || !weeklyDelivery.message || publishingStopped) return false;
  const required = (['telegram', 'facebook'] as const).filter(platform =>
    platform === 'telegram' ? appConfig.telegramAutoPost : appConfig.facebookAutoPost);
  const pending = required.filter(platform => (facebookSlot ? platform === 'facebook' : platform === 'telegram') && !weeklyDelivery.delivered[platform] &&
    (weeklyDelivery.attempts[platform] || 0) <= MAX_RETRY_ATTEMPTS && (weeklyDelivery.retryAt[platform] || 0) <= Date.now());
  if (!pending.length || !facebookSlot && (isQuietHoursActive().isActive || !canBroadcastNow())) return false;
  weeklySending = true;
  try {
    if (!await ensurePublishingOwnership()) return false;
    for (const platform of pending) {
      if (weeklyDelivery.delivered[platform]) continue;
      await flushBroadcastQueueState();
      if (queueCheckpointStatus.lastError) return false;
      if (publishingStopped || !ownsAccountLease()) return false;
      try {
        if (weeklyDelivery.imageBase64) {
          const image = Buffer.from(weeklyDelivery.imageBase64.slice('data:image/png;base64,'.length), 'base64');
          if (image.length < 24 || image.length > 5 * 1024 * 1024 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('صورة الحصاد المحفوظة غير صالحة.');
          if (platform === 'telegram') {
            const manager = getOrInitTelegramManager(), channel = (appConfig.telegramPostChannel || '').trim();
            if (!manager || !channel) throw new Error('إعدادات نشر صورة الحصاد في تيليجرام غير مكتملة.');
            const caption = weeklyDelivery.message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            if (!await manager.sendFile(channel, image, { caption, filename: `weekly-harvest-${weeklyDelivery.date}.png`, parseMode: 'html' })) throw new Error(manager.lastError || 'تعذر إرسال صورة الحصاد إلى تيليجرام.');
          } else {
            if (!appConfig.facebookPageId || !appConfig.facebookAccessToken) throw new Error('إعدادات صفحة فيسبوك غير مكتملة.');
            const form = new FormData();
            form.set('source', new Blob([image], { type: 'image/png' }), `weekly-harvest-${weeklyDelivery.date}.png`);
            form.set('caption', facebookPostText(weeklyDelivery.message));
            form.set('alt_text_custom', facebookPostText(weeklyDelivery.message).split('\n').slice(0, 6).join(' '));
            const response = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(appConfig.facebookPageId)}/photos`, {
              method: 'POST', headers: { Authorization: `Bearer ${appConfig.facebookAccessToken}` }, body: form, signal: AbortSignal.timeout(20000)
            });
            const result: any = await response.json();
            if (!response.ok || result?.error || !result?.id) throw new Error(result?.error?.message || `Facebook photo upload failed (${response.status}).`);
            weeklyDelivery.delivered.facebook = true;
            await addFacebookLinksComment(result.post_id || result.id);
          }
        } else await broadcastToSocialMedia(weeklyDelivery.message, false, platform, false, undefined, facebookSlot);
        weeklyDelivery.delivered[platform] = true;
        if (platform === 'telegram') recentBroadcastTimestamps.push(Date.now());
        addBroadcastLog({ platform, currency_ids: ['WEEKLY'], status: 'success', attempts: (weeklyDelivery.attempts[platform] || 0) + 1 });
      } catch (err) {
        const attempt = (weeklyDelivery.attempts[platform] || 0) + 1;
        weeklyDelivery.attempts[platform] = attempt;
        weeklyDelivery.retryAt[platform] = Date.now() + RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 3);
        weeklyDelivery.lastError = sanitizeErrorMessage(err) || 'فشل إرسال الحصاد الأسبوعي';
        addBroadcastLog({ platform, currency_ids: ['WEEKLY'], status: 'failed', attempts: attempt, error_message: weeklyDelivery.lastError });
      }
      persistBroadcastQueue();
      await flushBroadcastQueueState();
    }
    const complete = required.length > 0 && required.every(platform => weeklyDelivery.delivered[platform]);
    if (complete) {
      weeklyDelivery.lastError = '';
      persistBroadcastQueue();
      await flushBroadcastQueueState();
    }
    return complete;
  } finally { weeklySending = false; }
}

async function ensurePublishingOwnership(): Promise<boolean> {
  if (publishingStopped || !await ensureAccountLease()) return false;
  const generation = getAccountLeaseGeneration();
  if (publishingGeneration !== generation) {
    if (!publishingRestore) publishingRestore = (async () => {
      if (!await loadBroadcastQueueState(true)) return false;
      await loadRecentBroadcastTimestamps();
      if (!ownsAccountLease() || publishingStopped) return false;
      publishingGeneration = generation;
      return true;
    })().finally(() => { publishingRestore = null; });
    if (!await publishingRestore) return false;
  }
  return !publishingStopped && ownsAccountLease();
}

export function stopSocialPublishing() {
  publishingStopped = true;
  if (smartBroadcastWatchdogInterval) clearInterval(smartBroadcastWatchdogInterval);
  if (smartBroadcastAggregationTimer) clearTimeout(smartBroadcastAggregationTimer);
  smartBroadcastWatchdogInterval = null;
  smartBroadcastAggregationTimer = null;
}
let queueBackupTimer: NodeJS.Timeout | null = null;
let queueBackupWrite: Promise<unknown> = Promise.resolve();
function queueSnapshot() {
  return JSON.stringify({ items: [...smartBroadcastQueue.entries()], official: officialDelivery, weekly: weeklyDelivery, facebookSchedule,
    lastSocialBroadcastTime, savedAt: Date.now() });
}
function persistBroadcastQueue() {
  try { db?.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run('worker_broadcast_queue', queueSnapshot()); }
  catch (err) { console.error('[Queue] Local checkpoint failed:', err); }
  if (queueBackupTimer || !supabase || !ownsAccountLease() || publishingStopped) return;
  queueBackupTimer = setTimeout(() => { void flushBroadcastQueueState(); }, 1000);
}
export async function flushBroadcastQueueState() {
  if (queueBackupTimer) clearTimeout(queueBackupTimer);
  queueBackupTimer = null;
  if (!supabase || !ownsAccountLease()) return;
  if (publishingGeneration !== getAccountLeaseGeneration() && !await ensurePublishingOwnership()) return;
  const value = queueSnapshot();
  const generation = getAccountLeaseGeneration();
  queueBackupWrite = queueBackupWrite.catch(() => {}).then(async () => {
    if (!ownsAccountLease() || generation !== getAccountLeaseGeneration()) return;
    const { error } = await supabase.from('server_config').upsert({
      key: 'worker_broadcast_queue', value, updated_at: new Date().toISOString()
    });
    if (error) throw error;
    queueCheckpointStatus.lastSavedAt = Date.now();
    queueCheckpointStatus.lastError = '';
  }).catch(err => {
    queueCheckpointStatus.lastError = sanitizeErrorMessage(err) || 'تعذر حفظ الطابور سحابيًا';
    addLog('error', 'حفظ الطابور', queueCheckpointStatus.lastError, { stage: 'queue-checkpoint' });
  });
  await queueBackupWrite;
}

function validDeliveryProgress(state: any): boolean {
  return ['delivered', 'attempts', 'retryAt'].every(field => {
    const value = state?.[field];
    if (value === undefined) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value).every(([platform, entry]) =>
      ['telegram', 'facebook'].includes(platform) && (field === 'delivered' ?
        typeof entry === 'boolean' : typeof entry === 'number' && Number.isFinite(entry) && entry >= 0));
  });
}

export async function loadBroadcastQueueState(mergePending = false): Promise<boolean> {
  let saved: any;
  const pendingAtStart = new Map(smartBroadcastQueue);
  try {
    const row = db?.prepare('SELECT value FROM server_config WHERE key = ?').get('worker_broadcast_queue') as {value: string} | undefined;
    if (row?.value) {
      try { saved = JSON.parse(row.value); }
      catch { console.warn('[Queue] Ignoring malformed local checkpoint.'); }
    }
    if (supabase) {
      const { data, error } = await supabase.from('server_config').select('value').eq('key', 'worker_broadcast_queue').single();
      if (mergePending && error && error.code !== 'PGRST116') throw error;
      if (!error && data?.value) {
        try {
          const remote = JSON.parse(data.value);
          if (mergePending && !Array.isArray(remote?.items)) throw new Error('Invalid remote queue checkpoint');
          if (Array.isArray(remote?.items) && (mergePending || !saved || remote.savedAt > saved.savedAt)) saved = remote;
        } catch (err) { if (mergePending) throw err; console.warn('[Queue] Ignoring malformed remote checkpoint.'); }
      }
    }
    if (mergePending && Number.isFinite(saved?.savedAt)) {
      const remoteKeys = new Set((saved.items || []).map(([key]: [string, any]) => key));
      for (const [key, item] of smartBroadcastQueue) {
        if (!remoteKeys.has(key) && item === pendingAtStart.get(key) && item.lastSeenAt <= saved.savedAt) smartBroadcastQueue.delete(key);
      }
    }
    for (const entry of (Array.isArray(saved?.items) ? saved.items : []).slice(0, 100)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, item] = entry;
      if (typeof key === 'string' && item?.id === key && typeof item.name === 'string' && typeof item.flag === 'string' &&
          Number.isFinite(item.newVal) && item.newVal > 0 && Number.isFinite(item.oldVal) &&
          Number.isFinite(item.firstSeenAt) && Number.isFinite(item.lastSeenAt) && Number.isFinite(item.updateCount) &&
          (item.targets === undefined || Array.isArray(item.targets) && item.targets.length > 0 &&
            item.targets.every((target: string) => ['telegram', 'facebook'].includes(target))) &&
          (item.headerTitle === undefined || typeof item.headerTitle === 'string') &&
          (item.lastError === undefined || typeof item.lastError === 'string') && validDeliveryProgress(item)) {
        const pending = smartBroadcastQueue.get(key);
        if (!mergePending || !pending || pending === pendingAtStart.get(key) && pending.lastSeenAt <= item.lastSeenAt) smartBroadcastQueue.set(key, item);
      }
    }
    if (Number.isFinite(saved?.lastSocialBroadcastTime)) lastSocialBroadcastTime = saved.lastSocialBroadcastTime;
    if (saved?.facebookSchedule && /^\d{4}-\d{2}-\d{2}$/.test(saved.facebookSchedule.date) &&
        saved.facebookSchedule.slots && typeof saved.facebookSchedule.slots === 'object' && !Array.isArray(saved.facebookSchedule.slots) &&
        Object.entries(saved.facebookSchedule.slots).length <= 1440 && Object.entries(saved.facebookSchedule.slots).every(([time, status]) =>
          /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && ['sending', 'posted', 'skipped', 'uncertain'].includes(String(status))) &&
        typeof saved.facebookSchedule.revision === 'string' && saved.facebookSchedule.revision.length < 4000 &&
        typeof saved.facebookSchedule.lastError === 'string') facebookSchedule = saved.facebookSchedule;
    if (typeof saved?.official?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.official.date) &&
        saved.official.delivered && saved.official.attempts && saved.official.retryAt && validDeliveryProgress(saved.official)) {
      officialDelivery = saved.official;
    }
    if (typeof saved?.weekly?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.weekly.date) &&
        typeof saved.weekly.message === 'string' && saved.weekly.message.length <= 10000 && validDeliveryProgress(saved.weekly) &&
        saved.weekly.delivered && saved.weekly.attempts && saved.weekly.retryAt &&
        (saved.weekly.imageBase64 === undefined || /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(saved.weekly.imageBase64) && saved.weekly.imageBase64.length <= 7 * 1024 * 1024)) weeklyDelivery = saved.weekly;

    // Old automatic Facebook price items are replaced by authoritative scheduled snapshots.
    for (const [key, item] of smartBroadcastQueue) {
      if (item.manual === true) continue;
      item.targets = (item.targets || ['telegram', 'facebook']).filter(platform => platform === 'telegram');
      if (!item.targets.length || item.delivered?.telegram) smartBroadcastQueue.delete(key);
    }
    return true;
  } catch (err) {
    queueCheckpointStatus.lastError = sanitizeErrorMessage(err) || 'تعذر استعادة الطابور';
    console.warn('[Queue] Restore failed:', queueCheckpointStatus.lastError);
    return false;
  }
}

async function deliverQueuedUpdates(
  updates: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[],
  target: 'all' | 'telegram' | 'facebook',
  isManual: boolean,
  customHeaderTitle?: string
) {
  if (queueSending) return { success: false, count: 0, message: 'هناك نشر قيد التنفيذ، يرجى الانتظار.' };
  if (!await ensurePublishingOwnership()) return { success: false, count: 0, message: 'بانتظار استلام ملكية النشر أو استعادة حالة الطابور.' };
  if (queueSending) return { success: false, count: 0, message: 'هناك نشر قيد التنفيذ، يرجى الانتظار.' };
  queueSending = true;
  const snapshot = [...smartBroadcastQueue.entries()].filter(([, item]) =>
    updates.some(u => (u.id || u.name) === item.id));
  const platforms: ('telegram' | 'facebook')[] = target === 'all' ? ['telegram', 'facebook'] : [target];
  let failed = false;
  try {
    for (const platform of platforms) {
      const pending = snapshot.filter(([, item]) => canDeliverQueuedItem(item, platform, isManual));
      if (!pending.length) continue;
      addLog('info', 'طابور النشر', `بدء محاولة نشر ${pending.length} عملة على ${platform}`, {
        stage: 'queue-delivery', platform, currencies: pending.map(([, item]) => item.id), isManual
      });
      try {
        const headers = new Set(pending.map(([, item]) => item.headerTitle));
        const header = customHeaderTitle || (headers.size === 1 ? pending[0]?.[1].headerTitle : '📊 *مؤشر الدينار | نشرة الأسعار*');
        const sent = await executeBroadcast(pending.map(([, item]) => item), false, platform, true, isManual, header);
        if (!sent) { failed = true; continue; }
        for (const [, item] of pending) item.delivered = { ...item.delivered, [platform]: true };
      } catch (err: any) {
        failed = true;
        for (const [, item] of pending) {
          const attempt = (item.attempts?.[platform] || 0) + 1;
          item.attempts = { ...item.attempts, [platform]: attempt };
          item.retryAt = { ...item.retryAt, [platform]: Date.now() + RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 3) };
          item.lastError = sanitizeErrorMessage(err) || 'فشل النشر';
        }
        addLog('error', 'طابور النشر', `تعذر النشر على ${platform}؛ التحديثات محفوظة`, {
          stage: 'queue-delivery', platform, error: sanitizeErrorMessage(err),
          retries: pending.map(([, item]) => ({ currency: item.id, attempt: item.attempts?.[platform],
            retryAt: (item.attempts?.[platform] || 0) > MAX_RETRY_ATTEMPTS ? null : new Date(item.retryAt![platform]!).toISOString(),
            requiresManualRetry: (item.attempts?.[platform] || 0) > MAX_RETRY_ATTEMPTS }))
        });
      }
      persistBroadcastQueue();
      await flushBroadcastQueueState();
    }
    let count = 0;
    for (const [key, item] of snapshot) {
      if ((item.targets || platforms).every(platform => item.delivered?.[platform])) {
        if (smartBroadcastQueue.get(key) === item) smartBroadcastQueue.delete(key);
        count++;
      } else failed = true;
    }
    persistBroadcastQueue();
    await flushBroadcastQueueState();
    return { success: !failed, count, message: failed ?
      'لم يكتمل النشر لكل المنصات. التحديثات غير المرسلة محفوظة في الطابور.' :
      'تم نشر التحديثات بنجاح.' };
  } finally { queueSending = false; }
}

export async function flushBroadcastQueueImmediately(target?: 'all' | 'telegram' | 'facebook', isManual = true) {
  if (!smartBroadcastQueue.size) return { success: true, count: 0, message: 'طابور التحديثات فارغ حالياً.' };
  if (smartBroadcastAggregationTimer) clearTimeout(smartBroadcastAggregationTimer);
  smartBroadcastAggregationTimer = null;
  smartBroadcastAggregationTimerStartedAt = null;
  const resolved = target || (appConfig.telegramAutoPost && appConfig.facebookAutoPost ? 'all' :
    appConfig.telegramAutoPost ? 'telegram' : appConfig.facebookAutoPost ? 'facebook' : null);
  if (!resolved) return { success: false, count: 0, message: 'لم يتم تفعيل أي منصة للنشر.' };
  if (isManual) {
    const selected: ('telegram' | 'facebook')[] = resolved === 'all' ? ['telegram', 'facebook'] : [resolved];
    for (const item of smartBroadcastQueue.values()) item.targets = [...new Set([...(item.targets || []), ...selected])];
    for (const item of smartBroadcastQueue.values()) item.manual = true;
    persistBroadcastQueue();
  }
  return deliverQueuedUpdates([...smartBroadcastQueue.values()], resolved, isManual);
}

export async function processSmartBroadcastQueue(): Promise<boolean> {
  if (smartBroadcastQueue.size === 0 || queueSending) return false;
  if (!appConfig.telegramAutoPost && !appConfig.facebookAutoPost) return false;
  const platforms = (['telegram', 'facebook'] as const).filter(platform =>
    platform === 'telegram' ? appConfig.telegramAutoPost : appConfig.facebookAutoPost);
  const dispatchable = [...smartBroadcastQueue.values()].filter(item => platforms.some(platform => canDeliverQueuedItem(item, platform)));
  if (!dispatchable.length) return false;

  // 🌙 فحص ساعات الصمت الليلي لمنع إزعاج المتابعين أثناء الليل
  const quietCheck = isQuietHoursActive();
  if (quietCheck.isActive) {
    console.log(`[SmartBroadcastQueue] 🌙 Quiet hours active (${quietCheck.reason}). Holding ${smartBroadcastQueue.size} items in queue until morning.`);
    return false;
  }

  const retryItems = dispatchable.filter(item => item.lastError);
  if (retryItems.length) {
    const target = appConfig.telegramAutoPost && appConfig.facebookAutoPost ? 'all' :
      appConfig.telegramAutoPost ? 'telegram' : 'facebook';
    return (await deliverQueuedUpdates(retryItems, target, false)).success;
  }
  const now = Date.now();
  const minIntervalMs = Math.max(1, appConfig.minBroadcastIntervalMinutes ?? 20) * 60 * 1000;
  const timeSinceLast = lastSocialBroadcastTime ? (now - lastSocialBroadcastTime) : 999999999;

  if (timeSinceLast < minIntervalMs) {
    const remainingMin = Math.ceil((minIntervalMs - timeSinceLast) / 60000);
    console.log(`[SmartBroadcastQueue] ⏳ Cooldown active (${Math.floor(timeSinceLast/60000)}m elapsed / ${appConfig.minBroadcastIntervalMinutes ?? 20}m required). Retaining ${smartBroadcastQueue.size} items in queue (next slot in ~${remainingMin}m).`);
    return false;
  }

  if (!canBroadcastNow()) {
    console.log(`[SmartBroadcastQueue] 🚫 Hourly post cap reached. Retaining ${smartBroadcastQueue.size} items in queue.`);
    return false;
  }

  const rawQueuedItems = dispatchable.map(item => ({
    id: item.id,
    name: item.name,
    oldVal: item.oldVal,
    newVal: item.newVal,
    flag: item.flag
  }));

  const eligibleUpdates = filterEligibleUpdates(rawQueuedItems);

  if (eligibleUpdates.length === 0) {
    console.log(`[SmartBroadcastQueue] ⏭ None of the ${rawQueuedItems.length} queued items reached threshold. Retaining buffer.`);
    return false;
  }

  let toBroadcast = eligibleUpdates;
  if (appConfig.smartConsolidatedPost !== false) {
    toBroadcast = rawQueuedItems;
  }

  console.log(`[SmartBroadcastQueue] 🚀 Cooldown clear! Dispatching consolidated bulletin for ${toBroadcast.length} currencies...`);
  const resolvedTarget: 'all' | 'telegram' | 'facebook' =
    (appConfig.telegramAutoPost && appConfig.facebookAutoPost) ? 'all'
    : appConfig.telegramAutoPost ? 'telegram'
    : 'facebook';

  const result = await deliverQueuedUpdates(toBroadcast, resolvedTarget, false);
  return result.success;
}

// Queue watchdog timer running every 30 seconds
if (!smartBroadcastWatchdogInterval) {
  smartBroadcastWatchdogInterval = setInterval(() => {
    processFacebookSchedule().catch(e => console.error('[Facebook Schedule]', sanitizeErrorMessage(e)));
    processWeeklyBroadcastQueue().catch(e => console.error('[Weekly Queue] Retry failed:', sanitizeErrorMessage(e)));
    if (smartBroadcastQueue.size > 0 && !smartBroadcastAggregationTimer) {
      processSmartBroadcastQueue().catch(e => console.error("[SmartBroadcastQueue] Watchdog cycle error:", e));
    }
  }, 30000);
}

export async function broadcastRateChanges(
  updates: {id?: string, name: string, oldVal: number, newVal: number, flag: string}[], 
  isTest: boolean = false, 
  target: 'all' | 'telegram' | 'facebook' = 'all',
  isManual: boolean = false,
  customHeaderTitle?: string
) {
  if ((isManual || isTest) && !await ensurePublishingOwnership()) throw new Error('بانتظار استلام ملكية النشر في نسخة Worker الحالية.');
  if (!isTest && !isManual && !appConfig.telegramAutoPost && !appConfig.facebookAutoPost) {
    return;
  }
  if (updates.length === 0) {
    return;
  }

  if (isTest) {
    console.log(`[SmartBroadcast] ⚡ Executing IMMEDIATE broadcast for ${updates.length} items (isManual=${isManual}, bypassing cooldowns)`);
    await executeBroadcast(updates, isTest, target, true, isManual);
    return;
  }

  updates = sanitizeBroadcastUpdates(updates, isManual);
  let targets: ('telegram' | 'facebook')[] = target !== 'all' ? [target] :
    (['telegram', 'facebook'] as const).filter(platform => isManual ||
      (platform === 'telegram' ? appConfig.telegramAutoPost : appConfig.facebookAutoPost));
  if (!isManual) targets = targets.filter(platform => platform === 'telegram' && appConfig.telegramAutoPost);
  if (!targets.length) return;
  const now = Date.now();
  for (const u of updates) {
    const key = (u.id || u.name).toUpperCase();
    const existing = smartBroadcastQueue.get(key);
    if (existing && existing.newVal === u.newVal) {
      existing.lastSeenAt = now;
      existing.updateCount++;
      existing.targets = [...new Set([...(existing.targets || []), ...targets])];
      continue;
    }
    if (existing) {
      smartBroadcastQueue.set(key, {
        ...existing,
        manual: isManual,
        targets,
        headerTitle: customHeaderTitle,
        delivered: u.newVal === existing.newVal ? existing.delivered : {},
        attempts: u.newVal === existing.newVal ? existing.attempts : {},
        retryAt: u.newVal === existing.newVal ? existing.retryAt : {},
        lastError: u.newVal === existing.newVal ? existing.lastError : '',
        name: u.name || existing.name,
        newVal: u.newVal,
        flag: u.flag || existing.flag,
        lastSeenAt: now,
        updateCount: existing.updateCount + 1
      });
    } else {
      smartBroadcastQueue.set(key, {
        manual: isManual,
        id: u.id || key,
        targets,
        headerTitle: customHeaderTitle,
        name: u.name,
        oldVal: u.oldVal,
        newVal: u.newVal,
        flag: u.flag,
        firstSeenAt: now,
        lastSeenAt: now,
        updateCount: 1
      });
    }
  }

  console.log(`[SmartBroadcastQueue] 📥 Buffered ${updates.length} items. Current queue size: ${smartBroadcastQueue.size} items.`);
  addLog('info', 'طابور النشر', `أُضيفت ${updates.length} عملة بعد حفظ الأسعار`, {
    stage: 'queue', currencies: updates.map(u => u.id || u.name), targets, queueSize: smartBroadcastQueue.size
  });

  persistBroadcastQueue();
  if (isManual) {
    const result = await deliverQueuedUpdates(updates, target, true, customHeaderTitle);
    if (!result.success) throw new Error(result.message);
    return;
  }
  const aggWindowMs = Math.max(10, appConfig.aggregationWindowSeconds ?? 45) * 1000;
  if (!smartBroadcastAggregationTimer) {
    smartBroadcastAggregationTimerStartedAt = Date.now();
    smartBroadcastAggregationTimer = setTimeout(() => {
      smartBroadcastAggregationTimer = null;
      smartBroadcastAggregationTimerStartedAt = null;
      processSmartBroadcastQueue().catch(e => console.error("[SmartBroadcastQueue] Queue processing error:", e));
    }, aggWindowMs);
  }
}

// ─── ترتيب مخصص لعرض العملات في نص الرسالة المنشورة ───────────────────────
const BROADCAST_DISPLAY_ORDER: string[] = [
  'USD',          // 1. الدولار الأمريكي (كاش)
  'USD_CHECKS',   // 2. الدولار الأمريكي (صكوك)
  'EUR',          // 3. اليورو
  'GBP',          // 4. الجنيه الإسترليني
  'TND',          // 5. الدينار التونسي
  'EGP',          // 6. الجنيه المصري
  'JOD',          // 7. الدينار الأردني
  'USD_TR',       // 8. حوالات تركيا
  'USD_AE',       // حوالات دبي
  'USD_CN',       // حوالات الصين
];

export function getBroadcastDisplayRank(u: { id?: string; name?: string }): number {
  const id = (u.id || '').toUpperCase();
  const name = u.name || '';

  if (
    id === 'USD' || 
    (name.includes('دولار') && !name.includes('صك') && !name.includes('شيك') && !name.includes('رسمي') && !name.includes('حوال') && !id.includes('OFFICIAL') && !id.includes('TR') && !id.includes('AE') && !id.includes('CN'))
  ) {
    return 10;
  }

  if (
    id === 'USD_CHECKS' ||
    id === 'USD_SUKUK' ||
    name.includes('صكوك') ||
    name.includes('صك') ||
    name.includes('شيك')
  ) {
    return 20;
  }

  if (id === 'EUR' || name.includes('يورو')) return 30;
  if (id === 'GBP' || name.includes('إسترليني') || name.includes('استرليني') || name.includes('باوند')) return 40;
  if (id === 'TND' || name.includes('تونسي')) return 50;
  if (id === 'EGP' || name.includes('مصري')) return 60;
  if (id === 'JOD' || name.includes('أردني') || name.includes('اردني')) return 70;

  if (id === 'USD_TR' || (name.includes('حوال') && (name.includes('تركيا') || name.includes('تركي')))) return 81;
  if (id === 'USD_AE' || (name.includes('حوال') && (name.includes('دبي') || name.includes('امارات') || name.includes('إمارات')))) return 82;
  if (id === 'USD_CN' || (name.includes('حوال') && (name.includes('صين') || name.includes('الصين')))) return 83;

  if (id === 'GOLD_SCRAP_18' || id === 'GOLD') return 901;
  if (id === 'GOLD_SCRAP_21') return 902;
  if (id === 'GOLD_CAST_18') return 903;
  if (id === 'GOLD_CAST_21') return 904;
  if (id === 'GOLD_CAST_24') return 905;
  if (id === 'GOLD_EXT_18') return 906;
  if (id === 'GOLD_EXT_21') return 907;
  if (id === 'GOLD_LIRA_8G') return 908;
  if (id === 'GOLD_LIRA_14G') return 909;
  if (id === 'GOLD_MUJARA_14G') return 910;
  if (id === 'SILVER_CAST_1000' || id === 'SILVER') return 920;
  if (id === 'SILVER_SCRAP') return 921;

  return 9999;
}

export function formatSmartBroadcastMessage(
  updates: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[],
  customHeaderTitle?: string
): string {
  const now = new Date();
  const libyaInfo = getLibyaTimeInfo(now);
  
  const daysInArabic = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const dayName = daysInArabic[libyaInfo.dayIndex];
  
  const dateStr = `${libyaInfo.dateObj.getDate()}/${libyaInfo.dateObj.getMonth() + 1}/${libyaInfo.dateObj.getFullYear()}`;
  
  let hours = libyaInfo.hour;
  const period = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12 || 12;
  const mins = String(libyaInfo.minute).padStart(2, '0');
  const timeStr = `${hours}:${mins} ${period}`;

  const flagMap: Record<string, string> = {
    'us': '🇺🇸', 'eu': '🇪🇺', 'gb': '🇬🇧', 'uk': '🇬🇧', 'eg': '🇪🇬', 'tn': '🇹🇳', 
    'tr': '🇹🇷', 'ae': '🇦🇪', 'cn': '🇨🇳', 'sa': '🇸🇦', 'jo': '🇯🇴', 'kw': '🇰🇼', 
    'qa': '🇶🇦', 'bh': '🇧🇭', 'ca': '🇨🇦', 'au': '🇦🇺', 'ch': '🇨🇭', 'jp': '🇯🇵',
    'se': '🇸🇪', 'no': '🇳🇴', 'dk': '🇩🇰', 'gold': '🥇', 'silver': '🪙'
  };

  const sorted = [...updates].sort((a, b) => getBroadcastDisplayRank(a) - getBroadcastDisplayRank(b));

  const formatItemBlock = (u: typeof sorted[0]) => {
    const isUp = u.newVal > u.oldVal;
    const isDown = u.newVal < u.oldVal;
    const diff = Math.abs(u.newVal - u.oldVal);

    let fe = flagMap[(u.flag || '').toLowerCase()] || '💰';
    if (u.id === 'USD') fe = '🇺🇸';
    else if (u.id === 'USD_CHECKS' || u.id === 'USD_JBANK' || u.id === 'USD_NCB' || u.id === 'USD_BCD' || u.id === 'USD_AB' || u.id === 'USD_WB' || u.id === 'USD_SUKUK') fe = '🏦';
    else if (u.id === 'EUR') fe = '🇪🇺';
    else if (u.id === 'GBP') fe = '🇬🇧';
    else if (u.id === 'TRY' || u.id === 'USD_TR') fe = '🇹🇷';
    else if (u.id === 'EGP') fe = '🇪🇬';
    else if (u.id === 'TND') fe = '🇹🇳';
    else if (u.id === 'AED' || u.id === 'USD_AE') fe = '🇦🇪';
    else if (u.id === 'CNY' || u.id === 'USD_CN') fe = '🇨🇳';
    else if (u.id === 'SAR') fe = '🇸🇦';
    else if (u.id === 'JOD') fe = '🇯🇴';
    else if (u.id === 'KWD') fe = '🇰🇼';
    else if (u.id === 'QAR') fe = '🇶🇦';
    else if (u.id === 'BHD') fe = '🇧🇭';
    else if (u.id?.startsWith('GOLD') || u.flag === 'gold') fe = '🥇';
    else if (u.id?.startsWith('SILVER') || u.flag === 'silver') fe = '🪙';

    let displayName = u.name;
    if (u.id === 'USD' && !displayName.includes('كاش')) {
      displayName = 'دولار أمريكي (كاش)';
    } else if (u.id === 'USD_CHECKS' && !displayName.includes('صكوك')) {
      displayName = 'دولار أمريكي (صكوك مصرفية)';
    }

    const isMetal = u.id?.startsWith('GOLD') || u.id?.startsWith('SILVER');
    const decimals = isMetal ? 2 : 3;

    let changeText = `🟢 استقرار عند ${u.newVal.toFixed(decimals)} د.ل`;
    if (isUp) {
      changeText = `🔺 ارتفاع بمقدار ${diff.toFixed(decimals)} (كان ${u.oldVal.toFixed(decimals)})`;
    } else if (isDown) {
      changeText = `🔻 انخفاض بمقدار ${diff.toFixed(decimals)} (كان ${u.oldVal.toFixed(decimals)})`;
    }

    return `${fe} *${displayName}*\n💵 السعر: *${u.newVal.toFixed(decimals)} د.ل*\n📊 التغير: ${changeText}`;
  };

  const titleLine = customHeaderTitle || `📊 *مؤشر الدينار | تحديث السوق الموازي*`;
  let message = `${titleLine}\n`;
  message += `━━━━━━━━━━━━━━━━━━━\n`;
  message += `📅 ${dayName}، ${dateStr} | ⏰ ${timeStr}\n\n`;

  message += sorted.map(formatItemBlock).join('\n\n') + `\n\n`;

  message += `━━━━━━━━━━━━━━━━━━━\n`;
  message += `🔗 *المتابعة الحية والرسوم البيانية:*\n`;
  message += `🌐 https://tinyurl.com/2j7667u2\n`;
  message += `📱 *المصدر:* شبكة مؤشر الدينار`;

  return message;
}

export async function executeBroadcast(
  updates: {id?: string, name: string, oldVal: number, newVal: number, flag: string}[],
  isTest = false,
  target: 'all' | 'telegram' | 'facebook' = 'all',
  skipFilters = false,
  isManual = false,
  customHeaderTitle?: string
) {
  updates = sanitizeBroadcastUpdates(updates, isManual);
  const unique = new Map<string, typeof updates[0]>();
  for (const update of updates) {
    const key = update.id || update.name;
    unique.set(key, { ...update, oldVal: unique.get(key)?.oldVal ?? update.oldVal });
  }
  updates = [...unique.values()];
  if (!updates.length) return false;
  if (!isTest && !skipFilters && !isManual) {
    updates = filterEligibleUpdates(updates);
    if (!updates.length) return false;
    if (!canBroadcastNow()) {
      await broadcastRateChanges(updates, false, target);
      return false;
    }
  }
  const start = Date.now();
  try {
    if (!isTest && !await ensureWebRatesReady('parallel')) throw new Error(getWebRatesSyncError('parallel'));
    const result = await broadcastToSocialMedia(formatSmartBroadcastMessage(updates, customHeaderTitle), isTest, target, isManual, 'parallel');
    if (!result.sentTargets.length) return false;
    if (!isTest) recordBroadcast(updates);
    for (const platform of result.sentTargets) addBroadcastLog({
      platform, currency_ids: updates.map(u => u.id || u.name), status: 'success',
      attempts: 1, duration_ms: Date.now() - start, error_message: null, is_test: isTest ? 1 : isManual ? 2 : 0
    });
    return true;
  } catch (err: any) {
    addBroadcastLog({ platform: target === 'all' ? 'both' : target,
      currency_ids: updates.map(u => u.id || u.name), status: 'failed', attempts: 1,
      duration_ms: Date.now() - start, error_message: err.message || String(err), is_test: isTest ? 1 : isManual ? 2 : 0 });
    throw err;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// إرسال رسائل الزوار المباشرة إلى الرسائل المحفوظة في حساب تيليجرام
// ───────────────────────────────────────────────────────────────────────────

export interface VisitorMessagePayload {
  id?: number | bigint | string;
  name?: string;
  email: string;
  phone: string;
  message: string;
  ip?: string;
  userAgent?: string;
  referrer?: string;
  createdAt?: string;
}

export async function forwardVisitorMessageToTelegram(data: VisitorMessagePayload): Promise<boolean> {
  const manager = getOrInitTelegramManager();
  if (!manager) {
    console.error("[Visitor Messages] TelegramManager not initialized. Please verify Telegram session credentials.");
    return false;
  }

  // تنظيف وتجهيز رقم الهاتف لرابط واتساب المباشر (دعم الأرقام الليبية 09X والأرقام الدولية)
  let cleanPhone = (data.phone || '').replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('00218')) {
    cleanPhone = cleanPhone.slice(2);
  } else if (cleanPhone.startsWith('0') && cleanPhone.length >= 10) {
    cleanPhone = '218' + cleanPhone.slice(1);
  } else if (!cleanPhone.startsWith('218') && cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
    cleanPhone = '218' + cleanPhone;
  }
  const whatsappUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : '';

  // التوقيت المحلي الدقيق لدولة ليبيا (طرابلس)
  const timeStr = data.createdAt || new Date().toLocaleString('ar-LY', { 
    timeZone: 'Africa/Tripoli',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const escapeHtml = (text: string) => (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const safeName = escapeHtml(data.name?.trim() || 'غير محدد');
  const safeEmail = escapeHtml(data.email?.trim() || '');
  const safePhone = escapeHtml(data.phone?.trim() || '');
  const safeMessage = escapeHtml(data.message?.trim() || '');
  const safeIp = escapeHtml(data.ip?.trim() || 'غير متوفر');
  const rawUa = (data.userAgent || 'غير متوفر').slice(0, 150);
  const safeUserAgent = escapeHtml(rawUa);
  const safeReferrer = escapeHtml((data.referrer || '').slice(0, 100));

  const htmlMsg = [
    `📬 <b>رسالة جديدة من زائر الموقع</b>`,
    `━━━━━━━━━━━━━━━━━━━`,
    data.id ? `🆔 <b>رقم الرسالة:</b> <code>#${data.id}</code>` : '',
    `👤 <b>الاسم:</b> ${safeName}`,
    `📧 <b>البريد:</b> <code>${safeEmail}</code> (<a href="mailto:${safeEmail}">إرسال بريد</a>)`,
    `📱 <b>الهاتف:</b> <code>${safePhone}</code>${whatsappUrl ? ` (<a href="${whatsappUrl}">محادثة واتساب</a>)` : ''}`,
    `━━━━━━━━━━━━━━━━━━━`,
    `📝 <b>نص الرسالة:</b>`,
    `<blockquote>${safeMessage}</blockquote>`,
    `━━━━━━━━━━━━━━━━━━━`,
    `🌐 <b>بيانات تقنية للزائر:</b>`,
    `📍 <b>عنوان الـ IP:</b> <code>${safeIp}</code>`,
    `💻 <b>المتصفح/الجهاز:</b> <code>${safeUserAgent}</code>`,
    safeReferrer ? `🔗 <b>المصدر:</b> <code>${safeReferrer}</code>` : '',
    `⏰ <b>التوقيت:</b> ${timeStr}`
  ].filter(Boolean).join('\n');

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const success = await manager.sendMessage('me', htmlMsg, { parseMode: 'html', linkPreview: false });
      if (success) {
        console.log(`[Visitor Messages] Message #${data.id || 'new'} delivered successfully to Telegram Saved Messages.`);
        return true;
      }
      console.warn(`[Visitor Messages] Delivery attempt ${attempt} failed: ${manager.lastError || 'Unknown error'}`);
    } catch (err: any) {
      console.warn(`[Visitor Messages] Delivery attempt ${attempt} threw exception: ${err.message || err}`);
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.error(`[Visitor Messages] Failed to forward visitor message #${data.id || 'new'} to Telegram after ${maxAttempts} attempts.`);
  return false;
}

