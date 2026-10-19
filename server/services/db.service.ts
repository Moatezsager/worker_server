import { db, supabase, supabaseKey } from '../db';
import { rates, history } from '../state';
import { appConfig } from '../config';
import { HistoryPoint, PriceChangeLog, RateMap, AppConfig } from '../types';
import { isSignificantChange, METAL_IDS, getPriceHistoryCutoff } from '../utils/helpers';
import { updateStats } from './reporting.service';
import { addLog, sanitizeErrorMessage } from '../utils/logger';

export let lastRatesFetchTime = 0;
export const RATES_CACHE_TTL = 30 * 1000; // 30 seconds

export let lastHistoryFetchTime = 0;
export const HISTORY_CACHE_TTL = 60 * 1000; // 1 minute
export let cachedHistory: HistoryPoint[] | null = null;

export const recentChangesLog: PriceChangeLog[] = [];
export const pipelineStatus = { lastSavedAt: 0, lastWebSyncAt: 0, lastWebSyncError: '' };
const rejectedRates = new Map<string, { code: string; name: string; previous: number; proposed: number; source: string; observedAt: string; rejectedAt: number }>();

export function getRejectedRates() {
  return [...rejectedRates.values()].sort((a, b) => b.rejectedAt - a.rejectedAt);
}

export function clearDbCache() {
  cachedHistory = null;
  lastHistoryFetchTime = 0;
  lastRatesFetchTime = 0;
}

export async function saveWorkerStateToSupabase(key: string, value: any): Promise<void> {
  const stringVal = typeof value === 'string' ? value : JSON.stringify(value);
  try { db?.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run(key, stringVal); }
  catch (err) { console.warn('[WorkerState] Local checkpoint failed:', key); }
  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return;
  try {
    const { error } = await supabase.from('server_config').upsert({
      key, value: stringVal, updated_at: new Date().toISOString()
    });
    if (error) console.warn('[WorkerState] Remote checkpoint failed:', key, error.message);
  } catch (err) { console.warn('[WorkerState] Remote checkpoint failed:', key); }
}

export async function loadWorkerStateFromSupabase<T = any>(key: string): Promise<T | null> {
  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return null;
  try {
    const { data, error } = await supabase
      .from('server_config')
      .select('value')
      .eq('key', key)
      .single();
    if (error || !data?.value) return null;
    try {
      return JSON.parse(data.value);
    } catch {
      return data.value as unknown as T;
    }
  } catch (err) {
    console.warn(`[WorkerState] Error loading state '${key}' from Supabase:`, err);
    return null;
  }
}

export async function logErrorArabic(message: string, context = "النظام", stack?: string, url?: string) {
  addLog("error", context, message, stack);
  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) {
    console.error(`[ArabicLog] ${context}: ${message}`);
    return;
  }
  
  try {
    const { error } = await supabase.from('error_logs').insert([{
      message: message,
      context: context,
      stack: stack,
      url: url,
      created_at: new Date().toISOString()
    }]);
    
    if (error) console.error("Failed to save Arabic error log:", error.message);
  } catch (err) {
    console.error("Critical error in logErrorArabic:", err);
  }
}

