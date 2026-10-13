import { db, supabase, supabaseKey } from '../db';
import { rates, history } from '../state';
import { appConfig } from '../config';
import { HistoryPoint, PriceChangeLog, RateMap, AppConfig } from '../types';
import { isSignificantChange, METAL_IDS } from '../utils/helpers';
import { updateStats } from './reporting.service';
import { addLog } from '../utils/logger';

export let lastRatesFetchTime = 0;
export const RATES_CACHE_TTL = 30 * 1000; // 30 seconds

export let lastHistoryFetchTime = 0;
export const HISTORY_CACHE_TTL = 60 * 1000; // 1 minute
export let cachedHistory: HistoryPoint[] | null = null;

export const recentChangesLog: PriceChangeLog[] = [];

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
      if (!isManual && entry.time < lastTime) continue;
      const oldVal = candidate.parallel[term.id];
      const maxDeviation = term.id === 'TND' || term.id === 'EGP' ? 1 : 0.25;
      if (!isManual && oldVal > 0 && Math.abs(entry.value - oldVal) / oldVal > maxDeviation) {
        await logErrorArabic('تم رفض قفزة غير منطقية في سعر ' + term.id, 'حماية البيانات');
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

export async function downsampleTable(tableName: string) {
  try {
    if (!supabase || !['parallel_rates', 'official_rates'].includes(tableName)) return;
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await supabase.from(tableName)
      .select('id, recorded_at, usd, rates').lt('recorded_at', cutoff)
      .order('recorded_at', { ascending: true }).limit(10000);
    if (error || !data?.length) return;
    const days = new Map<string, any[]>();
    for (const row of data) {
      const day = String(row.recorded_at).split('T')[0];
      days.set(day, [...(days.get(day) || []), row]);
    }
    const finalDay = String(data[data.length - 1].recorded_at).split('T')[0];
    const ids: any[] = [];
    for (const [day, rows] of days) {
      // The final day may be truncated by the query limit or cutoff.
      if (day === finalDay || rows.length <= 4) continue;
      const keep = new Set([rows[0].id, rows[rows.length - 1].id]);
      const codes = new Set(rows.flatMap(row => Object.keys(row.rates || {})));
      codes.add('USD');
      for (const code of codes) {
        const points = rows.filter(row => Number.isFinite(code === 'USD' ? row.usd : row.rates?.[code]));
        if (!points.length) continue;
        const value = (row: any) => code === 'USD' ? row.usd : row.rates[code];
        keep.add(points.reduce((a, b) => value(a) < value(b) ? a : b).id);
        keep.add(points.reduce((a, b) => value(a) > value(b) ? a : b).id);
      }
      for (const row of rows) if (!keep.has(row.id)) ids.push(row.id);
    }
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from(tableName).delete().in('id', ids.slice(i, i + 200));
      if (error) throw error;
    }
    if (ids.length) console.log(`[Cleanup] Downsampled ${tableName}: ${ids.length} redundant rows.`);
  } catch (err) { console.error(`[Cleanup] Error downsampling ${tableName}:`, err); }
}

export const cleanupOldData = async (onUserLogsCleanup?: () => void) => {
  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return;
  
  try {
    console.log("Running scheduled database cleanup...");
    
    await downsampleTable('parallel_rates');
    await downsampleTable('official_rates');
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff30 = thirtyDaysAgo.toISOString();

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const cutoff1 = oneDayAgo.toISOString();

    const [legacyRes, parallelRes, officialRes, metalRes, logsRes, changesRes] = await Promise.all([
      supabase.from('exchange_rates').delete({ count: 'exact' }).lt('recorded_at', cutoff30),
      supabase.from('parallel_rates').delete({ count: 'exact' }).lt('recorded_at', cutoff30),
      supabase.from('official_rates').delete({ count: 'exact' }).lt('recorded_at', cutoff30),
      supabase.from('metal_rates').delete({ count: 'exact' }).lt('recorded_at', cutoff30),
      supabase.from('error_logs').delete({ count: 'exact' }).lt('created_at', cutoff1),
      supabase.from('price_changes_log').delete({ count: 'exact' }).lt('created_at', cutoff1)
    ]);

    const removedRates = (legacyRes.count || 0) + (parallelRes.count || 0) + (officialRes.count || 0) + (metalRes.count || 0);
    const removedLogs = logsRes.count || 0;
    const removedChanges = changesRes.count || 0;

    const errors = [legacyRes.error, parallelRes.error, officialRes.error, metalRes.error, logsRes.error, changesRes.error]
      .filter(err => err && err.code !== '42P01');

    if (errors.length > 0) {
      console.error("Cleanup partial error:", { 
        legacy: legacyRes.error?.message, 
        parallel: parallelRes.error?.message, 
        official: officialRes.error?.message, 
        metal: metalRes.error?.message,
        logs: logsRes.error?.message,
        changes: changesRes.error?.message
      });
    }

    console.log(`Database cleanup completed. Removed ${removedRates} rates (older than 30 days), ${removedLogs} logs, and ${removedChanges} price changes (older than 1 day).`);
    
    if (onUserLogsCleanup) {
      onUserLogsCleanup();
    }
  } catch (error) {
    console.error("Failed to run database cleanup:", error);
  }
};

/**
 * Notifies the Web Server that rates have been updated in Supabase.
 * The Web Server will then reload rates and broadcast to Socket.IO clients.
 */
