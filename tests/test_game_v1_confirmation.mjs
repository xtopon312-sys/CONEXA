/* Isolated real Chromium UI regression. No ESP32, credentials or native C host. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(process.env.CONEXA_PLAYWRIGHT_MODULE || import.meta.url);
const playwright = 'playwright';
const { chromium } = require(playwright);

test('teacher confirmation is bound to boot, epoch, teacher receipt and authenticated session', async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const source = await readFile(new URL('../web/game_v1.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../web/game_v1.css', import.meta.url), 'utf8');
    await page.setContent('<!doctype html><style>' + css + '</style><main><canvas id="iso-world" tabindex="0"></canvas><div id="view-menu"></div><div id="teacher-panel"></div></main><script>' + source + '</script>');
    await page.evaluate(() => {
      window.calls = [];
      window.session = {
        v: 1, boot: '0000000000000001', epoch: 1, rev: 1, phase: 'open', mission: 0, released: 1,
        positions: '79' + '--'.repeat(43), completed: [0, 0, 0], decisions: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        me: null, teacher: { seq: 1, progress: '0000' + '----'.repeat(43) }
      };
      window.access = { online: true, authenticated: true, busy: false, ownId: 0, position: null };
      window.app = createGameV1UI({
        view: 'teacher', send: (op, arg) => { calls.push({ op, arg }); return true; }, navigate: () => {}
      });
      app.update(session, access);
    });
    const open = async op => {
      await page.locator('#v1-control-' + op).click();
      assert.equal(await page.locator('#v1-confirmation').evaluate(node => node.open), true);
    };
    const cancelled = async () => {
      assert.equal(await page.locator('#v1-confirmation').evaluate(node => node.open), false);
      assert.equal(await page.evaluate(() => calls.length), 0);
      assert.match(await page.locator('#v1-teacher-panel .v1-notice').innerText(), /confirmação anterior foi cancelada/);
    };
    await t.test('epoch change cancels a pending reset without sending it', async () => {
      await open('reset');
      await page.evaluate(() => { session = { ...session, epoch: 2, teacher: { ...session.teacher, seq: 0 } }; app.update(session, access); });
      await cancelled();
    });
    await t.test('boot change cancels a pending finish without sending it', async () => {
      await open('finish');
      await page.evaluate(() => { session = { ...session, boot: '0000000000000002' }; app.update(session, access); });
      await cancelled();
    });
    await t.test('another teacher receipt cancels a pending advance without sending it', async () => {
      await open('next');
      await page.evaluate(() => { session = { ...session, teacher: { ...session.teacher, seq: 1 } }; app.update(session, access); });
      await cancelled();
    });
    await t.test('logout clears confirmation and removes authorized controls', async () => {
      await open('reset');
      await page.evaluate(() => app.update(null, { ...access, authenticated: false }));
      await cancelled();
      assert.equal(await page.locator('#v1-control-reset').count(), 0);
    });
    await t.test('a fresh confirmation after reauthentication sends exactly once', async () => {
      await page.evaluate(() => app.update(session, access));
      await open('finish');
      await page.locator('#v1-confirmation').getByRole('button', { name: 'Confirmar', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => calls), [{ op: 'finish', arg: 0 }]);
      assert.equal(await page.locator('#v1-confirmation').evaluate(node => node.open), false);
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
