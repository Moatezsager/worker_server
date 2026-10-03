import { monitorMemory, cleanupUserLogs } from "../services/maintenance.service";
import { cleanupOldData, saveToSupabase, logErrorArabic, saveWorkerStateToSupabase } from "../services/db.service";
import { 
  fetchOfficialRates, 
  fetchParallelRatesFromTelegram, 
  lastSuccessfulFetchTime, 
  setLastSuccessfulFetchTime, 
  clearLiveFeed 
} from "../services/scraper.service";
import { rates } from "../state";
import { getOrInitTelegramManager } from "../services/social.service";
import { initializeTelegram, activeClient } from "../../telegramClient";
import { whatsappManager, hasSavedSession } from "../services/whatsapp.service";

export type JobStatus = 'idle' | 'running' | 'success' | 'failed';

export interface WorkerJob {
  id: string;
  name: string;
  status: JobStatus;
  lastRunStartTime: number | null;
  lastRunEndTime: number | null;
  lastRunDurationMs: number | null;
  lastSuccessTime: number | null;
  lastError: string | null;
  runCount: number;
  consecutiveFailures: number;
  isRunning: boolean;
}

export const jobRegistry = new Map<string, WorkerJob>();

function getOrCreateJob(id: string, name: string): WorkerJob {
  let job = jobRegistry.get(id);
  if (!job) {
    job = {
      id,
      name,
      status: 'idle',
      lastRunStartTime: null,
      lastRunEndTime: null,
      lastRunDurationMs: null,
      lastSuccessTime: null,
      lastError: null,
      runCount: 0,
      consecutiveFailures: 0,
      isRunning: false,
    };
    jobRegistry.set(id, job);
  }
  return job;
}

/**
 * Returns current status and metrics of all registered worker background jobs.
 */
export function getWorkerJobsStatus(): WorkerJob[] {
  return Array.from(jobRegistry.values());
}

/**
 * Checks if a specific worker job is actively running.
 */
export function isJobRunning(jobId: string): boolean {
  return jobRegistry.get(jobId)?.isRunning ?? false;
}

export let isSchedulerShuttingDown = false;

/**
 * Executes a job safely with:
 * - Mutex lock (Duplicate execution protection)
 * - Timeout enforcement (Prevents hanging jobs)
 * - Error isolation (Never throws to caller)
 * - Metrics & Supabase persistence
 * - Exponential backoff delay on repeated failures
 */
export async function runJobSafely<T>(
  jobId: string,
  jobName: string,
  fn: () => Promise<T>,
  options: { timeoutMs?: number; maxConsecutiveFailures?: number } = {}
): Promise<T | null> {
  // 0. Shutdown Check (Stop new jobs during shutdown)
  if (isSchedulerShuttingDown) {
    console.log(`[WorkerJob] 🛑 System is shutting down. Rejecting job '${jobName}' (${jobId}).`);
    return null;
  }

  const timeoutMs = options.timeoutMs || 45000; // 45 seconds default
  const job = getOrCreateJob(jobId, jobName);

  // 1. Overlap / Duplicate Execution Protection
  if (job.isRunning) {
    console.warn(`[WorkerJob] ⏳ Job '${jobName}' (${jobId}) is already running. Skipping overlapping run.`);
    return null;
  }

  // 2. Exponential Backoff Check if Job is in severe failure state
  if (job.consecutiveFailures >= 5) {
    const backoffSeconds = Math.min(300, Math.pow(2, job.consecutiveFailures - 4) * 10);
    const lastAttemptTime = job.lastRunEndTime || 0;
    if (Date.now() - lastAttemptTime < backoffSeconds * 1000) {
      console.warn(`[WorkerJob] ⚠️ Job '${jobName}' in backoff mode (${job.consecutiveFailures} consecutive failures). Next retry in ${Math.round((backoffSeconds * 1000 - (Date.now() - lastAttemptTime)) / 1000)}s.`);
      return null;
    }
  }

  job.isRunning = true;
  job.status = 'running';
  job.lastRunStartTime = Date.now();
  job.runCount++;

  console.log(`[WorkerJob] ▶️ Starting job: '${jobName}' (#${job.runCount})`);

  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    // 3. Timeout race to ensure no job hangs indefinitely
    const executionPromise = fn();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Job '${jobName}' exceeded maximum timeout of ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const result = await Promise.race([executionPromise, timeoutPromise]);

    // 4. Record Success
    const endTime = Date.now();
    job.status = 'success';
    job.lastRunEndTime = endTime;
    job.lastRunDurationMs = endTime - job.lastRunStartTime;
    job.lastSuccessTime = endTime;
    job.lastError = null;
    job.consecutiveFailures = 0;

    console.log(`[WorkerJob] ✅ Completed job: '${jobName}' in ${job.lastRunDurationMs}ms`);
    return result;
  } catch (error: any) {
    // 5. Record Failure safely
    const endTime = Date.now();
    const errorMsg = error?.message || String(error);
    job.status = 'failed';
    job.lastRunEndTime = endTime;
    job.lastRunDurationMs = endTime - job.lastRunStartTime;
    job.lastError = errorMsg;
    job.consecutiveFailures++;

    console.error(`[WorkerJob] ❌ Job failed: '${jobName}' (Attempt failure #${job.consecutiveFailures}):`, errorMsg);
    await logErrorArabic(`فشل المهمة الخلفية [${jobName}]: ${errorMsg}`, "WorkerJob", error?.stack);

    return null;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    job.isRunning = false;

    // Persist critical job state to Supabase in background
    saveWorkerStateToSupabase(`job_state_${jobId}`, {
      id: job.id,
      name: job.name,
      status: job.status,
      lastSuccessTime: job.lastSuccessTime,
      lastRunDurationMs: job.lastRunDurationMs,
      consecutiveFailures: job.consecutiveFailures,
      lastError: job.lastError
    }).catch(() => {});
  }
}

