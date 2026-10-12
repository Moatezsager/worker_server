const assert = require('node:assert/strict');
const { StringSession } = require('telegram/sessions');
const { fixture, fakeSupabase, noopDb } = require('./fixtures.cjs');
const tests = [];
const test = (name, run) => tests.push({ name, run });
// Valid SDK session serialization with an invented offline auth key, never a real account.
const session = n => '1' + Buffer.concat([Buffer.from([2, 0, 9]), Buffer.from('127.0.0.1'),
  Buffer.from([1, 187]), Buffer.alloc(256, n)]).toString('base64');
const credentials = n => ({ apiId: 123, apiHash: 'a'.repeat(32), sessionString: session(n) });

test('Private Telegram checkpoint wins over stale environment/shared config and survives restart', async () => {
  const f = fixture(), shared = credentials(1), fresh = credentials(2), env = { TG_SESSION_V2: session(3) };
  Object.assign(f.config, { telegramApiId: shared.apiId, telegramApiHash: shared.apiHash, telegramSessionString: shared.sessionString });
  let cloud, failure = false, writes = 0;
  const checkpoints = new Map();
  const db = { ...noopDb, prepare: () => ({ run: (key, value) => checkpoints.set(key, value),
    get: key => checkpoints.has(key) ? { value: checkpoints.get(key) } : undefined }) };
  const load = () => f.load('server/services/telegramSession.service.ts', {
    'telegram/sessions': { StringSession }, '../config': { appConfig: f.config },
    '../db': { db, supabaseKey: 'fixture', supabase: fakeSupabase(q => {
      assert.equal(q.table, 'server_config');
      if (failure) return { error: { message: 'fixture failure' } };
      if (q.op === 'upsert') { cloud = q.args.upsert[0].value; writes++; return { error: null }; }
      return { data: cloud ? { value: cloud } : null, error: null };
    }) }
  }, { process: { env } });
  let store = load();
  assert.equal(store.getTelegramCredentials().sessionString, shared.sessionString);
  await store.saveTelegramSession(fresh.apiId, fresh.apiHash, fresh.sessionString);
  await store.saveTelegramSession(fresh.apiId, fresh.apiHash, fresh.sessionString);
  assert.equal(writes, 1);
  assert.equal(f.config.telegramSessionString, shared.sessionString, 'Never share the new Worker auth key with Web');
  env.TELEGRAM_SESSION = shared.sessionString;
  checkpoints.clear(); store = load(); assert.equal(await store.restoreTelegramSession(), true);
  assert.equal(store.getTelegramCredentials().sessionString, fresh.sessionString);
  f.config.telegramSessionString = session(4);
  assert.equal(store.getTelegramCredentials().sessionString, fresh.sessionString, 'A later shared config reload cannot undo the private session');
  failure = true;
  await assert.rejects(store.saveTelegramSession(fresh.apiId, fresh.apiHash, session(5)), /Failed to save/);
  assert.equal(store.getTelegramCredentials().sessionString, fresh.sessionString);
  store = load(); assert.equal(await store.restoreTelegramSession(), true, 'Local checkpoint is retained on remote read failure');
  await assert.rejects(store.saveTelegramSession(0, 'bad', ''), /Invalid Telegram/);
});

function telegramFixture(f, options = {}) {
  const clients = []; let connections = 0, maxConnections = 0, permitted = true;
  class Client {
    constructor(session, _id, _hash, settings) { this.session = session; this.settings = settings; this.connected = false; clients.push(this); }
    async connect() {
      await this.session.load();
      if (options.fail) throw new Error(options.fail);
      if (options.wait) await options.wait;
      if (this.destroyed) return;
      this.connected = true; connections++; maxConnections = Math.max(connections, maxConnections);
    }
    async checkAuthorization() { return !options.unauthorized; }
    async destroy() { if (this.connected) connections--; this.connected = false; this.destroyed = true; }
    async disconnect() { return this.destroy(); }
    async getEntity() { return 'fixture'; }
    async getMessages() { throw new Error('TIMEOUT'); }
  }
  const module = f.load('telegramClient.ts', {
    telegram: { TelegramClient: Client, Api: {} }, 'telegram/sessions': { StringSession }, 'telegram/client/uploads': {},
    './server/services/accountLease.service': { ensureAccountLease: async () => permitted },
    './server/services/telegramSession.service': { getTelegramCredentials: () => credentials(1), restoreTelegramSession: async () => true }
  }, { fetch: async () => ({ ok: true, text: async () => '' }) });
  return { module, clients, permit: value => { permitted = value; }, maxConnections: () => maxConnections };
}

