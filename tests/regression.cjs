const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { fixture, fakeSupabase, noopDb, cblHtml } = require('./fixtures.cjs');
const tests = [];
const test = (name, run) => tests.push({ name, run });
function dbService(f, perform = () => ({ data: [], error: null }), extra = {}) {
  return f.load('server/services/db.service.ts', {
    '../db': { db: noopDb, supabase: fakeSupabase(perform), supabaseKey: 'fixture' },
    '../state': { rates: f.rates, history: [] }, '../config': { appConfig: f.config },
    '../utils/helpers': f.helper, './reporting.service': { updateStats() {} }, '../utils/logger': { addLog() {} }
  }, extra);
}
function scraper(f, db, social = {}, fetch = async () => { throw Error('Unexpected fetch'); }, storage = { db: noopDb, supabase: null }, config = { appConfig: f.config, refreshExtractionTerms: async () => {} }, extra = {}) {
  return f.load('server/services/scraper.service.ts', {
    '../state': { rates: f.rates, history: [] }, '../config': config,
    '../db': storage, './db.service': db,
    './ai.service': { extractRatesWithAI: async () => [] },
    './social.service': { broadcastOfficialRates: async () => true, broadcastRateChanges: async () => {},
      lastBroadcastState: {}, getOrInitTelegramManager: () => null, lastOfficialBroadcastDate: '', ...social },
    '../../telegramClient': { fetchPublicChannelMessages: async () => [] },
    '../utils/helpers': f.helper, './reporting.service': { updateStats() {} }, './ingestion.service': { recordIngestion() {} }
  }, { fetch, ...extra });
}
function socialFixture(f, options = {}) {
  const counts = { telegram: 0, facebook: 0 };
  let failFB = true, failTG = false, delayed;
  const checkpoints = new Map();
  const db = { ...noopDb, prepare: sql => ({
    run: (key, value) => { if (sql.includes('server_config')) checkpoints.set(key, value); },
    get: key => checkpoints.has(key) ? { value: checkpoints.get(key) } : undefined, all: () => []
  }) };
  const mocks = {
    '../../telegramClient': { getTelegramManager: () => ({
      sendMessage: async () => { counts.telegram++; return delayed ? await delayed : !failTG; }, lastError: 'Fixture TG failure'
    }) },
    '../config': { appConfig: f.config, setTelegramManager() {} }, '../state': { rates: f.rates },
    '../db': { db, supabase: null, supabaseKey: '' }, './broadcastLog.service': { addBroadcastLog() {} },
    '../utils/helpers': { ...f.helper, delay: async () => {} }
  };
  const extra = { fetch: async url => {
    assert.ok(url.startsWith('https://graph.facebook.com/'));
    if (url.endsWith('/comments')) return { json: async () => ({ id: 'fixture-comment' }) };
    counts.facebook++;
    return { json: async () => failFB ? { error: { code: 190, message: 'Fixture FB failure' } } : { id: 'fixture-post' } };
  } };
  return { social: f.load('server/services/social.service.ts', mocks, extra), counts, checkpoints,
    restore: () => f.load('server/services/social.service.ts', mocks, extra),
    failFB: v => { failFB = v; }, failTG: v => { failTG = v; }, delayTG: p => { delayed = p; } };
}
const update = { id: 'USD', name: 'Dollar', flag: 'us', oldVal: 9.7, newVal: 9.8 };
test('Database failure cannot commit RAM, history or publish; same price can retry', async () => {
  const f = fixture(); let fail = true, inserts = 0, publications = 0;
  const db = dbService(f, query => {
    if (query.table === 'parallel_rates' && query.op === 'insert') { inserts++; return { error: fail ? { message: 'fixture failure' } : null }; }
    return { data: [], error: null };
  });
  const source = scraper(f, db, { broadcastRateChanges: async () => { publications++; } });
  assert.equal((await source.processWhatsAppMessage('fixture', 'USD 9.80', f.now())).processed, false);
  assert.equal(f.rates.parallel.USD, 9.7); assert.equal(publications, 0);
  fail = false;
  assert.equal((await source.processWhatsAppMessage('fixture', 'USD 9.80', f.now())).processed, true);
  assert.equal(f.rates.parallel.USD, 9.8); assert.equal(publications, 1); assert.equal(inserts, 2);
  await source.processWhatsAppMessage('fixture', 'USD 9.80', f.now()); assert.equal(inserts, 2);
});
test('Older, invalid, future and anomalous source prices cannot overwrite newer prices', async () => {
  const f = fixture(), db = dbService(f);
  const entry = (value, time) => [{ code: 'USD', value, time, source: 'fixture' }];
  await db.commitParallelRates(entry(9.8, f.now()));
  await db.commitParallelRates(entry(9.7, f.now() - 1)); assert.equal(f.rates.parallel.USD, 9.8);
  f.advance(60000); await db.commitParallelRates(entry(9.8, f.now()));
  await db.commitParallelRates(entry(9.7, f.now() - 30000)); assert.equal(f.rates.parallel.USD, 9.8);
  for (const value of [NaN, Infinity, -1, 19]) await db.commitParallelRates(entry(value, f.now()));
  await db.commitParallelRates(entry(9.9, f.now() + 3600000)); assert.equal(f.rates.parallel.USD, 9.8);
  await db.commitParallelRates(entry(19, f.now()), true); assert.equal(f.rates.parallel.USD, 19);
});
test('Primary save stays successful if compatibility history copy fails', async () => {
  const f = fixture();
  const db = dbService(f, q => ({ error: q.table === 'exchange_rates' ? { message: 'fixture auxiliary failure' } : null }));
  assert.equal(await db.saveToSupabase('parallel'), true);
});
test('Concurrent price writes serialize and preserve both currencies', async () => {
  const f = fixture(), db = dbService(f);
  await Promise.all(['USD', 'EUR'].map((code, i) => db.commitParallelRates([{
    code, value: i ? 10.6 : 9.8, time: f.now(), source: 'fixture'
  }])));
  assert.equal(f.rates.parallel.USD, 9.8); assert.equal(f.rates.parallel.EUR, 10.6);
});
test('Partial delivery retains failed platform, survives restore, never repeats Telegram', async () => {
  const f = fixture(), env = socialFixture(f), s = env.social;
  await assert.rejects(s.broadcastRateChanges([update], false, 'all', true));
  assert.equal(s.smartBroadcastQueue.size, 1);
  assert.equal(s.smartBroadcastQueue.get('USD').delivered.telegram, true);
  assert.ok(s.smartBroadcastQueue.get('USD').lastError);
  const restored = env.restore(); await restored.loadBroadcastQueueState();
  env.failFB(false);
  assert.equal((await restored.flushBroadcastQueueImmediately('all', true)).success, true);
  assert.equal(restored.smartBroadcastQueue.size, 0); assert.equal(env.counts.telegram, 1);
});
test('Price queued during in-flight publishing is retained and sent later', async () => {
  const f = fixture(), env = socialFixture(f), s = env.social;
  f.config.facebookAutoPost = false;
  await s.broadcastRateChanges([update]);
  let release; env.delayTG(new Promise(resolve => { release = resolve; }));
  const send = s.flushBroadcastQueueImmediately('telegram', true);
  await Promise.resolve(); await s.broadcastRateChanges([{ ...update, newVal: 9.9 }]);
  release(true); await send;
  assert.equal(s.smartBroadcastQueue.get('USD').newVal, 9.9);
  env.delayTG(null); await s.flushBroadcastQueueImmediately('telegram', true);
  assert.equal(s.smartBroadcastQueue.size, 0); assert.equal(env.counts.telegram, 2);
});
test('Exhausted retries retain failed items but do not block unrelated new currencies', async () => {
  const f = fixture(), env = socialFixture(f), s = env.social;
  f.config.facebookAutoPost = false;
  s.smartBroadcastQueue.set('USD', { ...update, firstSeenAt: f.now(), lastSeenAt: f.now(),
    targets: ['telegram'], lastError: 'fixture blocked', attempts: { telegram: 4 } });
  await s.broadcastRateChanges([{ id: 'EUR', name: 'Euro', flag: 'eu', oldVal: 10.5, newVal: 10.7 }]);
  await s.processSmartBroadcastQueue();
  assert.equal(s.smartBroadcastQueue.has('USD'), true); assert.equal(s.smartBroadcastQueue.has('EUR'), false);
  assert.equal(env.counts.telegram, 1);
});
test('Official bulletin only completes when all enabled platforms deliver; Facebook-only works', async () => {
  const f = fixture(), env = socialFixture(f), s = env.social;
  assert.equal(await s.broadcastOfficialRates(false), false); assert.equal(s.lastOfficialBroadcastDate, '');
  env.failFB(false); f.advance(30001);
  assert.equal(await s.broadcastOfficialRates(false), true); assert.equal(env.counts.telegram, 1);
  assert.equal(s.lastOfficialBroadcastDate, '2026-10-12');
  const another = fixture(); another.config.telegramAutoPost = false;
  const fb = socialFixture(another); fb.failFB(false);
  assert.equal(await fb.social.broadcastOfficialRates(false), true); assert.equal(fb.counts.telegram, 0);
});
test('WhatsApp discovery does not process disabled or unlisted chats, global toggle is unified', async () => {
  const f = fixture(); let calls = 0, enabled = true;
  const source = { get isWhatsAppFetchEnabled() { return enabled; },
    setWhatsAppFetchEnabled: v => { enabled = v; },
    processWhatsAppMessage: async () => { calls++; return { processed: true, extractedCount: 1 }; } };
  const wa = f.load('server/services/whatsapp.service.ts', {
    '@whiskeysockets/baileys': {}, qrcode: {}, pino: () => ({}), fs: { existsSync: () => true },
    '../db': { db: noopDb, supabase: null }, '../config': { appConfig: f.config },
    './scraper.service': source, './db.service': { logErrorArabic: async () => {} }
  });
  for (const jid of ['allowed@g.us', 'disabled@g.us', 'unknown@s.whatsapp.net']) {
    await wa.whatsappManager.handleIncomingMessage({ key: { remoteJid: jid, fromMe: false },
      message: { conversation: 'USD 9.80' }, messageTimestamp: f.now() / 1000 });
  }
  assert.equal(calls, 1);
  wa.whatsappManager.setAutoProcess(false); assert.equal(wa.whatsappManager.getStatus().autoProcessEnabled, false);
});
test('SQLite ingestion stores real observations without synthetic startup prices', async () => {
  const f = fixture(), sqlite = new Database(':memory:');
  try {
    const ingestion = f.load('server/services/ingestion.service.ts', { '../db': { db: sqlite } });
    assert.equal(sqlite.prepare('SELECT count(*) n FROM ingested_messages').get().n, 0);
    ingestion.recordIngestion({ source: 'fixture', platform: 'whatsapp', timestamp: new f.Clock().toISOString(),
      rawText: 'USD 9.80', status: 'extracted', extractedRates: [{ code: 'USD', value: 9.8 }] });
    assert.equal(sqlite.prepare('SELECT count(*) n FROM ingested_messages').get().n, 1);
  } finally { sqlite.close(); }
});
test('Downsampling preserves open, close and EUR extremes; incomplete final day is untouched', async () => {
  const f = fixture(), deleted = [];
  const data = Array.from({ length: 8 }, (_, i) => ({ id: i, usd: 9.7,
    recorded_at: '2026-09-30T0' + i + ':00:00Z', rates: { USD: 9.7, EUR: i === 2 ? 12 : i === 4 ? 8 : 10 } }));
  data.push({ id: 8, usd: 9.7, recorded_at: '2026-10-01T00:00:00Z', rates: { EUR: 10 } });
  const db = dbService(f, q => {
    if (q.op === 'delete') deleted.push(...q.args.in[1]);
    return { data, error: null };
  });
  await db.downsampleTable('parallel_rates');
  assert.ok(deleted.length > 0); for (const id of [0, 2, 4, 7, 8]) assert.ok(!deleted.includes(id));
});
test('Actual CBL job rejects stale/missing dates and commits only after saving in the morning window', async () => {
  for (const date of [null, '2026-10-11', '2026-10-12']) {
    const f = fixture(); let saves = 0, publish = 0;
    f.advance(-3 * 3600000);
    const db = { logErrorArabic: async () => {}, saveWorkerStateToSupabase: async () => {},
      saveToSupabase: async () => { saves++; return date === '2026-10-12'; } };
    const s = scraper(f, db, { broadcastOfficialRates: async () => { publish++; return true; } },
      async () => ({ ok: true, text: async () => cblHtml(date) }));
    const result = await s.fetchOfficialRates();
    assert.equal(result, date === '2026-10-12');
    assert.equal(saves, date === '2026-10-12' ? 1 : 0); assert.equal(publish, date === '2026-10-12' ? 1 : 0);
  }
  const f = fixture();
  f.advance(-3 * 3600000);
  const s = scraper(f, { logErrorArabic: async () => {}, saveToSupabase: async () => false },
    {}, async () => ({ ok: true, text: async () => cblHtml('2026-10-12') }));
  assert.equal(await s.fetchOfficialRates(), false); assert.equal(f.rates.official.USD, 6.4);
  assert.equal(s.lastOfficialFetchDate, '');
});
test('CBL enforces Tripoli 09:00 <= time < 11:00, even for forced manual requests', async () => {
  for (const [time, allowed] of [['06:59:59', false], ['07:00:00', true], ['08:59:59', true], ['09:00:00', false], ['10:00:00', false]]) {
    const f = fixture(); f.advance(Date.parse('2026-10-12T' + time + 'Z') - f.now());
    let fetches = 0;
    const s = scraper(f, { saveToSupabase: async () => true, saveWorkerStateToSupabase: async () => {} }, {},
      async () => { fetches++; return { ok: true, text: async () => cblHtml('2026-10-12') }; });
    assert.equal(s.getCblStatusInfo().isInActiveWindow, allowed);
    assert.equal(await s.fetchOfficialRates(true, true), allowed);
    assert.equal(fetches, allowed ? 1 : 0);
    if (allowed) { await s.fetchOfficialRates(true, true); assert.equal(fetches, 1, 'No same-day forced re-fetch'); }
  }
});
test('CBL stops retries and discards responses crossing the 11:00 boundary', async () => {
  const f = fixture(); f.advance(Date.parse('2026-10-12T08:59:59Z') - f.now());
  let fetches = 0, saves = 0;
  const s = scraper(f, { saveToSupabase: async () => { saves++; return true; } }, {},
    async () => { fetches++; f.advance(2000); return { ok: true, text: async () => cblHtml('2026-10-12') }; });
  assert.equal(await s.fetchOfficialRates(), false); assert.equal(fetches, 1); assert.equal(saves, 0);
  await s.fetchOfficialRates(); assert.equal(fetches, 1);
});
test('CBL restart consults saved official rows even when the daily marker is stale', async () => {
  const entry = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server/worker.ts'), 'utf8');
  assert(!entry.includes('await fetchOfficialRates('), 'Startup must load saved official prices, not fetch CBL');
  const f = fixture(); f.advance(-3 * 3600000); let fetches = 0;
  const storage = { db: noopDb, supabase: fakeSupabase(q => ({ data: q.table === 'official_rates'
    ? [{ recorded_at: '2026-10-12T07:00:00Z' }]
    : q.args.eq?.[1] === 'last_official_fetch_date' ? { value: '2026-10-11' } : null, error: null })) };
  for (let restart = 0; restart < 2; restart++) {
    const s = scraper(f, {}, {}, async () => { fetches++; throw Error('CBL should not be called'); }, storage);
    await s.loadCblStateFromSupabase(); assert.equal(s.lastOfficialFetchDate, '2026-10-12');
    assert.equal(await s.fetchOfficialRates(true, true), false);
  }
  assert.equal(fetches, 0);
});
test('CBL cannot re-fetch when persisted daily state is temporarily unreadable', async () => {
  const f = fixture(); f.advance(-3 * 3600000); let fetches = 0;
  const s = scraper(f, {}, {}, async () => { fetches++; throw Error('Unexpected CBL request'); }, {
    db: noopDb, supabase: fakeSupabase(q => ({ data: null, error: q.table === 'official_rates' ? { message: 'Fixture database outage' } : null }))
  });
  assert.equal(await s.fetchOfficialRates(), false); assert.equal(fetches, 0);
});
test('Missing optional server_config never blocks CBL; saved official rows still prevent daily duplicates', async () => {
  for (const code of ['PGRST205', '42P01']) {
    for (const manual of [false, true]) {
      for (const savedToday of [false, true]) {
        const f = fixture(); f.advance(-3 * 3600000);
        let fetches = 0, saves = 0;
        const s = scraper(f, { saveToSupabase: async () => { saves++; return true; }, saveWorkerStateToSupabase: async () => {} }, {},
          async () => { fetches++; return { ok: true, text: async () => cblHtml('2026-10-12') }; }, {
            db: noopDb, supabase: fakeSupabase(q => q.table === 'official_rates'
              ? { data: [{ recorded_at: (savedToday ? '2026-10-12' : '2026-10-11') + 'T07:00:00Z' }], error: null }
              : { data: null, error: { code, message: 'Optional table missing' } })
          });
        assert.equal(await s.fetchOfficialRates(manual, manual), !savedToday);
        assert.equal(fetches, savedToday ? 0 : 1); assert.equal(saves, savedToday ? 0 : 1);
        await s.fetchOfficialRates(manual, manual);
        assert.equal(fetches, savedToday ? 0 : 1, 'Saved-row checkpoint prevents a second fetch');
      }
    }
  }
  const f = fixture(); f.advance(-3 * 3600000);
  const disabledDb = { ...noopDb, prepare: () => ({ get: key => key === 'cbl_fetch_enabled' ? { value: 'false' } : undefined }) };
  const s = scraper(f, {}, {}, async () => { throw new Error('Disabled CBL must not fetch'); }, {
    db: disabledDb, supabase: fakeSupabase(q => q.table === 'official_rates'
      ? { data: [], error: null } : { data: null, error: { code: 'PGRST205' } })
  });
  await s.loadCblStateFromSupabase();
  assert.equal(s.getCblStatusInfo().enabled, false); assert.equal(await s.fetchOfficialRates(), false);
});

