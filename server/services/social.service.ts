import { TelegramManager, getTelegramManager } from '../../telegramClient';
import { appConfig, telegramManager, setTelegramManager } from '../config';
import { rates } from '../state';
import { db, supabase, supabaseKey } from '../db';
import { addBroadcastLog } from './broadcastLog.service';
import { delay, getPublicAppUrl, getLibyaTimeInfo } from '../utils/helpers';

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
      // Support both integer millisecond and ISO string timestamp schemas in Supabase
      const { data, error } = await supabase
        .from('broadcast_log')
        .select('created_at')
        .eq('status', 'success')
        .or(`created_at.gte.${oneHourAgo},created_at.gte.${new Date(oneHourAgo).toISOString()}`)
        .order('created_at', { ascending: true });

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
           WHERE status = 'success' AND (created_at >= ? OR created_at >= ?)`
        )
        .all(oneHourAgo, new Date(oneHourAgo).toISOString()) as { created_at: string | number }[];

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

// ─── Pending Queue (تحديثات مُؤجَّلة بسبب حد الساعة) ──────────────────────
interface PendingBroadcast {
  updates: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[];
  target: 'all' | 'telegram' | 'facebook';
  addedAt: number;
}
/** قائمة انتظار للتحديثات المرفوضة بسبب حد الساعة — تُعالَج بمجرد تحرر فتحة */
const pendingBroadcastQueue: PendingBroadcast[] = [];

/** أقصى عمر لتحديث في قائمة الانتظار = 3 ساعات، بعدها يُحذف */
const MAX_PENDING_AGE_MS = 3 * 60 * 60 * 1000;

/** watchdog timer للتحقق من قائمة الانتظار كل 5 دقائق */
let pendingWatchdogTimer: NodeJS.Timeout | null = null;
// ───────────────────────────────────────────────────────────────────────────

// ─── Retry Engine (إعادة المحاولة عند فشل الإرسال) ────────────────────────
interface RetryJob {
  message: string;
  target: 'all' | 'telegram' | 'facebook';
  updates: { id?: string; name: string; newVal?: number; oldVal?: number; [key: string]: any }[];
  attempts: number;
  nextRetryAt: number;
  startTime?: number;
  lastError?: string;
}
/** قائمة مهام إعادة المحاولة بعد فشل الإرسال */
const retryQueue: RetryJob[] = [];

export function getRetryQueueCount(): number {
  return retryQueue.length;
}

/** الحد الأقصى لمحاولات الإعادة = 3 */
const MAX_RETRY_ATTEMPTS = 3;

/** مضاعف التأخير بين المحاولات (Exponential Backoff) بالميللي ثانية */
const RETRY_BASE_DELAY_MS = 30 * 1000; // 30 ثانية، 60، 120

/** timer لمحرك إعادة المحاولة */
let retryEngineTimer: NodeJS.Timeout | null = null;
// ───────────────────────────────────────────────────────────────────────────



export function getOrInitTelegramManager(): TelegramManager {
  const apiId = Number(process.env.TELEGRAM_API_ID || appConfig.telegramApiId || 0);
  const apiHash = process.env.TELEGRAM_API_HASH || appConfig.telegramApiHash || "";
  const sessionString = process.env.TELEGRAM_SESSION || process.env.TG_SESSION_V2 || appConfig.telegramSessionString || "";
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

// ─── Retry Engine ───────────────────────────────────────────────────────────
/**
 * يُضيف رسالة فاشلة إلى قائمة إعادة المحاولة مع Exponential Backoff.
 * المحاولة 1 → بعد 30 ثانية
 * المحاولة 2 → بعد 60 ثانية
 * المحاولة 3 → بعد 120 ثانية
 * بعد 3 فشل → يُحذف نهائياً مع تسجيل خطأ
 */
function scheduleRetry(
  message: string,
  target: 'all' | 'telegram' | 'facebook',
  updates: { id?: string; name: string; newVal?: number; oldVal?: number; [key: string]: any }[],
  attemptNumber: number,
  startTime: number = Date.now(),
  lastError: string = ''
): void {
  if (attemptNumber > MAX_RETRY_ATTEMPTS) {
    console.error(
      `[RetryEngine] ❌ Giving up after ${MAX_RETRY_ATTEMPTS} attempts for: [${updates.map(u => u.id || u.name).join(', ')}]`
    );
    try {
      const platform = target === 'all' ? 'both' : target;
      const currencyIds = updates.map(u => u.id || u.name).filter(Boolean) as string[];
      addBroadcastLog({
        platform,
        currency_ids: currencyIds,
        status: 'failed',
        attempts: 1 + MAX_RETRY_ATTEMPTS,
        duration_ms: Date.now() - startTime,
        error_message: lastError || `Exhausted ${MAX_RETRY_ATTEMPTS} retries`,
        is_test: 0
      });
    } catch (logErr) {
      console.error("[BroadcastLog] Failed to record give-up log:", logErr);
    }
    return;
  }
  const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attemptNumber - 1);
  const nextRetryAt = Date.now() + delayMs;
  retryQueue.push({ message, target, updates, attempts: attemptNumber, nextRetryAt, startTime, lastError });
  console.warn(
    `[RetryEngine] ⏳ Scheduled retry #${attemptNumber} in ${delayMs / 1000}s for: [${updates.map(u => u.id || u.name).join(', ')}]`
  );
  startRetryEngine();
}