test('Concurrent Telegram checkpoint writes serialize; a failed write cannot block the newer session', async () => {
  const f = fixture(); let release, cloud, attempts = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const store = f.load('server/services/telegramSession.service.ts', {
    'telegram/sessions': { StringSession }, '../config': { appConfig: {} },
    '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(async q => {
      attempts++;
      if (attempts === 1) { await wait; return { error: { code: 'fixture' } }; }
      cloud = q.args.upsert[0].value; return { error: null };
    }) }
  });
  const c = credentials(1);
  const first = store.saveTelegramSession(c.apiId, c.apiHash, c.sessionString);
  const second = store.saveTelegramSession(c.apiId, c.apiHash, session(2));
  const result = Promise.allSettled([first, second]);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(attempts, 1); release();
  assert.deepEqual((await result).map(value => value.status), ['rejected', 'fulfilled']);
  assert.equal(JSON.parse(cloud).sessionString, session(2));
  assert.equal(store.getTelegramCredentials().sessionString, session(2));
});

test('A delayed handoff checkpoint read cannot replace a newly saved Telegram session', async () => {
  const f = fixture(); let cloud, release, delayed = false;
  const wait = new Promise(resolve => { release = resolve; });
  const store = f.load('server/services/telegramSession.service.ts', {
    'telegram/sessions': { StringSession }, '../config': { appConfig: {} },
    '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(async q => {
      if (q.op === 'upsert') { cloud = q.args.upsert[0].value; return { error: null }; }
      const value = cloud; delayed = true; await wait; return { data: { value }, error: null };
    }) }
  });
  const c = credentials(1); await store.saveTelegramSession(c.apiId, c.apiHash, c.sessionString);
  const restoring = store.restoreTelegramSession(true);
  for (let i = 0; i < 8 && !delayed; i++) await Promise.resolve();
  assert.equal(delayed, true);
  await store.saveTelegramSession(c.apiId, c.apiHash, session(2));
  release(); await restoring;
  assert.equal(store.getTelegramCredentials().sessionString, session(2));
});

test('Telegram startup, source and bot changes reuse a single client; credentials swap closes the old client first', async () => {
  const f = fixture(), t = telegramFixture(f), c = credentials(1);
  const manager = t.module.getTelegramManager(c.apiId, c.apiHash, c.sessionString, 'fixture-bot');
  const [a, b] = await Promise.all([t.module.initializeTelegram(), manager.getClient()]);
  assert.equal(a, b); assert.equal(t.clients.length, 1);
  manager.updateCredentials(c.apiId, c.apiHash, c.sessionString, 'another-fixture-bot');
  assert.equal(await manager.getClient(), a); assert.equal(a.destroyed, undefined);
  assert.equal(a.settings.autoReconnect, true); assert.equal(a.settings.reconnectRetries, 6);
  manager.updateCredentials(c.apiId, c.apiHash, session(2));
  const next = await manager.getClient();
  assert.notEqual(next, a); assert.equal(a.destroyed, true); assert.equal(t.maxConnections(), 1);
  await manager.disconnect(); assert.equal(t.module.activeClient, null);
});

test('Telegram in-flight credential change cannot create competing connections or return the retired client', async () => {
  const f = fixture(); let release;
  const wait = new Promise(resolve => { release = resolve; });
  const t = telegramFixture(f, { wait }), c = credentials(1);
  const manager = t.module.getTelegramManager(c.apiId, c.apiHash, c.sessionString);
  const first = manager.getClient();
  for (let i = 0; i < 30 && !t.clients.length; i++) await Promise.resolve();
  assert.equal(t.clients.length, 1);
  manager.updateCredentials(c.apiId, c.apiHash, session(2));
  const second = manager.getClient(); release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b); assert.equal(t.clients[0].destroyed, true); assert.equal(t.maxConnections(), 1);
});