test('Saved official prices use actual database save time', async () => {
  const f = fixture(); f.advance(-3 * 3600000); let saved;
  const db = dbService(f, q => { if (q.table === 'official_rates' && q.op === 'insert') saved = q.args.insert[0][0]; return { data: [], error: null }; });
  assert.equal(await db.saveToSupabase('official'), true);
  assert.equal(saved.recorded_at, new Date(f.now()).toISOString());
});
test('Web app_config extraction rules override defaults, preserve removals and update with bounded reads', async () => {
  const f = fixture(); let reads = 0, outage = false;
  let terms = [{ id: 'USD', name: 'Custom USD', regex: 'CUSTOM\\s+(\\d+\\.\\d+)', min: 9.7, max: 9.9, isInverse: false, flag: 'us' }];
  const config = f.load('server/config.ts', {
    '../telegramClient': {}, './db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(q => {
      assert.equal(q.op, 'select', 'Loading rules must not write to shared configuration');
      if (q.table === 'app_config') { reads++; return { data: outage ? null : { config: { terms: structuredClone(terms), channels: ['fixture'] } }, error: outage ? { message: 'Fixture outage' } : null }; }
      return { data: null, error: null };
    }) }
  });
  await config.loadConfigFromSupabase();
  assert.equal(config.appConfig.terms.length, 1); assert.equal(config.appConfig.terms[0].regex, terms[0].regex);
  assert.equal(config.appConfig.terms[0].min, 9.7); assert.equal(config.appConfig.terms[0].max, 9.9);
  const extracted = [];
  const s = scraper(f, { commitParallelRates: async entries => { extracted.push(...entries); return []; }, logErrorArabic: async () => {} }, {}, undefined, undefined, config);
  assert.equal(s.extractRatesFromText('CUSTOM 9.80')[0].value, 9.8);
  assert.equal(s.extractRatesFromText('CUSTOM 9.60').length, 0);
  assert.equal(s.extractRatesFromText('USD 9.80').length, 0, 'No default regex silently restored');
  await s.processWhatsAppMessage('fixture', 'CUSTOM 9.80', f.now()); assert.equal(extracted[0].value, 9.8);
  await Promise.all([config.refreshExtractionTerms(), config.refreshExtractionTerms()]); assert.equal(reads, 1);
  terms[0].regex = 'NEW\\s+(\\d+\\.\\d+)'; terms[0].min = 10; terms[0].max = 11;
  f.advance(5 * 60000);
  await Promise.all([config.refreshExtractionTerms(), config.refreshExtractionTerms()]); assert.equal(reads, 2);
  assert.equal(s.extractRatesFromText('NEW 10.50')[0].value, 10.5);
  assert.equal(s.extractRatesFromText('CUSTOM 9.80').length, 0);
  const telegram = scraper(f, { commitParallelRates: async entries => { extracted.push(...entries); return []; }, logErrorArabic: async () => {} },
    { getOrInitTelegramManager: () => ({ fetchMessages: async () => [{ text: 'NEW 10.50', date: f.now() }] }) }, undefined, undefined, config,
    { process: { env: {}, memoryUsage: () => ({ rss: 0, heapUsed: 0 }) }, setTimeout: (fn, ms) => { if (ms === 250) queueMicrotask(fn); return {}; } });
  await telegram.fetchParallelRatesFromTelegram(); assert.equal(extracted.at(-1).value, 10.5);
  outage = true; f.advance(5 * 60000); await config.refreshExtractionTerms();
  assert.equal(s.extractRatesFromText('NEW 10.50')[0].value, 10.5, 'Keep the last loaded rules during a transient DB failure');
  const outageReads = reads; await config.refreshExtractionTerms(); assert.equal(reads, outageReads, 'Failed reads also obey the cooldown');
  outage = false;
  terms = []; f.advance(5 * 60000); await config.refreshExtractionTerms();
  assert.equal(config.appConfig.terms.length, 0, 'An empty configured list must stay empty');
  config.applyLoadedConfig({ ...config.appConfig, terms: [
    { id: 'USD', name: 'Inverse', regex: 'INV (\\d+)', min: 0.09, max: 0.11, isInverse: true },
    { id: 'BAD', regex: '[', min: 0, max: 1 }, { id: 'BAD_LIMIT', regex: '(1)', min: 5, max: 1 },
  ] }, 'fixture');
  assert.equal(config.appConfig.terms.length, 1); assert.equal(s.extractRatesFromText('INV 10')[0].value, 0.1);
});
test('Local extraction cache preserves configured removals across a Worker restart', async () => {
  const f = fixture(), sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE server_config(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE currency_terms(id TEXT PRIMARY KEY, name TEXT, regex TEXT, min REAL, max REAL, is_inverse INTEGER, flag TEXT, is_active INTEGER, updated_at TEXT);');
  const mocks = { '../telegramClient': {}, './db': { db: sqlite, supabase: null, supabaseKey: '' } };
  try {
    const config = f.load('server/config.ts', mocks);
    config.applyLoadedConfig({ ...config.appConfig, terms: [{ id: 'USD', name: 'Custom', regex: 'CUSTOM (\\d+)', min: 9, max: 10, isInverse: false, flag: 'us' }] }, 'fixture');
    config.syncTermsToDatabase(config.appConfig.terms);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM currency_terms WHERE is_active = 1').get().count, 1);
    sqlite.prepare('INSERT INTO server_config(key, value) VALUES (?, ?)').run('app_config', JSON.stringify(config.appConfig));
    sqlite.prepare("UPDATE currency_terms SET is_active = 1 WHERE id = 'EUR'").run();
    const restarted = f.load('server/config.ts', mocks);
    assert.equal(restarted.appConfig.terms.length, 1); assert.equal(restarted.appConfig.terms[0].regex, 'CUSTOM (\\d+)');
    assert.equal(sqlite.prepare('SELECT is_active FROM currency_terms WHERE id = ?').get('EUR').is_active, 0);
  } finally { sqlite.close(); }
});
test('Web loads and saves app_config without widening bounds, replacing regex or restoring removed currencies', async () => {
  if (!process.env.WEB_PROJECT_PATH) return;
  const f = fixture(); let saved;
  const terms = [{ id: 'USD', name: 'Custom dollar', regex: 'CUSTOM (\\d+)', min: 9.7, max: 9.9, isInverse: false, flag: 'us' },
    { id: 'GOLD_SCRAP_18', name: 'Custom gold', regex: 'METAL (\\d+)', min: 500, max: 600, isInverse: false, flag: 'gold' }];
  const config = f.load(require('node:path').join(process.env.WEB_PROJECT_PATH, 'server/config.ts'), {
    '../telegramClient': {}, './db': { db: noopDb, supabaseAnonKey: 'fixture', supabase: fakeSupabase(q => {
      if (q.op === 'upsert') saved = q.args.upsert[0].config;
      return { data: { config: { terms: structuredClone(terms), channels: ['fixture'] } }, error: null };
    }) }
  });
  await config.loadConfigFromSupabase();
  assert.equal(config.appConfig.terms.length, 2);
  for (let i = 0; i < terms.length; i++) {
    assert.equal(config.appConfig.terms[i].regex, terms[i].regex);
    assert.equal(config.appConfig.terms[i].min, terms[i].min);
    assert.equal(config.appConfig.terms[i].max, terms[i].max);
    assert.equal(config.appConfig.terms[i].name, terms[i].name);
  }
  assert.equal(await config.saveConfigToSupabase(config.appConfig), true);
  assert.equal(saved.terms[0].regex, terms[0].regex); assert.equal(saved.terms.length, 2);
  config.applyLoadedConfig({ ...config.appConfig, terms: [] }, 'fixture'); assert.equal(config.appConfig.terms.length, 0);
});
test('Cold Worker starts without invented prices or history and accepts the first real source observation', async () => {
  const f = fixture(), state = f.load('server/state.ts');
  assert.equal(Object.keys(state.rates.parallel).length, 0); assert.equal(state.history.length, 0);
  Object.assign(f.rates, state.rates);
  const db = dbService(f);
  await db.commitParallelRates([{ code: 'USD', value: 9.8, time: f.now() - 60000, source: 'fixture' }]);
  assert.equal(f.rates.parallel.USD, 9.8); assert.equal(f.rates.parallel.EUR, undefined);
  const env = socialFixture(f); assert.equal(await env.social.broadcastOfficialRates(false), false);
});
test('WhatsApp backs up changed session keys privately; never overwrites newer local credentials', async () => {
  const f = fixture(), path = require('node:path');
  const files = { 'creds.json': '{"registered":true}', 'session-fixture.json': '{"key":"A"}', 'pre-key-old.json': '{}' };
  const uploads = [];
  const disk = { existsSync: name => path.basename(name) === 'whatsapp_auth' || Object.hasOwn(files, path.basename(name)),
    readdirSync: () => Object.keys(files), statSync: () => ({ isFile: () => true }),
    readFileSync: name => files[path.basename(name)], writeFileSync: (name, value) => { files[path.basename(name)] = value; },
    mkdirSync() {}, unlinkSync: name => { delete files[path.basename(name)]; } };
  const wa = f.load('server/services/whatsapp.service.ts', {
    '@whiskeysockets/baileys': {}, qrcode: {}, pino: () => ({}), fs: disk,
    '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(q => {
      assert.equal(q.table, 'server_config');
      if (q.op === 'upsert') uploads.push(q.args.upsert[0]);
      return { data: { value: '{}' }, error: null };
    }) }, '../config': { appConfig: f.config }, './scraper.service': {},
    './db.service': { logErrorArabic: async () => {} }
  });
  await wa.backupAuthToStorage(); files['session-fixture.json'] = '{"key":"B"}';
  await wa.backupAuthToStorage(); await wa.backupAuthToStorage();
  assert.equal(uploads.length, 2); assert.equal(uploads[0].key, 'worker_whatsapp_auth');
  assert.equal(JSON.parse(uploads[1].value)['session-fixture.json'], '{"key":"B"}');
  assert.ok(files['pre-key-old.json']); assert.equal(await wa.restoreAuthFromStorage(), true);
  assert.equal(files['session-fixture.json'], '{"key":"B"}');
  await wa.whatsappManager.disconnect();
  assert.equal(uploads.at(-1).value, '{}'); assert.equal(await wa.restoreAuthFromStorage(), false);
});
test('Invalid cloud session filenames cannot escape the Worker authentication folder', async () => {
  const f = fixture(), path = require('node:path'); let writes = 0;
  const wa = f.load('server/services/whatsapp.service.ts', {
    '@whiskeysockets/baileys': {}, qrcode: {}, pino: () => ({}),
    fs: { existsSync: name => path.basename(name) !== 'creds.json', writeFileSync: () => { writes++; } },
    '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(() => ({
      data: { value: JSON.stringify({ 'creds.json': '{}', '../escape.json': '{}' }) }, error: null
    })) }, '../config': { appConfig: f.config }, './scraper.service': {},
    './db.service': { logErrorArabic: async () => {} }
  });
  assert.equal(await wa.restoreAuthFromStorage(), false); assert.equal(writes, 0);
});
test('WhatsApp logout reports cloud cleanup failure, clears local keys and preserves a restart tombstone', async () => {
  const f = fixture(), path = require('node:path'), sqlite = new Database(':memory:');
  const files = { 'creds.json': '{}', 'session-fixture.json': '{}' };
  sqlite.exec('CREATE TABLE whatsapp_auth(filename TEXT PRIMARY KEY, content TEXT); CREATE TABLE server_config(key TEXT PRIMARY KEY, value TEXT);');
  const disk = { existsSync: name => path.basename(name) === 'whatsapp_auth' || Object.hasOwn(files, path.basename(name)),
    readdirSync: () => Object.keys(files), unlinkSync: name => { delete files[path.basename(name)]; } };
  const mocks = {
    '@whiskeysockets/baileys': {}, qrcode: {}, pino: () => ({}), fs: disk,
    '../db': { db: sqlite, supabaseKey: 'fixture', supabase: fakeSupabase(q => q.op === 'upsert' ?
      { error: { message: 'fixture cloud failure' } } : { data: { value: '{"creds.json":"{}"}' }, error: null }) },
    '../config': { appConfig: f.config }, './scraper.service': {}, './db.service': { logErrorArabic: async () => {} }
  };
  try {
    const wa = f.load('server/services/whatsapp.service.ts', mocks);
    await assert.rejects(wa.whatsappManager.disconnect(), /cleanup was not confirmed/);
    assert.equal(Object.keys(files).length, 0);
    assert.equal(sqlite.prepare('SELECT value FROM server_config WHERE key = ?').get('whatsapp_session_backup').value, '{}');
    assert.equal(await wa.restoreAuthFromStorage(), false);
    const restarted = f.load('server/services/whatsapp.service.ts', mocks);
    assert.equal(await restarted.restoreAuthFromStorage(), false);
    assert.ok(wa.whatsappManager.getStatus().lastError.includes('cleanup was not confirmed'));
  } finally { sqlite.close(); }
});
test('Private cloud session restoration never copies keys back into shared application configuration', async () => {
  const f = fixture(), path = require('node:path'), files = {};
  const wa = f.load('server/services/whatsapp.service.ts', {
    '@whiskeysockets/baileys': {}, qrcode: {}, pino: () => ({}),
    fs: { existsSync: name => path.basename(name) === 'whatsapp_auth' || Object.hasOwn(files, path.basename(name)),
      readFileSync: name => files[path.basename(name)],
      writeFileSync: (name, value) => { files[path.basename(name)] = value; } },
    '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(() => ({
      data: { value: JSON.stringify({ 'creds.json': '{"registered":true}', 'session-fixture.json': '{}' }) }, error: null
    })) }, '../config': { appConfig: f.config }, './scraper.service': {},
    './db.service': { logErrorArabic: async () => {} }
  });
  assert.equal(await wa.restoreAuthFromStorage(), true); assert.ok(files['creds.json']);
  assert.equal(f.config.whatsappAuth, undefined); assert.equal(wa.hasSavedSession(), true);
});
test('WhatsApp pairing persists immediately; ephemeral restart restores keys and reconnects without QR', async () => {
  const f = fixture(), path = require('node:path');
  let files = {}, cloud, uploads = 0, cloudFailure = false, socket, state;
  const timers = new Map(); let nextTimer = 0;
  const disk = {
    existsSync: name => path.basename(name) === 'whatsapp_auth' || Object.hasOwn(files, path.basename(name)),
    readdirSync: () => Object.keys(files), statSync: () => ({ isFile: () => true }), mkdirSync() {},
    readFileSync: name => files[path.basename(name)],
    writeFileSync: (name, value) => { files[path.basename(name)] = value; },
    unlinkSync: name => { delete files[path.basename(name)]; }
  };
  const load = () => f.load('server/services/whatsapp.service.ts', {
    '@whiskeysockets/baileys': {
      default: options => {
        state = options.auth;
        const handlers = {};
        socket = { ev: { on: (name, fn) => { handlers[name] = fn; }, removeAllListeners: name => { delete handlers[name]; } },
          user: { id: 'fixture:1', name: 'Fixture' }, end: () => handlers['connection.update']?.({ connection: 'close' }),
          emit: async (name, value) => handlers[name]?.(value) };
        return socket;
      }, DisconnectReason: {}, fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
      useMultiFileAuthState: async () => {
        const creds = JSON.parse(files['creds.json'] || '{"registered":false}');
        return { state: { creds, keys: { get: async () => ({}), set: async data => {
          for (const [name, value] of Object.entries(data)) files[name + '.json'] = JSON.stringify(value);
        } } }, saveCreds: async () => { files['creds.json'] = JSON.stringify(creds); } };
      }
    }, qrcode: {}, pino: () => ({}), fs: disk,
    '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(q => {
      if (cloudFailure) return { error: { code: 'UNAVAILABLE' } };
      if (q.op === 'upsert') { cloud = q.args.upsert[0].value; uploads++; return { error: null }; }
      return cloud ? { data: { value: cloud }, error: null } : { error: { code: 'PGRST116' } };
    }) }, '../config': { appConfig: f.config }, './scraper.service': {}, './db.service': { logErrorArabic: async () => {} }
  }, {
    setTimeout: (fn, ms) => { const timer = { id: ++nextTimer, unref() {} }; timers.set(timer, { fn, ms }); return timer; },
    clearTimeout: timer => timers.delete(timer)
  });
  let wa = load(); await wa.whatsappManager.initClient();
  assert.equal(state.creds.registered, false);
  state.creds.registered = true;
  await socket.emit('creds.update', {});
  assert.equal(uploads, 1, 'pairing must persist without waiting for the debounce');
  await socket.emit('connection.update', { connection: 'open' });
  await state.keys.set({ 'session-123@s.whatsapp.net': { key: 'new-key' } });
  const backupTimer = [...timers].find(([, value]) => value.ms === 30000);
  assert.ok(backupTimer);
  await state.keys.set({ 'session-123@s.whatsapp.net': { key: 'latest-key' } });
  assert.equal([...timers.values()].filter(value => value.ms === 30000).length, 1);
  assert.ok(timers.has(backupTimer[0]), 'continued activity must not replace the original timer');
  timers.delete(backupTimer[0]); backupTimer[1].fn(); await wa.backupAuthToStorage();
  assert.equal(JSON.parse(JSON.parse(cloud)['session-123@s.whatsapp.net.json']).key, 'latest-key');
  const beforeClosing = nextTimer;
  wa.whatsappManager.closeOnly();
  assert.equal(nextTimer, beforeClosing, 'shutdown must not schedule reconnect');
  files = { 'creds.json': '{"registered":false}' }; timers.clear();
  wa = load(); await wa.whatsappManager.initClient();
  assert.equal(state.creds.registered, true, 'unregistered local credentials must not block cloud restore');
  assert.equal(JSON.parse(files['session-123@s.whatsapp.net.json']).key, 'latest-key');
  await socket.emit('connection.update', { connection: 'open' });
  assert.equal(wa.whatsappManager.getStatus().status, 'connected');
  const beforeFailure = cloud;
  cloudFailure = true;
  await state.keys.set({ 'session-123@s.whatsapp.net': { key: 'pending' } });
  await wa.backupAuthToStorage();
  assert.equal(cloud, beforeFailure);
  assert.ok(wa.whatsappManager.getStatus().lastError);
  for (let attempt = 0; attempt < 3; attempt++) {
    const retry = [...timers].find(([, value]) => value.ms === 30000);
    assert.ok(retry); timers.delete(retry[0]); retry[1].fn();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    // Wait for the serialized backup without starting another retry attempt.
    for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  }
  assert.equal([...timers.values()].filter(value => value.ms === 30000).length, 0, 'cloud retries must stop');
  cloudFailure = false; await wa.backupAuthToStorage();
  assert.equal(wa.whatsappManager.getStatus().lastError, null);
  assert.equal(JSON.parse(JSON.parse(cloud)['session-123@s.whatsapp.net.json']).key, 'pending');
});

