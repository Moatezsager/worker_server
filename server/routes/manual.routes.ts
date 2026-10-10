import express from 'express';
import crypto from 'crypto';
import { executeBroadcast } from '../services/social.service';

const router = express.Router();

// ─── Auth middleware: يتحقق من WORKER_INTERNAL_SECRET ───
function requireWorkerSecret(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const configured = (process.env.WORKER_INTERNAL_SECRET || '').trim();
  const provided = (
    (req.headers['x-worker-secret'] as string) ||
    (req.headers['authorization'] as string || '').replace('Bearer ', '')
  ).trim();

  if (!configured || !provided) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  try {
    const a = crypto.createHash('sha256').update(configured).digest();
    const b = crypto.createHash('sha256').update(provided).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
  } catch {
    res.status(500).json({ success: false, message: 'Verification error' });
    return;
  }
  next();
}

// ─── POST /api/internal/manual-broadcast ───
// يستقبل تحديثات يدوية من Web Server وينشرها على Facebook وTelegram
router.post('/manual-broadcast', requireWorkerSecret, async (
  req: express.Request,
  res: express.Response
): Promise<void> => {
  try {
    const { updates, target } = req.body as {
      updates: { id: string; name: string; oldVal: number; newVal: number; flag: string }[];
      target?: 'all' | 'telegram' | 'facebook';
    };

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      if (!res.headersSent) {
        res.status(400).json({ success: false, message: 'لا توجد تحديثات للنشر' });
      }
      return;
    }

    const resolvedTarget = target || 'all';

    console.log(`[Manual Broadcast] طلب نشر يدوي: ${updates.length} عملة/معدن على ${resolvedTarget}`);

    // نشر فوري بدون شروط (isManual = true)
    await executeBroadcast(
      updates,
      false,       // isTest
      resolvedTarget,
      true,        // isManual — يتجاوز جميع شروط التصفية
      false        // skipBroadcastLog
    );

    console.log(`[Manual Broadcast] ✅ تم النشر بنجاح على ${resolvedTarget}`);
    if (!res.headersSent) {
      res.json({
        success: true,
        message: `تم النشر بنجاح على ${resolvedTarget} (${updates.length} صنف)`
      });
    }

  } catch (err: any) {
    console.error('[Manual Broadcast] ❌ فشل النشر:', err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: `فشل النشر: ${err?.message || 'خطأ غير معروف'}`
      });
    }
  }
});

import { whatsappManager } from '../services/whatsapp.service';

// ─── WhatsApp Management (called from Web Admin Panel) ───

router.get('/whatsapp/status', requireWorkerSecret, (
  req: express.Request,
  res: express.Response
): void => {
  try {
    const status = whatsappManager.getStatus();
    res.json({ success: true, data: status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/whatsapp/init', requireWorkerSecret, async (
  req: express.Request,
  res: express.Response
): Promise<void> => {
  try {
    whatsappManager.initClient().catch(console.error);
    res.json({ success: true, message: 'جاري تهيئة واتساب...' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/whatsapp/disconnect', requireWorkerSecret, async (
  req: express.Request,
  res: express.Response
): Promise<void> => {
  try {
    await whatsappManager.disconnect();
    res.json({ success: true, message: 'تم قطع الاتصال بنجاح' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/whatsapp/qr', requireWorkerSecret, (
  req: express.Request,
  res: express.Response
): void => {
  try {
    const status = whatsappManager.getStatus();
    res.json({ success: true, data: { qr: status.qrCodeUrl || null } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
