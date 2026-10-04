import { Router, Request, Response } from "express";
import { rates } from "../state";
import { appConfig, saveConfigToSupabase } from "../config";
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
import { broadcastToSocialMedia } from "../services/social.service";
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
  verifyTelegram2FAPassword,
  DEFAULT_TELEGRAM_API_ID,
  DEFAULT_TELEGRAM_API_HASH
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
      apiId: apiId ? Number(apiId) : DEFAULT_TELEGRAM_API_ID,
      apiHash: apiHash || DEFAULT_TELEGRAM_API_HASH
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

export default dashboardRouter;
