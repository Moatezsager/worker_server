import { CurrencyStat } from '../types';
import { rates } from '../state';
import { appConfig } from '../config';
import { broadcastToSocialMedia, getOrInitTelegramManager, queueWeeklyReport } from './social.service';

export const dailyStats: Record<string, CurrencyStat> = {};
export const weeklyStats: Record<string, CurrencyStat> = {};

export function initStatsIfEmpty(termId: string, val: number) {
  if (!dailyStats[termId]) {
    dailyStats[termId] = { high: val, low: val, sum: 0, count: 0, startPrice: val };
  }
  if (!weeklyStats[termId]) {
    weeklyStats[termId] = { high: val, low: val, sum: 0, count: 0, startPrice: val };
  }
}

export function updateStats(termId: string, val: number) {
  if (val <= 0) return;
  initStatsIfEmpty(termId, val);
  
  if (val > dailyStats[termId].high) dailyStats[termId].high = val;
  if (val < dailyStats[termId].low) dailyStats[termId].low = val;
  dailyStats[termId].sum += val;
  dailyStats[termId].count++;

  if (val > weeklyStats[termId].high) weeklyStats[termId].high = val;
  if (val < weeklyStats[termId].low) weeklyStats[termId].low = val;
  weeklyStats[termId].sum += val;
  weeklyStats[termId].count++;
}

export async function broadcastSuddenChangeAlert(_u: {id?: string, name: string, oldVal: number, newVal: number, flag: string}) {
  // تم إزالة رسائل التنبيه العاجل والتغيير المفاجئ نهائياً بناءً على طلب المستخدم
  return;
}

export async function broadcastDailyReport() {
  const mgr = getOrInitTelegramManager();
  if (!appConfig.telegramPostChannel || !mgr || !appConfig.telegramAutoPost) return;
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-LY', { timeZone: 'Africa/Tripoli' });
  
  let message = `📊 *المؤشر | تقرير نهاية اليوم*\n📅 ${dateStr}\n━━━━━━━━━━━━━━━━━\n\n`;
  
  const mainCurrencies = ['USD', 'USD_CHECKS', 'EUR', 'GBP'];
  const goldCurrencies = ['GOLD_CAST_24', 'GOLD_CAST_18', 'GOLD_EXT_21', 'GOLD_EXT_18'];
  
  for (const cid of mainCurrencies) {
    const stat = dailyStats[cid];
    const term = appConfig.terms.find(t => t.id === cid);
    if (term) {
      let high = stat?.count > 0 ? stat.high : (rates.parallel[cid] || 0);
      let low = stat?.count > 0 ? stat.low : (rates.parallel[cid] || 0);
      let avg = stat?.count > 0 ? (stat.sum / stat.count) : (rates.parallel[cid] || 0);
      let trend = '➖';
      if (stat?.count > 0) {
        trend = stat.high > stat.startPrice ? '📈' : (stat.low < stat.startPrice ? '📉' : '➖');
      }
      if (avg > 0) {
        message += `💵 *${term.name}*\n`;
        message += `└ أعلى: ${high.toFixed(3)} | أدنى: ${low.toFixed(3)} | متوسط: ${avg.toFixed(3)} ${trend}\n\n`;
      }
    }
  }
  
  message += `━━━━━━━━━━━━━━━━━\n`;
  for (const cid of goldCurrencies) {
    const stat = dailyStats[cid];
    const term = appConfig.terms.find(t => t.id === cid);
    if (term) {
      let high = stat?.count > 0 ? stat.high : (rates.parallel[cid] || 0);
      let low = stat?.count > 0 ? stat.low : (rates.parallel[cid] || 0);
      if (high > 0) {
        message += `🥇 ${term.name} | أعلى: ${high.toFixed(2)} | أدنى: ${low.toFixed(2)}\n`;
      }
    }
  }
  
  message += `━━━━━━━━━━━━━━━━━\n📡 *مؤشر الدينار | الدقة والسرعة*\n🔗 https://tinyurl.com/2j7667u2`;
  
  try {
    await broadcastToSocialMedia(message, false);
  } catch(e) {}
  
  // Reset daily stats
  for (const key in dailyStats) {
    dailyStats[key].high = rates.parallel[key] || 0;
    dailyStats[key].low = rates.parallel[key] || 0;
    dailyStats[key].sum = 0;
    dailyStats[key].count = 0;
    dailyStats[key].startPrice = rates.parallel[key] || 0;
  }
}

export async function broadcastWeeklyReport(isTest: boolean = false) {
  if (!isTest && !appConfig.telegramAutoPost && !appConfig.facebookAutoPost) return;
  const webUrl = (process.env.WEB_SERVER_URL || '').trim(), secret = (process.env.WORKER_INTERNAL_SECRET || '').trim();
  if (!webUrl || !secret) throw new Error('تعذر إعداد الحصاد: WEB_SERVER_URL أو WORKER_INTERNAL_SECRET غير مضبوط.');
  const response = await fetch(`${webUrl.replace(/\/$/, '')}/api/internal/weekly-harvest`, {
    headers: { 'X-Worker-Secret': secret, 'User-Agent': 'Dollar-Price-Worker/1.0', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(25000)
  });
  const result: any = await response.json();
  if (!response.ok || !result?.success || typeof result.week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.week) ||
      typeof result.caption !== 'string' || !result.caption || result.caption.length > 1024 ||
      typeof result.imageBase64 !== 'string' || !result.imageBase64.startsWith('data:image/png;base64,') || result.imageBase64.length > 7 * 1024 * 1024) {
    throw new Error(result?.error || `تعذر استلام تقرير الحصاد من Web (${response.status}).`);
  }
  if (!isTest) await queueWeeklyReport(result.caption, result.week, result.imageBase64);
  return result.caption;
}
