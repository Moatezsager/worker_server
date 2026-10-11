const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const silent = { log() {}, warn() {}, error() {} };
const noopDb = { prepare: () => ({ get() {}, all: () => [], run: () => ({ changes: 0 }) }), transaction: fn => fn, exec() {} };
function fixture() {
  let clock = Date.parse('2026-10-12T10:00:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const config = {
    terms: [
      { id: 'USD', name: 'Dollar', regex: 'USD\\s+(\\d+\\.\\d+)', min: 5.5, max: 20, flag: 'us' },
      { id: 'EUR', name: 'Euro', regex: 'EUR\\s+(\\d+\\.\\d+)', min: 5.5, max: 20, flag: 'eu' }
    ],
    channels: ['fixture'], whatsappSources: [{ jid: 'allowed@g.us', enabled: true }, { jid: 'disabled@g.us', enabled: false }],
    telegramAutoPost: true, facebookAutoPost: true, telegramPostChannel: 'fixture',
    facebookPageId: 'fixture', facebookAccessToken: 'fake-only', quietHoursEnabled: false,
    aggregationWindowSeconds: 45, hourlyPostLimit: 4
  };
  const rates = { parallel: { USD: 9.7, EUR: 10.5 }, previousParallel: { USD: 9.6, EUR: 10.4 },
    official: { USD: 6.4, EUR: 7.1 }, previousOfficial: { USD: 6.3, EUR: 7 },
    lastUpdated: new Clock().toISOString(), lastChanged: { parallel: {}, official: {} } };
  function load(relative, mocks = {}, extra = {}) {
    const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
    const source = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code;
    const mod = { exports: {} };
    const context = vm.createContext({
      module: mod, exports: mod.exports, console: silent, Date: Clock, structuredClone, URL,
      process: { env: {}, cwd: () => root }, global: {}, Buffer, AbortController, AbortSignal,
      setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} }), clearTimeout() {}, clearInterval() {},
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (['crypto', 'path'].includes(name)) return require(name);
        throw new Error('Unmocked dependency: ' + name);
      },
      fetch: async () => { throw new Error('Unexpected external network'); }, ...extra
    });
    vm.runInContext(source, context, { filename, timeout: 5000 });
    return mod.exports;
  }
  const helper = load('server/utils/helpers.ts');
  return { config, rates, load, helper, Clock, now: () => clock, advance: ms => { clock += ms; } };
}
function fakeSupabase(perform) {
  return { from(table) {
    const query = { table, op: 'select', args: {} };
    const chain = {};
    for (const method of ['select', 'insert', 'upsert', 'delete', 'eq', 'lt', 'in', 'order', 'limit', 'single']) {
      chain[method] = (...args) => {
        query.args[method] = args;
        if (['insert', 'upsert', 'delete'].includes(method)) query.op = method;
        return chain;
      };
    }
    chain.then = (ok, bad) => Promise.resolve().then(() => perform(query)).then(ok, bad);
    return chain;
  } };
}
function cblHtml(date, usd = 6.45) {
  return '<table class="currency-rates-table"><thead><tr><th>التاريخ</th><th>العملة</th><th>الرمز</th><th>شراء</th><th>بيع</th><th>متوسط</th></tr></thead><tbody>' +
    [['USD', usd], ['EUR', 7.1], ['GBP', 8]].map(([code, value]) =>
      '<tr><td>' + (date || 'No date') + '</td><td>' + code + '</td><td>' + code + '</td><td>' +
      (value - .02).toFixed(4) + '</td><td>' + value.toFixed(4) + '</td><td>' + (value - .01).toFixed(4) + '</td></tr>'
    ).join('') + '</tbody></table>';
}
module.exports = { fixture, fakeSupabase, noopDb, cblHtml, root, silent };