/**
 * محرك إعادة المحاولة — يعمل بدورة متكررة حتى تفرغ القائمة تماماً.
 * يُشغَّل تلقائياً عند إضافة أي مهمة retry.
 */
function startRetryEngine(): void {
  if (retryEngineTimer !== null) return; // يعمل بالفعل
  retryEngineTimer = setTimeout(async () => {
    retryEngineTimer = null;
    const now = Date.now();
    const due = retryQueue.filter(j => j.nextRetryAt <= now);
    due.forEach(j => retryQueue.splice(retryQueue.indexOf(j), 1));

    for (const job of due) {
      console.log(`[RetryEngine] 🔁 Retrying attempt #${job.attempts} for: [${job.updates.map(u => u.id || u.name).join(', ')}]`);
      try {
        await broadcastToSocialMedia(job.message, false, job.target);
        // نجاح → سجّل وقت النشر
        recordBroadcast(job.updates);
        console.log(`[RetryEngine] ✅ Retry #${job.attempts} succeeded for: [${job.updates.map(u => u.id || u.name).join(', ')}]`);

        // تسجيل نجاح بعد إعادة المحاولة (Outcome 2)
        try {
          const platform = job.target === 'all' ? 'both' : job.target;
          const currencyIds = job.updates.map(u => u.id || u.name).filter(Boolean) as string[];
          addBroadcastLog({
            platform,
            currency_ids: currencyIds,
            status: 'success_after_retry',
            attempts: 1 + job.attempts,
            duration_ms: Date.now() - (job.startTime || Date.now()),
            error_message: null,
            is_test: 0
          });
        } catch (logErr) {
          console.error("[BroadcastLog] Failed to record retry success log:", logErr);
        }
      } catch (err: any) {
        console.error(`[RetryEngine] ❌ Retry #${job.attempts} failed: ${err.message || err}`);
        scheduleRetry(job.message, job.target, job.updates, job.attempts + 1, job.startTime || Date.now(), err.message || String(err));
      }
    }

    if (retryQueue.length > 0) {
      startRetryEngine(); // جدولة دورة قادمة إذا لا تزال هناك مهام
    }
  }, 5000); // فحص كل 5 ثوانٍ لمعرفة المهام المستحقة
}
// ─── Pending Queue Watchdog ─────────────────────────────────────────────────
/**
 * يُضيف تحديثات مرفوضة (بسبب حد الساعة) إلى قائمة الانتظار.
 *
 * ✅ الإصلاح الجوهري:
 * الكود القديم كان يُضيف كل عملة كـ batch منفصل ← يتسبب في إرسال منشور لكل عملة على حدة.
 * الكود الجديد يجمع دائماً كل التحديثات في batch واحد يتراكم ويُحدَّث بدلاً من التكرار.
 * بهذا يُرسل الـ watchdog منشوراً واحداً يحتوي على جميع العملات المعلقة.
 */