let webNotification: Promise<boolean> | null = null;
let notificationPending = false;
let notificationSnapshot: typeof rates | undefined;
let notificationMarket: 'parallel' | 'official' | 'both' = 'both';
let confirmedWebRevision = '';
let confirmedParallelRevision = '';
let confirmedOfficialRevision = '';
let confirmedWebAt = 0;
let failedWebRevision = '';
let failedWebAt = 0;
function webRevision(snapshot: typeof rates) {
  return JSON.stringify([snapshot.lastUpdated, snapshot.parallel.USD || null,
    snapshot.parallel.EUR || null, snapshot.official.USD || null, snapshot.official.EUR || null]);
}
function parallelRevision(snapshot: typeof rates) {
  return JSON.stringify([Number(snapshot.parallel?.USD) || null, Number(snapshot.parallel?.EUR) || null]);
}
function officialRevision(snapshot: typeof rates) {
  return JSON.stringify([Number(snapshot.official?.USD) || null, Number(snapshot.official?.EUR) || null]);
}

export async function ensureWebRatesReady(market: 'parallel' | 'official' | 'both' = 'both'): Promise<boolean> {
  const snapshot = structuredClone(rates), revision = webRevision(snapshot);
  if (confirmedWebRevision === revision && Date.now() - confirmedWebAt < 30000) return true;
  if (market === 'parallel' && confirmedParallelRevision === parallelRevision(snapshot) && Date.now() - confirmedWebAt < 30000) return true;
  if (market === 'official' && confirmedOfficialRevision === officialRevision(snapshot) && Date.now() - confirmedWebAt < 30000) return true;
  if (failedWebRevision === revision && Date.now() - failedWebAt < 30000) return false;
  const synchronized = await notifyWebServers(snapshot, market);
  return synchronized && (
    confirmedWebRevision === revision ||
    (market === 'parallel' && Number(rates.parallel.USD) > 0) ||
    (market === 'official' && Number(rates.official.USD) > 0)
  ) && (
    webRevision(rates) === revision ||
    (market === 'parallel' && Number(rates.parallel.USD) > 0) ||
    (market === 'official' && Number(rates.official.USD) > 0)
  );
}

export function notifyWebServers(snapshot?: typeof rates, market: 'parallel' | 'official' | 'both' = 'both'): Promise<boolean> {
  const webUrl = (process.env.WEB_SERVER_URL || '').trim();
  const secret = (process.env.WORKER_INTERNAL_SECRET || '').trim();
  if (!webUrl || !secret) return Promise.resolve(false);
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
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(`${webUrl.replace(/\/$/, '')}/api/internal/notify-rates-updated${expected ? '?wait=true' : ''}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': secret, 'User-Agent': 'Dollar-Price-Worker/1.0' },
            signal: AbortSignal.timeout(expected ? 20000 : 5000)
          });
          if (response.ok) {
            if (expected) {
              const result: any = await response.json();
              const matchesRate = (actual: any, exp: any): boolean => {
                if (actual == null && exp == null) return true;
                if (actual == null || exp == null) return false;
                const a = Number(actual), e = Number(exp);
                if (isNaN(a) || isNaN(e)) return String(actual).trim() === String(exp).trim();
                return Math.abs(a - e) < 0.005;
              };
              const parallelMatches = matchesRate(result.parallel?.USD, expected.parallel.USD) &&
                (!expected.parallel.EUR || matchesRate(result.parallel?.EUR, expected.parallel.EUR));
              const officialMatches = matchesRate(result.official?.USD, expected.official.USD) &&
                (!expected.official?.EUR || matchesRate(result.official?.EUR, expected.official.EUR));
              const resTime = Date.parse(result.lastUpdated);
              const expTime = Date.parse(expected.lastUpdated);
              const isTimestampValid = !isNaN(resTime) && !isNaN(expTime) && (resTime >= expTime - 5000);
              const timeConfirmed = expectedMarket === 'official' ? (isTimestampValid || officialMatches) : expectedMarket === 'parallel' ? (isTimestampValid || parallelMatches) : (isTimestampValid || (parallelMatches && officialMatches));
              if (result.status !== 'synchronized' ||
                  !timeConfirmed ||
                  (expectedMarket !== 'official' && !parallelMatches) ||
                  (expectedMarket !== 'parallel' && !officialMatches)) {
                throw new Error('Web has not confirmed the saved prices and preview');
              }
              const marketConfirmed = expectedMarket === 'official' ? officialMatches : expectedMarket === 'parallel' ? parallelMatches : (parallelMatches && officialMatches);
              confirmedWebRevision = marketConfirmed ? webRevision(expected) : '';
              if (parallelMatches) confirmedParallelRevision = parallelRevision(expected);
              if (officialMatches) confirmedOfficialRevision = officialRevision(expected);
              confirmedWebAt = Date.now();
              failedWebRevision = '';
            }
            synchronized = true;
            break;
          }
          if (response.status < 500 && ![408, 429].includes(response.status)) {
            console.error('[Notify] Web rejected update notification:', response.status);
            break;
          }
          throw new Error('HTTP ' + response.status);
        } catch (err: any) {
          if (attempt === 2) console.error('[Notify] Web notification failed after 3 attempts:', err.message);
          else await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
      if (expected && !synchronized) {
        failedWebRevision = webRevision(expected);
        failedWebAt = Date.now();
        confirmedWebRevision = '';
      }
    }
    return synchronized;
  })().finally(() => { webNotification = null; });
  return webNotification;
}