test('WhatsApp cloud outage never starts blank pairing or uploads unregistered credentials', async () => {
  const f = fixture(), path = require('node:path'); let sockets = 0, uploads = 0;
  const files = { 'creds.json': '{"registered":false}' };
  const wa = f.load('server/services/whatsapp.service.ts', {
    '@whiskeysockets/baileys': { default: () => { sockets++; }, useMultiFileAuthState: async () => { throw new Error('Must not pair'); } },
    qrcode: {}, pino: () => ({}), fs: {
      existsSync: name => path.basename(name) === 'whatsapp_auth' || Object.hasOwn(files, path.basename(name)),
      readdirSync: () => Object.keys(files), statSync: () => ({ isFile: () => true }), readFileSync: name => files[path.basename(name)]
    }, '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(q => {
      if (q.op === 'upsert') uploads++;
      return { error: { code: 'UNAVAILABLE' } };
    }) }, '../config': { appConfig: f.config }, './scraper.service': {}, './db.service': { logErrorArabic: async () => {} }
  });
  await assert.rejects(wa.restoreAuthFromStorage(), /restore saved WhatsApp session safely/);
  await wa.whatsappManager.initClient();
  await wa.backupAuthToStorage();
  assert.equal(sockets, 0); assert.equal(uploads, 0);
  assert.equal(wa.whatsappManager.getStatus().status, 'error'); assert.equal(wa.hasSavedSession(), false);
});