function addToPendingQueue(
  updates: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[],
  target: 'all' | 'telegram' | 'facebook'
): void {
  if (updates.length === 0) return;

  if (pendingBroadcastQueue.length === 0) {
    // لا يوجد batch معلق بعد → أنشئ واحداً جديداً بكل التحديثات
    pendingBroadcastQueue.push({ updates: [...updates], target, addedAt: Date.now() });
  } else {
    // يوجد batch معلق → ادمج التحديثات الجديدة فيه
    // القاعدة: نفس العملة → نحتفظ بالـ oldVal الأصلي ونأخذ آخر newVal
    const batch = pendingBroadcastQueue[pendingBroadcastQueue.length - 1];
    for (const u of updates) {
      const key = u.id || u.name;
      const existingIdx = batch.updates.findIndex(pu => (pu.id || pu.name) === key);
      if (existingIdx >= 0) {
        // تحديث موجود → حدّث القيمة الجديدة فقط، احتفظ بالقيمة القديمة الأصلية
        batch.updates[existingIdx] = { ...u, oldVal: batch.updates[existingIdx].oldVal };
      } else {
        // عملة جديدة → أضفها للـ batch نفسه
        batch.updates.push({ ...u });
      }
    }
    // حدّث الـ target للأشمل في حال اختلف
    if (batch.target !== target && target === 'all') {
      batch.target = 'all';
    }
  }

  console.log(
    `[PendingQueue] 📥 Merged ${updates.map(u => u.id || u.name).join(', ')} into pending batch ` +
    `(batch size: ${pendingBroadcastQueue[0]?.updates.length ?? 0} currencies)`
  );
  startPendingWatchdog();
}

/**
 * يُشغّل الـ watchdog إذا لم يكن يعمل بالفعل.
 *
 * ✅ الإصلاح الجوهري:
 * الكود القديم يأخذ shift() عنصراً واحداً فقط في كل دورة → إرسال منشور منفرد لكل عملة.
 * الكود الجديد يستنزف كل العناصر المعلقة ويدمجها في منشور واحد شامل عند تحرر الفتحة.
 * كما تم تقليل الفترة من 5 دقائق إلى 90 ثانية للاستجابة الأسرع.
 */
function startPendingWatchdog(): void {
  if (pendingWatchdogTimer !== null) return;
  pendingWatchdogTimer = setInterval(async () => {
    const now = Date.now();

    // حذف التحديثات منتهية الصلاحية (أكثر من 3 ساعات)
    const expiredIdxs: number[] = [];
    pendingBroadcastQueue.forEach((p, i) => {
      if (now - p.addedAt > MAX_PENDING_AGE_MS) expiredIdxs.push(i);
    });
    for (let i = expiredIdxs.length - 1; i >= 0; i--) {
      const [expired] = pendingBroadcastQueue.splice(expiredIdxs[i], 1);
      console.warn(`[PendingQueue] 🗑 Expired pending update: [${expired.updates.map(u => u.id || u.name).join(', ')}]`);
    }

    if (pendingBroadcastQueue.length === 0) {
      clearInterval(pendingWatchdogTimer!);
      pendingWatchdogTimer = null;
      return;
    }

    if (!canBroadcastNow()) return; // لا تزال الفتحة ممتلئة

    // ✅ اجمع كل العناصر في القائمة في منشور واحد بدلاً من أخذ عنصر واحد فقط
    // هذا يضمن: إذا تراكمت عملات متعددة في الـ pending، تُرسل جميعها في رسالة واحدة
    const allPending = pendingBroadcastQueue.splice(0, pendingBroadcastQueue.length);
    const mergedTarget = allPending.some(p => p.target === 'all') ? 'all' 
      : allPending.some(p => p.target === 'telegram') ? 'telegram' : 'facebook';

    // دمج جميع التحديثات مع معالجة التكرار (نفس العملة → نحتفظ بآخر سعر وأقدم oldVal)
    const mergedMap = new Map<string, { id?: string; name: string; oldVal: number; newVal: number; flag: string }>();
    for (const batch of allPending) {
      for (const u of batch.updates) {
        const key = u.id || u.name;
        const existing = mergedMap.get(key);
        if (existing) {
          mergedMap.set(key, { ...u, oldVal: existing.oldVal }); // احتفظ بأقدم oldVal
        } else {
          mergedMap.set(key, { ...u });
        }
      }
    }
    const mergedUpdates = Array.from(mergedMap.values());

    console.log(
      `[PendingQueue] 🚀 Dispatching merged pending batch: [${mergedUpdates.map(u => u.id || u.name).join(', ')}] ` +
      `(${mergedUpdates.length} currencies in 1 post)`
    );

    // إرسال الـ batch المدمج بدون فلاتر (لأنها اجتازتها مسبقاً)
    executeBroadcast(mergedUpdates, false, mergedTarget, true).catch(e =>
      console.error('[PendingQueue] ❌ Failed to process pending batch:', e)
    );
  }, 90 * 1000); // فحص كل 90 ثانية (تقليل من 5 دقائق للاستجابة الأسرع)
}
// ───────────────────────────────────────────────────────────────────────────