export async function loadLatestRatesFromSupabase() {
  if (!supabase) return;
  
  try {
    console.log("[Startup] Loading latest rates from Supabase to ensure latest prices...");
    
    // Load parallel rates
    const { data: parallelData, error: parallelError } = await supabase
      .from('parallel_rates')
      .select('usd, rates, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1);
      
    if (parallelData && parallelData.length > 0) {
      const latest = parallelData[0];
      rates.parallel = { ...rates.parallel, ...latest.rates, USD: latest.usd };
      rates.lastUpdated = latest.recorded_at;
      console.log("[Startup] Successfully loaded latest parallel rates from", latest.recorded_at);
      await syncCheckRates("بدء تشغيل السيرفر");
    }
    
    // Load official rates
    const { data: officialData, error: officialError } = await supabase
      .from('official_rates')
      .select('usd, rates, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1);
      
    if (officialData && officialData.length > 0) {
      const latest = officialData[0];
      rates.official = { ...rates.official, ...latest.rates, USD: latest.usd };
      console.log("[Startup] Successfully loaded latest official rates from", latest.recorded_at);
    }
  } catch (err) {
    console.error("[Startup] Failed to load latest rates from Supabase:", err);
  }
}

export async function logPriceChange(change: PriceChangeLog) {
  recentChangesLog.unshift(change);
  if (recentChangesLog.length > 200) recentChangesLog.pop();

  if (supabase && supabaseKey && !supabaseKey.includes('dummy')) {
    try {
      await supabase.from('price_changes_log').insert([{
        id: change.id,
        currency_code: change.currencyCode,
        currency_name: change.currencyName,
        old_price: change.oldPrice,
        new_price: change.newPrice,
        source: change.source,
        created_at: change.timestamp
      }]);
    } catch (e) {
      console.error("Failed to insert price change log to Supabase", e);
    }
  }
}


export async function initializeRatesFromDB(force = false) {
  if (!force && lastRatesFetchTime > 0 && (Date.now() - lastRatesFetchTime < RATES_CACHE_TTL)) {
    return; 
  }

  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return;
  
  try {
    console.log(`[DB] Initializing rates from Supabase (force=${force})...`);
    const { data: parallelData, error: parallelError } = await supabase
      .from('parallel_rates')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1000);

    const { data: officialData, error: officialError } = await supabase
      .from('official_rates')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1000);

    const isParallelTableMissing = parallelError && parallelError.message.includes('relation "parallel_rates" does not exist');
    const isOfficialTableMissing = officialError && officialError.message.includes('relation "official_rates" does not exist');

    if (isParallelTableMissing || isOfficialTableMissing) {
      console.warn("[DB] New tables missing, falling back to legacy exchange_rates table");
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(50);
        
      if (!error && data && data.length > 0) {
        const latestRow = data[0];
        if (latestRow.rates_parallel) rates.parallel = { ...rates.parallel, ...latestRow.rates_parallel };
        if (latestRow.rates_official) rates.official = { ...rates.official, ...latestRow.rates_official };
        if (latestRow.last_changed) {
          rates.lastChanged = {
            official: { ...rates.lastChanged.official, ...(latestRow.last_changed.official || {}) },
            parallel: { ...rates.lastChanged.parallel, ...(latestRow.last_changed.parallel || {}) }
          };
        }
        rates.lastUpdated = latestRow.recorded_at || new Date().toISOString();
        
        const findPrev = (curr: RateMap, isP: boolean) => {
          const prev: RateMap = { ...curr };
          for (const code in curr) {
            const diff = data.find((row: any) => {
              const r = isP ? row.rates_parallel : row.rates_official;
              return r && isSignificantChange(r[code], curr[code]);
            });
            if (diff) {
              const r = isP ? (diff as any).rates_parallel : (diff as any).rates_official;
              prev[code] = r[code];
            }
          }
          return prev;
        };
        rates.previousParallel = findPrev(rates.parallel, true);
        rates.previousOfficial = findPrev(rates.official, false);
      }
    } else {
      if (parallelData && parallelData.length > 0) {
        const latest = parallelData[0];
        if (latest.rates) rates.parallel = { ...rates.parallel, ...latest.rates };
        if (latest.last_changed) rates.lastChanged.parallel = { ...rates.lastChanged.parallel, ...latest.last_changed };
        rates.lastUpdated = latest.recorded_at;
        
        for (const code in rates.parallel) {
          const diff = parallelData.find(r => r.rates && isSignificantChange(r.rates[code], rates.parallel[code]));
          if (diff) rates.previousParallel[code] = diff.rates[code];
        }
      }

      if (officialData && officialData.length > 0) {
        const latest = officialData[0];
        if (latest.rates) rates.official = { ...rates.official, ...latest.rates };
        for (const code in rates.official) {
          const diff = officialData.find(r => r.rates && isSignificantChange(r.rates[code], rates.official[code]));
          if (diff) rates.previousOfficial[code] = diff.rates[code];
        }
        if (new Date(latest.recorded_at) > new Date(rates.lastUpdated)) {
           rates.lastUpdated = latest.recorded_at;
        }
      }
    }
    
    delete rates.parallel.OFFICIAL_USD;
    delete (rates.parallel as any).official_usd;
    delete rates.previousParallel.OFFICIAL_USD;
    delete (rates.previousParallel as any).official_usd;
    if (rates.lastChanged.parallel) {
      delete rates.lastChanged.parallel.OFFICIAL_USD;
      delete (rates.lastChanged.parallel as any).official_usd;
    }

    lastRatesFetchTime = Date.now();
    console.log(`[DB] Successfully loaded state from separated tables (Parallel USD: ${rates.parallel.USD})`);
  } catch (err) {
    console.error("Error initializing rates from DB:", err);
  }
}

