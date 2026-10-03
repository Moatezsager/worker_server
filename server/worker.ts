import dotenv from "dotenv";
dotenv.config({ override: true });

import { createServer, Server as HttpServer } from "http";
import express from "express";
import compression from "compression";
import { initCronSchedulers, stopCronSchedulers } from "./schedulers/cron.scheduler";
import { initBackgroundTasks, stopBackgroundTasks, getWorkerJobsStatus, runJobSafely } from "./schedulers/tasks.scheduler";
import { 
  loadBroadcastStateFromStorageAndSupabase 
} from "./services/maintenance.service";
import { 
  initializeRatesFromDB, 
  loadLatestRatesFromSupabase, 
  saveToSupabase,
  logErrorArabic 
} from "./services/db.service";
import { loadConfigFromSupabase } from "./config";
import { loadRecentBroadcastTimestamps } from "./services/social.service";
import { initStatsIfEmpty } from "./services/reporting.service";
import { fetchOfficialRates, fetchParallelRatesFromTelegram, loadCblStateFromSupabase } from "./services/scraper.service";
import { whatsappManager, hasSavedSession } from "./services/whatsapp.service";
import { activeClient, initializeTelegram } from "../telegramClient";
import { rates } from "./state";
import { db } from "./db";

// Middlewares
import {
  ipBanMiddleware,
  suspiciousActivityMiddleware,
  userAgentMiddleware,
  timeoutMiddleware,
  helmetMiddleware,
  permissionsPolicyMiddleware,
  apiLimiter,
  publicApiLimiter,
  apiStats
} from "./middleware/security";

// Routers
import cronRouter from "./routes/cron.routes";
import systemRouter from "./routes/system.routes";
import internalRouter from "./routes/internal.routes";
import { createAdminRouter } from "./routes/admin.routes";
import { getUserLogs, clearUserLogs } from "./services/maintenance.service";

// ─── Environment Validation on Bootstrap ───
if (process.env.NODE_ENV === "production") {
  const SECURITY_CHECKS: Array<{ name: string; minLen: number; isCritical: boolean }> = [
    { name: "ADMIN_PASSWORD", minLen: 8, isCritical: true },
    { name: "WORKER_INTERNAL_SECRET", minLen: 16, isCritical: false },
    { name: "API_HMAC_SECRET", minLen: 32, isCritical: false },
    { name: "CRON_SECRET", minLen: 16, isCritical: false },
  ];

  for (const check of SECURITY_CHECKS) {
    const val = process.env[check.name];
    if (!val || val.length < check.minLen) {
      if (check.isCritical) {
        console.warn(`⚠️ [SECURITY WARNING] '${check.name}' is missing or shorter than ${check.minLen} chars. Please configure it in Render environment settings.`);
      } else {
        console.warn(`ℹ️ [CONFIG NOTICE] '${check.name}' is not set yet in Render. Advanced server-to-server security features will require this variable.`);
      }
    }
  }
}

// ─── Global Error Handlers ───
process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  await logErrorArabic(`خطأ غير معالج في الـ Worker: ${reason}`, "WorkerProcess", String(reason));
});

process.on("uncaughtException", async (error) => {
  console.error("Uncaught Exception in Worker:", error);
  await logErrorArabic(`خطأ فادح في الـ Worker: ${error.message}`, "WorkerProcess", error.stack || "");
  setTimeout(() => process.exit(1), 1000);
});

let httpServer: HttpServer | null = null;
let isShuttingDown = false;