export async function broadcastToSocialMedia(message: string, isTest: boolean = false, target: 'all' | 'telegram' | 'facebook' = 'all', isManual: boolean = false) {

  const manager = getOrInitTelegramManager();

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

      // تجهيز رسالة تيليجرام: الحفاظ على الرابط المختصر https://tinyurl.com/2j7667u2
      let tgMessage = message;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          success = await manager.sendMessage(tgChannel, tgMessage, { linkPreview: true });
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
        console.log(`[Telegram Broadcast] Successfully sent message to ${tgChannel}`);
      }
    }
  }

  // Facebook
  const shouldPostFb = (target === 'facebook' || target === 'all') && (isManual || (!isTest && appConfig.facebookAutoPost) || isTest);
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
      let fbMessage = message.replace(/[*_`]/g, '');
      
      // استخدام الروابط المختصرة دائماً في منشورات فيسبوك
      fbMessage = fbMessage.replace(/https:\/\/dollar-price-qp14\.onrender\.com[^\s]*/g, 'https://tinyurl.com/2j7667u2');
      fbMessage = fbMessage.replace(/https:\/\/t\.me\/[^\s]*/g, 'https://tinyurl.com/m3m4jrd2');
      
      const maxRetries = isTest ? 1 : 2;
      let postedSuccessfully = false;
      let lastFbError = "";

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const targetId = appConfig.facebookPageId.trim() || 'me';
          let url = `https://graph.facebook.com/v20.0/${targetId}/feed`;
          
          let linkToAttach = null;
          const urlMatch = fbMessage.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            linkToAttach = urlMatch[0];
          }
          
          const payload: any = { message: fbMessage, access_token: appConfig.facebookAccessToken };
          if (linkToAttach) {
            payload.link = linkToAttach;
          }

          let fbRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          let fbData = (await fbRes.json()) as FacebookApiResponse;

          // Fallback 1: If link parameter error, retry cleanly without link
          if (fbData.error && payload.link) {
            console.log("[Facebook Broadcast] Retrying without link parameter...");
            delete payload.link;
            const retryRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const retryData = (await retryRes.json()) as FacebookApiResponse;
            if (!retryData.error) {
              fbData = retryData;
            }
          }

          // Fallback 2: If global ID error or invalid ID, attempt posting to /me/feed directly
          if (fbData.error && (fbData.error.code === 100 || fbData.error.message?.includes('global id'))) {
            console.log("[Facebook Broadcast] Trying fallback to /me/feed...");
            const fallbackUrl = `https://graph.facebook.com/v20.0/me/feed`;
            const fallbackRes = await fetch(fallbackUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: fbMessage, access_token: appConfig.facebookAccessToken })
            });
            const fallbackData = (await fallbackRes.json()) as FacebookApiResponse;
            if (!fallbackData.error) {
              fbData = fallbackData;
            }
          }

          if (fbData.error) {
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
            postedSuccessfully = true;
            console.log("[Facebook Broadcast] Successfully posted, ID:", fbData.id);
            facebookBroadcastStatus = { status: 'ok', lastError: '', lastErrorTime: facebookBroadcastStatus.lastErrorTime, lastSuccessTime: new Date().toISOString() };
            lastSocialBroadcastTime = Date.now();
            
            // Add comment safely without breaking the main post status
            try {
              const commentMessage = `📢 لمتابعة التحديثات لحظة بلحظة على تيليجرام:\n👉 https://tinyurl.com/m3m4jrd2\n\n🌐 والرسوم البيانية والتفاصيل الكاملة من هنا:\n👉 https://tinyurl.com/2j7667u2`;
              const commentUrl = `https://graph.facebook.com/v20.0/${fbData.id}/comments`;
              const commentRes = await fetch(commentUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: commentMessage, access_token: appConfig.facebookAccessToken })
              });
              const commentData = (await commentRes.json()) as FacebookApiResponse;
              if (commentData.error) {
                console.warn("[Facebook Broadcast] Note: Comment skipped or failed (non-fatal):", commentData.error.message);
              } else {
                console.log("[Facebook Broadcast] Successfully added comment, ID:", commentData.id);
              }
            } catch (commentErr: any) {
              console.warn("[Facebook Broadcast] Non-fatal comment error:", commentErr.message);
            }
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

  const hadAttempts = shouldPostTg || shouldPostFb;
  const anySuccess = (shouldPostTg && telegramBroadcastStatus.status === 'ok') || (shouldPostFb && facebookBroadcastStatus.status === 'ok');

  if (hadAttempts && !anySuccess) {
    const errorDetails: string[] = [];
    if (shouldPostTg) errorDetails.push(`تيليجرام: ${telegramBroadcastStatus.lastError || 'فشل الاتصال'}`);
    if (shouldPostFb) errorDetails.push(`فيسبوك: ${facebookBroadcastStatus.lastError || 'فشل الاتصال'}`);
    throw new Error(`فشل النشر عبر الشبكات: ${errorDetails.join(' | ')}`);
  }
}