export async function saveToSupabase(
  type: 'parallel' | 'official' | 'both' = 'both',
  customOfficialRates?: RateMap,
  snapshot: typeof rates = rates
): Promise<boolean> {
  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return false;
  const saved = structuredClone(snapshot);
  if (customOfficialRates) saved.official = { ...customOfficialRates };
  delete saved.parallel.OFFICIAL_USD;
  delete saved.parallel.official_usd;
  delete saved.lastChanged.parallel.OFFICIAL_USD;
  delete saved.lastChanged.parallel.official_usd;
  const now = new Date().toISOString();
  if (type === 'official' || !saved.lastUpdated) {
    saved.lastUpdated = now;
    snapshot.lastUpdated = now;
  }
  const recordedAt = saved.lastUpdated;
  try {
    // Confirm authoritative saves before writing compatibility copies.
    if (type === 'parallel' || type === 'both') {
      if (!Number.isFinite(saved.parallel.USD) || saved.parallel.USD < 5.5) return false;
      const { error } = await supabase.from('parallel_rates').insert([{
        usd: saved.parallel.USD, rates: saved.parallel,
        last_changed: saved.lastChanged.parallel, recorded_at: recordedAt
      }]);
      if (error) throw error;
    }
    if (type === 'official' || type === 'both') {
      if (!Number.isFinite(saved.official.USD) || saved.official.USD <= 0) return false;
      const { error } = await supabase.from('official_rates').insert([{
        usd: saved.official.USD, rates: saved.official, recorded_at: now
      }]);
      if (error) throw error;
    }
  } catch (err) {
    await logErrorArabic('فشل حفظ الأسعار في قاعدة البيانات', 'حفظ البيانات', String(err));
    return false;
  }
  const copies = [];
  if (type === 'parallel' || type === 'both') {
    const metals = Object.fromEntries(METAL_IDS.filter(id => saved.parallel[id] > 0).map(id => [id, saved.parallel[id]]));
    if (Object.keys(metals).length) copies.push(supabase.from('metal_rates').insert([{
      rates: metals,
      last_changed: Object.fromEntries(Object.keys(metals).map(id => [id, saved.lastChanged.parallel[id]])),
      recorded_at: recordedAt
    }]));
  }
  if (saved.parallel.USD > 0 && saved.official.USD > 0) copies.push(supabase.from('exchange_rates').insert([{
    usd_parallel: saved.parallel.USD, usd_official: saved.official.USD,
    rates_parallel: saved.parallel, rates_official: saved.official,
    last_changed: saved.lastChanged, recorded_at: type === 'official' ? now : recordedAt
  }]));
  for (const result of await Promise.allSettled(copies)) {
    const error = result.status === 'rejected' ? result.reason : result.value.error;
    if (error) console.warn('[DB] Compatibility copy failed after authoritative save:', String(error?.message || error));
  }
  clearDbCache();
  pipelineStatus.lastSavedAt = Date.now();
  addLog('success', 'حفظ الأسعار', 'حُفظت الأسعار؛ بدء تأكيد مزامنة Web قبل النشر', {
    stage: 'persist', market: type, recordedAt, parallel: { USD: saved.parallel.USD, EUR: saved.parallel.EUR },
    official: { USD: saved.official.USD, EUR: saved.official.EUR }
  });
  // A saved price remains authoritative even if Web is temporarily unavailable.
  await notifyWebServers(saved, type);
  return true;
}

let parallelWrite: Promise<unknown> = Promise.resolve();
const lastObserved: Record<string, number> = {};

