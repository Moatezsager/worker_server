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
