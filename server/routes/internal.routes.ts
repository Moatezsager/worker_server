import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { runJobSafely, isJobRunning, getWorkerJobsStatus } from "../schedulers/tasks.scheduler";
import { fetchOfficialRates, fetchParallelRatesFromTelegram } from "../services/scraper.service";
import { saveToSupabase } from "../services/db.service";
import { cleanupOldData } from "../services/db.service";
import { cleanupUserLogs, monitorMemory } from "../services/maintenance.service";

const internalRouter = Router();

// ─── Internal Rate Limiter (Dedicated for Web-to-Worker S2S communication) ───
export const internalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "failed",
    error: "Too many internal requests, please slow down."
  }
});

// ─── Timing-Safe Secret Verification Middleware ───
export function verifyInternalSecret(req: Request, res: Response, next: NextFunction) {
  const configuredSecret = (process.env.WORKER_INTERNAL_SECRET || process.env.API_HMAC_SECRET || "").trim();

  if (!configuredSecret) {
    console.error("[InternalAPI] WORKER_INTERNAL_SECRET is not configured on Worker server.");
    return res.status(500).json({ 
      status: "failed", 
      error: "Worker internal secret is not configured" 
    });
  }

  // Extract secret from X-Worker-Secret header or Authorization Bearer header
  const authHeader = req.headers["x-worker-secret"] || req.headers["authorization"];
  let providedSecret = "";

  if (typeof authHeader === "string") {
    providedSecret = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : authHeader.trim();
  }

  if (!providedSecret) {
    return res.status(401).json({ 
      status: "failed", 
      error: "Unauthorized: Missing internal secret header" 
    });
  }

  try {
    // Timing-safe comparison using SHA-256 digests to protect against length disclosure & timing attacks
    const hashConfigured = crypto.createHash("sha256").update(configuredSecret).digest();
    const hashProvided = crypto.createHash("sha256").update(providedSecret).digest();

    if (!crypto.timingSafeEqual(hashConfigured, hashProvided)) {
      console.warn("[InternalAPI] Unauthorized access attempt: Invalid secret provided.");
      return res.status(403).json({ 
        status: "failed", 
        error: "Forbidden: Invalid internal secret" 
      });
    }

    next();
  } catch (err) {
    console.error("[InternalAPI] Error during secret verification:", err);
    return res.status(500).json({ 
      status: "failed", 
      error: "Internal verification error" 
    });
  }
}

// Apply rate limiter and secret verification to all internal routes
internalRouter.use(internalApiLimiter);
internalRouter.use(verifyInternalSecret);

// ─── Strict Allowlist of Permitted Jobs ───
export const ALLOWED_INTERNAL_JOBS = ['cbl', 'telegram', 'refresh', 'maintenance'] as const;
export type AllowedJob = typeof ALLOWED_INTERNAL_JOBS[number];

function isAllowedJob(jobName: string): jobName is AllowedJob {
  return (ALLOWED_INTERNAL_JOBS as readonly string[]).includes(jobName);
}

// Map logical job names to unique mutex lock IDs in the worker
const JOB_LOCK_IDS: Record<AllowedJob, string> = {
  cbl: 'official_rates_scraper',
  telegram: 'parallel_rates_scraper',
  refresh: 'rates_auto_refresh',
  maintenance: 'database_cleanup'
};

/**
 * Triggers an allowlisted job asynchronously without holding HTTP request.
 */
function triggerJob(jobKey: AllowedJob, res: Response) {
  const lockId = JOB_LOCK_IDS[jobKey];

  // 1. Check if job is already actively executing
  if (isJobRunning(lockId)) {
    console.log(`[InternalAPI] Job '${jobKey}' is already running.`);
    return res.status(409).json({
      status: "already_running",
      job: jobKey,
      message: `Job '${jobKey}' is currently in progress. Overlapping run skipped.`
    });
  }

  // 2. Dispatch job asynchronously in background (Request -> Enqueue -> Response)
  switch (jobKey) {
    case 'cbl':
      runJobSafely(lockId, 'جلب أسعار مصرف ليبيا المركزي عبر Internal API', async () => {
        return await fetchOfficialRates(true, true); // Force manual admin run
      }, { timeoutMs: 90000 });
      break;

    case 'telegram':
      runJobSafely(lockId, 'مزامنة أسعار تيليجرام عبر Internal API', async () => {
        const changed = await fetchParallelRatesFromTelegram();
        if (changed) {
          await saveToSupabase('parallel');
        }
        return changed;
      }, { timeoutMs: 90000 });
      break;

    case 'refresh':
      runJobSafely(lockId, 'تحديث شامل للأسعار ومزامنة Supabase عبر Internal API', async () => {
        const officialChanged = await fetchOfficialRates(true, true);
        const parallelChanged = await fetchParallelRatesFromTelegram();
        if (officialChanged || parallelChanged) {
          const saveType = (officialChanged && parallelChanged) ? 'both' : (officialChanged ? 'official' : 'parallel');
          await saveToSupabase(saveType);
        }
        return { officialChanged, parallelChanged };
      }, { timeoutMs: 120000 });
      break;

    case 'maintenance':
      runJobSafely(lockId, 'صيانة وتنظيف السجلات عبر Internal API', async () => {
        monitorMemory();
        cleanupUserLogs();
        await cleanupOldData(cleanupUserLogs);
      }, { timeoutMs: 120000 });
      break;
  }

  // 3. Return 202 Accepted immediately
  console.log(`[InternalAPI] Dispatched job '${jobKey}' asynchronously.`);
  return res.status(202).json({
    status: "accepted",
    job: jobKey,
    message: `Job '${jobKey}' was accepted and started asynchronously in worker.`
  });
}

// ─── Endpoints ───

// GET /internal/health - Health & Auth verification for Web Server
internalRouter.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "online",
    role: "worker_internal_api",
    timestamp: new Date().toISOString(),
    allowedJobs: ALLOWED_INTERNAL_JOBS
  });
});

// GET /internal/jobs - Query all registered jobs and their status
internalRouter.get("/jobs", (req: Request, res: Response) => {
  res.json({
    status: "success",
    timestamp: new Date().toISOString(),
    jobs: getWorkerJobsStatus()
  });
});

// Specific Job Endpoints
internalRouter.post("/jobs/cbl", (req: Request, res: Response) => {
  return triggerJob('cbl', res);
});

internalRouter.post("/jobs/telegram", (req: Request, res: Response) => {
  return triggerJob('telegram', res);
});

internalRouter.post("/jobs/refresh", (req: Request, res: Response) => {
  return triggerJob('refresh', res);
});

internalRouter.post("/jobs/maintenance", (req: Request, res: Response) => {
  return triggerJob('maintenance', res);
});

// Generic Parametric Endpoint: POST /internal/jobs/:jobName
internalRouter.post("/jobs/:jobName", (req: Request, res: Response) => {
  const { jobName } = req.params;

  if (!isAllowedJob(jobName)) {
    console.warn(`[InternalAPI] Rejected unknown job request: '${jobName}'`);
    return res.status(400).json({
      status: "failed",
      error: `Unknown job '${jobName}'. Allowed jobs: ${ALLOWED_INTERNAL_JOBS.join(', ')}`
    });
  }

  return triggerJob(jobName, res);
});

export default internalRouter;