export function commitParallelRates(extracted: { code: string; value: number; time: number; source: string }[], isManual = false) {
  const write = parallelWrite.then(async () => {
    const candidate = structuredClone(rates);
    const observed: Record<string, number> = {};
    const changes: { id: string; name: string; oldVal: number; newVal: number; flag: string; source: string }[] = [];
    for (const entry of extracted) {
      const term = appConfig.terms.find(t => t.id === entry.code);
      if (!term || term.id === 'OFFICIAL_USD' || !Number.isFinite(entry.value) ||
          entry.value < term.min || entry.value > term.max || !Number.isFinite(entry.time) ||
          entry.time <= 0 || entry.time > Date.now() + 300000) {
        if (isManual) throw new Error('Invalid manual price or currency');
        continue;
      }
      const lastTime = Math.max(Date.parse(candidate.lastChanged.parallel[term.id] || '') || 0,
        observed[term.id] || lastObserved[term.id] || 0);
      if (!isManual && (entry.time < lastTime || observed[term.id] !== undefined)) continue;
      const oldVal = candidate.parallel[term.id];
      const isCheck = CHECK_TRIO.includes(term.id as typeof CHECK_TRIO[number]);
      const maxDeviation = term.id === 'USD' || term.id === 'EUR' || isCheck ? 0.03
        : term.id === 'TND' || term.id === 'EGP' ? 1 : 0.25;
      // Compare persisted prices, including every check alias that synchronization could overwrite.
      const baselineCodes = isCheck ? CHECK_TRIO : [term.id];
      const rejectedBaseline = baselineCodes.find(code => {
        const previous = rates.parallel[code];
        return Number.isFinite(previous) && previous > 0 &&
          Math.abs(entry.value - previous) > previous * maxDeviation + 1e-9;
      });
      if (!isManual && rejectedBaseline) {
        const previous = rates.parallel[rejectedBaseline];
        rejectedRates.delete(term.id);
        rejectedRates.set(term.id, { code: term.id, name: term.name, previous, proposed: entry.value,
          source: entry.source, observedAt: new Date(entry.time).toISOString(), rejectedAt: Date.now() });
        if (rejectedRates.size > 50) rejectedRates.delete(rejectedRates.keys().next().value!);
        addLog('warn', 'حماية الأسعار', `تم رفض تغير غير معتاد في ${term.name}: ${previous} إلى ${entry.value}؛ يلزم التحقق أو الاعتماد اليدوي`, {
          stage: 'price-validation', code: term.id, baselineCode: rejectedBaseline, source: entry.source,
          previous, proposed: entry.value, difference: entry.value - previous,
          changePercent: Math.abs(entry.value - previous) / previous * 100, limitPercent: maxDeviation * 100
        });
        continue;
      }
      observed[term.id] = entry.time;
      if (!isSignificantChange(oldVal, entry.value)) continue;
      candidate.previousParallel[term.id] = oldVal || entry.value;
      candidate.parallel[term.id] = entry.value;
      candidate.lastChanged.parallel[term.id] = new Date(entry.time).toISOString();
      if (isManual) {
        candidate.parallel[term.id.toLowerCase()] = entry.value;
        candidate.previousParallel[term.id.toLowerCase()] = oldVal || entry.value;
        if (term.id === 'GOLD_SCRAP_18') {
          candidate.parallel.GOLD = entry.value;
          candidate.parallel.gold = entry.value;
          candidate.previousParallel.GOLD = oldVal || entry.value;
          candidate.previousParallel.gold = oldVal || entry.value;
        }
      }
      changes.push({ id: term.id, name: term.name, oldVal: oldVal || entry.value,
        newVal: entry.value, flag: term.flag || 'ly', source: entry.source });
    }
    if (!changes.length && !isManual) {
      Object.assign(lastObserved, observed);
      return changes;
    }
    const checkChange = changes.filter(u => CHECK_TRIO.includes(u.id as typeof CHECK_TRIO[number]))
      .sort((a, b) => Date.parse(candidate.lastChanged.parallel[b.id]) - Date.parse(candidate.lastChanged.parallel[a.id]))[0];
    if (checkChange && Math.abs(checkChange.newVal - candidate.parallel.USD) >= 0.05) {
      const changedAt = candidate.lastChanged.parallel[checkChange.id];
      for (const id of CHECK_TRIO) {
        if (Date.parse(candidate.lastChanged.parallel[id] || '') > Date.parse(changedAt)) continue;
        if (candidate.parallel[id] !== checkChange.newVal) {
          candidate.previousParallel[id] = candidate.parallel[id] || checkChange.newVal;
          candidate.parallel[id] = checkChange.newVal;
          candidate.lastChanged.parallel[id] = changedAt;
        }
      }
    }
    for (const change of changes) change.newVal = candidate.parallel[change.id];
    candidate.lastUpdated = new Date().toISOString();
    if (!await saveToSupabase('parallel', undefined, candidate)) throw new Error('Parallel rates were not saved');
    rates.parallel = candidate.parallel;
    rates.previousParallel = candidate.previousParallel;
    rates.lastChanged.parallel = candidate.lastChanged.parallel;
    rates.lastUpdated = candidate.lastUpdated;
    for (const change of changes) rejectedRates.delete(change.id);
    Object.assign(lastObserved, observed);
    history.push({ time: candidate.lastUpdated, usdParallel: rates.parallel.USD,
      usdOfficial: rates.official.USD, ratesParallel: { ...rates.parallel }, ratesOfficial: { ...rates.official } });
    if (history.length > 500) history.shift();
    for (const change of changes) {
      updateStats(change.id, change.newVal);
      await logPriceChange({ id: Math.random().toString(36).slice(2, 9), currencyCode: change.id,
        currencyName: change.name, oldPrice: change.oldVal, newPrice: change.newVal,
        source: change.source, timestamp: candidate.lastUpdated });
    }
    return changes;
  });
  parallelWrite = write.catch(() => {});
  return write;
}