test('Revoked Telegram key is never retried by bot updates; new login credentials allow recovery', async () => {
  const f = fixture(), opts = { fail: 'AUTH_KEY_DUPLICATED' }, t = telegramFixture(f, opts), c = credentials(1);
  const manager = t.module.getTelegramManager(c.apiId, c.apiHash, c.sessionString);
  assert.equal(await manager.getClient(), null); assert.equal(manager.isAuthRevoked, true);
  manager.updateCredentials(c.apiId, c.apiHash, c.sessionString, 'fixture-bot');
  f.advance(86400000); assert.equal(await manager.getClient(), null); assert.equal(t.clients.length, 1);
  opts.fail = null; manager.updateCredentials(c.apiId, c.apiHash, session(2));
  assert.ok(await manager.getClient());
  await manager.fetchMessages('fixture'); assert.equal(manager.isAuthRevoked, false, 'Transport timeout never revokes or erases credentials');
  assert.equal(t.module.activeClient, null); f.advance(31000); assert.ok(await manager.getClient());
});

test('Standby Worker never opens a Telegram account socket', async () => {
  const f = fixture(), t = telegramFixture(f), c = credentials(1); t.permit(false);
  const manager = t.module.getTelegramManager(c.apiId, c.apiHash, c.sessionString);
  assert.equal(await manager.getClient(), null); assert.equal(t.clients.length, 0);
  t.permit(true); assert.ok(await manager.getClient());
});

test('Unreadable private Telegram checkpoint never falls back to a stale environment key and retries with bounded reads', async () => {
  const f = fixture(); let failed = true, reads = 0;
  const store = f.load('server/services/telegramSession.service.ts', {
    'telegram/sessions': { StringSession }, '../config': { appConfig: {} },
    '../db': { db: noopDb, supabaseKey: 'fixture', supabase: fakeSupabase(() => {
      reads++; return failed ? { error: { code: 'fixture' } } : { data: { value: JSON.stringify(credentials(2)) }, error: null };
    }) }
  }, { process: { env: { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'a'.repeat(32), TG_SESSION_V2: session(1) } } });
  await assert.rejects(store.restoreTelegramSession(), /temporarily unreadable/);
  assert.equal(store.getTelegramCredentials().sessionString, '');
  for (let i = 0; i < 6; i++) await store.restoreTelegramSession();
  assert.equal(reads, 1);
  f.advance(60000); failed = false; assert.equal(await store.restoreTelegramSession(), true);
  assert.equal(store.getTelegramCredentials().sessionString, session(2));
  for (let i = 0; i < 6; i++) await store.restoreTelegramSession();
  assert.equal(reads, 2, 'Healthy reconnection checks must not poll private storage');
});

test('Telegram OTP completion requires durable save and destroys the login client before runtime initialization', async () => {
  const f = fixture(); let loginClient, fail = true, signIns = 0, initialized = 0, saved = false;
  class Request { constructor(data) { Object.assign(this, data); } }
  class Client {
    constructor() { loginClient = this; this.session = { save: () => session(2) }; }
    async connect() { this.connected = true; }
    async sendCode() { return { phoneCodeHash: 'fixture-code-hash' }; }
    async checkAuthorization() { return !!this.authorized; }
    async invoke() { this.authorized = true; signIns++; }
    async destroy() { this.connected = false; }
  }
  const auth = f.load('server/services/telegramAuth.service.ts', {
    telegram: { TelegramClient: Client, Api: { auth: { SignIn: Request } } }, 'telegram/sessions': { StringSession },
    'telegram/Password': {}, '../utils/logger': { addLog() {} },
    './accountLease.service': { ensureAccountLease: async () => true },
    './telegramSession.service': { getTelegramCredentials: () => credentials(1), saveTelegramSession: async () => {
      if (fail) throw new Error('Private checkpoint failed'); saved = true;
    } }, '../../telegramClient': { initializeTelegram: async () => {
      assert.equal(saved, true); assert.equal(loginClient.connected, false); initialized++;
    } }
  });
  await auth.sendTelegramLoginCode({ phoneNumber: '+218900000000' });
  const checking = assert.rejects(auth.verifyTelegramLoginCode('12345'), /Private checkpoint failed/);
  await assert.rejects(auth.sendTelegramLoginCode({ phoneNumber: '+218900000001' }), /قيد التنفيذ/);
  await checking;
  assert.equal(initialized, 0); assert.equal(loginClient.connected, true);
  fail = false; assert.equal((await auth.verifyTelegramLoginCode('12345')).success, true);
  assert.equal(signIns, 1, 'Retrying persistence does not repeat a successful OTP authorization');
  assert.equal(initialized, 1); assert.equal(loginClient.connected, false);
});

