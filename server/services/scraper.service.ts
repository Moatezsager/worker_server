import { RateMap, LiveFeedMessage, ChannelStatusInfo } from '../types';
import { rates, history } from '../state';
import { appConfig } from '../config';
import { db, supabase } from '../db';
import { logErrorArabic, logPriceChange, saveToSupabase, syncCheckRates, saveWorkerStateToSupabase } from './db.service';
import { extractRatesWithAI } from './ai.service';
import { broadcastOfficialRates, broadcastRateChanges, getOrInitTelegramManager, lastBroadcastState, lastOfficialBroadcastDate } from './social.service';
import { fetchPublicChannelMessages } from '../../telegramClient';
import { isSignificantChange, isProbablyDateOrTime } from '../utils/helpers';
import { updateStats } from './reporting.service';
import { recordIngestion } from './ingestion.service';

export let lastOfficialFetchDate = "";
export let isCblFetchEnabled = true;
export let isTelegramFetchEnabled = true;
export let isWhatsAppFetchEnabled = true;

export function setCblFetchEnabled(enabled: boolean) {
  isCblFetchEnabled = enabled;
  console.log(`[Official] CBL auto-fetch enabled set to: ${enabled}`);
  try {
    if (db) {
      db.prepare(`
        INSERT INTO server_config (key, value) VALUES ('cbl_fetch_enabled', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(enabled ? 'true' : 'false');
    }
    if (supabase) {
      supabase.from('server_config').upsert({
        key: 'cbl_fetch_enabled',
        value: enabled ? 'true' : 'false',
        updated_at: new Date().toISOString()
      }).then(() => {}, (err) => console.error('[Official] Error saving cbl_fetch_enabled to Supabase:', err));
    }
  } catch (e) {
    console.error('[Official] Error persisting cbl_fetch_enabled:', e);
  }
}

export function setTelegramFetchEnabled(enabled: boolean) {
  isTelegramFetchEnabled = enabled;
  console.log(`[Scraper] Telegram auto-fetch set to: ${enabled}`);
}

export function setWhatsAppFetchEnabled(enabled: boolean) {
  isWhatsAppFetchEnabled = enabled;
  console.log(`[WhatsApp] WhatsApp auto-fetch set to: ${enabled}`);
}

export const CBL_STATUS = {
  STARTED: 'CBL_FETCH_STARTED',
  SUCCESS: 'CBL_FETCH_SUCCESS',
  FAILED: 'CBL_FETCH_FAILED',
  VALIDATION_FAILED: 'CBL_VALIDATION_FAILED',
  SAVE_FAILED: 'CBL_SAVE_FAILED'
} as const;

// Load lastOfficialFetchDate and isCblFetchEnabled from SQLite + Supabase on startup
export async function loadCblStateFromSupabase(): Promise<void> {
  try {
    if (db) {
      const row = db.prepare(
        'SELECT value FROM server_config WHERE key = ?'
      ).get('last_official_fetch_date') as { value: string } | undefined;
      if (row?.value) {
        lastOfficialFetchDate = row.value;
        console.log(`[Official] Loaded lastOfficialFetchDate from SQLite: ${row.value}`);
      }

      const enabledRow = db.prepare(
        'SELECT value FROM server_config WHERE key = ?'
      ).get('cbl_fetch_enabled') as { value: string } | undefined;
      if (enabledRow?.value !== undefined) {
        isCblFetchEnabled = enabledRow.value === 'true';
        console.log(`[Official] Loaded isCblFetchEnabled from SQLite: ${isCblFetchEnabled}`);
      }
    }

    if (supabase) {
      const { data } = await supabase
        .from('server_config')
        .select('value')
        .eq('key', 'last_official_fetch_date')
        .single();
      if (data?.value) {
        lastOfficialFetchDate = data.value;
        console.log(`[Official] Loaded lastOfficialFetchDate from Supabase server_config: ${data.value}`);
        if (db) {
          try {
            db.prepare(`
              INSERT INTO server_config (key, value) VALUES ('last_official_fetch_date', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(data.value);
          } catch {}
        }
      } else if (!lastOfficialFetchDate) {
        // Fallback: Infer from latest record in official_rates
        const { data: officialRows } = await supabase
          .from('official_rates')
          .select('recorded_at')
          .order('recorded_at', { ascending: false })
          .limit(1);
        if (officialRows && officialRows.length > 0 && officialRows[0].recorded_at) {
          const recordedDate = officialRows[0].recorded_at.split('T')[0];
          lastOfficialFetchDate = recordedDate;
          console.log(`[Official] Inferred lastOfficialFetchDate from official_rates table: ${recordedDate}`);
        }
      }

      const { data: enabledData } = await supabase
        .from('server_config')
        .select('value')
        .eq('key', 'cbl_fetch_enabled')
        .single();
      if (enabledData?.value !== undefined) {
        isCblFetchEnabled = enabledData.value === 'true';
        console.log(`[Official] Loaded isCblFetchEnabled from Supabase: ${isCblFetchEnabled}`);
        if (db) {
          try {
            db.prepare(`
              INSERT INTO server_config (key, value) VALUES ('cbl_fetch_enabled', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(enabledData.value);
          } catch {}
        }
      }

      const { data: fetchTimeData } = await supabase
        .from('server_config')
        .select('value')
        .eq('key', 'last_successful_fetch_time')
        .single();
      if (fetchTimeData?.value) {
        const parsedTime = Number(fetchTimeData.value);
        if (!isNaN(parsedTime) && parsedTime > 0) {
          lastSuccessfulFetchTime = parsedTime;
          lastSuccessfulScrape = new Date(parsedTime);
          console.log(`[Scraper] Loaded lastSuccessfulFetchTime from Supabase: ${new Date(parsedTime).toISOString()}`);
        }
      }
    }
  } catch (e) {
    console.warn('[Official] Could not load CBL settings on startup:', e);
  }
}

// Initial fire-and-forget load for module initialization, also called explicitly in worker.ts
loadCblStateFromSupabase().catch(() => {});

export let lastSuccessfulFetchTime = Date.now();
export let isScraping = false;
export let lastSuccessfulScrape = new Date();
export let lastAttemptTime = 0;
export let channelStatusTracker: Record<string, ChannelStatusInfo> = {};
export let liveFeed: LiveFeedMessage[] = [];

export function clearLiveFeed() {
  liveFeed = [];
}

export function setLiveFeed(feed: LiveFeedMessage[]) {
  liveFeed = feed;
}

export function setLastSuccessfulFetchTime(time: number) {
  lastSuccessfulFetchTime = time;
  lastSuccessfulScrape = new Date(time);
  if (supabase) {
    supabase.from('server_config').upsert({
      key: 'last_successful_fetch_time',
      value: String(time),
      updated_at: new Date(time).toISOString()
    }).then(() => {}, () => {});
  }
}

// Configurable list of official Libyan holidays (format: 'YYYY-MM-DD' or 'MM-DD')
export const OFFICIAL_LIBYA_HOLIDAYS: string[] = [
  // Examples for future additions without rewriting service:
  // '02-17', // ثورة 17 فبراير
  // '05-01', // عيد العمال
  // '09-16', // يوم الشهيد
  // '10-23', // عيد التحرير
  // '12-24', // عيد الاستقلال
];

export function isLibyanHoliday(dateStr: string, dayIndex: number): boolean {
  // Friday (5) and Saturday (6) are weekly non-working days
  if (dayIndex === 5 || dayIndex === 6) return true;
  const mmDd = dateStr.slice(5);
  return OFFICIAL_LIBYA_HOLIDAYS.includes(dateStr) || OFFICIAL_LIBYA_HOLIDAYS.includes(mmDd);
}

// Fetch official rates from Central Bank of Libya website with timeout, retry, and exponential backoff
export async function fetchFromCBL(maxRetries: number = 3): Promise<{ cblDate: string, rates: RateMap } | null> {
  let attempt = 0;
  console.log(`[CBL] ${CBL_STATUS.STARTED}: Initiating HTTP fetch from Central Bank of Libya website (maxRetries=${maxRetries})...`);
  
  while (attempt < maxRetries) {
    attempt++;
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // Strict 15s timeout
      
      const response = await fetch('https://cbl.gov.ly/currency-exchange-rates/', { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3'
        }
      });
      clearTimeout(timeoutId);
      
      const durationMs = Date.now() - startTime;
      
      if (!response.ok) {
        console.warn(`[CBL] ${CBL_STATUS.FAILED}: Attempt ${attempt}/${maxRetries} returned HTTP ${response.status} in ${durationMs}ms`);
        if (attempt < maxRetries) {
          const backoffDelay = Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, backoffDelay));
          continue;
        }
        return null;
      }
      
      const html = await response.text();
      console.log(`[CBL] ${CBL_STATUS.SUCCESS}: Received HTTP ${response.status} in ${durationMs}ms (${html.length} bytes downloaded).`);
      
      // Parse without logging full HTML (protect against leaking sensitive content or massive log bloat)
      return parseCBLHtml(html);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted');
      const errorMsg = isTimeout ? `Request timed out after 15000ms` : (err?.message || String(err));
      
      console.warn(`[CBL] ${CBL_STATUS.FAILED}: Attempt ${attempt}/${maxRetries} failed in ${durationMs}ms: ${errorMsg}`);
      
      if (attempt < maxRetries) {
        const backoffDelay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, backoffDelay));
      } else {
        await logErrorArabic("خطأ في الاتصال بموقع المصرف المركزي بعد استنفاد محاولات إعادة المحاولة", "مصرف ليبيا المركزي", errorMsg);
        return null;
      }
    }
  }
  
  return null;
}

/**
 * Normalizes varied date string formats (YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY)
 * to standard ISO YYYY-MM-DD. Returns null if invalid.
 */
function normalizeDateString(rawDate: string): string | null {
  if (!rawDate) return null;
  const clean = rawDate.trim();
  
  // Format 1: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = clean.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Format 2: DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = clean.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    const y = parseInt(dmyMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

export function parseCBLHtml(html: string): { cblDate: string, rates: RateMap } | null {
  if (!html || typeof html !== 'string') {
    console.warn(`[CBL] ${CBL_STATUS.VALIDATION_FAILED}: Empty or invalid HTML string provided.`);
    return null;
  }

  // 1. Isolate the specific exchange rates table
  // Look for <table> blocks containing currency exchange indicators (e.g. USD / الدولار AND بيع / شراء)
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  let targetTableHtml = '';

  for (const tableHtml of tableMatches) {
    const hasCurrencyIndicator = tableHtml.includes('USD') || tableHtml.includes('الدولار الأمريكي') || tableHtml.includes('الدولار');
    const hasRateColumnIndicator = tableHtml.includes('بيع') || tableHtml.includes('شراء') || tableHtml.includes('متوسط');
    if (hasCurrencyIndicator && hasRateColumnIndicator) {
      targetTableHtml = tableHtml;
      break;
    }
  }

  // If no <table> tag wrapper found (e.g. mock fragment in tests), fallback to matching rows in html directly
  if (!targetTableHtml) {
    if (html.includes('<tr') && (html.includes('USD') || html.includes('الدولار الأمريكي'))) {
      targetTableHtml = html;
    } else {
      console.warn(`[CBL] ${CBL_STATUS.VALIDATION_FAILED}: No exchange rates table found in the HTML.`);
      return null;
    }
  }

  const results: RateMap = {};
  let cblDateStr: string | null = null;
  
  // 2. Extract date specifically tied to the exchange rates table
  // A. Check table caption / header
  const captionMatch = targetTableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
  if (captionMatch) {
    const extractedDate = normalizeDateString(captionMatch[1]);
    if (extractedDate) cblDateStr = extractedDate;
  }

  // B. Split rows inside the table to extract row-level data and dates
  const rows = targetTableHtml.split(/<tr[^>]*>/i);
  
  for (const row of rows) {
    if (!row.includes("<td>") && !row.includes("<td ")) continue;
    
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (tds && tds.length >= 6) {
      // In CBL table, column index 0 is strictly the bulletin date cell for that currency
      const dateCellHtml = tds[0].replace(/<[^>]+>/g, '').trim();
      const rowDate = normalizeDateString(dateCellHtml);
      
      // Associate date with the currency row (prefer date from USD row or first valid row date in the rates table)
      if (rowDate && !cblDateStr) {
        cblDateStr = rowDate;
      }
      
      const currencyHtml = tds[1];
      let currencyId: string | null = null;
      
      if (currencyHtml.includes("الدولار الأمريكي") || currencyHtml.includes("USD")) currencyId = "USD";
      else if (currencyHtml.includes("اليورو") || currencyHtml.includes("EUR")) currencyId = "EUR";
      else if (currencyHtml.includes("الجنيه الاسترليني") || currencyHtml.includes("الجنيه الإسترليني") || currencyHtml.includes("GBP")) currencyId = "GBP";
      else if (currencyHtml.includes("الدينار التونسي") || currencyHtml.includes("TND")) currencyId = "TND";
      else if (currencyHtml.includes("الليرة التركية") || currencyHtml.includes("TRY")) currencyId = "TRY";
      else if (currencyHtml.includes("الريال السعودي") || currencyHtml.includes("SAR")) currencyId = "SAR";
      else if (currencyHtml.includes("الدرهم الإماراتي") || currencyHtml.includes("الدرهم الاماراتي") || currencyHtml.includes("AED")) currencyId = "AED";
      else if (currencyHtml.includes("اليوان الصيني") || currencyHtml.includes("الايوان الصيني") || currencyHtml.includes("CNY")) currencyId = "CNY";
      else if (currencyHtml.includes("الدولار الكندي") || currencyHtml.includes("CAD")) currencyId = "CAD";
      else if (currencyHtml.includes("الدولار الاسترالي") || currencyHtml.includes("الدولار الأسترالي") || currencyHtml.includes("AUD")) currencyId = "AUD";
      else if (currencyHtml.includes("الفرنك السويسري") || currencyHtml.includes("CHF")) currencyId = "CHF";
      else if (currencyHtml.includes("الكرونر السويدي") || currencyHtml.includes("الكرونة السويدية") || currencyHtml.includes("SEK")) currencyId = "SEK";
      else if (currencyHtml.includes("الكرونر النرويجي") || currencyHtml.includes("الكرونة النرويجية") || currencyHtml.includes("NOK")) currencyId = "NOK";
      else if (currencyHtml.includes("الكرونر الدنمركي") || currencyHtml.includes("الكرونة الدنماركية") || currencyHtml.includes("DKK")) currencyId = "DKK";
      else if (currencyHtml.includes("الين الياباني") || currencyHtml.includes("JPY")) currencyId = "JPY";

      if (currencyId) {
        // Index 4 is strictly the 'Selling' (بيع) column on the CBL website
        const sellHtml = tds[4];
        const match = sellHtml.match(/[\d.]+/);
        if (match) {
          let val = parseFloat(match[0]);
          if (!isNaN(val) && val > 0 && val < 30) {
            if (currencyId === 'JPY') {
              val = parseFloat((val / 100).toFixed(4));
            }
            results[currencyId] = val;
          }
        }
      }
    }
  }

  // 3. Strict Date Validation: Never fallback to server date!
  if (!cblDateStr) {
    console.warn(`[CBL] ${CBL_STATUS.VALIDATION_FAILED}: Missing or unextractable bulletin date in currency table.`);
    return null;
  }

  // 4. Strict Rate Validation: Ensure USD rate exists and is within realistic official range
  if (!results.USD || results.USD < 4.0 || results.USD > 8.0) {
    console.warn(`[CBL] ${CBL_STATUS.VALIDATION_FAILED}: Invalid USD rate extracted (${results.USD}). Expected between 4.0 and 8.0 LYD.`);
    return null;
  }

  // 5. Ensure multiple rates are present
  const extractedCount = Object.keys(results).length;
  if (extractedCount < 2) {
    console.warn(`[CBL] ${CBL_STATUS.VALIDATION_FAILED}: Incomplete bulletin data (only ${extractedCount} currencies found).`);
    return null;
  }

  console.log(`[CBL] Successfully parsed bulletin from exchange rates table (Date: ${cblDateStr}, Currencies: ${extractedCount}, USD: ${results.USD})`);
  return { cblDate: cblDateStr, rates: results };
}

export function getCblStatusInfo() {
  const now = new Date();
  const libyaDateObj = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Tripoli' }));
  const dayIndex = libyaDateObj.getDay();
  const currentLibyaHour = libyaDateObj.getHours();
  const currentLibyaMinute = libyaDateObj.getMinutes();

  const yyyy = libyaDateObj.getFullYear();
  const mm = String(libyaDateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(libyaDateObj.getDate()).padStart(2, '0');
  const currentLibyaDate = `${yyyy}-${mm}-${dd}`;

  const isWeekend = isLibyanHoliday(currentLibyaDate, dayIndex);
  const isInActiveWindow = !isWeekend && (currentLibyaHour >= 9);
  const isTodayFetched = (lastOfficialFetchDate === currentLibyaDate);

  const timeFormatted = `${String(currentLibyaHour).padStart(2, '0')}:${String(currentLibyaMinute).padStart(2, '0')}`;

  return {
    enabled: isCblFetchEnabled,
    lastOfficialFetchDate,
    lastOfficialBroadcastDate,
    isTodayFetched,
    isInActiveWindow,
    isWeekend,
    currentLibyaDate,
    currentLibyaTime: timeFormatted,
    currentLibyaHour,
    lastSuccessfulFetchTime,
    rates: rates.official
  };
}

export async function fetchOfficialRates(force: boolean = false, isManualAdmin: boolean = false): Promise<boolean> {
  console.log(`[CBL] ${CBL_STATUS.STARTED}: Initiating official rates check (force=${force}, isManualAdmin=${isManualAdmin})...`);

  const now = new Date();
  const libyaDateObj = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Tripoli' }));
  const dayIndex = libyaDateObj.getDay();
  const currentLibyaHour = libyaDateObj.getHours();

  const yyyy = libyaDateObj.getFullYear();
  const mm = String(libyaDateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(libyaDateObj.getDate()).padStart(2, '0');
  const currentLibyaDate = `${yyyy}-${mm}-${dd}`;

  console.log(`[CBL] Libya today date = ${currentLibyaDate}, Hour = ${currentLibyaHour}:00 (lastOfficialFetchDate = '${lastOfficialFetchDate || 'none'}')`);

  // When not manual admin force, enforce business hours and holiday rules
  if (!force && !isManualAdmin) {
    // 0. Check if CBL auto-fetch is enabled
    if (!isCblFetchEnabled) {
      console.log("[CBL] Skipping fetch. CBL auto-fetch function is disabled in Admin settings.");
      return false;
    }

    // 1. Check holidays & weekends (Friday & Saturday + official holidays)
    if (isLibyanHoliday(currentLibyaDate, dayIndex)) {
      console.log("[CBL] Skipping fetch. CBL is closed today (Weekend or Official Holiday).");
      return false;
    }

    // 2. Check work window: Only fetch between 09:00 AM and 10:59 AM Libya time
    if (currentLibyaHour < 9) {
      console.log(`[CBL] Before work start time (09:00 AM Libya time). Current hour: ${currentLibyaHour}:00. Skipping automatic fetch.`);
      return false;
    }
    if (currentLibyaHour >= 11) {
      console.log(`[CBL] Outside fetch window (after 11:00 AM Libya time). Current hour: ${currentLibyaHour}:00. Skipping automatic fetch. Will retry tomorrow.`);
      return false;
    }

    // 3. Check if today's official rates have already been successfully fetched and completed
    if (lastOfficialFetchDate === currentLibyaDate) {
      console.log(`[CBL] Today's official bulletin (${currentLibyaDate}) has already been successfully fetched. Skipping duplicate fetch.`);
      return false;
    }
  }

  // 1. FETCH from CBL website (Sequential Await)
  const cblResult = await fetchFromCBL();
  if (!cblResult) {
    console.warn(`[CBL] ${CBL_STATUS.FAILED}: HTTP fetch or parsing failed.`);
    return false;
  }

  // 2. PARSE & 3. VALIDATE
  const { cblDate, rates: cblRates } = cblResult;
  console.log(`[CBL] Bulletin date extracted = ${cblDate}`);

  if (!cblDate) {
    console.warn(`[CBL] ${CBL_STATUS.VALIDATION_FAILED}: Missing bulletin date in CBL response.`);
    return false;
  }

  if (!cblRates || !cblRates.USD || cblRates.USD <= 0) {
    console.warn(`[CBL] ${CBL_STATUS.VALIDATION_FAILED}: Invalid or missing rates in CBL response.`);
    return false;
  }

  // In automatic mode, verify that CBL data is strictly for today (never publish stale data as today's rates!)
  if (!isManualAdmin && !force && cblDate !== currentLibyaDate) {
    console.warn(`[CBL] ${CBL_STATUS.VALIDATION_FAILED}: Stale data rejected. CBL bulletin date (${cblDate}) does not match Libya current date (${currentLibyaDate}). Automatic publishing rejected.`);
    return false;
  }

  console.log(`[CBL] Rates validated successfully for bulletin date: ${cblDate}`);

  recordIngestion({
    source: 'موقع مصرف ليبيا المركزي (CBL)',
    platform: 'cbl',
    timestamp: new Date().toISOString(),
    rawText: `النشرة الرسمية الصادرة بتاريخ ${cblDate} عن مصرف ليبيا المركزي`,
    status: Object.keys(cblRates).length > 0 ? 'extracted' : 'ignored',
    extractedRates: Object.entries(cblRates).map(([k, v]) => ({ code: k, value: Number(v) })),
    ignoreReason: Object.keys(cblRates).length === 0 ? 'لم يتم العثور على جدول أسعار صالح' : undefined
  });

  // 4. CREATE CANDIDATE DATA (In-memory state remains UNCHANGED at this point!)
  const candidateOfficialRates: RateMap = { ...rates.official, ...cblRates };
  const candidatePreviousOfficial: RateMap = { ...rates.previousOfficial };
  const candidateLastChanged: Record<string, string> = {};
  let anyChanged = false;

  Object.entries(cblRates).forEach(([key, val]) => {
    if (isSignificantChange(rates.official[key], val)) {
      candidatePreviousOfficial[key] = rates.official[key];
      candidateLastChanged[key] = new Date().toISOString();
      anyChanged = true;
    }
  });

  // 5. SAVE TO SUPABASE (Persistence Check BEFORE modifying in-memory state!)
  try {
    const saveSuccess = await saveToSupabase('official', candidateOfficialRates);
    if (!saveSuccess) {
      console.error(`[CBL] ${CBL_STATUS.SAVE_FAILED}: saveToSupabase reported database failure. In-memory state and success timestamps NOT updated.`);
      await logErrorArabic("فشل حفظ أسعار المصرف المركزي في قاعدة البيانات", "مصرف ليبيا المركزي");
      return false; // Stop immediately if DB save fails! In-memory RAM state remains old!
    }
    console.log(`[CBL] Rates successfully persisted to Supabase.`);
  } catch (dbErr) {
    console.error(`[CBL] ${CBL_STATUS.SAVE_FAILED}: Failed to persist official rates to database:`, dbErr);
    await logErrorArabic(`فشل حفظ أسعار المركزي: ${dbErr}`, "مصرف ليبيا المركزي");
    return false; // Stop immediately if DB save fails! In-memory RAM state remains old!
  }

  // 6. COMMIT IN-MEMORY STATE (Only after confirmed DB persistence)
  rates.official = candidateOfficialRates;
  rates.previousOfficial = { ...rates.previousOfficial, ...candidatePreviousOfficial };
  rates.lastChanged.official = { ...rates.lastChanged.official, ...candidateLastChanged };

  if (rates.official.USD) {
    rates.parallel.OFFICIAL_USD = rates.official.USD;
    rates.lastChanged.parallel.OFFICIAL_USD = new Date().toISOString();
  }

  if (anyChanged) {
    console.log(`[Official] Rates updated via CBL Scraper (USD: ${rates.official.USD})`);
    history.push({
      time: new Date().toISOString(),
      usdParallel: rates.parallel.USD,
      usdOfficial: rates.official.USD,
      ratesParallel: { ...rates.parallel },
      ratesOfficial: { ...rates.official }
    });
    if (history.length > 500) {
      history.shift();
    }
  }

  // Update success state ONLY after DB persistence & in-memory commit succeed
  lastOfficialFetchDate = currentLibyaDate;
  setLastSuccessfulFetchTime(Date.now());

  await saveWorkerStateToSupabase('last_official_fetch_date', currentLibyaDate);
  await saveWorkerStateToSupabase('last_successful_fetch_time', String(Date.now()));

  try {
    if (db) {
      db.prepare(`
        INSERT INTO server_config (key, value) VALUES ('last_official_fetch_date', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(currentLibyaDate);
    }
  } catch (dbErr) {
    console.error("[Official] Failed to persist lastOfficialFetchDate to SQLite:", dbErr);
  }

  // 7. SOCIAL BROADCAST (Only after DB persistence & in-memory commit succeed)
  const isAlreadyBroadcastedToday = (lastOfficialBroadcastDate === currentLibyaDate);
  if (!isAlreadyBroadcastedToday) {
    console.log(`[Official] Broadcasting daily official bulletin for (${cblDate})...`);
    const broadcastSuccess = await broadcastOfficialRates(false);
    if (broadcastSuccess) {
      console.log(`[CBL] Social broadcast completed successfully.`);
    } else {
      console.warn(`[CBL] Social broadcast did not complete successfully.`);
      if (!isManualAdmin) {
        return false;
      }
    }
  } else {
    console.log(`[CBL] Broadcast skipped (already broadcasted today).`);
  }

  console.log(`[CBL] Successfully completed official bulletin fetch and persistence for ${currentLibyaDate}.`);
  return true;
}

export function stripArabicDiacritics(text: string): string {
  let result = text.replace(/[\u064B-\u065F\u0670]/g, '');
  result = result.replace(/\u0640/g, '');
  return result;
}

export const extractRatesFromText = (originalText: string) => {
  const cleanText = stripArabicDiacritics(originalText);
  const results: { code: string, value: number, date?: string }[] = [];
  const foundCodes = new Set<string>();
  
  const compiledTerms = appConfig.terms.map(t => ({
    ...t,
    compiledRegex: new RegExp(t.regex, 'i')
  }));

  const processTermValue = (term: typeof compiledTerms[0], valStr: string): number | null => {
    let cleanValStr = valStr.replace(/,/g, ''); 
    let val = parseFloat(cleanValStr);
    
    if (term.id === 'GOLD_LIRA' && val < 500) return null;
    
    // Smart extraction for TND (Ensure 1 TND = X LYD format)
    if (term.id === 'TND') {
      if (valStr.includes(',')) {
        val = parseFloat(valStr.replace(/,/g, '.'));
      }
      
      if (val >= 100 && val <= 500) {
        val = val / 100;
      } else if (val >= 20 && val < 100) {
        val = 100 / val;
      } else if (val < 1.0 && val > 0) {
        val = 1 / val;
      }
    }
    
    // Smart extraction for EGP
    if (term.id === 'EGP') {
      if (valStr.includes(',')) {
        val = parseFloat(valStr.replace(/,/g, '.'));
      }
      if (val >= 10.0 && val <= 100.0) {
        val = val / 100;
      } else if (val >= 2.0 && val < 10.0) {
        val = 1 / val;
      }
    }
    
    // Smart extraction for TRY
    if (term.id === 'TRY') {
      if (valStr.includes(',')) {
        val = parseFloat(valStr.replace(/,/g, '.'));
      }
      if (val >= 10.0 && val <= 100.0) {
        val = val / 100;
      } else if (val >= 2.0 && val < 10.0) {
        val = 1 / val;
      }
    }
    
    if (term.isInverse && val > 0) val = 1 / val;
    
    if (!isNaN(val) && val >= term.min && val <= term.max) {
      return val;
    }
    return null;
  };

  const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // 1. Line-by-line pass: prevents multi-line pasted text from bleeding across lines
  if (lines.length > 1) {
    for (const line of lines) {
      for (const term of compiledTerms) {
        if (foundCodes.has(term.id)) continue;
        const match = line.match(term.compiledRegex);
        if (!match) continue;

        const capturedNums = match.slice(1).filter(Boolean);
        let valStr: string | null = null;
        if (capturedNums.length >= 2) {
          const firstNum = capturedNums[0];
          const secondNum = capturedNums[1];
          const secondIndex = match.index! + match[0].indexOf(secondNum);
          if (isProbablyDateOrTime(line, secondIndex, secondNum)) {
            valStr = firstNum;
          } else {
            valStr = secondNum;
          }
        } else if (capturedNums.length === 1) {
          valStr = capturedNums[0];
        }

        if (valStr) {
          const val = processTermValue(term, valStr);
          if (val !== null) {
            const dateMatch = line.match(/\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/);
            const extractedDate = dateMatch ? dateMatch[0] : undefined;
            results.push({ code: term.id, value: val, date: extractedDate });
            foundCodes.add(term.id);
            break;
          }
        }
      }
    }
  }

  // 2. Full-text pass for remaining terms or continuous single-paragraph announcements
  for (const term of compiledTerms) {
    if (foundCodes.has(term.id)) continue;
    const match = cleanText.match(term.compiledRegex);
    if (!match) continue;

    let valStr = null;
    const capturedNums = match.slice(1).filter(Boolean);
    const firstCapturedNum = capturedNums[0];
    const secondCapturedNum = capturedNums[1];
    
    if (firstCapturedNum) {
      if (secondCapturedNum) {
        const firstIndex = match.index! + match[0].indexOf(firstCapturedNum);
        const secondIndex = match.index! + match[0].indexOf(secondCapturedNum);
        const textBetween = cleanText.substring(firstIndex + firstCapturedNum.length, secondIndex);
        
        const isDifferentCurrency = /[\n=💶💷💎🪙]/.test(textBetween) || 
                                     /(?:يورو|دولار|باوند|دينار|ليرة|ذهب|فضة|كسر|مسبوك|أونصة|عالميا|EUR|USD|GBP|TND|TRY|EGP)/i.test(textBetween);
        
        if (isProbablyDateOrTime(cleanText, secondIndex, secondCapturedNum) || isDifferentCurrency) {
          valStr = firstCapturedNum;
        } else {
          valStr = secondCapturedNum;
        }
      } else {
        valStr = firstCapturedNum;
      }
    }

    if (valStr) {
      const val = processTermValue(term, valStr);
      if (val !== null) {
        const matchIndex = match.index!;
        const lineStart = cleanText.lastIndexOf('\n', matchIndex) + 1;
        let lineEnd = cleanText.indexOf('\n', matchIndex);
        if (lineEnd === -1) lineEnd = cleanText.length;
        const lineText = cleanText.substring(lineStart, lineEnd);
        
        const dateMatch = lineText.match(/\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/);
        const extractedDate = dateMatch ? dateMatch[0] : undefined;
        results.push({ code: term.id, value: val, date: extractedDate });
        foundCodes.add(term.id);
      }
    }
  }
  return results;
};

export async function fetchParallelRatesFromTelegram(isManual: boolean = false): Promise<boolean | null> {
  console.log(`\n[Scraper] Starting parallel rates fetch at ${new Date().toISOString()}`);
  
  if (!isTelegramFetchEnabled && !isManual) {
    console.log("[Scraper] Telegram parallel fetch is currently disabled via dashboard. Skipping.");
    return false;
  }

  if (isScraping) {
    console.log("[Scraper] Scrape already in progress, skipping...");
    return null;
  }
  
  const now = Date.now();
  if (now - lastAttemptTime < 2 * 60 * 1000) {
    const remaining = Math.ceil((2 * 60 * 1000 - (now - lastAttemptTime)) / 1000);
    console.log(`[Scraper] Too soon since last attempt, skipping... (${remaining}s remaining)`);
    return null;
  }
  
  lastAttemptTime = now;
  isScraping = true;
  console.log("[Scraper] Lock acquired, starting extraction...");
  
  const scraperPromise = (async () => {
    try {
      const priceHistory: Record<string, { value: number, time: number, channel: string }[]> = {};
      for (const term of appConfig.terms) {
        priceHistory[term.id] = [];
      }

      let successfulChannels = 0;
      let totalMessagesProcessed = 0;

      console.log(`[Scraper] Starting fetch from ${appConfig.channels?.length || 0} channels.`);
      
      const channels = (appConfig.channels || [])
        .filter(c => c && typeof c === 'string' && c.trim() !== '')
        .map(c => c.replace('@', '').trim());

      if (channels.length === 0) {
        console.warn("[Scraper] No channels configured.");
        await logErrorArabic("لا توجد قنوات تيليجرام مهيأة في الإعدادات", "الكاشط");
        return false;
      }

      console.log(`[Scraper] Validated channels: ${channels.join(', ')}`);
      
      const nowTimestamp = Date.now();
      channels.forEach(ch => {
        if (!channelStatusTracker[ch]) {
          channelStatusTracker[ch] = { last_scrape_attempt: 0, last_post_time: 0, status: 'stale', messages_processed: 0 };
        }
        channelStatusTracker[ch].last_scrape_attempt = nowTimestamp;
        channelStatusTracker[ch].status = 'stale';
      });
      
      // ─── حساب بداية اليوم الحالي بتوقيت ليبيا (Africa/Tripoli = UTC+2) ────────
      // نستخدم Intl لتحويل الوقت الحالي إلى التاريخ الليبي الصحيح
      // ثم نحسب منتصف الليل الليبي كـ UTC timestamp
      const _nowForLibya = new Date();
      const libyaDateStr = _nowForLibya.toLocaleDateString('en-CA', { timeZone: 'Africa/Tripoli' }); // 'YYYY-MM-DD'
      const startOfTodayLibya = new Date(`${libyaDateStr}T00:00:00+02:00`).getTime();
      // ─────────────────────────────────────────────────────────────────────────────
      
      console.log(`[Scraper] Filtering messages sent after: ${new Date(startOfTodayLibya).toISOString()} (Start of today in Libya time: ${libyaDateStr})`);

      const mgr = getOrInitTelegramManager();
      if (mgr) {
        console.log("[Scraper] TelegramManager ready. Fetching channels sequentially with stability pauses...");
        
        const gramJsResults: Array<{ status: 'fulfilled'; value: { channel: string; messages: { text: string; date: number }[] } } | { status: 'rejected'; reason: { channel: string; error: any } }> = [];
        for (const channel of channels) {
          try {
            // Fetch last 4 messages per channel as requested
            const messages = await mgr.fetchMessages(channel, 4);
            gramJsResults.push({ status: 'fulfilled', value: { channel, messages } });
            // Small pause between channels to keep MTProto connection calm and avoid flood wait
            await new Promise(r => setTimeout(r, 250));
          } catch (err: any) {
            gramJsResults.push({ status: 'rejected', reason: { channel, error: err } });
          }
        }

        for (const result of gramJsResults) {
          if (result.status === 'rejected') {
            if (channelStatusTracker[result.reason.channel]) channelStatusTracker[result.reason.channel].status = 'error';
          }
        }

        for (const result of gramJsResults) {
          if (result.status === 'fulfilled') {
            const { channel, messages } = result.value;
            if (messages.length > 0) {
              successfulChannels++;
              totalMessagesProcessed += messages.length;
              channelStatusTracker[channel].status = 'active';
              channelStatusTracker[channel].messages_processed += messages.length;
              const latestMsgDate = Math.max(...messages.map((m: any) => m.date));
              if (latestMsgDate > channelStatusTracker[channel].last_post_time) channelStatusTracker[channel].last_post_time = latestMsgDate;
              
              let skippedOldCount = 0;
              for (const msg of messages) {
                if (msg.date < startOfTodayLibya) {
                  skippedOldCount++;
                  continue;
                }

                const cleanText = msg.text;
                // Exclude gold rates from Telegram scraping; gold is managed solely via Admin manual entry
                let extracted = extractRatesFromText(cleanText).filter(r => !r.code.startsWith('GOLD_') && r.code !== 'GOLD');
                const hasCurrencyKeywords = /(?:يورو|دولار|باوند|دينار|EUR|USD|GBP|TND|TRY|EGP)/i.test(cleanText);
                // Only call AI if deterministic regex extraction yielded no rates
                if (extracted.length === 0 && hasCurrencyKeywords && cleanText.length > 10 && cleanText.length < 800) {
                   const aiExtracted = await extractRatesWithAI(cleanText, channel);
                   if (aiExtracted.length > 0) {
                      extracted = aiExtracted.filter(r => !r.code.startsWith('GOLD_') && r.code !== 'GOLD');
                   }
                }
                
                const feedMsg: LiveFeedMessage = {
                  id: Math.random().toString(36).substring(2, 11),
                  channel,
                  text: msg.text,
                  time: msg.date,
                  status: extracted.length > 0 ? 'processed' : 'skipped',
                  extractedRates: extracted
                };
                
                liveFeed.unshift(feedMsg);
                if (liveFeed.length > 100) liveFeed = liveFeed.slice(0, 100);

                recordIngestion({
                  source: '@' + channel,
                  platform: 'telegram',
                  timestamp: new Date(msg.date).toISOString(),
                  rawText: msg.text,
                  status: extracted.length > 0 ? 'extracted' : 'ignored',
                  extractedRates: extracted.map(e => ({ code: e.code, value: e.value })),
                  ignoreReason: extracted.length === 0 ? 'لا تحتوي الرسالة على أسعار مطابقة لشروط الصرف' : undefined
                });

                if (extracted.length > 0) {
                  for (const res of extracted) {
                    if (res.code.startsWith('GOLD_') || res.code === 'GOLD') continue;
                    if (priceHistory[res.code]) {
                      priceHistory[res.code].push({ value: res.value, time: msg.date, channel });
                    }
                  }
                }
              }
            } else {
              console.warn(`[Scraper-GramJS] No messages returned for ${channel}`);
            }
          } else {
            const { channel, error } = result.reason;
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Scraper-GramJS] Error fetching ${channel}:`, errorMsg);
            await logErrorArabic(`خطأ في جلب رسائل القناة ${channel} عبر TelegramManager`, "الكاشط", errorMsg);
          }
        }
      } else {
        console.warn("[Scraper] TelegramManager is not available. Please verify Telegram connection status.");
        await logErrorArabic("جلب البيانات متوقف لأن حساب تيليجرام غير متصل.", "الكاشط");
      }

      if (successfulChannels > 0) {
        lastSuccessfulScrape = new Date();
        setLastSuccessfulFetchTime(Date.now());
        console.log(`[Scraper] Successfully processed ${totalMessagesProcessed} messages from ${successfulChannels} channels.`);
      } else {
        console.warn("[Scraper] Failed to fetch any messages from any channels (They might be empty or blocked).");
      }

      const mem = process.memoryUsage();
      console.log(`[Scraper] Starting processing. Memory: RSS=${Math.round(mem.rss/1024/1024)}MB, Heap=${Math.round(mem.heapUsed/1024/1024)}MB`);

      const latestRates: Record<string, number> = {};
      const latestSources: Record<string, string> = {};
      const latestTimes: Record<string, number> = {};
      const previousRates: Record<string, number> = {};
      let newestMessageTime = 0;

      for (const key in priceHistory) {
        if (priceHistory[key].length === 0) continue;

        const historyArr = priceHistory[key].sort((a, b) => {
          if (b.time !== a.time) return b.time - a.time;
          if (b.channel === appConfig.telegramPostChannel) return 1;
          if (a.channel === appConfig.telegramPostChannel) return -1;
          return 0;
        });
        
        const newestEntry = historyArr[0];
        latestRates[key] = newestEntry.value; 
        latestSources[key] = newestEntry.channel;
        latestTimes[key] = newestEntry.time;
        
        if (newestEntry.time > newestMessageTime) {
          newestMessageTime = newestEntry.time;
        }
        
        for (let i = 1; i < historyArr.length; i++) {
          if (isSignificantChange(historyArr[i].value, newestEntry.value)) {
            previousRates[key] = historyArr[i].value;
            break;
          }
        }
      }

      const foundKeys = Object.keys(latestRates);
      if (foundKeys.length > 0) {
        console.log(`[Scraper] Scrape check completed. Found rates for: ${foundKeys.join(', ')}`);
        
        let anyChanged = false;
        const collectedUpdates: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[] = [];

        for (const term of appConfig.terms) {
          if (term.id.startsWith('GOLD') || term.id.startsWith('SILVER')) continue;
          const currentVal = rates.parallel[term.id];
          const newValFromTelegram = latestRates[term.id];
          const newValTime = latestTimes[term.id];
          
          const currentLastChanged = rates.lastChanged.parallel[term.id];
          const currentTime = currentLastChanged ? new Date(currentLastChanged).getTime() : 0;

          if (newValFromTelegram !== undefined) {
            if (newValTime < currentTime) {
              console.log(`[Scraper] Skipping update for ${term.id}: Scraped price is older than current memory state.`);
              continue;
            }

            if (currentVal !== undefined && currentVal > 0) {
              const deviation = Math.abs(newValFromTelegram - currentVal) / currentVal;
              const allowedDeviation = (term.id === 'TND' || term.id === 'EGP') ? 1.0 : 0.25;
              if (deviation > allowedDeviation) {
                const sourceName = latestSources[term.id] || 'غير معروف';
                const msg = `تم رفض تحديث سعر ${term.name} (${term.id}) من المصدر (${sourceName}) بسبب قفزة غير منطقية من ${currentVal} إلى ${newValFromTelegram} (تغيير بنسبة ${(deviation*100).toFixed(1)}%)`;
                console.warn(`[Scraper] ${msg}`);
                await logErrorArabic(msg, "حماية البيانات");
                continue;
              }
            }

            if (isSignificantChange(currentVal, newValFromTelegram)) {
              console.log(`[Scraper] Price update: ${term.id} (${currentVal} -> ${newValFromTelegram}) Source: ${latestSources[term.id]}`);
              
              collectedUpdates.push({
                id: term.id,
                name: term.name,
                oldVal: currentVal || newValFromTelegram,
                newVal: newValFromTelegram,
                flag: term.flag || 'ly'
              });

              rates.previousParallel[term.id] = currentVal || newValFromTelegram;
              rates.parallel[term.id] = newValFromTelegram;
              rates.lastChanged.parallel[term.id] = new Date().toISOString();
              anyChanged = true;
              
              updateStats(term.id, newValFromTelegram);

              history.push({
                time: new Date().toISOString(),
                usdParallel: rates.parallel.USD || newValFromTelegram,
                usdOfficial: rates.official.USD,
                ratesParallel: { ...rates.parallel },
                ratesOfficial: { ...rates.official }
              });
              if (history.length > 500) {
                history.shift();
              }
              
              const changeLog = {
                id: Math.random().toString(36).substring(2, 9),
                currencyCode: term.id,
                currencyName: term.name,
                oldPrice: currentVal || 0,
                newPrice: newValFromTelegram,
                source: latestSources[term.id] || "Telegram",
                timestamp: new Date().toISOString()
              };
              await logPriceChange(changeLog);
            } else {
              rates.parallel[term.id] = newValFromTelegram;
            }
          }
        }

        for (const term of appConfig.terms) {
          const key = term.id;
          if (previousRates[key] && latestRates[key] && Math.abs(previousRates[key] - latestRates[key]) < (latestRates[key] * 0.2)) {
            if (!rates.previousParallel[key]) rates.previousParallel[key] = previousRates[key];
          }
        }

        const synced = await syncCheckRates("كاشط تيليجرام");
        if (synced) anyChanged = true;

        if (newestMessageTime > 0) {
          rates.lastUpdated = new Date(newestMessageTime).toISOString();
        } else {
          rates.lastUpdated = new Date().toISOString();
        }

        if (anyChanged) {
          await saveToSupabase('parallel');
          if (collectedUpdates.length > 0) {
            // توحيد الصكوك: استبعاد صكوك الجمهورية والتجاري من النشر، والاكتفاء بنشر دولار صكوك فقط
            const sanitizedUpdates: typeof collectedUpdates = [];
            let checkPrice: number | null = null;
            let checkOldPrice: number | null = null;

            const isBankCheck = (id?: string) => {
              if (!id) return false;
              return id === 'USD_JBANK' || id === 'USD_NCB' || id === 'USD_BCD' || id === 'USD_AB' || id === 'USD_WB' || id === 'USD_CHECKS' || id === 'USD_SUKUK';
            };

            for (const u of collectedUpdates) {
              if (isBankCheck(u.id)) {
                if (checkPrice === null) {
                  checkPrice = u.newVal;
                  checkOldPrice = u.oldVal;
                }
              } else {
                sanitizedUpdates.push(u);
              }
            }

            if (checkPrice !== null) {
              sanitizedUpdates.push({
                id: 'USD_CHECKS',
                name: 'دولار أمريكي (صكوك)',
                oldVal: checkOldPrice ?? rates.previousParallel['USD_CHECKS'] ?? checkPrice,
                newVal: checkPrice,
                flag: 'us'
              });
            }

            if (sanitizedUpdates.length > 0) {
              broadcastRateChanges(sanitizedUpdates).catch(e => console.error("[Scraper] Broadcast error:", e));
            }
          }
        }

        lastSuccessfulFetchTime = Date.now();
        return anyChanged;
      }
      lastSuccessfulFetchTime = Date.now();
      return false;
    } catch (error) {
      console.error("Error fetching from Telegram:", error);
      return false;
    } finally {
      isScraping = false;
    }
  })();

  const timeoutPromise = new Promise<null>((_, reject) => {
    setTimeout(() => reject(new Error("Global Scraper Timeout")), 90000);
  });

  try {
    return await Promise.race([scraperPromise, timeoutPromise]);
  } catch (err) {
    console.error(`[Scraper] ${err instanceof Error ? err.message : String(err)}`);
    // ← BUG FIX: We removed `isScraping = false;` here.
    // If the timeout is reached, the underlying scraperPromise is still running.
    // Releasing the lock here causes a race condition where a new scrape could start concurrently.
    // The finally block of scraperPromise will release the lock when it actually finishes.
    return null;
  }
}