export async function fetchHistoryFromSupabase() {
  if (cachedHistory && Date.now() - lastHistoryFetchTime < HISTORY_CACHE_TTL) {
    return cachedHistory;
  }

  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return history;
  
  try {
    const [parallelRes, officialRes, metalRes] = await Promise.all([
      supabase.from('parallel_rates').select('recorded_at, usd, rates').order('recorded_at', { ascending: false }).limit(3000),
      supabase.from('official_rates').select('recorded_at, usd, rates').order('recorded_at', { ascending: false }).limit(3000),
      supabase.from('metal_rates').select('recorded_at, rates').order('recorded_at', { ascending: false }).limit(3000)
    ]);

    if (parallelRes.error?.message.includes('relation "parallel_rates" does not exist') || 
        officialRes.error?.message.includes('relation "official_rates" does not exist')) {
        
        const { data, error } = await supabase.from('exchange_rates').select('*').order('recorded_at', { ascending: false }).limit(3000);
        if (!error && data) {
           cachedHistory = data.reverse().map((row: any) => ({
              time: row.recorded_at,
              usdParallel: row.usd_parallel || (row.rates_parallel ? row.rates_parallel.USD : 0),
              usdOfficial: row.usd_official || (row.rates_official ? row.rates_official.USD : 0),
              ratesParallel: row.rates_parallel || { USD: row.usd_parallel },
              ratesOfficial: row.rates_official || { USD: row.usd_official },
              previousParallel: row.previous_parallel,
              previousOfficial: row.previous_official
           })).filter((item: any) => item.usdParallel > 5.5 || item.usdOfficial > 0);
           lastHistoryFetchTime = Date.now();
           return cachedHistory;
        }
        return history;
    }

    const parallelData = parallelRes.data || [];
    const officialData = officialRes.data || [];
    const metalData = metalRes.data || [];

    const timelineMap = new Map<string, Partial<HistoryPoint>>();

    parallelData.forEach((row: any) => {
      const time = new Date(row.recorded_at).toISOString();
      timelineMap.set(time, {
        time,
        usdParallel: row.usd,
        ratesParallel: row.rates || { USD: row.usd }
      });
    });

    officialData.forEach((row: any) => {
      const time = new Date(row.recorded_at).toISOString();
      if (timelineMap.has(time)) {
        const existing = timelineMap.get(time)!;
        existing.usdOfficial = row.usd;
        existing.ratesOfficial = row.rates || { USD: row.usd };
      } else {
        timelineMap.set(time, {
          time,
          usdOfficial: row.usd,
          ratesOfficial: row.rates || { USD: row.usd }
        });
      }
    });

    metalData.forEach((row: any) => {
      const time = new Date(row.recorded_at).toISOString();
      if (timelineMap.has(time)) {
        const existing = timelineMap.get(time)!;
        existing.ratesParallel = { ...(existing.ratesParallel || {}), ...(row.rates || {}) };
      } else {
        timelineMap.set(time, {
          time,
          ratesParallel: row.rates || {}
        });
      }
    });

    const sortedPoints = Array.from(timelineMap.values()).sort((a, b) => 
      new Date(a.time!).getTime() - new Date(b.time!).getTime()
    );

    let lastParallelRates: any = { ...rates.parallel };
    let lastOfficialRates: any = { ...rates.official };
    let lastUsdParallel = rates.parallel.USD || 0;
    let lastUsdOfficial = rates.official.USD || 0;
    
    const completedHistory = sortedPoints.map(p => {
      if (p.usdParallel !== undefined) lastUsdParallel = p.usdParallel;
      if (p.usdOfficial !== undefined) lastUsdOfficial = p.usdOfficial;
      if (p.ratesParallel) lastParallelRates = { ...lastParallelRates, ...p.ratesParallel };
      if (p.ratesOfficial) lastOfficialRates = { ...lastOfficialRates, ...p.ratesOfficial };
      
      return {
        time: p.time!,
        usdParallel: lastUsdParallel,
        usdOfficial: lastUsdOfficial,
        ratesParallel: { ...lastParallelRates },
        ratesOfficial: { ...lastOfficialRates }
      };
    }) as HistoryPoint[];

    if (completedHistory.length > 0) {
      cachedHistory = completedHistory;
      lastHistoryFetchTime = Date.now();
      return cachedHistory;
    }
  } catch (err) {
    console.error("Error fetching history from separated tables:", err);
  }
  return history;
}

export const CHECK_TRIO = ["USD_CHECKS", "USD_JBANK", "USD_NCB"] as const;

