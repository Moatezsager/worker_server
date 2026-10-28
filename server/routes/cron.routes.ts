import express from "express";
import { rates } from "../state";
import { cleanupOldData } from "../services/db.service";
import { fetchParallelRatesFromTelegram, fetchOfficialRates } from "../services/scraper.service";
import { 
  extractProvidedCronKey, 
  isValidCronSecret, 
  cronParallelLimiter, 
  cronOfficialLimiter, 
  cronCleanupLimiter 
} from "../middleware/security";

const router = express.Router();

router.get("/refresh-parallel", cronParallelLimiter, async (req: express.Request, res: express.Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('X-Accel-Buffering', 'no');

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const providedKey = extractProvidedCronKey(req);
  
  if (!isValidCronSecret(providedKey)) {
    console.warn(`[Cron-Job] Unauthorized refresh attempt from IP: ${ip}`);
    return res.status(403).json({ success: false, error: "Forbidden: Invalid security key" });
  }
  
  console.log(`\n[Cron-Job] Refresh request received!`);
  
  try {
    const startTime = Date.now();
    const oldUsd = rates.parallel.USD;

    // 1. Fetch data from Telegram
    const parallelUpdate = await fetchParallelRatesFromTelegram();
    
    if (parallelUpdate === true) {
      console.log(`[Cron-Job] Fetch completed (Changes: ${parallelUpdate}). Syncing with database...`);
    } else if (parallelUpdate === false) {
      console.log("[Cron-Job] No changes detected. Database sync skipped.");
    } else {
      console.log("[Cron-Job] Scraper was busy or too recent. Skipping DB sync.");
    }
    
    const duration = Date.now() - startTime;
    const newUsd = rates.parallel.USD;
    
    res.status(200).json({ 
      success: true, 
      message: parallelUpdate === true 
        ? "Parallel data updated and synced with database" 
        : parallelUpdate === false 
          ? "Server active & alive. No changes detected." 
          : "Server active & alive. Scraper executed recently, prices are up to date.",
      details: {
        duration_ms: duration,
        parallel_usd: newUsd,
        last_sync: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("[Cron-Job] Parallel refresh failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error during refresh" });
    }
  }
});

router.get("/refresh-official", cronOfficialLimiter, async (req: express.Request, res: express.Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('X-Accel-Buffering', 'no');

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const providedKey = extractProvidedCronKey(req);
  
  if (!isValidCronSecret(providedKey)) {
    console.warn(`[Cron-Job-Official] Unauthorized refresh attempt from IP: ${ip}`);
    return res.status(403).json({ success: false, error: "Forbidden: Invalid security key" });
  }
  
  console.log(`\n[Cron-Job-Official] Official refresh request received!`);
  
  try {
    const startTime = Date.now();
    const oldOfficial = rates.official.USD;

    // 1. Fetch official rates (CBL) in automatic mode
    const officialUpdate = await fetchOfficialRates(false, false);
    
    if (officialUpdate === true) {
      console.log(`[Cron-Job-Official] Fetch completed (Changes: ${officialUpdate}). Syncing with database...`);
    } else {
      console.log("[Cron-Job-Official] No changes detected. Database sync skipped.");
    }
    
    const duration = Date.now() - startTime;
    const newOfficial = rates.official.USD;
    
    res.status(200).json({ 
      success: true, 
      message: "Official data updated and synced with database",
      details: {
        duration_ms: duration,
        official_usd: newOfficial,
        last_sync: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("[Cron-Job-Official] Official refresh failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error during official refresh", details: err ? String(err) : "Unknown", stack: err && err.stack ? err.stack : "" });
    }
  }
});

router.get("/cleanup-db", cronCleanupLimiter, async (req: express.Request, res: express.Response) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const providedKey = extractProvidedCronKey(req);
  
  if (!isValidCronSecret(providedKey)) {
    console.warn(`[Maintenance] Unauthorized cleanup attempt from IP: ${ip}`);
    return res.status(403).json({ success: false, error: "Forbidden: Invalid security key" });
  }

  try {
    const details = await cleanupOldData();
    if (res.headersSent || res.destroyed) return;
    res.json({
      success: true,
      message: "اكتمل التنظيف مع الاحتفاظ بقراءات 30 يومًا وملخصات يومية حتى ستة أشهر وآخر سعر متاح",
      details
    });
  } catch (err) {
    console.error("[Maintenance] Cleanup failed:", err);
    if (!res.headersSent && !res.destroyed) {
      res.status(500).json({ success: false, error: "Internal server error during cleanup" });
    }
  }
});

export default router;
