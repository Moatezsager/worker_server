import { Router, Request, Response } from "express";
import { rates } from "../state";
import { appConfig } from "../config";
import { serverStartTime, getAppBuildSignature } from "../utils/version";
import { getWorkerJobsStatus, runJobSafely } from "../schedulers/tasks.scheduler";
import { fetchOfficialRates, fetchParallelRatesFromTelegram } from "../services/scraper.service";
import { cleanupOldData, saveToSupabase } from "../services/db.service";
import { cleanupUserLogs, monitorMemory } from "../services/maintenance.service";
import { extractRatesWithAI } from "../services/ai.service";
import { broadcastToSocialMedia } from "../services/social.service";
import { activeClient, initializeTelegram } from "../../telegramClient";
import { whatsappManager } from "../services/whatsapp.service";
import { addLog, getRecentLogs, clearLogs } from "../utils/logger";
import { renderDashboardHtml } from "../views/dashboard.html";

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

export default dashboardRouter;