export async function syncCheckRates(source: string = "تزامن تلقائي", explicitPrice?: number) {
  let targetPrice = explicitPrice || 0;
  let latestCheckTime = 0;

  if (targetPrice <= 0) {
    // العثور على أحدث سعر تم تعديله بين الثلاثي (دولار صكوك، صكوك تجاري، صكوك جمهورية)
    for (const id of CHECK_TRIO) {
      const lastChanged = rates.lastChanged.parallel[id];
      const p = rates.parallel[id] || 0;
      if (p > 0) {
        if (lastChanged) {
          const time = new Date(lastChanged).getTime();
          if (time > latestCheckTime) {
            latestCheckTime = time;
            targetPrice = p;
          }
        } else if (targetPrice <= 0) {
          targetPrice = p;
        }
      }
    }
  }

  // 🛡️ حماية صارمة: سعر الصكوك في السوق الليبي يختلف جذرياً عن سعر الكاش
  // لا يجوز إطلاقاً مزامنة الصكوك إذا كان السعر المستهدف مطابقاً لسعر الدولار كاش
  const usdCash = rates.parallel['USD'] || 0;
  if (targetPrice > 0 && usdCash > 0 && Math.abs(targetPrice - usdCash) < 0.05) {
    console.warn(`[Sync] ⚠️ تم رفض مزامنة الصكوك: السعر المستهدف (${targetPrice}) مطابق لسعر الدولار كاش (${usdCash}). الصكوك والكاش منفصلان تماماً.`);
    return false;
  }

  if (targetPrice > 0) {
    let anyChanged = false;
    const nowIso = latestCheckTime > 0 ? new Date(latestCheckTime).toISOString() : new Date().toISOString();

    for (const id of CHECK_TRIO) {
      if (rates.parallel[id] !== targetPrice) {
        const oldVal = rates.parallel[id] || targetPrice;
        
        rates.previousParallel[id] = oldVal;
        rates.parallel[id] = targetPrice;
        rates.lastChanged.parallel[id] = nowIso;
        anyChanged = true;
        
        const term = appConfig.terms.find(t => t.id === id);
        const termName = term ? term.name : (id === 'USD_CHECKS' ? 'دولار أمريكي (صكوك)' : id);
        const changeLog = {
          id: Math.random().toString(36).substring(2, 9),
          currencyCode: id,
          currencyName: termName,
          oldPrice: oldVal,
          newPrice: targetPrice,
          source: `${source} (مزامنة الصكوك)`,
          timestamp: new Date().toISOString()
        };
        await logPriceChange(changeLog);
        try {
          updateStats(id, targetPrice);
        } catch (e) {}
        console.log(`[Sync] Synced ${id} to ${targetPrice} from check trio. Source: ${source}`);
      }
    }
    return anyChanged;
  }
  return false;
}

let cleanupRun: Promise<Record<string, number | string>> | null = null;

export function cleanupOldData(onUserLogsCleanup?: () => void): Promise<Record<string, number | string>> {
  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return Promise.reject(new Error('Cleanup database unavailable'));
  if (!cleanupRun) cleanupRun = (async () => {
    const cutoff30 = getPriceHistoryCutoff();
    const cutoff1 = new Date(Date.now() - 86400000).toISOString();
    const signal = AbortSignal.timeout(10000);
    const removed: Record<string, number> = {};
    const tables = ['exchange_rates', 'parallel_rates', 'official_rates', 'metal_rates', 'error_logs', 'price_changes_log'];
    const failures: string[] = [];
    for (const table of tables) {
      const priceTable = table.endsWith('_rates');
      let cutoff = priceTable ? cutoff30 : cutoff1;
      try {
        if (priceTable) {
          const latest = await supabase!.from(table).select('recorded_at').lt('recorded_at', cutoff)
            .order('recorded_at', { ascending: false }).limit(1).abortSignal(signal);
          if (latest.error) throw latest.error;
          if (!Array.isArray(latest.data)) throw new Error('Missing cleanup boundary');
          if (!latest.data.length) { removed[table] = 0; continue; }
          const boundary = Date.parse(latest.data[0].recorded_at);
          if (!Number.isFinite(boundary) || boundary >= Date.parse(cutoff)) throw new Error('Invalid cleanup boundary');
          // Retain the last pre-month observation; never delete the only/latest quote.
          cutoff = new Date(boundary).toISOString();
        }
        const result = await supabase!.from(table).delete({ count: 'exact' })
          .lt(priceTable ? 'recorded_at' : 'created_at', cutoff).abortSignal(signal);
        if (result.error) throw result.error;
        removed[table] = result.count || 0;
      } catch (error: any) {
        if (['42P01', 'PGRST205'].includes(error?.code) && !['parallel_rates', 'official_rates'].includes(table)) {
          removed[table] = 0;
        } else {
          failures.push(table);
          console.error(`[Cleanup] ${table} failed:`, sanitizeErrorMessage(error));
        }
      }
    }
    clearDbCache();
    if (failures.length) {
      addLog('error', 'Cleanup', 'لم يكتمل تنظيف البيانات؛ لم تُضغط قراءات الشهر.', { tables: failures });
      throw new Error(`Cleanup incomplete: ${failures.join(', ')}`);
    }
    const details = {
      removed_exchange_rates: removed.exchange_rates, removed_parallel_rates: removed.parallel_rates,
      removed_official_rates: removed.official_rates, removed_metal_rates: removed.metal_rates,
      total_removed_rates: removed.exchange_rates + removed.parallel_rates + removed.official_rates + removed.metal_rates,
      removed_logs: removed.error_logs, removed_changes: removed.price_changes_log,
      cutoff_rates_date: cutoff30, cutoff_logs_date: cutoff1
    };
    console.log('[Cleanup] Completed; monthly observations and boundary quotes preserved.', details);
    addLog('success', 'Cleanup', 'اكتمل التنظيف مع الاحتفاظ بقراءات الشهر وآخر سعر سابق.', details);
    return details;
  })().finally(() => { cleanupRun = null; });
  return cleanupRun.then(details => { onUserLogsCleanup?.(); return details; });
}