test('WhatsApp logout tombstone overrides leftover files; failed restoration never commits registered credentials', async () => {
  const f = fixture(), path = require('node:path');
  let tombstone = true, writes = [];
  const files = { 'creds.json': '{"registered":true}' };
  const wa = f.load('server/services/whatsapp.service.ts', {
    '@whiskeysockets/baileys': {}, qrcode: {}, pino: () => ({}), fs: {
      existsSync: name => path.basename(name) === 'whatsapp_auth' || Object.hasOwn(files, path.basename(name)),
      readFileSync: name => files[path.basename(name)],
      writeFileSync: name => { writes.push(path.basename(name)); throw new Error('Fixture disk failure'); }
    }, '../db': { db: { ...noopDb, prepare: () => ({ get: () => tombstone ? { value: '{}' } : undefined }) },
      supabaseKey: 'fixture', supabase: fakeSupabase(() => ({ data: { value: JSON.stringify({
        'creds.json': '{"registered":true}', 'session-123@s.whatsapp.net.json': '{}'
      }) }, error: null })) }, '../config': { appConfig: f.config }, './scraper.service': {},
    './db.service': { logErrorArabic: async () => {} }
  });
  assert.equal(await wa.restoreAuthFromStorage(), false); assert.equal(wa.hasSavedSession(), false);
  assert.equal(writes.length, 0);
  tombstone = false; delete files['creds.json'];
  await assert.rejects(wa.restoreAuthFromStorage(), /restore saved WhatsApp session safely/);
  assert.deepEqual(writes, ['session-123@s.whatsapp.net.json']);
  assert.equal(files['creds.json'], undefined);
});

