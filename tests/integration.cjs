const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { fixture, fakeSupabase, noopDb } = require('./fixtures.cjs');
async function listen(app) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
async function main() {
  const f = fixture(), source = { fetchOfficialRates: async () => true, fetchParallelRatesFromTelegram: async () => false };
  const scheduler = f.load('server/schedulers/tasks.scheduler.ts', {
    '../services/maintenance.service': { monitorMemory() {}, cleanupUserLogs() {} },
    '../services/db.service': { cleanupOldData() {}, logErrorArabic: async () => {}, saveWorkerStateToSupabase: async () => {} },
    '../services/scraper.service': source, '../state': { rates: f.rates },
    '../services/social.service': {}, '../../telegramClient': {},
    '../services/whatsapp.service': {}, '../utils/logger': { addLog() {} }
  }, { setTimeout, clearTimeout });
  let release, executions = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const job = scheduler.runJobSafely('fixture', 'fixture', async () => { executions++; return await waiting; }, { timeoutMs: 20 });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(scheduler.isJobRunning('fixture'), true);
  assert.equal(await scheduler.runJobSafely('fixture', 'fixture', async () => { executions++; }), null);
  release(true); await job; await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(scheduler.isJobRunning('fixture'), false); assert.equal(executions, 1);
  console.log('PASS actual scheduler keeps underlying lock after timeout and releases on completion');

  const internal = f.load('server/routes/internal.routes.ts', {
    express, 'express-rate-limit': require('express-rate-limit'),
    '../schedulers/tasks.scheduler': scheduler, '../services/scraper.service': source,
    '../services/db.service': { cleanupOldData() {} }, '../services/maintenance.service': {},
    '../services/ai.service': {}, '../../telegramClient': {}, '../services/whatsapp.service': {}
  }, { process: { env: { WORKER_INTERNAL_SECRET: 'fixture-only-secret' } } }).default;
  let published = 0, enabled = true;
  const manual = f.load('server/routes/manual.routes.ts', {
    express, '../services/social.service': { broadcastRateChanges: async () => { published++; } },
    '../services/whatsapp.service': { whatsappManager: {
      setAutoProcess: v => { enabled = v; }, getStatus: () => ({ autoProcessEnabled: enabled })
    } }
  }, { process: { env: { WORKER_INTERNAL_SECRET: 'fixture-only-secret' } } }).default;
  const app = express(); app.use(express.json()); app.use('/internal', internal); app.use('/api', manual);
  const http = await listen(app);
  const post = (url, body, headers = {}) => fetch(http.url + url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
  });
  const auth = { 'x-worker-secret': 'fixture-only-secret' };
  try {
    assert.equal((await post('/internal/jobs/refresh', {})).status, 401);
    assert.equal((await post('/internal/jobs/refresh', {}, { 'x-worker-secret': 'wrong' })).status, 403);
    assert.equal((await post('/internal/jobs/unknown', {}, auth)).status, 400);
    assert.equal((await post('/internal/jobs/refresh', {}, auth)).status, 202);
    assert.equal((await post('/api/whatsapp/toggle-auto', { enabled: 'false' }, auth)).status, 400);
    assert.equal((await post('/api/whatsapp/toggle-auto', { enabled: false }, auth)).status, 200); assert.equal(enabled, false);
    assert.equal((await post('/api/manual-broadcast', { updates: [] }, auth)).status, 400);
    const u = { id: 'USD', name: 'Dollar', oldVal: 9.7, newVal: 9.8, flag: 'us' };
    assert.equal((await post('/api/manual-broadcast', { updates: [u], target: 'invalid' }, auth)).status, 400);
    assert.equal((await post('/api/manual-broadcast', { updates: [u], target: 'telegram' }, auth)).status, 200);
    assert.equal(published, 1);
  } finally { await http.close(); }
  console.log('PASS real internal HTTP routes: authentication, allowlist, dispatch, toggle and broadcast validation');

  let saveFails = true, sessionSaveFails = false, configSaveFails = false, privateSessionSaves = 0, settingsWrites = 0;
  const db = f.load('server/services/db.service.ts', {
    '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(q =>
      ({ error: saveFails && q.table === 'parallel_rates' ? { message: 'fixture failure' } : null })) },
    '../state': { rates: f.rates, history: [] }, '../config': { appConfig: f.config },
    '../utils/helpers': f.helper, './reporting.service': { updateStats() {} }, '../utils/logger': { addLog() {} }
  });
  const adminAuth = f.load('server/middleware/auth.ts', { express, '../config': { appConfig: f.config } });
  assert.equal(adminAuth.validateAdminPassword('admin'), false);
  const token = adminAuth.createAdminSession('fixture', 'fixture').token;
  const waSources = f.load('server/services/whatsapp.service.ts', {
    '@whiskeysockets/baileys': {}, qrcode: {}, pino: () => ({}), fs: { existsSync: () => true },
    './accountLease.service': {}, '../db': { db: noopDb, supabase: null }, '../config': { appConfig: f.config },
    './scraper.service': {}, './db.service': {}
  });
  waSources.whatsappManager.rememberChats([{ id: 'found@newsletter', name: 'Found Channel' }]);
  const dashboard = f.load('server/routes/dashboard.routes.ts', {
    express, '../state': { rates: f.rates }, '../config': { appConfig: f.config, saveConfigToSupabase: async () => { settingsWrites++; return !configSaveFails; } },
    '../db': { db: noopDb }, '../utils/version': { serverStartTime: new f.Clock() },
    '../schedulers/tasks.scheduler': scheduler, '../services/scraper.service': source,
    '../services/db.service': db, '../services/maintenance.service': {}, '../services/ai.service': {},
    '../services/social.service': {}, '../../telegramClient': { initializeTelegram: async () => null }, '../services/whatsapp.service': waSources,
    '../services/telegramAuth.service': {},
    '../services/telegramSession.service': { getTelegramCredentials: () => ({ apiId: 123, apiHash: 'fixture' }),
      saveTelegramSession: async () => { if (sessionSaveFails) throw new Error('Private checkpoint failed'); privateSessionSaves++; } },
    '../utils/logger': { addLog() {} }, '../views/dashboard.html': {}, '../services/ingestion.service': {},
    '../middleware/security': { loginLimiter: (req, res, next) => next() }, '../middleware/auth': adminAuth
  }).default;
  const adminApp = express(); adminApp.use(express.json()); adminApp.use(dashboard);
  const adminHttp = await listen(adminApp);
  const adminPost = (suffix, body, authenticated = true) => fetch(adminHttp.url + '/api/dashboard/' + suffix, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body)
  });
  try {
    assert.equal((await fetch(adminHttp.url + '/api/dashboard/sources')).status, 401);
    const sourceList = await (await fetch(adminHttp.url + '/api/dashboard/sources', { headers: { Authorization: 'Bearer ' + token } })).json();
    assert.equal(sourceList.whatsappSources.find(source => source.jid === 'disabled@g.us').enabled, true);
    assert.equal(sourceList.whatsappSources.find(source => source.jid === 'found@newsletter').enabled, true);
    const beforeSourceRefresh = settingsWrites;
    assert.equal((await adminPost('sources/whatsapp/refresh', {})).status, 200);
    assert.equal(settingsWrites, beforeSourceRefresh, 'Source discovery must not overwrite shared app_config');
    assert.equal((await adminPost('sources/whatsapp/toggle', { jid: 'disabled@g.us', enabled: false })).status, 409);
    assert.equal((await adminPost('sources/whatsapp/toggle', { jid: 'found@newsletter', enabled: true })).status, 200);
    assert.equal((await adminPost('sources/whatsapp/toggle', { jid: 'found@newsletter', enabled: 'false' })).status, 400);
    assert.equal((await adminPost('sources/whatsapp/delete', { jid: 'found@newsletter' })).status, 409);
    assert.equal(settingsWrites, beforeSourceRefresh);
    assert.equal((await adminPost('sources/whatsapp/toggle', { jid: 'private@s.whatsapp.net', enabled: true })).status, 200);
    assert.equal(f.config.whatsappSources.find(source => source.jid === 'private@s.whatsapp.net').enabled, true);
    assert.equal((await adminPost('accounts/telegram/save', { sessionString: 'fixture' }, false)).status, 401);
    assert.equal((await adminPost('accounts/telegram/save', { sessionString: 123 })).status, 400);
    assert.equal((await adminPost('accounts/telegram/save', { sessionString: ' ' })).status, 200);
    assert.equal(privateSessionSaves, 0, 'A blank form field must not erase the saved account');
    sessionSaveFails = true;
    assert.equal((await adminPost('accounts/telegram/save', { sessionString: 'fixture' })).status, 503);
    assert.equal(f.config.telegramSessionString, undefined, 'Never copy the new Worker session into shared config');
    sessionSaveFails = false; configSaveFails = true;
    assert.equal((await adminPost('accounts/telegram/save', { botToken: 'fixture' })).status, 503);
    configSaveFails = false;
    assert.equal((await adminPost('accounts/telegram/save', { sessionString: 'fixture' })).status, 200);
    assert.equal(privateSessionSaves, 1);
    assert.equal((await adminPost('update-rate', { code: 'USD', rate: 9.8 }, false)).status, 401);
    assert.equal((await adminPost('update-rate', { code: 'USD', rate: 9.8 })).status, 500);
    assert.equal(f.rates.parallel.USD, 9.7);
    assert.equal((await adminPost('manual-rates-batch', { items: [{ code: 'USD', selected: true, newRate: 9.8 }] })).status, 500);
    assert.equal(f.rates.parallel.USD, 9.7);
    saveFails = false;
    const response = await adminPost('update-rate', { code: 'USD', rate: 9.8 });
    assert.equal(response.status, 200); assert.equal((await response.json()).success, true);
    assert.equal(f.rates.parallel.USD, 9.8);
    assert.equal((await adminPost('update-rate', { code: 'UNKNOWN', rate: 9.8 })).status, 400);
  } finally { await adminHttp.close(); }
  console.log('PASS actual manual admin route commits only saved prices, with authorization and validation');

  let attempts = 0;
  const notificationRequests = [];
  const notify = f.load('server/services/db.service.ts', {
    '../db': { db: noopDb, supabase: null, supabaseKey: '' }, '../state': { rates: f.rates, history: [] },
    '../config': { appConfig: f.config }, '../utils/helpers': f.helper,
    './reporting.service': {}, '../utils/logger': {}
  }, { process: { env: { WEB_SERVER_URL: 'https://fixture.invalid', WORKER_INTERNAL_SECRET: 'fixture-only' } },
    setTimeout: fn => { queueMicrotask(fn); return {}; },
    fetch: async (url, init) => {
      attempts++; notificationRequests.push(init);
      if (attempts < 3) throw Error('fixture timeout');
      return { ok: true };
    }
  });
  await notify.notifyWebServers(); assert.equal(attempts, 3);
  for (const init of notificationRequests) {
    assert.equal(init.headers['x-worker-secret'], 'fixture-only'); assert.ok(init.signal);
    assert.equal(init.headers['User-Agent'], 'Dollar-Price-Worker/1.0');
  }
  console.log('PASS bounded Web notification retries and existing secret/header contract');

  const webRoot = process.env.WEB_PROJECT_PATH;
  if (webRoot) {
    const w = fixture(); let row = { usd: 9.8, rates: { USD: 9.8 }, recorded_at: '2026-10-12T10:01:00Z',
      last_changed: { USD: '2026-10-12T10:00:30Z' } };
    const cold = w.load(path.join(webRoot, 'server/state.ts'));
    assert.equal(Object.keys(cold.rates.parallel).length, 0); assert.equal(cold.history.length, 0);
    const webDb = w.load(path.join(webRoot, 'server/services/db.service.ts'), {
      '../db': { db: noopDb, supabaseAnonKey: 'fixture', supabase: fakeSupabase(q => ({
        data: [q.table === 'parallel_rates' ? row : { usd: 6.4, rates: { USD: 6.4 }, recorded_at: '2026-10-12T09:00:00Z' }], error: null
      })) }, '../state': { rates: w.rates, history: [] }, '../config': { appConfig: w.config },
      '../utils/helpers': w.helper, './reporting.service': { updateStats() {} },
      './alert.service': { checkAndAlertIfCritical: async () => {} }
    });
    await webDb.loadLatestRatesFromSupabase(); assert.equal(w.rates.previousParallel.USD, 9.7);
    assert.equal(w.rates.lastChanged.parallel.USD, row.last_changed.USD); assert.equal(w.rates.parallel.USD, 9.8);
    row = { ...row, usd: 9.6, recorded_at: '2026-10-12T09:59:00Z' };
    await webDb.loadLatestRatesFromSupabase(); assert.equal(w.rates.parallel.USD, 9.8);
    assert.equal(webDb.lastRatesFetchTime, w.now());
    console.log('PASS paired Web loader updates previous price/source time/cache and rejects older snapshots');
    let calls = 0, active = 0, maxActive = 0, broadcasts = 0, alwaysFail = false, release, syncGate;
    const retryTimers = [], waiting = new Promise(resolve => { release = resolve; });
    const pass = (_req, _res, next) => next(), empty = () => express.Router();
    const security = Object.fromEntries(['ipBanMiddleware', 'suspiciousActivityMiddleware', 'userAgentMiddleware',
      'timeoutMiddleware', 'helmetMiddleware', 'permissionsPolicyMiddleware', 'apiLimiter', 'publicApiLimiter'].map(key => [key, pass]));
    const webSecurity = w.load(path.join(webRoot, 'server/middleware/security.ts'), {
      express, 'express-rate-limit': require('express-rate-limit'), helmet: require('helmet'), '../config': { appConfig: w.config }
    });
    security.userAgentMiddleware = webSecurity.userAgentMiddleware;
    assert.equal(webSecurity.isValidCronSecret('fixture-cron-only-token'), false);
    assert.ok(/const knownKeys = \[\s*process\.env\.CRON_SECRET\s*\]/.test(webSecurity.isValidCronSecret.toString()),
      'Cron authentication has no embedded fallback credential');
    const configuredSecurity = w.load(path.join(webRoot, 'server/middleware/security.ts'), {
      express, 'express-rate-limit': require('express-rate-limit'), helmet: require('helmet'), '../config': { appConfig: w.config }
    }, { process: { env: { CRON_SECRET: 'fixture-cron-only-token' } } });
    assert.equal(configuredSecurity.isValidCronSecret('fixture-cron-only-token'), true);
    assert.equal(configuredSecurity.isValidCronSecret('  fixture-cron-only-token  '), true);
    assert.equal(configuredSecurity.isValidCronSecret('wrong-fixture-token'), false);
    assert.equal(configuredSecurity.isValidCronSecret(undefined), false);
    const timeoutLimits = [];
    for (const [path, query] of [['/api/internal/notify-rates-updated', { wait: 'true' }],
      ['/api/internal/notify-rates-updated', {}], ['/api/rates', {}]]) {
      webSecurity.timeoutMiddleware({ path, query }, { setTimeout: limit => timeoutLimits.push(limit) }, () => {});
    }
    assert.deepEqual(timeoutLimits, [20000, 5000, 5000]);
    const webAppModule = w.load(path.join(webRoot, 'server/app.ts'), {
      express, compression: require('compression'), fs: {}, vite: { createServer: async () => ({ middlewares: pass }) },
      './middleware/security': { ...security, apiStats: {} }, './routes/rates.routes': empty(),
      './routes/cron.routes': empty(), './routes/push.routes': { __esModule: true, default: empty(), handlePushSwRoute() {} },
      './routes/tracking.routes': { __esModule: true, default: empty(), handleTelegramPageRoute() {}, handleTelegramBannerRoute() {} },
      './routes/system.routes': empty(), './routes/admin.routes': { createAdminRouter: empty },
      './state': { rates: w.rates }, './services/maintenance.service': {},
      './services/db.service': { loadLatestRatesFromSupabase: async () => {
        calls++; active++; maxActive = Math.max(maxActive, active);
        try {
          if (alwaysFail || calls === 1) throw Error('Fixture database unavailable');
          if (calls === 2) await waiting;
          if (syncGate) await syncGate;
        } finally { active--; }
      } }, './socket/socket.service': { broadcastRatesUpdate: () => { broadcasts++; } }
    }, { process: { env: { NODE_ENV: 'test', WORKER_INTERNAL_SECRET: 'fixture-only' }, cwd: () => webRoot },
      setTimeout: fn => { retryTimers.push(fn); return {}; } });
    const notifiedWeb = await listen(await webAppModule.createApp({}));
    const sendNotify = secret => fetch(notifiedWeb.url + '/api/internal/notify-rates-updated', {
      method: 'POST', headers: { 'User-Agent': 'Dollar-Price-Worker/1.0', ...(secret ? { 'x-worker-secret': secret } : {}) }
    });
    async function waitFor(check) {
      for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.ok(check(), 'Fixture notification operation completed');
    }
    try {
      assert.equal((await fetch(notifiedWeb.url + '/api/internal/notify-rates-updated', {
        method: 'POST', headers: { 'User-Agent': 'node', 'x-worker-secret': 'fixture-only' }
      })).status, 403); assert.equal(calls, 0);
      assert.equal((await sendNotify()).status, 401);
      assert.equal((await sendNotify('wrong')).status, 403); assert.equal(calls, 0);
      const pairedNotify = f.load('server/services/db.service.ts', {
        '../db': { db: noopDb, supabase: null, supabaseKey: '' }, '../state': { rates: f.rates, history: [] },
        '../config': { appConfig: f.config }, '../utils/helpers': f.helper, './reporting.service': {}, '../utils/logger': {}
      }, { process: { env: { WEB_SERVER_URL: notifiedWeb.url, WORKER_INTERNAL_SECRET: 'fixture-only' } }, fetch });
      await pairedNotify.notifyWebServers(); assert.equal(calls, 1);
      await waitFor(() => retryTimers.length === 1); assert.equal(broadcasts, 0);
      for (let i = 0; i < 3; i++) assert.equal((await sendNotify('fixture-only')).status, 200);
      retryTimers.shift()(); await waitFor(() => calls === 2);
      release(); await waitFor(() => broadcasts === 2);
      assert.equal(calls, 3); assert.equal(maxActive, 1);
      alwaysFail = true;
      assert.equal((await sendNotify('fixture-only')).status, 200);
      for (let i = 0; i < 2; i++) { await waitFor(() => retryTimers.length === 1); retryTimers.shift()(); }
      await waitFor(() => calls === 6 && active === 0);
      assert.equal(broadcasts, 2); assert.equal(retryTimers.length, 0);

      alwaysFail = false;
      let finishSync, completed = false;
      syncGate = new Promise(resolve => { finishSync = resolve; });
      const completion = pairedNotify.notifyWebServers(w.rates).then(value => { completed = true; return value; });
      await waitFor(() => calls === 7 && active === 1);
      assert.equal(completed, false); assert.equal(broadcasts, 2, 'Completion cannot precede DB load and Socket.IO');
      syncGate = undefined; finishSync();
      assert.equal(await completion, true); assert.equal(broadcasts, 3);

      alwaysFail = true;
      const failedCompletion = fetch(notifiedWeb.url + '/api/internal/notify-rates-updated?wait=true', {
        method: 'POST', headers: { 'User-Agent': 'Dollar-Price-Worker/1.0', 'x-worker-secret': 'fixture-only' }
      });
      for (let i = 0; i < 2; i++) { await waitFor(() => retryTimers.length === 1); retryTimers.shift()(); }
      const failedResponse = await failedCompletion;
      assert.equal(failedResponse.status, 503); assert.equal((await failedResponse.json()).status, 'failed');
      assert.equal(broadcasts, 3);
    } finally { await notifiedWeb.close(); }
    console.log('PASS paired Web notification HTTP: legacy acknowledgement, completed synchronization before publishing, timeouts and bounded failed DB retries');
    const workerSecurity = f.load('server/middleware/security.ts', {
      express, 'express-rate-limit': require('express-rate-limit'), helmet: require('helmet'), '../config': { appConfig: f.config }
    });
    const workerApi = express(); workerApi.use(express.json()); workerApi.use(workerSecurity.userAgentMiddleware); workerApi.use('/api', manual);
    const workerTarget = await listen(workerApi);
    const proxy = w.load(path.join(webRoot, 'server/routes/admin/whatsapp.routes.ts'), { express }, {
      process: { env: { WORKER_SERVER_URL: workerTarget.url, WORKER_INTERNAL_SECRET: 'fixture-only-secret' } }, fetch
    }).default;
    const proxyApp = express(); proxyApp.use(express.json()); proxyApp.use('/api/admin', proxy);
    const proxyHttp = await listen(proxyApp);
    try {
      assert.equal((await fetch(workerTarget.url + '/api/whatsapp/status', {
        headers: { 'User-Agent': 'node', 'x-worker-secret': 'fixture-only-secret' }
      })).status, 403);
      const status = await fetch(proxyHttp.url + '/api/admin/whatsapp/status');
      assert.equal(status.status, 200); assert.equal((await status.json()).success, true);
      const toggle = await fetch(proxyHttp.url + '/api/admin/whatsapp/toggle-auto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true })
      });
      assert.equal(toggle.status, 200); assert.equal(enabled, true);
      assert.equal((await fetch(proxyHttp.url + '/api/admin/whatsapp/toggle-auto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: 'false' })
      })).status, 400); assert.equal(enabled, true);
    } finally { await proxyHttp.close(); await workerTarget.close(); }
    console.log('PASS actual Web WhatsApp proxy and Worker User-Agent protection: authenticated status/toggle requests and strict boolean validation');
  } else console.log('SKIP paired Web loader: set WEB_PROJECT_PATH to the separate checkout');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
