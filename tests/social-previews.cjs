const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { fixture, noopDb } = require('./fixtures.cjs');

async function main() {
  const roots = [path.resolve(__dirname, '..')];
  if (process.env.WEB_PROJECT_PATH) roots.push(path.resolve(process.env.WEB_PROJECT_PATH));
  for (const root of roots) {
    const f = fixture(), messages = [], payloads = [];
    let failFirst = true;
    const helper = f.load(path.join(root, 'server/utils/helpers.ts'), {}, {
      process: { env: { WEB_SERVER_URL: 'https://dollar-price-qp14.onrender.com/' } }
    });
    const manager = { sendMessage: async (_channel, message, options) => {
      assert.equal(options.linkPreview, true); messages.push(message);
      if (failFirst) { failFirst = false; return false; } return true;
    } };
    const social = f.load(path.join(root, 'server/services/social.service.ts'), {
      '../../telegramClient': { getTelegramManager: () => manager },
      '../config': { appConfig: f.config, telegramManager: manager, setTelegramManager() {} },
      '../state': { rates: f.rates }, '../db': { db: noopDb, supabase: null, supabaseKey: '', supabaseAnonKey: '' },
      './broadcastLog.service': { addBroadcastLog() {} }, '../utils/helpers': { ...helper, delay: async () => {} }
    }, { fetch: async (_url, options) => {
      payloads.push(JSON.parse(options.body)); return { json: async () => ({ id: 'fixture-post' }) };
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
  }
  console.log('PASS: Web/Worker Telegram cache-busting, stable retries, preview enabled and unchanged Facebook short URL');

  if (!process.env.WEB_PROJECT_PATH) return;
  const root = path.resolve(process.env.WEB_PROJECT_PATH), f = fixture();
  const pass = (_req, _res, next) => next(), empty = () => express.Router();
  const security = Object.fromEntries(['ipBanMiddleware', 'suspiciousActivityMiddleware', 'userAgentMiddleware',
    'timeoutMiddleware', 'helmetMiddleware', 'permissionsPolicyMiddleware', 'apiLimiter', 'publicApiLimiter'].map(key => [key, pass]));
  let htmlReads = 0;
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
    './state': { rates: f.rates }, './services/maintenance.service': {}, './services/db.service': {
      loadLatestRatesFromSupabase: async () => { throw new Error('Preview must not query the database'); }
    }, './socket/socket.service': {}
  }, { process: { env: { NODE_ENV: 'production' }, cwd: () => root } });
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
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('PASS: actual production HTML, EUR-only cache invalidation, variant OG URLs/ETags, bounded cache and missing-price safety');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
