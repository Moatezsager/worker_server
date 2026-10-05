import { Router, Request, Response } from "express";
import { rates } from "../state";
import { appConfig, saveConfigToSupabase, loadConfigFromSupabase } from "../config";
import { db } from "../db";
import { serverStartTime, getAppBuildSignature } from "../utils/version";
import { getWorkerJobsStatus, runJobSafely } from "../schedulers/tasks.scheduler";
import { 
  fetchOfficialRates, fetchParallelRatesFromTelegram, 
  isCblFetchEnabled, setCblFetchEnabled, 
  isTelegramFetchEnabled, setTelegramFetchEnabled, 
  isWhatsAppFetchEnabled, setWhatsAppFetchEnabled 
} from "../services/scraper.service";
import { cleanupOldData, saveToSupabase } from "../services/db.service";
import { cleanupUserLogs, monitorMemory } from "../services/maintenance.service";
import { extractRatesWithAI } from "../services/ai.service";
import { 
  broadcastToSocialMedia, 
  executeBroadcast,
  getBroadcastDisplayRank,
  getBroadcastQueueStatus, 
  flushBroadcastQueueImmediately, 
  clearBroadcastQueue 
} from "../services/social.service";
import { notifyWebServer } from "../utils/notify";
import { updateStats } from "../services/reporting.service";
import { activeClient, initializeTelegram } from "../../telegramClient";
import { whatsappManager } from "../services/whatsapp.service";
import { addLog, getRecentLogs, clearLogs } from "../utils/logger";
import { renderDashboardHtml } from "../views/dashboard.html";
import { getRecentIngestedRecords } from "../services/ingestion.service";

const dashboardRouter = Router();

// ─── 1. Serve Dashboard HTML Web Application ───
dashboardRouter.get(["/", "/dashboard", "/admin"], (req: Request, res: Response) => {
  // If client prefers JSON (such as programmatic probes), return JSON health status
  if (req.headers.accept && !req.headers.accept.includes("text/html") && req.headers.accept.includes("application/json")) {
    return res.json({
      status: "online",
      role: "worker_server",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - serverStartTime.getTime()) / 1000),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
      },
      telegramConnected: !!(activeClient && activeClient.connected),
      whatsappStatus: whatsappManager.getStatus().status,
      activeJobs: getWorkerJobsStatus(),
      lastUpdated: rates?.lastUpdated || new Date().toISOString(),
    });
  }

  const mem = process.memoryUsage();
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime.getTime()) / 1000);
  const initialState = {
    status: "online",
    role: "worker_server",
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    buildSignature: getAppBuildSignature(),
    memory: {
      rssMb: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    },
    telegramConnected: !!(activeClient && activeClient.connected),
    whatsappStatus: whatsappManager.getStatus().status,
    rates: {
      parallel: rates.parallel,
      official: rates.official,
      lastUpdated: rates.lastUpdated,
    },
    activeJobs: getWorkerJobsStatus(),
    recentLogs: getRecentLogs(60),
    accounts: {
      telegram: {
        connected: !!(activeClient && activeClient.connected),
        channel: appConfig.telegramPostChannel || 'lydollar',
        hasSession: !!(process.env.TELEGRAM_SESSION || appConfig.telegramSessionString),
        apiId: process.env.TELEGRAM_API_ID || appConfig.telegramApiId || '',
        hasApiHash: !!(process.env.TELEGRAM_API_HASH || appConfig.telegramApiHash)
      },
      whatsapp: whatsappManager.getStatus(),
      facebook: {
        pageId: appConfig.facebookPageId || '',
        hasToken: !!appConfig.facebookAccessToken,
        autoPost: !!appConfig.facebookAutoPost
      }
    },
    toggles: {
      cblFetchEnabled: isCblFetchEnabled,
      telegramFetchEnabled: isTelegramFetchEnabled,
      whatsappFetchEnabled: isWhatsAppFetchEnabled,
      telegramAutoPost: !!appConfig.telegramAutoPost,
      facebookAutoPost: !!appConfig.facebookAutoPost
    },
    broadcastConfig: {
      minBroadcastIntervalMinutes: appConfig.minBroadcastIntervalMinutes ?? 20,
      minPriceChangeThreshold: appConfig.minPriceChangeThreshold ?? 0.015,
      aggregationWindowSeconds: appConfig.aggregationWindowSeconds ?? 45,
      smartConsolidatedPost: appConfig.smartConsolidatedPost ?? true,
      hourlyPostLimit: appConfig.hourlyPostLimit ?? 4,
      telegramAutoPost: !!appConfig.telegramAutoPost,
      facebookAutoPost: !!appConfig.facebookAutoPost
    },
    broadcastQueue: getBroadcastQueueStatus(),
    terms: appConfig.terms,
    ingestedMessages: getRecentIngestedRecords(30)
  };

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderDashboardHtml(initialState));
});