// ─── Graceful Shutdown Engine ───
export const gracefulShutdown = async (signal: string = 'SIGTERM') => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n==========================================`);
  console.log(`🛑 [Worker] Initiating Graceful Shutdown (${signal})...`);
  console.log(`==========================================`);

  // 1. Stop all timers, schedulers and reject any new jobs from starting
  stopBackgroundTasks();
  stopCronSchedulers();

  // 2. Wait up to 6 seconds for active jobs to finish cleanly
  const runningJobs = getWorkerJobsStatus().filter(j => j.isRunning);
  if (runningJobs.length > 0) {
    console.log(`[Worker] Waiting for ${runningJobs.length} active job(s) to finish [${runningJobs.map(j => j.name || j.id).join(', ')}]...`);
    const waitStart = Date.now();
    while (Date.now() - waitStart < 6000) {
      const stillRunning = getWorkerJobsStatus().some(j => j.isRunning);
      if (!stillRunning) {
        console.log("[Worker] All active jobs completed successfully.");
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // 3. Disconnect WhatsApp client cleanly (preserving Supabase session)
  try {
    console.log("[Worker] Closing WhatsApp client connection...");
    whatsappManager.closeOnly();
  } catch (waErr) {
    console.warn("[Worker] WhatsApp disconnect error:", waErr);
  }

  // 4. Disconnect Telegram client cleanly
  if (activeClient && activeClient.connected) {
    try {
      console.log("[GramJS] Disconnecting Telegram client...");
      await activeClient.disconnect();
    } catch (tgErr) {
      console.warn("[GramJS] Error during Telegram disconnect:", tgErr);
    }
  }

  // 5. Close local SQLite database cleanly
  try {
    if (db) {
      db.close();
      console.log("[Worker] Local SQLite database connection closed cleanly.");
    }
  } catch (dbErr) {
    console.warn("[Worker] Error closing SQLite database:", dbErr);
  }

  // 6. Close HTTP server
  if (httpServer) {
    httpServer.close(() => {
      console.log("[Worker] HTTP server closed cleanly. Process exit 0.");
      process.exit(0);
    });

    // Force exit after 5 seconds fallback if connections linger
    setTimeout(() => {
      console.warn("[Worker] Force exiting after shutdown timeout.");
      process.exit(0);
    }, 5000).unref();
  } else {
    console.log("[Worker] Shutdown completed cleanly. Process exit 0.");
    process.exit(0);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export function createWorkerApp() {
  const app = express();

  // Core Express Middlewares
  app.use(compression());
  app.use(express.json());
  app.set('trust proxy', 1);

  // Security Middlewares
  app.use(ipBanMiddleware);
  app.use(suspiciousActivityMiddleware);
  app.use(userAgentMiddleware);
  app.use(timeoutMiddleware);
  app.use(helmetMiddleware);
  app.use(permissionsPolicyMiddleware);

  // Root health probes for Render / Cloud Run health checks
  app.get(["/health", "/ping", "/", "/api/health"], (req: express.Request, res: express.Response) => {
    if (isShuttingDown) {
      return res.status(503).json({
        status: "shutting_down",
        role: "worker_server",
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      status: "online",
      role: "worker_server",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024))
      },
      telegramConnected: !!(activeClient && activeClient.connected),
      whatsappStatus: whatsappManager.getStatus().status,
      activeJobs: getWorkerJobsStatus(),
      lastUpdated: rates?.lastUpdated || new Date().toISOString()
    });
  });

  // Dedicated Worker Job Status endpoint
  app.get("/api/worker/jobs", (req: express.Request, res: express.Response) => {
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      jobs: getWorkerJobsStatus()
    });
  });

  // Global API Rate Limiter
  app.use("/api/", apiLimiter);

  // Admin Routes (for managing scraping, telegram, whatsapp, AI, and worker state)
  app.use('/api/admin', createAdminRouter({
    getPublicApiLimiter: () => publicApiLimiter,
    getUserLogs: () => getUserLogs(),
    clearUserLogs: () => { clearUserLogs(); },
    getOnlineUsers: () => 0,
    apiStats,
    broadcastRatesUpdate: () => {}, // Handled via Supabase persistence -> Web Server
    broadcastConfigUpdate: () => {},
    broadcastUserLogs: () => {},
  }));

  // Cron triggers & Worker System status routes
  app.use("/api", cronRouter);
  app.use("/api", systemRouter);

  // Dedicated Server-to-Server Internal API for Web <-> Worker administrative commands
  app.use("/internal", internalRouter);

  // Catch-all 404 for unmatched routes
  app.use((req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "Worker server: endpoint not found" });
  });

  return app;
}

export async function startWorkerServer() {
  console.log("==========================================");
  console.log("🚀 Starting Production Standalone Worker Server");
  console.log("   Role: Scraping, AI, Schedulers & Supabase Sync");
  console.log("==========================================");

  // 1. Initial database and configuration loading
  await initializeRatesFromDB();
  await loadConfigFromSupabase();
  await loadBroadcastStateFromStorageAndSupabase();
  await loadCblStateFromSupabase();

  // 2. Initialize HTTP server for Worker Health / Admin
  const PORT = Number(process.env.PORT) || 3000;
  const app = createWorkerApp();
  httpServer = createServer(app);

  // 3. Initialize background schedulers and cron jobs
  initCronSchedulers();
  initBackgroundTasks(PORT);

  // 4. Start listening
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Worker] Server listening on http://localhost:${PORT}`);

    // Initial startup data check and synchronization inside safe runner
    (async () => {
      await runJobSafely('initial_startup_sync', 'مزامنة الإقلاع الأولية وتحميل الأسعار', async () => {
        await loadLatestRatesFromSupabase();
        await loadRecentBroadcastTimestamps();
        for (const key in rates.parallel) {
          if (rates.parallel[key] > 0) {
            initStatsIfEmpty(key, rates.parallel[key]);
          }
        }

        console.log("[Worker Startup] Waiting 3s for networks and sessions to settle...");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const libyaFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Tripoli", hour: "numeric", hourCycle: "h23" });
        const currentLibyaHour = parseInt(libyaFormatter.format(new Date()), 10);

        if (currentLibyaHour >= 1 && currentLibyaHour < 7) {
          console.log(`[Worker Startup] Skipping initial scrape during quiet hours (Hour ${currentLibyaHour} Libya Time).`);
        } else {
          console.log("[Worker Startup] Triggering initial rates verification...");
          const officialChanged = await fetchOfficialRates();
          const parallelChanged = await fetchParallelRatesFromTelegram();

          if (officialChanged || parallelChanged) {
            console.log("[Worker Startup] Initial changes detected! Saving to Supabase database...");
            const saveType = (officialChanged && parallelChanged) ? "both" : (officialChanged ? "official" : "parallel");
            await saveToSupabase(saveType);
          }
        }
      }, { timeoutMs: 60000 });
    })();

    // Initialize Telegram client once on Worker startup
    (async () => {
      try {
        console.log("[Telegram] Initializing client on Worker startup...");
        await initializeTelegram();
      } catch (tgBootErr) {
        console.warn("[Telegram] Boot check warning:", tgBootErr);
      }
    })();

    // Auto-reconnect WhatsApp if session exists
    (async () => {
      try {
        await loadConfigFromSupabase();
        if (hasSavedSession()) {
          console.log("[WhatsApp] Found permanent session credentials in Supabase cloud. Auto-connecting...");
          await whatsappManager.initClient();
        } else {
          console.log("[WhatsApp] No saved session in Supabase cloud. Awaiting user QR pairing in admin panel.");
        }
      } catch (waBootErr) {
        console.warn("[WhatsApp] Boot check warning:", waBootErr);
      }
    })();
  });

  return httpServer;
}
