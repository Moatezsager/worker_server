const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { fixture, fakeSupabase, noopDb } = require('./fixtures.cjs');

async function main() {
  const roots = [path.resolve(__dirname, '..')];
  if (process.env.WEB_PROJECT_PATH) roots.push(path.resolve(process.env.WEB_PROJECT_PATH));
  for (const root of roots) {
    const f = fixture(), messages = [], payloads = [], events = [];
    let failFirst = true, webReady = true, stalePreview = false, previewAckOnly = false;
    const helper = f.load(path.join(root, 'server/utils/helpers.ts'), {}, {
      process: { env: { WEB_SERVER_URL: 'https://dollar-price-qp14.onrender.com/' } }
    });
    const manager = { sendMessage: async (_channel, message, options) => {
      events.push('telegram');
      assert.equal(options.linkPreview, true); messages.push(message);
      if (failFirst) { failFirst = false; return false; } return true;
    } };
    const social = f.load(path.join(root, 'server/services/social.service.ts'), {
      '../../telegramClient': { getTelegramManager: () => manager },
      './telegramSession.service': { getTelegramCredentials: () => ({ apiId: 1, apiHash: 'fixture', sessionString: 'fixture' }) },
      './db.service': { ensureWebRatesReady: async () => { events.push('Web ready'); return webReady; } },
      '../config': { appConfig: f.config, telegramManager: manager, setTelegramManager() {} },
      '../state': { rates: f.rates }, '../db': { db: noopDb, supabase: null, supabaseKey: '', supabaseAnonKey: '' },
      './broadcastLog.service': { addBroadcastLog() {} }, '../utils/helpers': { ...helper, delay: async () => {} }
    }, { fetch: async (_url, options) => {
      const payload = options.body ? JSON.parse(options.body) : Object.fromEntries(new URL(_url).searchParams);
      events.push(payload.scrape ? 'scrape ' + payload.id : !options.body ? 'read preview' : _url.endsWith('/comments') ? 'comment' : 'facebook');
      if (payload.scrape) {
        assert.ok(options.signal); assert.equal(options.headers.Authorization, 'Bearer fake-only');
        assert.equal(payload.fields, 'og_object{title}');
        assert(!_url.includes('fake-only'), 'Token stays out of Graph URLs');
      }
      payloads.push(payload);
      return { ok: true, json: async () => payload.scrape && previewAckOnly ? { og_object: { id: 'fixture-object' } } : payload.scrape || !options.body ? {
        og_object: { title: `دولار: ${f.rates.parallel.USD.toFixed(2)} | يورو: ${(f.rates.parallel.EUR - (stalePreview ? .1 : 0)).toFixed(2)}` }
      } : { id: 'fixture-post' } };
    } });
    const message = 'Prices\nhttps://tinyurl.com/2j7667u2\n';
    await social.broadcastToSocialMedia(message, false, 'telegram', true);
    assert.equal(messages.length, 2); assert.equal(messages[0], messages[1], 'Retries keep the same preview URL');
    const first = new URL(messages[0].match(/https:\/\/\S+/)[0]);
    assert.equal(first.origin, 'https://dollar-price-qp14.onrender.com');
    assert(/^\d{6,32}$/.test(first.searchParams.get('r')));
    f.advance(1); await social.broadcastToSocialMedia(message, false, 'telegram', true);
    assert.notEqual(messages.at(-1), messages[0], 'A new publication uses a new preview URL');
    await social.broadcastToSocialMedia(message, false, 'facebook', true);
    assert(payloads.some(value => value.link === 'https://tinyurl.com/2j7667u2'));
    assert(payloads.filter(value => value.message).every(value => !value.message.includes('?r=')));
    if (root === roots[0]) {
      assert.deepEqual(payloads.filter(value => value.scrape).map(value => value.id), [
        'https://dollar-price-qp14.onrender.com/', 'https://tinyurl.com/2j7667u2'
      ]);
      assert(events.indexOf('Web ready') < events.indexOf('telegram'));
      assert(events.indexOf('scrape https://tinyurl.com/2j7667u2') < events.indexOf('facebook'));
      await social.broadcastToSocialMedia(message, false, 'facebook', true);
      assert.equal(payloads.filter(value => value.scrape).length, 2, 'Unchanged USD/EUR reuse confirmed Meta preview');
      f.rates.parallel.EUR = 10.7;
      await social.broadcastToSocialMedia(message, false, 'facebook', true);
      assert.equal(payloads.filter(value => value.scrape).length, 4, 'EUR alone refreshes the preview');
      const posted = payloads.filter(value => value.link).length;
      stalePreview = true; f.rates.parallel.EUR = 10.8;
      await assert.rejects(social.broadcastToSocialMedia(message, false, 'facebook', true));
      assert.equal(payloads.filter(value => value.link).length, posted, 'Never post with a stale Meta preview');
      stalePreview = false; f.advance(60001);
      await social.broadcastToSocialMedia(message, false, 'facebook', true);
      assert.equal(payloads.filter(value => value.link).length, posted + 1);
      previewAckOnly = true; f.rates.parallel.EUR = 10.9;
      await social.broadcastToSocialMedia(message, false, 'facebook', true);
      assert.equal(events.filter(event => event === 'read preview').length, 2, 'An incomplete scrape response still requires reading the real cached title');
      webReady = false;
      const sent = messages.length, requests = payloads.length;
      await assert.rejects(social.broadcastToSocialMedia(message, false, 'all', true));
      await assert.rejects(social.broadcastToSocialMedia('Prices https://dollar-price-qp14.onrender.com/', false, 'telegram', true));
      assert.equal(messages.length, sent); assert.equal(payloads.length, requests);
    }
  }
  console.log('PASS: Web readiness before delivery, USD/EUR Meta re-scrape before short-link posts, stale-preview blocking, cache-busting and stable retries');

  if (!process.env.WEB_PROJECT_PATH) return;
  const root = path.resolve(process.env.WEB_PROJECT_PATH), f = fixture();
  const pass = (_req, _res, next) => next(), empty = () => express.Router();
  const security = Object.fromEntries(['ipBanMiddleware', 'suspiciousActivityMiddleware', 'userAgentMiddleware',
    'timeoutMiddleware', 'helmetMiddleware', 'permissionsPolicyMiddleware', 'apiLimiter', 'publicApiLimiter'].map(key => [key, pass]));
  let htmlReads = 0;
  let parallelRow, releaseReload, databaseReads = 0;
  const reloadGate = new Promise(resolve => { releaseReload = resolve; });
  const sequence = [];
  const webDb = f.load(path.join(root, 'server/services/db.service.ts'), {
    '../db': { db: noopDb, supabaseAnonKey: 'fixture', supabase: fakeSupabase(async q => {
      assert.ok(parallelRow, 'Page requests alone never read Supabase');
      databaseReads++; await reloadGate;
      return { data: [q.table === 'parallel_rates' ? parallelRow : {
        usd: 6.4, rates: { USD: 6.4, EUR: 7.1 }, recorded_at: '2026-10-12T10:00:00Z'
      }], error: null };
    }) }, '../state': { rates: f.rates, history: [] }, '../config': { appConfig: f.config },
    '../utils/helpers': f.helper, './reporting.service': { updateStats() {} },
    './alert.service': { checkAndAlertIfCritical: async () => {} }
  });
  const previewExpress = new Proxy(express, { apply(target, receiver, args) {
    const app = Reflect.apply(target, receiver, args), get = app.get.bind(app);
    app.get = (route, ...handlers) => get(Object.prototype.toString.call(route) === '[object RegExp]'
      ? new RegExp(route.source, route.flags) : route, ...handlers);
    return app;
  } });
  const appModule = f.load(path.join(root, 'server/app.ts'), {
    express: previewExpress, compression: require('compression'), fs: { readFileSync: () => { htmlReads++; return fs.readFileSync(path.join(root, 'index.html'), 'utf8'); } },
    vite: {}, './middleware/security': { ...security, apiStats: {} }, './routes/rates.routes': empty(),
    './routes/cron.routes': empty(), './routes/push.routes': { __esModule: true, default: empty(), handlePushSwRoute() {} },
    './routes/tracking.routes': { __esModule: true, default: empty(), handleTelegramPageRoute() {}, handleTelegramBannerRoute() {} },
    './routes/system.routes': empty(), './routes/admin.routes': { createAdminRouter: empty },
    './state': { rates: f.rates }, './services/maintenance.service': {}, './services/db.service': webDb,
    './socket/socket.service': { broadcastRatesUpdate: () => { sequence.push('Web socket'); } }
  }, { process: { env: { NODE_ENV: 'production', WORKER_INTERNAL_SECRET: 'fixture-only' }, cwd: () => root } });
  const app = await appModule.createApp({});
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const initial = await fetch(base), firstEtag = initial.headers.get('etag');
    assert((await initial.text()).includes('يورو: 10.50'));
    f.rates.parallel.EUR = 10.97;
    const changed = await fetch(base, { headers: { 'If-None-Match': firstEtag, 'User-Agent': 'facebookexternalhit/1.1' } });
    assert.equal(changed.status, 200); assert((await changed.text()).includes('يورو: 10.97'));
    assert.notEqual(changed.headers.get('etag'), firstEtag);
    const beforeShares = htmlReads;
    const tg = await fetch(base + '/?r=1234567890123456789', { headers: { 'User-Agent': 'TelegramBot' } });
    const tgHtml = await tg.text();
    assert(tgHtml.includes('property="og:url" content="https://dollar-price-qp14.onrender.com/?r=1234567890123456789"'));
    const other = await fetch(base + '/?r=1234567890123456790');
    assert.notEqual(other.headers.get('etag'), tg.headers.get('etag'));
    assert.equal(htmlReads, beforeShares, 'Unique shares reuse one HTML cache, without disk/DB reads per URL');
    const unchanged = await fetch(base + '/?r=1234567890123456789', { headers: { 'If-None-Match': tg.headers.get('etag') } });
    assert.equal(unchanged.status, 304); assert(unchanged.headers.get('cache-control').includes('no-store'));
    const invalid = await fetch(base + '/?r=%22%3E%3Cscript%3Ealert(1)%3C/script%3E');
    assert(!(await invalid.text()).includes('alert(1)'));
    f.rates.parallel.EUR = 0;
    assert(!(await (await fetch(base)).text()).includes('يورو: 0.00'));
    assert.equal(databaseReads, 0);

    const worker = fixture(); worker.advance(60000);
    const workerDb = worker.load('server/services/db.service.ts', {
      '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(q => {
        if (q.table === 'parallel_rates' && q.op === 'insert') {
          parallelRow = q.args.insert[0][0]; sequence.push('saved');
        }
        return { data: [], error: null };
      }) }, '../state': { rates: worker.rates, history: [] }, '../config': { appConfig: worker.config },
      '../utils/helpers': worker.helper, './reporting.service': { updateStats() {} }, '../utils/logger': { addLog() {} }
    }, { fetch, process: { env: { WEB_SERVER_URL: base, WORKER_INTERNAL_SECRET: 'fixture-only' } } });
    const saved = workerDb.commitParallelRates([
      { code: 'USD', value: 9.8, time: worker.now(), source: 'fixture' },
      { code: 'EUR', value: 11.1, time: worker.now(), source: 'fixture' }
    ]);
    for (let i = 0; i < 100 && databaseReads < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(databaseReads, 2); assert.deepEqual(sequence, ['saved']);
    assert(!(await (await fetch(base)).text()).includes('يورو: 11.10'));
    const readsBeforeSync = htmlReads;
    releaseReload(); const updates = await saved;
    assert.deepEqual(sequence, ['saved', 'Web socket']);
    assert.equal(htmlReads, readsBeforeSync + 1, 'Completion proactively rebuilds the USD/EUR HTML cache');
    const readyHtml = await (await fetch(base)).text();
    assert(readyHtml.includes('دولار: 9.80')); assert(readyHtml.includes('يورو: 11.10'));
    const title = readyHtml.match(/property="og:title" content="([^"]+)"/)[1];
    const manager = { sendMessage: async () => { sequence.push('telegram'); return true; } };
    const sender = worker.load('server/services/social.service.ts', {
      '../../telegramClient': { getTelegramManager: () => manager },
      './telegramSession.service': { getTelegramCredentials: () => ({ apiId: 1, apiHash: 'fixture', sessionString: 'fixture' }) },
      './db.service': workerDb, '../config': { appConfig: worker.config, telegramManager: manager, setTelegramManager() {} },
      '../state': { rates: worker.rates }, '../db': { db: noopDb, supabase: null, supabaseKey: '' },
      './broadcastLog.service': { addBroadcastLog() {} }, '../utils/helpers': { ...worker.helper, delay: async () => {} }
    }, { process: { env: { WEB_SERVER_URL: base } }, fetch: async (url, options) => {
      assert.ok(url.startsWith('https://graph.facebook.com/'));
      const body = JSON.parse(options.body);
      sequence.push(body.scrape ? body.id === base + '/' ? 'canonical scrape' : 'short scrape' : url.endsWith('/comments') ? 'comment' : 'facebook');
      return { ok: true, json: async () => body.scrape ? { og_object: { title } } : { id: 'fixture-post' } };
    } });
    await sender.broadcastRateChanges(updates); sequence.push('queued');
    assert.equal((await sender.flushBroadcastQueueImmediately('all', true)).success, true);
    assert.deepEqual(sequence, ['saved', 'Web socket', 'queued', 'telegram', 'canonical scrape', 'short scrape', 'facebook', 'comment']);
    assert.equal(databaseReads, 2, 'Immediate delivery reuses the completed synchronization, without duplicate database reads');
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('PASS: real save -> HTTP Web sync -> Socket.IO/HTML cache -> queue -> fresh Telegram/Meta previews -> Facebook, without production access');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