/**
 * Processes incoming real-time messages from WhatsApp channels or dealer groups.
 * Implements identical validation, sanity checks, and consensus rules as Telegram.
 */
export async function processWhatsAppMessage(
  chatName: string,
  rawText: string,
  msgTime: number
): Promise<{ processed: boolean; extractedCount: number; rates?: { code: string; value: number }[] }> {
  try {
    if (!isWhatsAppFetchEnabled) {
      return { processed: false, extractedCount: 0 };
    }

    // 1. Time boundary check: message must be from today in Libya (GMT+2)
    // ─── حساب بداية اليوم الحالي بتوقيت ليبيا (Africa/Tripoli = UTC+2) ────────
    // نستخدم نفس منهجية Telegram: Intl لتحديد التاريخ الليبي بدقة
    const _nowForWhatsApp = new Date();
    const libyaDateStrWA = _nowForWhatsApp.toLocaleDateString('en-CA', { timeZone: 'Africa/Tripoli' }); // 'YYYY-MM-DD'
    const startOfTodayLibya = new Date(`${libyaDateStrWA}T00:00:00+02:00`).getTime();
    // ─────────────────────────────────────────────────────────────────────────────

    if (msgTime < startOfTodayLibya) {
      return { processed: false, extractedCount: 0 };
    }

    // 2. Extract rates using regex rules (Gold is handled manually by Admin)
    let extracted = extractRatesFromText(rawText).filter(r => !r.code.startsWith('GOLD_') && r.code !== 'GOLD');

    // 3. Fallback to AI extraction ONLY if regex found nothing AND currency keywords exist
    // ← BUG FIX: previously AI was called even when regex succeeded, wasting resources
    //   and potentially overwriting accurate regex results with less-accurate AI ones.
    //   Now matches Telegram scraper logic exactly (scraper.service.ts line 518).
    const hasCurrencyKeywords = /(?:يورو|دولار|باوند|دينار|EUR|USD|GBP|TND|TRY|EGP|صك|صكوك|شيك)/i.test(rawText);
    if (extracted.length === 0 && hasCurrencyKeywords && rawText.length > 10 && rawText.length < 800) {
      try {
        const aiExtracted = await extractRatesWithAI(rawText, `واتساب - ${chatName}`);
        if (aiExtracted.length > 0) {
          const merged = [...extracted];
          for (const aiRate of aiExtracted) {
            if (aiRate.code.startsWith('GOLD_') || aiRate.code === 'GOLD') continue;
            const existingIdx = merged.findIndex(r => r.code === aiRate.code);
            if (existingIdx >= 0) {
              merged[existingIdx] = aiRate;
            } else {
              merged.push(aiRate);
            }
          }
          extracted = merged.filter(r => !r.code.startsWith('GOLD_') && r.code !== 'GOLD');
        }
      } catch (aiErr) {
        console.warn('[WhatsApp Scraper] AI extraction fallback warning:', aiErr);
      }
    }

    // 4. Record to Live Feed Audit Trail
    const feedMsg: LiveFeedMessage = {
      id: Math.random().toString(36).substring(2, 11),
      channel: `واتساب: ${chatName}`,
      text: rawText,
      time: msgTime,
      status: extracted.length > 0 ? 'processed' : 'skipped',
      extractedRates: extracted
    };
    liveFeed.unshift(feedMsg);
    if (liveFeed.length > 100) liveFeed = liveFeed.slice(0, 100);

    recordIngestion({
      source: `واتساب (${chatName})`,
      platform: 'whatsapp',
      timestamp: new Date(msgTime).toISOString(),
      rawText,
      status: extracted.length > 0 ? 'extracted' : 'ignored',
      extractedRates: extracted.map(e => ({ code: e.code, value: e.value })),
      ignoreReason: extracted.length === 0 ? 'نص محادثة واتساب لا يتضمن أسعار عملات مطابقة' : undefined
    });

    if (extracted.length === 0) {
      return { processed: true, extractedCount: 0 };
    }

    // 5. Validate extracted rates against sanity boundaries & max deviation
    const collectedUpdates: { id?: string; name: string; oldVal: number; newVal: number; flag: string }[] = [];
    let anyChanged = false;

    for (const res of extracted) {
      const term = appConfig.terms.find(t => t.id === res.code);
      if (!term) continue;

      const currentVal = rates.parallel[term.id];
      const newVal = res.value;

      // Check min/max boundary
      if (newVal < term.min || newVal > term.max) {
        console.warn(`[WhatsApp Scraper] Rate ${res.code} (${newVal}) outside boundaries [${term.min}, ${term.max}], rejected.`);
        continue;
      }

      // Check sudden spike deviation (max 25% for USD/EUR, 100% for TND/EGP)
      if (currentVal !== undefined && currentVal > 0) {
        const deviation = Math.abs(newVal - currentVal) / currentVal;
        const allowedDeviation = (term.id === 'TND' || term.id === 'EGP') ? 1.0 : 0.25;
        if (deviation > allowedDeviation) {
          const msg = `تم رفض تحديث سعر ${term.name} (${term.id}) من واتساب (${chatName}) بسبب قفزة غير منطقية من ${currentVal} إلى ${newVal} (تغيير بنسبة ${(deviation * 100).toFixed(1)}%)`;
          console.warn(`[WhatsApp Scraper] ${msg}`);
          await logErrorArabic(msg, 'حماية بيانات واتساب');
          continue;
        }
      }

      const lastBroadcast = (term.id && lastBroadcastState[term.id]) || (term.name && lastBroadcastState[term.name]);
      const hoursSinceBroadcast = lastBroadcast?.time ? (Date.now() - lastBroadcast.time) / (1000 * 60 * 60) : 999;
      const isPriceShift = isSignificantChange(currentVal, newVal);
      const isStaleBroadcast = hoursSinceBroadcast >= 3 && (term.id === 'USD' || term.id === 'EUR' || term.id === 'USD_CHECKS');

      // If price has significantly changed OR if it's been > 3 hours (or since yesterday) since last broadcast
      if (isPriceShift || isStaleBroadcast) {
        console.log(`[WhatsApp Scraper] Rate update: ${term.id} (${currentVal} -> ${newVal}) [Shift: ${isPriceShift}, Stale: ${isStaleBroadcast}, Hours: ${hoursSinceBroadcast.toFixed(1)}] Source: ${chatName}`);

        collectedUpdates.push({
          id: term.id,
          name: term.name,
          oldVal: lastBroadcast?.price ?? currentVal ?? newVal,
          newVal,
          flag: term.flag || 'ly'
        });

        if (isPriceShift) {
          rates.previousParallel[term.id] = currentVal || newVal;
          rates.parallel[term.id] = newVal;
          rates.lastChanged.parallel[term.id] = new Date(msgTime).toISOString();

          updateStats(term.id, newVal);

          history.push({
            time: new Date().toISOString(),
            usdParallel: rates.parallel.USD || newVal,
            usdOfficial: rates.official.USD,
            ratesParallel: { ...rates.parallel },
            ratesOfficial: { ...rates.official }
          });
          if (history.length > 500) history.shift();

          const changeLog = {
            id: Math.random().toString(36).substring(2, 9),
            currencyCode: term.id,
            currencyName: term.name,
            oldPrice: currentVal || 0,
            newPrice: newVal,
            source: `واتساب - ${chatName}`,
            timestamp: new Date().toISOString()
          };
          await logPriceChange(changeLog);
        }

        anyChanged = true;
      }
    }

    if (anyChanged) {
      rates.lastUpdated = new Date().toISOString();
      lastSuccessfulFetchTime = Date.now();
      await saveToSupabase('parallel');

      // Broadcast changes across channels if needed
      if (collectedUpdates.length > 0) {
        broadcastRateChanges(collectedUpdates).catch(e => console.error('[WhatsApp Scraper] Broadcast error:', e));
      }
    }

    return { processed: true, extractedCount: extracted.length, rates: extracted };
  } catch (err: any) {
    console.error('[WhatsApp Scraper] Error processing message:', err);
    await logErrorArabic(`خطأ في معالجة رسالة واتساب: ${err?.message || err}`, 'واتساب');
    return { processed: false, extractedCount: 0 };
  }
}
