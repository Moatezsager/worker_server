import cron, { ScheduledTask } from "node-cron";
import { broadcastWeeklyReport } from "../services/reporting.service";
import { cleanupLocalDatabase } from "../services/maintenance.service";

let isCronInitialized = false;
const activeCronTasks: ScheduledTask[] = [];

/**
 * Initialize all scheduled recurring cron jobs in Worker with idempotency.
 */
export function initCronSchedulers() {
  if (isCronInitialized) {
    console.log("[Cron] Schedulers already initialized, skipping duplicate registration.");
    return;
  }
  isCronInitialized = true;

  console.log("[Cron] Registering scheduled recurring tasks...");

  // 1. Weekly Harvest & Market Summary Report (Every Friday 23:55 Libya Time)
  const weeklyTask = cron.schedule('55 23 * * 5', async () => {
    try {
      console.log("[Cron] Triggering Weekly Harvest Report broadcast...");
      await broadcastWeeklyReport();
    } catch (err) {
      console.error("[Cron] Error broadcasting weekly report:", err);
    }
  }, {
    timezone: "Africa/Tripoli"
  });
  activeCronTasks.push(weeklyTask);

  // 2. Local Database Maintenance (Auto-Vacuum & Log Pruning) (Every Day 03:00 Libya Time)
  const cleanupTask = cron.schedule('0 3 * * *', async () => {
    try {
      console.log("[Cron] Triggering daily local database cleanup & vacuum...");
      cleanupLocalDatabase();
    } catch (err) {
      console.error("[Cron] Error in daily database cleanup:", err);
    }
  }, {
    timezone: "Africa/Tripoli"
  });
  activeCronTasks.push(cleanupTask);

  console.log(`[Cron] Successfully registered ${activeCronTasks.length} recurring cron jobs.`);
}

/**
 * Stop and destroy all active cron tasks on Worker shutdown.
 */
export function stopCronSchedulers() {
  console.log(`[Cron] Stopping ${activeCronTasks.length} cron tasks...`);
  for (const task of activeCronTasks) {
    try {
      task.stop();
      if ((task as any).destroy) (task as any).destroy();
    } catch (e) {
      console.warn("[Cron] Error stopping task:", e);
    }
  }
  activeCronTasks.length = 0;
  isCronInitialized = false;
  console.log("[Cron] All cron tasks stopped cleanly.");
}