// ─── 2. Dedicated Dashboard Live Telemetry API ───
dashboardRouter.get("/api/dashboard/stats", (req: Request, res: Response) => {
  const mem = process.memoryUsage();
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime.getTime()) / 1000);

  res.json({
    status: "online",
    role: "worker_server",
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    buildSignature: getAppBuildSignature(),
    memory: {
      rssMb: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    },
    telegramConnected: !!(activeClient && activeClient.connected),
    whatsappStatus: whatsappManager.getStatus().status,
    rates: {
      parallel: rates.parallel,
      official: rates.official,
      lastUpdated: rates.lastUpdated,
    },
    activeJobs: getWorkerJobsStatus(),
    recentLogs: getRecentLogs(60),
    accounts: {
      telegram: {
        connected: !!(activeClient && activeClient.connected),
        channel: appConfig.telegramPostChannel || 'lydollar',
        hasSession: !!(process.env.TELEGRAM_SESSION || appConfig.telegramSessionString),
        apiId: process.env.TELEGRAM_API_ID || appConfig.telegramApiId || '',
        hasApiHash: !!(process.env.TELEGRAM_API_HASH || appConfig.telegramApiHash)
      },
      whatsapp: whatsappManager.getStatus(),
      facebook: {
        pageId: appConfig.facebookPageId || '',
        hasToken: !!appConfig.facebookAccessToken,
        autoPost: !!appConfig.facebookAutoPost
      }
    },
    toggles: {
      cblFetchEnabled: isCblFetchEnabled,
      telegramFetchEnabled: isTelegramFetchEnabled,
      whatsappFetchEnabled: isWhatsAppFetchEnabled,
      telegramAutoPost: !!appConfig.telegramAutoPost,
      facebookAutoPost: !!appConfig.facebookAutoPost
    },
    broadcastConfig: {
      minBroadcastIntervalMinutes: appConfig.minBroadcastIntervalMinutes ?? 20,
      minPriceChangeThreshold: appConfig.minPriceChangeThreshold ?? 0.015,
      aggregationWindowSeconds: appConfig.aggregationWindowSeconds ?? 45,
      smartConsolidatedPost: appConfig.smartConsolidatedPost ?? true,
      hourlyPostLimit: appConfig.hourlyPostLimit ?? 4,
      telegramAutoPost: !!appConfig.telegramAutoPost,
      facebookAutoPost: !!appConfig.facebookAutoPost
    },
    broadcastQueue: getBroadcastQueueStatus(),
    terms: appConfig.terms,
    ingestedMessages: getRecentIngestedRecords(30)
  });
});