test('Account lease uses atomic ownership, shared acquisition and bounded standby checks', async () => {
  const f = fixture(), rows = new Map(); let reads = 0, failed = false;
  const cloud = fakeSupabase(q => {
    assert.equal(q.table, 'server_config');
    if (failed) return { error: { code: 'fixture' } };
    const key = q.filters.key || q.args.insert?.[0].key;
    if (q.op === 'select') { reads++; return { data: rows.has(key) ? { value: rows.get(key) } : null, error: null }; }
    if (q.op === 'insert') {
      if (rows.has(key)) return { error: { code: '23505' } };
      rows.set(key, q.args.insert[0].value);
    } else {
      assert.equal(typeof q.filters.value, 'string', 'Ownership changes must compare the complete previous value');
      if (rows.get(key) !== q.filters.value) return { data: [], error: null };
      if (q.op === 'update') rows.set(key, q.args.update[0].value);
      else if (q.op === 'delete') rows.delete(key);
    }
    return { data: [{ key }], error: null };
  });
  const load = () => {
    let tick, lost = 0, acquired = 0;
    const lease = f.load('server/services/accountLease.service.ts', { '../db': { supabase: cloud, supabaseKey: 'fixture' } }, {
      setInterval: (fn, ms) => { assert.equal(ms, 30000); tick = fn; return { unref() {} }; }
    });
    lease.configureAccountLease(async () => { acquired++; }, async () => { lost++; });
    return { lease, tick: () => tick(), lost: () => lost, acquired: () => acquired };
  };
  const a = load(), b = load();
  const [first, shared, second] = await Promise.all([a.lease.ensureAccountLease(), a.lease.ensureAccountLease(), b.lease.ensureAccountLease()]);
  assert.equal(first, true); assert.equal(shared, true); assert.equal(second, false);
  assert.equal(a.lease.ownsAccountLease(), true); assert.equal(b.lease.ownsAccountLease(), false);
  const before = reads; for (let i = 0; i < 6; i++) assert.equal(await b.lease.ensureAccountLease(), false);
  assert.equal(reads, before, 'Channel fetches do not repeatedly query a busy lease');
  await a.lease.releaseAccountLease(); assert.equal(a.lease.ownsAccountLease(), false);
  f.advance(30000); await b.tick(); assert.equal(b.acquired(), 1); assert.equal(b.lease.ownsAccountLease(), true);
  failed = true; f.advance(30000); await b.tick(); assert.equal(b.lost(), 1); assert.equal(b.lease.ownsAccountLease(), false);
  failed = false; f.advance(121000);
  const c = load(), d = load();
  const results = await Promise.all([c.lease.ensureAccountLease(), d.lease.ensureAccountLease()]);
  assert.equal(results.filter(Boolean).length, 1, 'Concurrent expired-lease CAS permits only one owner');
  const winner = results[0] ? c : d;
  f.advance(121000); assert.equal(winner.lease.ownsAccountLease(), false);
  await winner.lease.ensureAccountLease(); assert.equal(winner.lost(), 1, 'Expired sockets close before reacquisition');
});

test('Shutdown stops account admission, then releases even an in-flight successful lease acquisition', async () => {
  const f = fixture(); let release, value;
  const wait = new Promise(resolve => { release = resolve; });
  const lease = f.load('server/services/accountLease.service.ts', {
    '../db': { supabaseKey: 'fixture', supabase: fakeSupabase(async q => {
      if (q.op === 'select') return { data: null, error: null };
      if (q.op === 'insert') { await wait; value = q.args.insert[0].value; return { data: [{ key: 'fixture' }], error: null }; }
      assert.equal(q.filters.value, value); value = undefined; return { error: null };
    }) }
  });
  const pending = lease.ensureAccountLease();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  lease.stopAccountLease(); release(); assert.equal(await pending, false);
  await lease.releaseAccountLease(); assert.equal(value, undefined);
  assert.equal(await lease.ensureAccountLease(), false);
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name, error); }
  }
  console.log(`${tests.length} isolated account/session scenarios, ${failed} failed.`);
  process.exitCode = failed ? 1 : 0;
})();
