import { Rates } from '../types';

export async function notifyWebServer(rates: Rates): Promise<void> {
  const webUrl = (process.env.WEB_SERVER_URL || '').trim();
  const secret = (process.env.WORKER_INTERNAL_SECRET || '').trim();

  if (!webUrl || !secret) {
    console.warn('[Worker] WEB_SERVER_URL أو WORKER_INTERNAL_SECRET غير مضبوطين.');
    return;
  }

  try {
    const response = await fetch(`${webUrl}/api/internal/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret,
      },
      body: JSON.stringify({
        ratesParallel: rates.parallel,
        ratesOfficial: rates.official,
        timestamp: Date.now(),
      }),
    });

    if (response.ok) {
      console.log('[Worker] ✅ Web Server أُشعر بالأسعار الجديدة');
    } else {
      console.warn(`[Worker] إشعار Web فشل: HTTP ${response.status}`);
    }
  } catch (err) {
    console.warn('[Worker] تعذّر الإشعار، سيُعاد في التحديث القادم:', err);
  }
}

export async function notifyWorkerManualBroadcast(
  updates: { id: string; name: string; oldVal: number; newVal: number; flag: string }[],
  target: 'all' | 'telegram' | 'facebook' = 'all'
): Promise<{ success: boolean; message: string }> {
  const workerUrl = (process.env.WORKER_SERVER_URL || '').trim();
  const secret   = (process.env.WORKER_INTERNAL_SECRET || '').trim();

  if (!workerUrl || !secret) {
    console.warn('[WebServer] WORKER_SERVER_URL أو WORKER_INTERNAL_SECRET غير مضبوطين. النشر الاجتماعي متوقف.');
    return { success: false, message: 'Worker URL غير مضبوط' };
  }

  try {
    const response = await fetch(`${workerUrl}/api/internal/manual-broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret,
      },
      body: JSON.stringify({ updates, target }),
    });

    const data = await response.json() as { success: boolean; message: string };

    if (response.ok && data.success) {
      console.log(`[WebServer] ✅ Worker نشر ${updates.length} تحديث يدوي على ${target}`);
    } else {
      console.warn(`[WebServer] Worker رفض طلب النشر: ${data.message}`);
    }
    return data;
  } catch (err: any) {
    console.warn('[WebServer] تعذّر الاتصال بـ Worker للنشر اليدوي:', err?.message);
    return { success: false, message: 'تعذّر الاتصال بـ Worker' };
  }
}