// ─── 3. Trigger Allowed Job on Demand ───
dashboardRouter.post("/api/dashboard/trigger", async (req: Request, res: Response) => {
  const { action } = req.body || {};

  addLog("info", "لوحة التحكم", `طلب المستخدم تنفيذ إجراء: [${action || "غير محدد"}]`);

  try {
    switch (action) {
      case "cbl": {
        const result = await runJobSafely(
          "official_rates_scraper",
          "جلب وتحديث أسعار مصرف ليبيا المركزي الرسمي (يدوي من اللوحة)",
          async () => await fetchOfficialRates()
        );
        return res.json({ success: true, message: "تم تشغيل جلب المصرف المركزي", result });
      }

      case "telegram": {
        const result = await runJobSafely(
          "parallel_rates_scraper",
          "جلب وتحديث أسعار السوق الموازي وتيليجرام (يدوي من اللوحة)",
          async () => await fetchParallelRatesFromTelegram()
        );
        return res.json({ success: true, message: "تم تشغيل جلب أسعار تيليجرام الموازي", result });
      }

      case "refresh": {
        const result = await runJobSafely(
          "periodic_supabase_sync",
          "تحديث شامل ومزامنة الأسعار مع سوبابيس (يدوي من اللوحة)",
          async () => {
            await fetchParallelRatesFromTelegram();
            await fetchOfficialRates();
            await saveToSupabase();
            return true;
          }
        );
        return res.json({ success: true, message: "تم تنفيذ دورة التحديث الشاملة", result });
      }

      case "ai": {
        const result = await runJobSafely(
          "ai_rates_extraction",
          "استخراج وتحليل الأسعار بالذكاء الاصطناعي (يدوي من اللوحة)",
          async () => {
            const sampleText = "سعر الدولار اليوم في طرابلس 7.15 واليورو 7.65 وكسر الذهب 18 بـ 385";
            return await extractRatesWithAI(sampleText, "قناة_الاختبار");
          }
        );
        return res.json({ success: true, message: "تم تشغيل تحليل الذكاء الاصطناعي", result });
      }

      case "maintenance": {
        const result = await runJobSafely(
          "database_cleanup",
          "تنظيف وضغط السجلات والمخلفات (يدوي من اللوحة)",
          async () => {
            await cleanupOldData();
            await cleanupUserLogs();
            monitorMemory();
            return true;
          }
        );
        return res.json({ success: true, message: "تم تنفيذ مهام الصيانة وتنظيف السجلات", result });
      }

      case "gc": {
        if (global.gc) {
          global.gc();
          addLog("success", "الذاكرة", "تم تشغيل Garbage Collection بنجاح وتحرير الذاكرة");
          return res.json({ success: true, message: "تم تحرير الذاكرة بنجاح" });
        } else {
          addLog("warn", "الذاكرة", "Garbage Collection غير متاح بدون راية --expose-gc");
          return res.json({ success: true, message: "الذاكرة تم تنظيفها تلقائياً" });
        }
      }

      case "telegram_reconnect": {
        addLog("info", "تيليجرام", "جاري إعادة الاتصال وتنشيط عميل تيليجرام...");
        initializeTelegram().catch((e) => console.error("TG Reconnect error:", e));
        return res.json({ success: true, message: "تم إرسال أمر إعادة الاتصال بتيليجرام" });
      }

      case "whatsapp_reconnect": {
        addLog("info", "واتساب", "جاري إعادة تهيئة وتنشيط جلسة واتساب...");
        whatsappManager.initClient().catch((e) => console.error("WA Reconnect error:", e));
        return res.json({ success: true, message: "تم إرسال أمر إعادة تهيئة واتساب" });
      }

      case "broadcast_test": {
        addLog("info", "البث والنشر", "إرسال نشرة تجريبية إلى القنوات والمجموعات...");
        const sampleMsg = `📢 *تجربة بث مباشر من لوحة التحكم*\n\n💵 الدولار: ${rates.parallel.usd.toFixed(2)} د.ل\n💶 اليورو: ${rates.parallel.eur.toFixed(2)} د.ل\n🕒 التوقيت: ${new Date().toLocaleTimeString('ar-LY')}`;
        const broadcastResult = await broadcastToSocialMedia(sampleMsg, true, 'all', true);
        return res.json({ success: true, message: "تم إرسال النشرة التجريبية", broadcastResult });
      }

      default:
        return res.status(400).json({ success: false, error: `إجراء غير معروف: ${action}` });
    }
  } catch (err: any) {
    addLog("error", "لوحة التحكم", `خطأ أثناء تنفيذ الإجراء ${action}: ${err?.message || err}`);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// ─── 4. Update or Override a Rate Manually ───
dashboardRouter.post("/api/dashboard/update-rate", async (req: Request, res: Response) => {
  const { code, rate } = req.body || {};
  const numRate = Number(rate);

  if (!code || isNaN(numRate) || numRate <= 0) {
    return res.status(400).json({ success: false, error: "كود العملة والقيمة مطلوبة ويجب أن تكون رقماً موجباً" });
  }

  const normalizedCode = String(code).trim();
  rates.parallel[normalizedCode] = numRate;
  rates.parallel[normalizedCode.toUpperCase()] = numRate;
  rates.parallel[normalizedCode.toLowerCase()] = numRate;
  rates.lastUpdated = new Date().toISOString();

  addLog("success", "تعديل يدوي", `تم تعديل سعر [${normalizedCode}] يدوياً إلى ${numRate} د.ل عبر لوحة التحكم`);

  try {
    await saveToSupabase();
    return res.json({
      success: true,
      message: `تم تحديث سعر ${normalizedCode} بنجاح ومزامنته مع سوبابيس`,
      code: normalizedCode,
      rate: numRate,
      lastUpdated: rates.lastUpdated
    });
  } catch (err: any) {
    return res.json({
      success: true,
      message: `تم تحديث السعر محلياً (حدث خطأ في المزامنة: ${err?.message})`,
      code: normalizedCode,
      rate: numRate
    });
  }
});

// ─── 4b. Manual Batch Price Entry & Auto Broadcast (Currencies or Metals) ───
dashboardRouter.post("/api/dashboard/manual-rates-batch", async (req: Request, res: Response) => {
  const { category = "currencies", items, autoBroadcast = true, broadcastTarget = "all" } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: "قائمة العناصر المدخلة فارغة" });
  }

  // Filter only items that are selected and have a valid positive rate
  const selectedItems = items.filter((item: any) => {
    const rate = Number(item.newRate);
    return Boolean(item.selected) && !isNaN(rate) && rate > 0;
  });

  if (selectedItems.length === 0) {
    return res.status(400).json({ success: false, error: "يرجى تحديد عنصر واحد على الأقل وإدخال سعر صحيح أكبر من الصفر" });
  }

  const isMetals = category === "metals";
  const catLabelAr = isMetals ? "الذهب والمعادن" : "العملات";

  addLog(
    "info",
    "تعديل يدوي جماعي",
    `بدء تحديث يدوي لـ ${selectedItems.length} صنف من أصناف [${catLabelAr}] ${autoBroadcast ? 'مع النشر التلقائي الذكي' : 'بدون نشر'}`
  );

  const updatedCodes: string[] = [];
  const broadcastUpdates: Array<{ id: string; name: string; oldVal: number; newVal: number; flag: string }> = [];

  for (const item of selectedItems) {
    const rawCode = String(item.code || "").trim();
    if (!rawCode) continue;

    const newRate = Number(item.newRate);
    const oldRate = (typeof item.oldRate === "number" && item.oldRate > 0) 
      ? Number(item.oldRate) 
      : (Number(rates.parallel[rawCode]) || newRate);

    // Save previous and new rate
    rates.previousParallel[rawCode] = oldRate;
    rates.previousParallel[rawCode.toUpperCase()] = oldRate;
    rates.previousParallel[rawCode.toLowerCase()] = oldRate;

    rates.parallel[rawCode] = newRate;
    rates.parallel[rawCode.toUpperCase()] = newRate;
    rates.parallel[rawCode.toLowerCase()] = newRate;

    // Handle key aliases
    if (rawCode.toUpperCase() === "USD") {
      rates.parallel.usd = newRate;
      rates.previousParallel.usd = oldRate;
    }
    if (rawCode.toUpperCase() === "GOLD_SCRAP_18") {
      rates.parallel.GOLD = newRate;
      rates.parallel.gold = newRate;
      rates.previousParallel.GOLD = oldRate;
      rates.previousParallel.gold = oldRate;
    }
    if (rawCode.toUpperCase() === "GOLD") {
      rates.parallel.GOLD_SCRAP_18 = newRate;
      rates.previousParallel.GOLD_SCRAP_18 = oldRate;
    }

    if (!rates.lastChanged) rates.lastChanged = { official: {}, parallel: {} };
    if (!rates.lastChanged.parallel) rates.lastChanged.parallel = {};
    rates.lastChanged.parallel[rawCode] = new Date().toISOString();

    updateStats(rawCode, newRate);
    updatedCodes.push(rawCode);

    // Determine flag and display name
    const term = appConfig.terms.find(t => t.id === rawCode);
    const flag = item.flag || term?.flag || (isMetals ? (rawCode.startsWith("SILVER") ? "silver" : "gold") : "us");
    const displayName = item.name || term?.name || rawCode;

    broadcastUpdates.push({
      id: rawCode,
      name: displayName,
      oldVal: oldRate,
      newVal: newRate,
      flag
    });
  }

  rates.lastUpdated = new Date().toISOString();

  // 1. Persist to Database (Supabase & SQLite)
  let dbPersisted = false;
  try {
    dbPersisted = await saveToSupabase('parallel');
  } catch (err: any) {
    console.error("[ManualBatch] Save to Supabase failed:", err);
  }

  // 2. Notify Web Server
  notifyWebServer(rates).catch(err => console.warn("[ManualBatch] Notify Web Server error:", err));

  // 3. Intelligent Professional Auto Broadcast
  let broadcastSuccess = false;
  let broadcastError: string | null = null;

  if (autoBroadcast && broadcastUpdates.length > 0) {
    try {
      // Sort in correct sequence according to official market hierarchy
      broadcastUpdates.sort((a, b) => getBroadcastDisplayRank(a) - getBroadcastDisplayRank(b));

      const title = isMetals
        ? "✨ *مؤشر الدينار | نشرة أسعار الذهب والمعادن الثمينة* ✨"
        : "📊 *مؤشر الدينار | نشرة أسعار العملات في السوق الموازي*";

      const targetPlatform = (broadcastTarget === "telegram" || broadcastTarget === "facebook") 
        ? broadcastTarget 
        : "all";

      console.log(`[ManualBatch] 📢 Broadcasting ${broadcastUpdates.length} ${catLabelAr} items to ${targetPlatform}...`);
      await executeBroadcast(broadcastUpdates, false, targetPlatform, true, true, title);
      broadcastSuccess = true;

      addLog("success", "النشر التلقائي الذكي", `تم نشر نشرة [${catLabelAr}] بنجاح (${broadcastUpdates.length} صنف) على (${targetPlatform})`);
    } catch (bcErr: any) {
      broadcastError = bcErr?.message || String(bcErr);
      addLog("error", "النشر التلقائي الذكي", `فشل النشر التلقائي لنشرة [${catLabelAr}]: ${broadcastError}`);
    }
  }

  addLog(
    "success",
    "تعديل يدوي جماعي",
    `تم تحديث ${updatedCodes.length} صنف في قاعدة البيانات [${catLabelAr}]`
  );

  return res.json({
    success: true,
    message: broadcastSuccess 
      ? `تم حفظ أسعار ${updatedCodes.length} صنف ونشر النشرة بنجاح على القنوات!`
      : `تم حفظ أسعار ${updatedCodes.length} صنف بنجاح في قاعدة البيانات${broadcastError ? ` (تعذر النشر: ${broadcastError})` : ''}`,
    category,
    updatedCount: updatedCodes.length,
    updatedCodes,
    persisted: dbPersisted,
    broadcasted: broadcastSuccess,
    broadcastError,
    lastUpdated: rates.lastUpdated,
    rates: rates.parallel
  });
});