/**
 * Notifies the Web Server that rates have been updated in Supabase.
 * The Web Server will then reload rates and broadcast to Socket.IO clients.
 */
let webNotification: Promise<boolean> | null = null;
let notificationPending = false;
let notificationSnapshot: typeof rates | undefined;
let notificationMarket: 'parallel' | 'official' | 'both' = 'both';
type WebMarket = 'parallel' | 'official' | 'both';
const confirmedWeb: Partial<Record<WebMarket, { revision: string; at: number }>> = {};
const failedWeb: Partial<Record<WebMarket, { revision: string; at: number; message: string }>> = {};
function webRevision(snapshot: typeof rates, market: WebMarket) {
  return JSON.stringify(market === 'both' ? [snapshot.lastUpdated, snapshot.parallel.USD, snapshot.parallel.EUR, snapshot.official.USD, snapshot.official.EUR]
    : [snapshot[market].USD, snapshot[market].EUR]);
}

export function getWebRatesSyncError(market: WebMarket = 'both'): string {
  return failedWeb[market]?.message || 'لم يؤكد Web الأسعار المحفوظة بعد؛ التحديث لم يُرسل.';
}

export async function ensureWebRatesReady(market: WebMarket = 'both'): Promise<boolean> {
  const snapshot = structuredClone(rates), revision = webRevision(snapshot, market);
  const confirmed = confirmedWeb[market], failed = failedWeb[market];
  if (confirmed?.revision === revision && Date.now() - confirmed.at < 30000) return true;
  if (failed?.revision === revision && Date.now() - failed.at < 30000) return false;
  await notifyWebServers(snapshot, market);
  // A concurrent notification can complete for another market or a newer price.
  return confirmedWeb[market]?.revision === revision && webRevision(rates, market) === revision;
}