test('Queue restore skips malformed progress and preserves valid delivery flags', async () => {
  const f = fixture(), env = socialFixture(f);
  await env.social.broadcastRateChanges([update]);
  const saved = JSON.parse(env.checkpoints.get('worker_broadcast_queue'));
  const item = saved.items[0][1];
  saved.items.push(['bad-target', { ...item, id: 'bad-target', targets: 'telegram' }],
    ['bad-progress', { ...item, id: 'bad-progress', delivered: { telegram: 'yes' } }], null);
  env.checkpoints.set('worker_broadcast_queue', JSON.stringify(saved));
  const restored = env.restore(); await restored.loadBroadcastQueueState();
  assert.equal(restored.smartBroadcastQueue.size, 1);
  env.failFB(false); assert.equal((await restored.flushBroadcastQueueImmediately('all', true)).success, true);
  assert.equal(env.counts.telegram, 1); assert.equal(env.counts.facebook, 1);
});
test('Explicit manual flush honors all selected platforms even when automatic Facebook is disabled', async () => {
  const f = fixture(), env = socialFixture(f);
  f.config.facebookAutoPost = false; env.failFB(false);
  await env.social.broadcastRateChanges([update]);
  assert.deepEqual(Array.from(env.social.smartBroadcastQueue.get('USD').targets), ['telegram']);
  assert.equal((await env.social.flushBroadcastQueueImmediately('all', true)).success, true);
  assert.equal(env.counts.telegram, 1); assert.equal(env.counts.facebook, 1);
});
test('Check-trio publishing descriptors match the final persisted synchronized prices', async () => {
  const f = fixture();
  for (const id of ['USD_CHECKS', 'USD_JBANK', 'USD_NCB']) {
    f.config.terms.push({ id, name: id, min: 5.5, max: 20, flag: 'us' });
    f.rates.parallel[id] = 11.5;
  }
  const changes = await dbService(f).commitParallelRates([
    { code: 'USD_JBANK', value: 11.6, time: f.now() - 60000, source: 'fixture' },
    { code: 'USD_NCB', value: 11.7, time: f.now(), source: 'fixture' }
  ]);
  for (const id of ['USD_CHECKS', 'USD_JBANK', 'USD_NCB']) assert.equal(f.rates.parallel[id], 11.7);
  assert.ok(changes.every(change => change.newVal === f.rates.parallel[change.id]));
});
test('Explicit manual override cannot silently skip an older request timestamp or invalid currency', async () => {
  const f = fixture(), db = dbService(f);
  await db.commitParallelRates([{ code: 'USD', value: 9.8, time: f.now(), source: 'fixture' }]);
  await db.commitParallelRates([{ code: 'USD', value: 9.9, time: f.now() - 1000, source: 'manual' }], true);
  assert.equal(f.rates.parallel.USD, 9.9);
  await assert.rejects(db.commitParallelRates([{ code: 'UNKNOWN', value: 9.9, time: f.now(), source: 'manual' }], true));
});
(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failures++; console.error('FAIL ' + name, error); }
  }
  console.log(tests.length + ' isolated regression scenarios, ' + failures + ' failed.');
  if (failures) process.exitCode = 1;
})();
module.exports = { dbService, scraper, socialFixture };