// ─── Worker Timers Registry ───
const activeIntervals: NodeJS.Timeout[] = [];
let isTasksInitialized = false;
let isMonitoringInitialized = false;

/**
 * Global connection reconnector monitoring for Telegram & WhatsApp
 */
export function startMonitoring() {
  if (isMonitoringInitialized) {
    console.log("[Reconnector] Connection monitor already running, skipping duplicate initialization.");
    return;
  }
  isMonitoringInitialized = true;

  const interval = setInterval(async () => {
    await runJobSafely('connection_monitor', 'مراقبة وإعادة الاتصال بالتيليجرام والواتساب', async () => {
      // 1. Telegram Client Reconnect
      if (!activeClient || !activeClient.connected) {
        console.log("[Reconnector] Telegram disconnected or not initialized, attempting reconnect...");
        await initializeTelegram();
      }

      // 2. WhatsApp Stealth Reconnect
      if (hasSavedSession()) {
        const waStatus = whatsappManager.getStatus();
        if (waStatus.status === 'disconnected') {
          console.log("[Reconnector] WhatsApp session saved and disconnected, attempting reconnect...");
          await whatsappManager.initClient();
        }
      }
    }, { timeoutMs: 30000 });
  }, 15 * 60 * 1000); // 15 mins

  activeIntervals.push(interval);
}

/**
 * Initialize all background worker tasks with concurrency protection and lifecycle control
 */