export function notifyWebServers(snapshot?: typeof rates, market: WebMarket = 'both'): Promise<boolean> {
  const webUrl = (process.env.WEB_SERVER_URL || '').trim();
  const secret = (process.env.WORKER_INTERNAL_SECRET || '').trim();
  if (!webUrl || !secret) {
    const revision = webRevision(snapshot || rates, market);
    const message = !webUrl ? 'WEB_SERVER_URL مفقود في Worker؛ لا يمكن تأكيد المزامنة.'
      : 'WORKER_INTERNAL_SECRET مفقود في Worker؛ لا يمكن توثيق طلب المزامنة.';
    pipelineStatus.lastWebSyncError = message;
    if (failedWeb[market]?.message !== message || Date.now() - failedWeb[market]!.at >= 30000) {
      addLog('error', 'مزامنة Web', message, { stage: 'web-sync', market, code: 'MISSING_CONFIGURATION' });
    }
    failedWeb[market] = { revision, at: Date.now(), message };
    delete confirmedWeb[market]; delete confirmedWeb.both;
    return Promise.resolve(false);
  }
  notificationPending = true;
  if (snapshot) { notificationSnapshot = structuredClone(snapshot); notificationMarket = market; }
  if (webNotification) return webNotification;
  webNotification = (async () => {
    let synchronized = false;
    while (notificationPending) {
      notificationPending = false;
      const expected = notificationSnapshot;
      const expectedMarket = notificationMarket;
      notificationSnapshot = undefined;
      synchronized = false;
      const started = Date.now();
      let lastFailure = '';
      let diagnostic: Record<string, any> = { stage: 'web-sync', market: expectedMarket };
      addLog('info', 'مزامنة Web', 'طلب تأكيد تحميل الأسعار وتحديث المعاينة وSocket.IO', diagnostic);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const endpoint = new URL(`/api/internal/notify-rates-updated${expected ? '?wait=true' : ''}`, webUrl);
          if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('WEB_SERVER_URL غير صالح.');
          diagnostic = { stage: 'web-sync', market: expectedMarket, endpoint: endpoint.origin + endpoint.pathname,
            attempt: attempt + 1, expected: expected && { lastUpdated: expected.lastUpdated,
              parallel: { USD: expected.parallel.USD, EUR: expected.parallel.EUR }, official: { USD: expected.official.USD, EUR: expected.official.EUR } } };
          const response = await fetch(endpoint.toString(), {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': secret, 'User-Agent': 'Dollar-Price-Worker/1.0' },
            signal: AbortSignal.timeout(expected ? 20000 : 5000), redirect: 'error'
          });
          diagnostic.httpStatus = response.status;
          if (response.ok) {
            if (expected) {
              const result: any = await response.json();
              const matchesRate = (actual: any, exp: any): boolean => {
                if (actual == null && exp == null) return true;
                if (actual == null || exp == null) return false;
                const a = Number(actual), e = Number(exp);
                return Number.isFinite(a) && Number.isFinite(e) && Math.abs(a - e) < 0.005;
              };
              const parallelMatches = Number.isFinite(expected.parallel.USD) && expected.parallel.USD > 0 && matchesRate(result.parallel?.USD, expected.parallel.USD) &&
                (!expected.parallel.EUR || matchesRate(result.parallel?.EUR, expected.parallel.EUR));
              const officialMatches = Number.isFinite(expected.official?.USD) && expected.official.USD > 0 && matchesRate(result.official?.USD, expected.official.USD) &&
                (!expected.official?.EUR || matchesRate(result.official?.EUR, expected.official.EUR));
              const resTime = Date.parse(result.lastUpdated);
              const expTime = Date.parse(expected.lastUpdated);
              const isTimestampValid = !isNaN(resTime) && !isNaN(expTime) && (resTime >= expTime - 5000);
              diagnostic.received = { status: result.status, lastUpdated: result.lastUpdated, parallel: result.parallel, official: result.official };
              const marketMatches = expectedMarket === 'official' ? officialMatches : expectedMarket === 'parallel' ? parallelMatches : parallelMatches && officialMatches;
              const timeConfirmed = Number.isFinite(resTime) && Number.isFinite(expTime) && (isTimestampValid || marketMatches);
              if (result.status !== 'synchronized' ||
                  !timeConfirmed ||
                  (expectedMarket !== 'official' && !parallelMatches) ||
                  (expectedMarket !== 'parallel' && !officialMatches)) {
                throw new Error(result.status !== 'synchronized' ? 'Web لم يرجع status=synchronized؛ تحقق من نشر إصدار Web الداعم للتأكيد.'
                  : 'أسعار Web لا تطابق الأسعار المحفوظة؛ راجع expected وreceived في تفاصيل السجل.');
              }
              for (const confirmedMarket of ['parallel', 'official', 'both'] as const) {
                if (confirmedMarket === 'parallel' ? parallelMatches : confirmedMarket === 'official' ? officialMatches : parallelMatches && officialMatches) {
                  confirmedWeb[confirmedMarket] = { revision: webRevision(expected, confirmedMarket), at: Date.now() };
                  delete failedWeb[confirmedMarket];
                }
              }
            }
            synchronized = true;
            if (expected) {
              pipelineStatus.lastWebSyncAt = Date.now();
              pipelineStatus.lastWebSyncError = '';
            }
            addLog('success', 'مزامنة Web', expected ? 'أكد Web تحميل الأسعار وتحديث المعاينة والبث اللحظي' : 'استلم Web إشعار التحديث (استلام فقط)',
              { ...diagnostic, duration_ms: Date.now() - started });
            break;
          }
          const body: any = await response.json?.().catch(() => null);
          diagnostic.responseError = body?.error || body?.message;
          lastFailure = response.status === 401 ? 'HTTP 401: Web رفض المصادقة؛ تحقق من WORKER_INTERNAL_SECRET في خدمة Web وعنوان WEB_SERVER_URL في Worker.'
            : response.status === 403 ? 'HTTP 403: Web رفض الطلب؛ تحقق من تطابق WORKER_INTERNAL_SECRET وقواعد الحماية.'
            : response.status === 404 ? 'HTTP 404: مسار المزامنة غير موجود؛ تحقق من عنوان Web والإصدار المنشور.'
            : 'HTTP ' + response.status + ': لم يكتمل تأكيد مزامنة Web.';
          if (response.status < 500 && ![408, 429].includes(response.status)) {
            break;
          }
          throw new Error(lastFailure);
        } catch (err: any) {
          lastFailure = sanitizeErrorMessage(err?.name === 'TimeoutError' || err?.name === 'AbortError'
            ? 'انتهت مهلة اتصال Web؛ راجع جاهزية الخدمة وقاعدة البيانات.' : err) || 'فشل اتصال Web';
          diagnostic.networkCode = err?.cause?.code || err?.code;
          if (attempt < 2) {
            addLog('warn', 'مزامنة Web', lastFailure, { ...diagnostic, retryInSeconds: 2 ** attempt });
            await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
          }
        }
      }
      if (!synchronized) {
        lastFailure = sanitizeErrorMessage(lastFailure) || 'لم يكتمل تأكيد مزامنة Web.';
        pipelineStatus.lastWebSyncError = lastFailure;
        addLog('error', 'مزامنة Web', lastFailure, { ...diagnostic, duration_ms: Date.now() - started });
        console.error('[Notify]', lastFailure);
        if (expected) {
          failedWeb[expectedMarket] = { revision: webRevision(expected, expectedMarket), at: Date.now(), message: lastFailure };
          delete confirmedWeb[expectedMarket]; delete confirmedWeb.both;
          if (expectedMarket === 'both') { delete confirmedWeb.parallel; delete confirmedWeb.official; }
        }
      }
    }
    return synchronized;
  })().finally(() => { webNotification = null; });
  return webNotification;
}