import { sendPushNotificationToAll } from './push.service';

export let lastOfficialBroadcastDate = "";
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
  USD: { name: 'دولار أمريكي', flag: '🇺🇸', rank: 1 },
  EUR: { name: 'يورو أوروبي', flag: '🇪🇺', rank: 2 },
  GBP: { name: 'جنيه إسترليني', flag: '🇬🇧', rank: 3 },
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
  CAD: { name: 'دولار كندي', flag: '🇨🇦', rank: 14 },
  AUD: { name: 'دولار أسترالي', flag: '🇦🇺', rank: 15 },
  CHF: { name: 'فرنك سويسري', flag: '🇨🇭', rank: 16 },
  JPY: { name: 'ين ياباني', flag: '🇯🇵', rank: 17 },
  SEK: { name: 'كرونة سويدية', flag: '🇸🇪', rank: 18 },
  NOK: { name: 'كرونة نرويجية', flag: '🇳🇴', rank: 19 },
  DKK: { name: 'كرونة دنماركية', flag: '🇩🇰', rank: 20 },
};

export async function broadcastOfficialRates(
  isTest: boolean = false, 
  target: 'all' | 'telegram' | 'facebook' = (appConfig.facebookAutoPost ? 'all' : 'telegram')
): Promise<boolean> {
  const manager = getOrInitTelegramManager();
  if (!appConfig.telegramPostChannel || !manager) {
    console.warn("[Official Broadcast] Aborting broadcast: channel or telegram manager not ready.");
    return false;
  }

  if (!isTest && !appConfig.telegramAutoPost) {
    console.log("[Official Broadcast] Aborting official broadcast because telegramAutoPost is disabled in settings.");
    return true; // Not an error condition; auto-post is disabled by choice
  }

  const now = new Date();
  const libyaDateObj = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Tripoli' }));
  const yyyy = libyaDateObj.getFullYear();
  const mm = String(libyaDateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(libyaDateObj.getDate()).padStart(2, '0');
  const todayLibyaKey = `${yyyy}-${mm}-${dd}`;
  const dateStr = now.toLocaleDateString('ar-LY', { timeZone: 'Africa/Tripoli' });
  const timeStr = now.toLocaleTimeString('ar-LY', { timeZone: 'Africa/Tripoli', hour: '2-digit', minute: '2-digit' });
  
  if (!isTest && (lastOfficialBroadcastDate === todayLibyaKey || lastOfficialBroadcastDate === dateStr)) {
    console.log(`[Official Broadcast] Already broadcasted for today (${todayLibyaKey}). Skipping duplicate post.`);
    return true;
  }

  const dayNames = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  let dayName = "الخميس";
  try {
    const dayIndex = libyaDateObj.getDay();
    dayName = dayNames[dayIndex];
  } catch (e) {}

  let message = `🏦 *نشرة أسعار مصرف ليبيا المركزي الرسمية* 🏦\n`;
  message += `━━━━━━━━━━━━━━━━━━━\n`;
  message += `🗓 ${dayName}، ${dateStr} | ⏰ ${timeStr}\n\n`;

  const officialEntries = Object.entries(rates.official)
    .filter(([key, val]) => typeof val === 'number' && val > 0 && key !== 'OFFICIAL_USD')
    .sort(([keyA], [keyB]) => {
      const rankA = OFFICIAL_CURRENCIES_INFO[keyA]?.rank || 999;
      const rankB = OFFICIAL_CURRENCIES_INFO[keyB]?.rank || 999;
      return rankA - rankB;
    });

  if (officialEntries.length === 0) {
    console.warn("[Official Broadcast] No official rates available to publish.");
    return false;
  }

  for (const [code, val] of officialEntries) {
    const info = OFFICIAL_CURRENCIES_INFO[code];
    const name = info?.name || appConfig.terms.find(t => t.id === code)?.name || code;
    const flag = info?.flag || '💰';
    message += `${flag} *${name}*: ${val.toFixed(4)} د.ل\n`;
  }

  message += `\n━━━━━━━━━━━━━━━━━━━\n`;
  message += `🔗 *لمزيد من التفاصيل والبيانات الحية:*\n🌐 https://tinyurl.com/2j7667u2\n`;
  message += `📱 *المصدر:* مصرف ليبيا المركزي`;

  try {
    console.log(`[Official Broadcast] Dispatching official bulletin (${officialEntries.length} currencies) to ${target}...`);
    await broadcastToSocialMedia(message, typeof isTest !== "undefined" ? isTest : false, target, isTest);
    if (!isTest) {
      lastOfficialBroadcastDate = todayLibyaKey;
      try {
        if (db) {
          db.prepare(`
            INSERT INTO server_config (key, value) VALUES ('last_official_broadcast_date', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `).run(todayLibyaKey);
        }
      } catch (dbErr) {
        console.error("[Official Broadcast] Failed to persist date to SQLite:", dbErr);
      }
      if (supabase) {
        supabase.from('server_config').upsert({
          key: 'last_official_broadcast_date',
          value: todayLibyaKey,
          updated_at: new Date().toISOString()
        }).then(({ error }) => {
          if (error) console.error("[Official Broadcast] Failed to persist date to Supabase:", error);
        }, err => {
          console.error("[Official Broadcast] Supabase error:", err);
        });
      }
    }
    console.log(`[Official Broadcast] Successfully posted daily official bulletin for ${todayLibyaKey}!`);
    return true;
  } catch(e) {
    console.error("[Official Broadcast] Failed to broadcast official rates:", e);
    return false;
  }
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
  id: string;
  name: string;
  oldVal: number;
  newVal: number;
  flag: string;
  firstSeenAt: number;
  lastSeenAt: number;
  updateCount: number;
}

export let smartBroadcastQueue: Map<string, QueuedRateUpdate> = new Map();
export let smartBroadcastAggregationTimer: NodeJS.Timeout | null = null;
export let smartBroadcastWatchdogInterval: NodeJS.Timeout | null = null;

export function getBroadcastQueueStatus() {
  const now = Date.now();
  const minIntervalMs = Math.max(1, appConfig.minBroadcastIntervalMinutes ?? 20) * 60 * 1000;
  const timeSinceLast = lastSocialBroadcastTime ? (now - lastSocialBroadcastTime) : 999999999;
  const isCooldownActive = timeSinceLast < minIntervalMs;
  const cooldownRemainingMs = isCooldownActive ? (minIntervalMs - timeSinceLast) : 0;

  const items = Array.from(smartBroadcastQueue.values()).map(item => ({
    id: item.id,
    name: item.name,
    oldVal: item.oldVal,
    newVal: item.newVal,
    diff: Number((item.newVal - item.oldVal).toFixed(3)),
    flag: item.flag,
    ageSeconds: Math.floor((now - item.firstSeenAt) / 1000),
    updateCount: item.updateCount
  }));

  return {
    queueSize: smartBroadcastQueue.size,
    items,
    lastSocialBroadcastTime,
    isCooldownActive,
    cooldownRemainingMs,
    cooldownRemainingMinutes: Math.ceil(cooldownRemainingMs / 60000),
    minIntervalMinutes: appConfig.minBroadcastIntervalMinutes ?? 20,
    minPriceChangeThreshold: appConfig.minPriceChangeThreshold ?? 0.015,
    aggregationWindowSeconds: appConfig.aggregationWindowSeconds ?? 45,
    hourlyPostLimit: appConfig.hourlyPostLimit ?? 4,
    recentPostsThisHour: recentBroadcastTimestamps.filter(t => t > now - 3600000).length
  };
}

export function clearBroadcastQueue(): number {
  if (smartBroadcastAggregationTimer) {
    clearTimeout(smartBroadcastAggregationTimer);
    smartBroadcastAggregationTimer = null;
  }
  const count = smartBroadcastQueue.size;
  smartBroadcastQueue.clear();
  return count;
}

export async function flushBroadcastQueueImmediately(target?: 'all' | 'telegram' | 'facebook', isManual = true) {
  if (smartBroadcastAggregationTimer) {
    clearTimeout(smartBroadcastAggregationTimer);
    smartBroadcastAggregationTimer = null;
  }
  const updates = Array.from(smartBroadcastQueue.values()).map(item => ({
    id: item.id,
    name: item.name,
    oldVal: item.oldVal,
    newVal: item.newVal,
    flag: item.flag
  }));
  smartBroadcastQueue.clear();

  if (updates.length === 0) {
    return { success: true, count: 0, message: "طابور التحديثات فارغ حالياً." };
  }

  const resolvedTarget = target || ((appConfig.telegramAutoPost && appConfig.facebookAutoPost) ? 'all' : appConfig.telegramAutoPost ? 'telegram' : 'facebook');
  await executeBroadcast(updates, false, resolvedTarget, true, isManual);
  return { success: true, count: updates.length, message: `تم تفريغ الطابور ونشر ${updates.length} عملة بنجاح!` };
}

export async function processSmartBroadcastQueue(): Promise<boolean> {
  if (smartBroadcastQueue.size === 0) return false;
  if (!appConfig.telegramAutoPost && !appConfig.facebookAutoPost) return false;

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

  const rawQueuedItems = Array.from(smartBroadcastQueue.values()).map(item => ({
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

  try {
    await executeBroadcast(toBroadcast, false, resolvedTarget, true, false);
    smartBroadcastQueue.clear(); // ← يُمسح فقط بعد نجاح النشر
  } catch (err) {
    console.error('[SmartBroadcastQueue] executeBroadcast failed. Retaining queue items for next cycle.', err);
    // Queue محتفظ به للمحاولة التالية عبر الـ watchdog
  }
  return true;
}

// Queue watchdog timer running every 30 seconds
if (!smartBroadcastWatchdogInterval) {
  smartBroadcastWatchdogInterval = setInterval(() => {
    if (smartBroadcastQueue.size > 0 && !smartBroadcastAggregationTimer) {
      processSmartBroadcastQueue().catch(e => console.error("[SmartBroadcastQueue] Watchdog cycle error:", e));
    }
  }, 30000);
}

export async function broadcastRateChanges(
  updates: {id?: string, name: string, oldVal: number, newVal: number, flag: string}[], 
  isTest: boolean = false, 
  target: 'all' | 'telegram' | 'facebook' = 'all',
  isManual: boolean = false
) {
  if (!isTest && !isManual && !appConfig.telegramAutoPost && !appConfig.facebookAutoPost) {
    return;
  }
  if (updates.length === 0) {
    return;
  }

  if (isTest || isManual) {
    console.log(`[SmartBroadcast] ⚡ Executing IMMEDIATE broadcast for ${updates.length} items (isManual=${isManual}, bypassing cooldowns)`);
    await executeBroadcast(updates, isTest, target, true, isManual);
    return;
  }

  const now = Date.now();
  for (const u of updates) {
    const key = (u.id || u.name).toUpperCase();
    const existing = smartBroadcastQueue.get(key);
    if (existing) {
      smartBroadcastQueue.set(key, {
        ...existing,
        name: u.name || existing.name,
        newVal: u.newVal,
        flag: u.flag || existing.flag,
        lastSeenAt: now,
        updateCount: existing.updateCount + 1
      });
    } else {
      smartBroadcastQueue.set(key, {
        id: u.id || key,
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

  const aggWindowMs = Math.max(10, appConfig.aggregationWindowSeconds ?? 45) * 1000;
  if (!smartBroadcastAggregationTimer) {
    smartBroadcastAggregationTimer = setTimeout(() => {
      smartBroadcastAggregationTimer = null;
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
  isTest: boolean = false, 
  target: 'all' | 'telegram' | 'facebook' = 'all',
  skipFilters: boolean = false,
  isManual: boolean = false,
  customHeaderTitle?: string
) {
  updates = sanitizeBroadcastUpdates(updates, isManual);

  const uniqueUpdatesMap = new Map<string, typeof updates[0]>();
  for (const u of updates) {
    const key = u.id || u.name;
    const existing = uniqueUpdatesMap.get(key);
    if (existing) {
      uniqueUpdatesMap.set(key, { ...u, oldVal: existing.oldVal });
    } else {
      uniqueUpdatesMap.set(key, { ...u });
    }
  }
  updates = Array.from(uniqueUpdatesMap.values());

  if (updates.length === 0) return;

  if (!isTest && !skipFilters && !isManual) {
    const eligible = filterEligibleUpdates(updates);
    if (eligible.length === 0) {
      console.log('[SmartBroadcast] ⏭ All updates filtered out. No broadcast needed.');
      return;
    }
    if (pendingBroadcastQueue.length > 0 || !canBroadcastNow()) {
      addToPendingQueue(eligible, target);
      return;
    }
    updates = eligible;
  }

  const message = formatSmartBroadcastMessage(updates, customHeaderTitle);

  const startTime = Date.now();
  const platform = target === 'all' ? 'both' : target;
  const currencyIds = updates.map(u => u.id || u.name).filter(Boolean) as string[];

  if (isTest || isManual) {
    try {
      await broadcastToSocialMedia(message, isTest, target, isManual);
      recordBroadcast(updates);
      try {
        addBroadcastLog({
          platform,
          currency_ids: currencyIds,
          status: 'success',
          attempts: 1,
          duration_ms: Date.now() - startTime,
          error_message: null,
          is_test: isTest ? 1 : 2
        });
      } catch (logErr) {
        console.error("[BroadcastLog] Failed to log broadcast:", logErr);
      }
    } catch (err: any) {
      try {
        addBroadcastLog({
          platform,
          currency_ids: currencyIds,
          status: 'failed',
          attempts: 1,
          duration_ms: Date.now() - startTime,
          error_message: err.message || String(err),
          is_test: isTest ? 1 : 2
        });
      } catch (logErr) {
        console.error("[BroadcastLog] Failed to log failure:", logErr);
      }
      if (isTest) throw err;
      console.error("[Manual Broadcast Error]:", err);
    }
  } else {
    broadcastToSocialMedia(message, isTest, target, isManual)
      .then(() => {
        recordBroadcast(updates);
        try {
          addBroadcastLog({
            platform,
            currency_ids: currencyIds,
            status: 'success',
            attempts: 1,
            duration_ms: Date.now() - startTime,
            error_message: null,
            is_test: 0
          });
        } catch (logErr) {
          console.error("[BroadcastLog] Failed to record first-try success log:", logErr);
        }
      })
      .catch(e => {
        console.error("[Background Broadcast] Error:", e);
        scheduleRetry(message, target, updates, 1, startTime, e.message || String(e));
      });
  }

  // SEND PUSH NOTIFICATION
  if (!isTest) {
    const mainUpdates = updates.filter(u => u.id === 'USD' || u.id === 'EUR' || u.id === 'GOLD_CAST_24' || u.id === 'GOLD_CAST_18').slice(0, 2);
    if (mainUpdates.length > 0) {
      const pushTitle = 'تحديث جديد لأسعار السوق';
      const pushBody = mainUpdates.map(u => `${u.name}: ${u.newVal.toFixed(3)}`).join(' | ');
      sendPushNotificationToAll(pushTitle, pushBody);
    } else {
      sendPushNotificationToAll('تحديث جديد', 'تم تحديث أسعار السوق الموازي');
    }
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