export function initBackgroundTasks(port: number) {
  if (isTasksInitialized) {
    console.log("[WorkerTasks] Tasks already initialized, skipping duplicate registration.");
    return;
  }
  isTasksInitialized = true;

  console.log("[WorkerTasks] Registering core background jobs & intervals...");

  // 1. Memory Watchdog (Every 15 mins)
  const memoryInterval = setInterval(() => {
    runJobSafely('memory_watchdog', 'مراقبة استهلاك الذاكرة', async () => {
      monitorMemory();
    }, { timeoutMs: 15000 });
  }, 15 * 60 * 1000);
  activeIntervals.push(memoryInterval);

  // 2. User Logs Cleanup (Every 15 mins)
  const userLogsInterval = setInterval(() => {
    runJobSafely('user_logs_cleanup', 'تنظيف سجلات المستخدمين المؤقتة', async () => {
      cleanupUserLogs();
    }, { timeoutMs: 15000 });
  }, 15 * 60 * 1000);
  activeIntervals.push(userLogsInterval);

  // 3. Database Downsampling & Cleanup (Initial run + every 24 hours)
  runJobSafely('database_cleanup', 'تنظيف وضغط السجلات التاريخية', async () => {
    await cleanupOldData(cleanupUserLogs);
  }, { timeoutMs: 120000 });

  const dbCleanupInterval = setInterval(() => {
    runJobSafely('database_cleanup', 'تنظيف وضغط السجلات التاريخية', async () => {
      await cleanupOldData(cleanupUserLogs);
    }, { timeoutMs: 120000 });
  }, 24 * 60 * 60 * 1000);
  activeIntervals.push(dbCleanupInterval);

  // 4. Admin Watchdog: alerts if no successful scrape for > 4 hours during active market hours
  const adminWatchdogInterval = setInterval(async () => {
    await runJobSafely('admin_watchdog', 'مراقب الطوارئ للجلب الآلي', async () => {
      const libyaFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Tripoli', hour: 'numeric', hourCycle: 'h23' });
      const currentLibyaHour = parseInt(libyaFormatter.format(new Date()), 10);
      
      // Active market hours (09:00 - 01:00)
      if (currentLibyaHour >= 9 || currentLibyaHour < 1) {
        const hoursSinceSuccess = (Date.now() - lastSuccessfulFetchTime) / (1000 * 60 * 60);
        if (hoursSinceSuccess > 4) {
          console.warn(`[Watchdog] ⚠️ No successful scrape for ${hoursSinceSuccess.toFixed(1)} hours!`);
          const tgMgr = getOrInitTelegramManager();
          if (tgMgr) {
            try {
              await tgMgr.sendMessage('me', `⚠️ *تنبيه للمدير (Watchdog)* ⚠️\n\nيبدو أن هناك مشكلة في الجلب الآلي للسوق الموازي.\nمرت أكثر من 4 ساعات دون أي عملية جلب ناجحة.\n\nرجاءً تحقق من حالة السيرفر أو حساب التليجرام.`);
              setLastSuccessfulFetchTime(Date.now());
            } catch (e) {
              console.error("[Watchdog] Failed to send alert message:", e);
            }
          }
        }
      }
    }, { timeoutMs: 25000 });
  }, 30 * 60 * 1000); // Check every 30 minutes
  activeIntervals.push(adminWatchdogInterval);

  // 5. Memory Heap GC Trigger (Every 1 min if heap > 500MB)
  const MEMORY_THRESHOLD = 500 * 1024 * 1024; // 500MB
  const heapInterval = setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.heapUsed > MEMORY_THRESHOLD) {
      console.warn(`[MemoryMonitor] High memory usage: ${Math.round(mem.heapUsed / 1024 / 1024)}MB. Cleaning live feed and invoking GC...`);
      clearLiveFeed();
      if ((global as any).gc) {
        try {
          (global as any).gc();
        } catch (e) {}
      }
    }
  }, 60000);
  activeIntervals.push(heapInterval);

  // 6. Core Currency Rates Auto-Refresh (Every 10 mins)
  const ratesAutoRefreshInterval = setInterval(async () => {
    await runJobSafely('rates_auto_refresh', 'تحديث أسعار العملات والمعادن ومزامنة Supabase', async () => {
      // Quiet hours check (01:00 to 07:00 Libya Time)
      const libyaFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Tripoli', hour: 'numeric', hourCycle: 'h23' });
      const currentLibyaHour = parseInt(libyaFormatter.format(new Date()), 10);
      
      if (currentLibyaHour >= 1 && currentLibyaHour < 7) {
        console.log(`[Auto-Refresh] Skipping scheduled update during quiet hours (${currentLibyaHour}:00 Libya Time). Market is sleeping.`);
        return;
      }

      console.log("[Auto-Refresh] Triggering automatic rates update cycle...");
      const officialChanged = await fetchOfficialRates();
      const parallelChanged = await fetchParallelRatesFromTelegram();
      
      if (officialChanged || parallelChanged) {
        console.log("[Auto-Refresh] Changes detected! Persisting to Supabase database...");
        const saveType = (officialChanged && parallelChanged) ? 'both' : (officialChanged ? 'official' : 'parallel');
        await saveToSupabase(saveType);
      }
    }, { timeoutMs: 90000 }); // 90 seconds timeout for full scraper cycle
  }, 10 * 60 * 1000);
  activeIntervals.push(ratesAutoRefreshInterval);

  // 7. Keep-alive ping for Render / Cloud Run
  const keepAliveInterval = setInterval(() => {
    const url = `http://127.0.0.1:${port}/health`;
    fetch(url).catch(() => {});
  }, 4 * 60 * 1000);
  activeIntervals.push(keepAliveInterval);

  // 8. Start global reconnection monitoring
  startMonitoring();

  console.log(`[WorkerTasks] Successfully initialized ${activeIntervals.length} background intervals.`);
}

/**
 * Cleanly stops and clears all background task intervals for graceful shutdown.
 */
export function stopBackgroundTasks() {
  isSchedulerShuttingDown = true;
  console.log(`[WorkerTasks] Stopping ${activeIntervals.length} background task intervals...`);
  for (const interval of activeIntervals) {
    try {
      clearInterval(interval);
    } catch (e) {}
  }
  activeIntervals.length = 0;
  isTasksInitialized = false;
  isMonitoringInitialized = false;
  console.log("[WorkerTasks] All background task intervals cleared.");
}