// ─── 5. Custom Message Broadcast to Channels ───
dashboardRouter.post("/api/dashboard/broadcast-custom", async (req: Request, res: Response) => {
  const { message, target = "all", isTest = false } = req.body || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ success: false, error: "نص الرسالة مطلوب" });
  }

  addLog("info", "البث والنشر", `إرسال رسالة مخصصة إلى (${target}) ${isTest ? '[تجريبي]' : '[نشر فعلي]'}`);

  try {
    const result = await broadcastToSocialMedia(message.trim(), Boolean(isTest), target as any, true);
    return res.json({ success: true, message: "تم إرسال الرسالة إلى قنوات النشر", result });
  } catch (err: any) {
    addLog("error", "البث والنشر", `فشل إرسال المنشور: ${err?.message || err}`);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// ─── 5b. Smart Broadcast Queue Telemetry & Management ───
dashboardRouter.get("/api/dashboard/broadcast/queue", (req: Request, res: Response) => {
  res.json({
    success: true,
    queue: getBroadcastQueueStatus()
  });
});

dashboardRouter.post("/api/dashboard/broadcast/queue/flush", async (req: Request, res: Response) => {
  const { target = "all" } = req.body || {};
  addLog("info", "البث والنشر", "طلب المشرف تفريغ طابور التحديثات ونشره فوراً");
  try {
    const result = await flushBroadcastQueueImmediately(target as any, true);
    return res.json(result);
  } catch (err: any) {
    addLog("error", "البث والنشر", `فشل تفريغ طابور التحديثات: ${err?.message || err}`);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

dashboardRouter.post("/api/dashboard/broadcast/queue/clear", (req: Request, res: Response) => {
  const clearedCount = clearBroadcastQueue();
  addLog("info", "البث والنشر", `تم مسح ${clearedCount} عنصر من طابور التحديثات`);
  res.json({ success: true, count: clearedCount, message: `تم مسح ${clearedCount} عنصر من الطابور` });
});

dashboardRouter.post("/api/dashboard/broadcast/settings/save", async (req: Request, res: Response) => {
  const { 
    minBroadcastIntervalMinutes, 
    minPriceChangeThreshold, 
    aggregationWindowSeconds, 
    hourlyPostLimit,
    smartConsolidatedPost,
    telegramAutoPost,
    facebookAutoPost
  } = req.body || {};

  if (minBroadcastIntervalMinutes !== undefined && !isNaN(Number(minBroadcastIntervalMinutes))) {
    appConfig.minBroadcastIntervalMinutes = Math.max(1, Number(minBroadcastIntervalMinutes));
  }
  if (minPriceChangeThreshold !== undefined && !isNaN(Number(minPriceChangeThreshold))) {
    appConfig.minPriceChangeThreshold = Math.max(0.001, Number(minPriceChangeThreshold));
  }
  if (aggregationWindowSeconds !== undefined && !isNaN(Number(aggregationWindowSeconds))) {
    appConfig.aggregationWindowSeconds = Math.max(10, Number(aggregationWindowSeconds));
  }
  if (hourlyPostLimit !== undefined && !isNaN(Number(hourlyPostLimit))) {
    appConfig.hourlyPostLimit = Math.max(1, Number(hourlyPostLimit));
  }
  if (smartConsolidatedPost !== undefined) {
    appConfig.smartConsolidatedPost = Boolean(smartConsolidatedPost);
  }
  if (telegramAutoPost !== undefined) {
    appConfig.telegramAutoPost = Boolean(telegramAutoPost);
  }
  if (facebookAutoPost !== undefined) {
    appConfig.facebookAutoPost = Boolean(facebookAutoPost);
  }

  addLog("info", "إعدادات النشر", `تم تحديث شروط النشر التلقائي: فاصل ${appConfig.minBroadcastIntervalMinutes}د | فارق ${appConfig.minPriceChangeThreshold}د.ل | تجميع ${appConfig.aggregationWindowSeconds}ث`);
  await saveConfigToSupabase(appConfig);

  res.json({
    success: true,
    message: "تم حفظ إعدادات وشروط النشر التلقائي بنجاح",
    config: {
      minBroadcastIntervalMinutes: appConfig.minBroadcastIntervalMinutes,
      minPriceChangeThreshold: appConfig.minPriceChangeThreshold,
      aggregationWindowSeconds: appConfig.aggregationWindowSeconds,
      hourlyPostLimit: appConfig.hourlyPostLimit,
      smartConsolidatedPost: appConfig.smartConsolidatedPost,
      telegramAutoPost: appConfig.telegramAutoPost,
      facebookAutoPost: appConfig.facebookAutoPost
    }
  });
});

// ─── 5c. Sources & Channels Management Endpoints ───
dashboardRouter.get("/api/dashboard/sources", async (req: Request, res: Response) => {
  try {
    const telegramChannels = appConfig.channels || [];
    const whatsappSources = appConfig.whatsappSources || [];
    const reachableChats = await whatsappManager.getReachableChats().catch(() => []);
    
    res.json({
      success: true,
      telegramChannels,
      whatsappSources,
      whatsappStatus: whatsappManager.getStatus().status,
      whatsappReachableChats: reachableChats
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

dashboardRouter.post("/api/dashboard/sources/telegram/add", async (req: Request, res: Response) => {
  try {
    const { channel } = req.body || {};
    if (!channel || typeof channel !== 'string') {
      return res.status(400).json({ success: false, error: "يرجى أدخال معرف القناة بشكل صحيح" });
    }
    const cleanChannel = channel.replace(/^@/, '').trim();
    if (!cleanChannel) {
      return res.status(400).json({ success: false, error: "اسم القناة غير صالح" });
    }
    if (appConfig.channels.includes(cleanChannel)) {
      return res.status(400).json({ success: false, error: "القناة موجودة بالفعل في قائمة المراقبة" });
    }

    appConfig.channels.push(cleanChannel);
    addLog("info", "إدارة المصادر", `تم إضافة قناة تيليجرام جديدة: @${cleanChannel}`);
    await saveConfigToSupabase(appConfig);

    res.json({
      success: true,
      message: `تم إضافة القناة @${cleanChannel} بنجاح!`,
      channels: appConfig.channels
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

dashboardRouter.post("/api/dashboard/sources/telegram/edit", async (req: Request, res: Response) => {
  try {
    const { oldChannel, newChannel } = req.body || {};
    if (!oldChannel || !newChannel) {
      return res.status(400).json({ success: false, error: "بيانات التعديل غير مكتملة" });
    }
    const cleanOld = oldChannel.replace(/^@/, '').trim();
    const cleanNew = newChannel.replace(/^@/, '').trim();

    const idx = appConfig.channels.indexOf(cleanOld);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: "القناة المراد تعديلها غير موجودة" });
    }

    appConfig.channels[idx] = cleanNew;
    addLog("info", "إدارة المصادر", `تم تعديل اسم قناة تيليجرام من @${cleanOld} إلى @${cleanNew}`);
    await saveConfigToSupabase(appConfig);

    res.json({
      success: true,
      message: "تم تعديل اسم القناة بنجاح",
      channels: appConfig.channels
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

dashboardRouter.post("/api/dashboard/sources/telegram/delete", async (req: Request, res: Response) => {
  try {
    const { channel } = req.body || {};
    if (!channel) {
      return res.status(400).json({ success: false, error: "لم يتم تحديد القناة المراد حذفها" });
    }
    const cleanChannel = channel.replace(/^@/, '').trim();
    const idx = appConfig.channels.indexOf(cleanChannel);
    if (idx !== -1) {
      appConfig.channels.splice(idx, 1);
      addLog("info", "إدارة المصادر", `تم حذف قناة تيليجرام: @${cleanChannel}`);
      await saveConfigToSupabase(appConfig);
    }

    res.json({
      success: true,
      message: `تم حذف القناة @${cleanChannel} بنجاح`,
      channels: appConfig.channels
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

dashboardRouter.post("/api/dashboard/sources/whatsapp/refresh", async (req: Request, res: Response) => {
  try {
    const chats = await whatsappManager.getReachableChats();
    if (!appConfig.whatsappSources) {
      appConfig.whatsappSources = [];
    }

    let addedCount = 0;
    for (const chat of chats) {
      const existing = appConfig.whatsappSources.find(s => s.jid === chat.id);
      if (!existing) {
        appConfig.whatsappSources.push({
          jid: chat.id,
          name: chat.name,
          enabled: true,
          type: chat.type
        });
        addedCount++;
      } else {
        existing.name = chat.name || existing.name;
        existing.type = chat.type || existing.type;
      }
    }

    if (addedCount > 0 || chats.length > 0) {
      addLog("info", "إدارة المصادر", `تم اكتشاف ومزامنة ${chats.length} مجموعة/قناة من حساب واتساب`);
      await saveConfigToSupabase(appConfig);
    }

    res.json({
      success: true,
      message: `تم جلب ومزامنة ${chats.length} مجموعة وقناة من حساب واتساب المنضم إليها`,
      whatsappSources: appConfig.whatsappSources,
      chats
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

dashboardRouter.post("/api/dashboard/sources/whatsapp/toggle", async (req: Request, res: Response) => {
  try {
    const { jid, enabled } = req.body || {};
    if (!jid) return res.status(400).json({ success: false, error: "معرف المصدر مفقود" });

    if (!appConfig.whatsappSources) appConfig.whatsappSources = [];
    let item = appConfig.whatsappSources.find(s => s.jid === jid);
    if (!item) {
      item = { jid, name: jid, enabled: Boolean(enabled) };
      appConfig.whatsappSources.push(item);
    } else {
      item.enabled = Boolean(enabled);
    }

    addLog("info", "إدارة المصادر", `تم ${item.enabled ? 'تفعيل' : 'تعطيل'} استخراج الأسعار من مصدر واتساب: ${item.name}`);
    await saveConfigToSupabase(appConfig);

    res.json({ success: true, item, whatsappSources: appConfig.whatsappSources });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

dashboardRouter.post("/api/dashboard/sources/whatsapp/add", async (req: Request, res: Response) => {
  try {
    const { jid, name, type = 'group' } = req.body || {};
    if (!jid || !name) return res.status(400).json({ success: false, error: "الرجاء إدخال اسم المصدر ومعرفه (JID)" });

    if (!appConfig.whatsappSources) appConfig.whatsappSources = [];
    const cleanJid = jid.trim();
    if (appConfig.whatsappSources.some(s => s.jid === cleanJid)) {
      return res.status(400).json({ success: false, error: "المصدر موجود بالفعل" });
    }

    appConfig.whatsappSources.push({
      jid: cleanJid,
      name: name.trim(),
      enabled: true,
      type
    });

    addLog("info", "إدارة المصادر", `تم إضافة مصدر واتساب جديد يدوياً: ${name}`);
    await saveConfigToSupabase(appConfig);

    res.json({ success: true, message: "تم إضافة مصدر واتساب بنجاح", whatsappSources: appConfig.whatsappSources });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

dashboardRouter.post("/api/dashboard/sources/whatsapp/delete", async (req: Request, res: Response) => {
  try {
    const { jid } = req.body || {};
    if (!jid) return res.status(400).json({ success: false, error: "معرف المصدر مفقود" });

    if (appConfig.whatsappSources) {
      appConfig.whatsappSources = appConfig.whatsappSources.filter(s => s.jid !== jid);
      addLog("info", "إدارة المصادر", `تم حذف مصدر واتساب: ${jid}`);
      await saveConfigToSupabase(appConfig);
    }

    res.json({ success: true, message: "تم حذف المصدر بنجاح", whatsappSources: appConfig.whatsappSources });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// ─── 6. Clear In-Memory Live Logs ───
dashboardRouter.post("/api/dashboard/clear-logs", (req: Request, res: Response) => {
  clearLogs();
  addLog("info", "السجلات", "تم مسح السجلات الحية من الذاكرة");
  res.json({ success: true });
});

// ─── 7. Accounts Management Endpoints ───
dashboardRouter.get("/api/dashboard/accounts", (req: Request, res: Response) => {
  res.json({
    success: true,
    telegram: {
      connected: !!(activeClient && activeClient.connected),
      channel: appConfig.telegramPostChannel || 'lydollar',
      hasSession: !!(process.env.TELEGRAM_SESSION || appConfig.telegramSessionString),
      hasBotToken: !!appConfig.telegramBotToken
    },
    whatsapp: whatsappManager.getStatus(),
    facebook: {
      pageId: appConfig.facebookPageId || '',
      hasToken: !!appConfig.facebookAccessToken,
      autoPost: !!appConfig.facebookAutoPost
    },
    toggles: {
      cblFetchEnabled: isCblFetchEnabled,
      telegramFetchEnabled: isTelegramFetchEnabled,
      whatsappFetchEnabled: isWhatsAppFetchEnabled,
      telegramAutoPost: !!appConfig.telegramAutoPost,
      facebookAutoPost: !!appConfig.facebookAutoPost
    }
  });
});

import { 
  sendTelegramLoginCode, 
  verifyTelegramLoginCode, 
  verifyTelegram2FAPassword
} from "../services/telegramAuth.service";

// Save Telegram Session or Token
dashboardRouter.post("/api/dashboard/accounts/telegram/save", async (req: Request, res: Response) => {
  const { sessionString, botToken, postChannel } = req.body || {};

  if (sessionString !== undefined && typeof sessionString === "string") {
    appConfig.telegramSessionString = sessionString.trim();
    process.env.TELEGRAM_SESSION = sessionString.trim();
  }
  if (botToken !== undefined && typeof botToken === "string") {
    appConfig.telegramBotToken = botToken.trim();
  }
  if (postChannel !== undefined && typeof postChannel === "string") {
    appConfig.telegramPostChannel = postChannel.trim();
  }

  addLog("info", "حسابات", "تم حفظ وتحديث إعدادات جلسة تيليجرام");
  await saveConfigToSupabase(appConfig);

  // Trigger reconnect
  try {
    await initializeTelegram();
    return res.json({
      success: true,
      message: "تم حفظ الجلسة وبدء الاتصال بتيليجرام بنجاح",
      connected: !!(activeClient && activeClient.connected)
    });
  } catch (err: any) {
    return res.json({
      success: true,
      message: `تم حفظ الإعدادات (جاري الاتصال: ${err?.message || err})`,
      connected: false
    });
  }
});

// Interactive Telegram Login Step 1: Send OTP Code
dashboardRouter.post("/api/dashboard/accounts/telegram/send-code", async (req: Request, res: Response) => {
  const { phoneNumber, apiId, apiHash } = req.body || {};

  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: "رقم الهاتف مطلوب" });
  }

  try {
    const result = await sendTelegramLoginCode({
      phoneNumber,
      apiId: apiId ? Number(apiId) : undefined,
      apiHash: apiHash ? String(apiHash).trim() : undefined
    });

    return res.json({
      success: true,
      message: result.isCodeViaApp 
        ? "تم إرسال كود التحقق إلى تطبيق تيليجرام الخاص بك" 
        : "تم إرسال كود التحقق عبر رسالة SMS",
      phoneCodeHash: result.phoneCodeHash
    });
  } catch (err: any) {
    addLog("error", "تسجيل دخول تيليجرام", `فشل إرسال كود التحقق: ${err?.message || err}`);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// Interactive Telegram Login Step 2: Verify Code
dashboardRouter.post("/api/dashboard/accounts/telegram/verify-code", async (req: Request, res: Response) => {
  const { phoneCode } = req.body || {};

  if (!phoneCode) {
    return res.status(400).json({ success: false, error: "كود التحقق مطلوب" });
  }

  try {
    const result = await verifyTelegramLoginCode(phoneCode);
    return res.json(result);
  } catch (err: any) {
    addLog("error", "تسجيل دخول تيليجرام", `فشل التحقق من الكود: ${err?.message || err}`);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// Interactive Telegram Login Step 3: Verify 2FA Password
dashboardRouter.post("/api/dashboard/accounts/telegram/verify-2fa", async (req: Request, res: Response) => {
  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ success: false, error: "كلمة المرور الثنائية مطلوبة" });
  }

  try {
    const result = await verifyTelegram2FAPassword(password);
    return res.json(result);
  } catch (err: any) {
    addLog("error", "تسجيل دخول تيليجرام", `فشل التحقق من كلمة المرور الثنائية: ${err?.message || err}`);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// Telegram Reconnect
dashboardRouter.post("/api/dashboard/accounts/telegram/reconnect", async (req: Request, res: Response) => {
  addLog("info", "حسابات", "طلب إعادة اتصال تيليجرام يدوياً");
  try {
    await initializeTelegram();
    return res.json({
      success: true,
      message: "تمت إعادة محاولة الاتصال بتيليجرام",
      connected: !!(activeClient && activeClient.connected)
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// Telegram Disconnect
dashboardRouter.post("/api/dashboard/accounts/telegram/disconnect", async (req: Request, res: Response) => {
  addLog("info", "حسابات", "قطع اتصال جلسة تيليجرام يدوياً");
  try {
    if (activeClient && activeClient.connected) {
      await activeClient.disconnect();
    }
    return res.json({ success: true, message: "تم قطع اتصال تيليجرام" });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// WhatsApp Init Client (Generates QR Code if needed)
dashboardRouter.post("/api/dashboard/accounts/whatsapp/init", async (req: Request, res: Response) => {
  addLog("info", "حسابات", "تهيئة وتشغيل عميل واتساب وتوليد الرمز");
  try {
    await whatsappManager.initClient();
    return res.json({
      success: true,
      message: "تم بدء تهيئة واتساب",
      status: whatsappManager.getStatus()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// WhatsApp Disconnect
dashboardRouter.post("/api/dashboard/accounts/whatsapp/disconnect", async (req: Request, res: Response) => {
  addLog("info", "حسابات", "تسجيل الخروج وحذف جلسة واتساب");
  try {
    await whatsappManager.disconnect();
    return res.json({ success: true, message: "تم تسجيل الخروج وقطع جلسة واتساب بنجاح" });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// Save Facebook Settings
dashboardRouter.post("/api/dashboard/accounts/facebook/save", async (req: Request, res: Response) => {
  const { pageId, accessToken, autoPost } = req.body || {};

  if (pageId !== undefined) appConfig.facebookPageId = String(pageId).trim();
  if (accessToken !== undefined) appConfig.facebookAccessToken = String(accessToken).trim();
  if (autoPost !== undefined) appConfig.facebookAutoPost = Boolean(autoPost);

  addLog("info", "حسابات", "تم حفظ إعدادات الربط مع فيسبوك");
  await saveConfigToSupabase(appConfig);

  return res.json({
    success: true,
    message: "تم حفظ إعدادات فيسبوك بنجاح"
  });
});

// Test Facebook Post
dashboardRouter.post("/api/dashboard/accounts/facebook/test", async (req: Request, res: Response) => {
  addLog("info", "حسابات", "إرسال منشور تجريبي إلى صفحة فيسبوك");
  try {
    const result = await broadcastToSocialMedia("منشور تجريبي من لوحة تحكم مؤشر الدينار الليبي", true, "facebook", true);
    return res.json({ success: true, message: "تم نشر الرسالة التجريبية على فيسبوك بنجاح!", result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// ─── 8. Automation & Scraping Toggles ───
dashboardRouter.post("/api/dashboard/toggles", async (req: Request, res: Response) => {
  const { 
    cblFetchEnabled, 
    telegramFetchEnabled, 
    whatsappFetchEnabled, 
    telegramAutoPost, 
    facebookAutoPost 
  } = req.body || {};

  if (cblFetchEnabled !== undefined) {
    setCblFetchEnabled(Boolean(cblFetchEnabled));
    addLog("info", "التحكم", `تم ${cblFetchEnabled ? 'تفعيل' : 'تعطيل'} الجلب من مصرف ليبيا المركزي`);
  }
  if (telegramFetchEnabled !== undefined) {
    setTelegramFetchEnabled(Boolean(telegramFetchEnabled));
    addLog("info", "التحكم", `تم ${telegramFetchEnabled ? 'تفعيل' : 'تعطيل'} الجلب من قنوات تيليجرام`);
  }
  if (whatsappFetchEnabled !== undefined) {
    setWhatsAppFetchEnabled(Boolean(whatsappFetchEnabled));
    addLog("info", "التحكم", `تم ${whatsappFetchEnabled ? 'تفعيل' : 'تعطيل'} الجلب من مجموعات واتساب`);
  }
  if (telegramAutoPost !== undefined) {
    appConfig.telegramAutoPost = Boolean(telegramAutoPost);
    addLog("info", "التحكم", `تم ${telegramAutoPost ? 'تفعيل' : 'تعطيل'} النشر التلقائي في تيليجرام`);
  }
  if (facebookAutoPost !== undefined) {
    appConfig.facebookAutoPost = Boolean(facebookAutoPost);
    addLog("info", "التحكم", `تم ${facebookAutoPost ? 'تفعيل' : 'تعطيل'} النشر التلقائي في فيسبوك`);
  }

  await saveConfigToSupabase(appConfig);

  return res.json({
    success: true,
    message: "تم تحديث إعدادات التشغيل والتحكم بنجاح",
    toggles: {
      cblFetchEnabled: isCblFetchEnabled,
      telegramFetchEnabled: isTelegramFetchEnabled,
      whatsappFetchEnabled: isWhatsAppFetchEnabled,
      telegramAutoPost: !!appConfig.telegramAutoPost,
      facebookAutoPost: !!appConfig.facebookAutoPost
    }
  });
});

// ─── 9. Ingested Messages & Extraction History ───
dashboardRouter.get("/api/dashboard/ingested-messages", (req: Request, res: Response) => {
  const records = getRecentIngestedRecords(35);
  res.json({
    success: true,
    messages: records
  });
});

// ─── 10. Currency Terms & Extraction Settings ───
dashboardRouter.get("/api/dashboard/settings/terms", (req: Request, res: Response) => {
  res.json({
    success: true,
    terms: appConfig.terms
  });
});

dashboardRouter.post("/api/dashboard/settings/terms/save", async (req: Request, res: Response) => {
  const { id, name, regex, min, max, flag, isInverse } = req.body || {};

  if (!id || typeof id !== 'string' || !id.trim()) {
    return res.status(400).json({ success: false, error: "كود العملة (ID) مطلوب" });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ success: false, error: "اسم العملة مطلوب" });
  }
  if (!regex || typeof regex !== 'string' || !regex.trim()) {
    return res.status(400).json({ success: false, error: "نمط المطابقة (Regex) مطلوب" });
  }

  // Validate regex syntax
  try {
    new RegExp(regex.trim(), 'i');
  } catch (err: any) {
    return res.status(400).json({ success: false, error: `نمط Regex غير صالح: ${err?.message || err}` });
  }

  const numMin = parseFloat(String(min));
  const numMax = parseFloat(String(max));

  if (isNaN(numMin) || isNaN(numMax)) {
    return res.status(400).json({ success: false, error: "الحد الأدنى والأقصى يجب أن يكونا أرقاماً صالحة" });
  }
  if (numMin > numMax) {
    return res.status(400).json({ success: false, error: "الحد الأدنى لا يمكن أن يكون أكبر من الحد الأقصى" });
  }

  const termId = id.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const termName = name.trim();
  const termRegex = regex.trim();
  const termFlag = (flag && String(flag).trim().toLowerCase()) || 'ly';
  const termInverse = Boolean(isInverse);

  const newTerm = {
    id: termId,
    name: termName,
    regex: termRegex,
    min: numMin,
    max: numMax,
    isInverse: termInverse,
    flag: termFlag
  };

  const existingIdx = appConfig.terms.findIndex(t => t.id === termId);
  if (existingIdx >= 0) {
    appConfig.terms[existingIdx] = newTerm;
  } else {
    appConfig.terms.unshift(newTerm);
  }

  addLog("info", "إعدادات العملات", `تم حفظ شروط العملة [${termName} (${termId})] بنطاق [${numMin} - ${numMax}]`);

  // Persist to database
  await saveConfigToSupabase(appConfig);

  return res.json({
    success: true,
    message: `تم حفظ العملة [${termName}] وشروط الاستخراج في قاعدة البيانات بنجاح`,
    terms: appConfig.terms,
    term: newTerm
  });
});

dashboardRouter.post("/api/dashboard/settings/terms/delete", async (req: Request, res: Response) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ success: false, error: "معرف العملة مطلوب للحذف" });
  }

  const existingIdx = appConfig.terms.findIndex(t => t.id === id);
  if (existingIdx === -1) {
    return res.status(404).json({ success: false, error: "العملة غير موجودة" });
  }

  const deletedTerm = appConfig.terms.splice(existingIdx, 1)[0];

  try {
    db.prepare('DELETE FROM currency_terms WHERE id = ?').run(id);
  } catch (e) {}

  addLog("warn", "إعدادات العملات", `تم حذف العملة [${deletedTerm.name} (${deletedTerm.id})] من شروط الاستخراج`);

  await saveConfigToSupabase(appConfig);

  return res.json({
    success: true,
    message: `تم حذف العملة [${deletedTerm.name}] بنجاح`,
    terms: appConfig.terms
  });
});

dashboardRouter.post("/api/dashboard/settings/terms/sync-db", async (req: Request, res: Response) => {
  addLog("info", "إعدادات العملات", "طلب مزامنة شروط العملات من جدول قاعدة البيانات");
  await loadConfigFromSupabase();
  return res.json({
    success: true,
    message: "تمت مزامنة العملات من قاعدة البيانات بنجاح",
    terms: appConfig.terms
  });
});

dashboardRouter.post("/api/dashboard/settings/terms/test", (req: Request, res: Response) => {
  const { regex, min, max, isInverse, text } = req.body || {};
  if (!regex || !text) {
    return res.status(400).json({ success: false, error: "النمط والنص مطلوبان للاختبار" });
  }

  try {
    const rx = new RegExp(regex, 'i');
    const match = text.match(rx);
    if (!match) {
      return res.json({
        success: true,
        matched: false,
        message: "لم يتم العثور على مطابقة في النص"
      });
    }

    const capturedNums = match.slice(1).filter(Boolean);
    let val: number | null = null;

    if (capturedNums.length > 0) {
      const rawStr = capturedNums[0].replace(/,/g, '.');
      val = parseFloat(rawStr);
      if (isInverse && val > 0) val = 1 / val;
    }

    const numMin = typeof min === 'number' ? min : parseFloat(min || '0');
    const numMax = typeof max === 'number' ? max : parseFloat(max || '999999');

    const withinRange = val !== null && !isNaN(val) && val >= numMin && val <= numMax;

    return res.json({
      success: true,
      matched: true,
      fullMatch: match[0],
      capturedValue: val,
      withinRange,
      message: withinRange 
        ? `✅ تطابق ناجح! تم استخراج القيمة ${val} وهي تقع ضمن النطاق المطلوب [${numMin} - ${numMax}]`
        : `⚠️ تم التطابق واستخراج القيمة ${val} ولكنها تقع خارج النطاق المشروط [${numMin} - ${numMax}]`
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: `خطأ في النمط: ${err?.message || err}` });
  }
});

export default dashboardRouter;
