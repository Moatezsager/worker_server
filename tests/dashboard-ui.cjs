const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./fixtures.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function main() {
  const f = fixture(), view = f.load('server/views/dashboard.html.ts');
  const attack = '<img src="/fixture-missing" onerror="window.__fixtureXss=true">';
  const quoted = "USD'quoted";
  f.rates.parallel[quoted] = 9.8;
  const queue = { queueSize: 1, items: [{ id: 'USD', name: 'Dollar ' + attack, newVal: 9.8, oldVal: 9.7, diff: .1, ageSeconds: 60,
    targets: ['telegram', 'facebook'], delivered: { telegram: true }, attempts: { facebook: 4 }, lastError: 'Fixture failed ' + attack }] };
  const state = { rates: f.rates, terms: f.config.terms, activeJobs: [], broadcastQueue: queue,
    recentLogs: [{ message: '</script><script>window.__fixtureInitial=true</script>' }],
    accounts: { telegram: {}, whatsapp: {}, facebook: {} }, memory: {}, broadcastConfig: {} };
  const browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER_CHANNEL || undefined });
  try {
    for (const width of [390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'worker.fixture') return route.abort();
        if (url.pathname === '/dashboard') return route.fulfill({ contentType: 'text/html', body: view.renderDashboardHtml(state) });
        if (url.pathname.endsWith('/ingested-messages')) return route.fulfill({ json: { success: true, messages: [{
          source: attack, timestamp: new f.Clock().toISOString(), rawText: attack, status: 'ignored' }] } });
        if (url.pathname.endsWith('/stats')) return route.fulfill({ json: state });
        if (url.pathname.endsWith('/sources')) return route.fulfill({ json: { success: true, whatsappSources: [
          { jid: 'dealer@g.us', name: 'Dealer ' + attack, enabled: false, type: 'group' },
          { jid: 'prices@newsletter', name: 'Channel', enabled: false, type: 'channel' },
          { jid: 'private@s.whatsapp.net', name: 'Private', enabled: false, type: 'chat' }
        ], whatsappReachableChats: [{ id: 'discovered@g.us', name: 'Discovered', type: 'group' }] } });
        return route.fulfill({ json: { success: true, queue, messages: [], channels: [], data: {} } });
      });
      await page.goto('http://worker.fixture/dashboard');
      await page.waitForFunction(() => typeof renderQueueUI === 'function');
      await page.evaluate(async () => { await fetchIngestedMessages(); });
      assert.equal(await page.evaluate(() => window.__fixtureXss || window.__fixtureInitial || false), false);
      await page.locator('#tab-btn-sources').click();
      await page.waitForFunction(() => document.querySelectorAll('#wa-sources-list-container input').length === 4);
      const autoSources = page.locator('#wa-sources-list-container input:disabled');
      assert.equal(await autoSources.count(), 3);
      assert.equal(await page.locator('#wa-sources-list-container input:disabled:checked').count(), 3);
      const manual = page.locator('#wa-sources-list-container input:not(:disabled)');
      assert.equal(await manual.count(), 1); assert.equal(await manual.isChecked(), false);
      assert.equal(await page.locator('#wa-sources-list-container button').count(), 1, 'Only manually configured sources offer per-source deletion');
      assert.equal(await page.locator('#wa-sources-list-container img').count(), 0);
      assert.ok((await autoSources.first().getAttribute('aria-label')).includes('Dealer'));
      await page.evaluate(code => {
        const button = [...document.querySelectorAll('.rate-btn-edit')].find(b => b.getAttribute('onclick').includes(code));
        button.click();
      }, quoted);
      assert.equal(await page.locator('#modal-code').inputValue(), quoted);
      await page.evaluate(() => closeRateModal());
      await page.evaluate(queue => { switchTab('broadcast'); renderQueueUI(queue); }, queue);
      const text = await page.locator('#queue-items-container').innerText();
      assert.ok(text.includes('Telegram: تم الإرسال')); assert.ok(text.includes('يتطلب إعادة محاولة يدوية'));
      assert.ok((await page.locator('#queue-status-badge').innerText()).includes('يتطلب مراجعة'));
      assert.equal(await page.locator('#queue-items-container img').count(), 0);
      assert.equal(await page.evaluate(() => window.__fixtureXss || window.__fixtureInitial || false), false);
      assert.deepEqual(errors, []);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      if (process.env.UI_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.UI_ARTIFACT_DIR, 'worker-queue-' + width + '.png'), fullPage: true });
      if (dimensions.scroll > dimensions.client + 1) {
        console.error(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
          const box = el.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1);
        }).slice(-8).map(el => ({ tag: el.tagName, id: el.id, text: el.textContent.slice(0, 90) }))));
      }
      assert.ok(dimensions.scroll <= dimensions.client + 1, 'Page overflow at ' + width + ': ' + JSON.stringify(dimensions));
      await page.close();
      console.log('PASS dashboard ' + width + 'px: safe source text, automatic group/channel controls, quoted edit handler, queue status, no page overflow');
    }
    const login = view.renderLoginHtml({ clientIp: attack });
    assert.ok(!login.includes('IP: ' + attack));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
