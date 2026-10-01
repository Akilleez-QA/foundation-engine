#!/usr/bin/env node
// Real shell and Graphics row; diagnostic world, no physical-device or game acceptance.
import assert from 'node:assert/strict';
import {diagnosticReport} from './diagnostic-report.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { ROOT } from './lib.mjs';
import { launch } from '../perf/bench-browser.mjs';
const out = resolve(process.argv[2] ?? 'playtest/compact-shell');
mkdirSync(out, { recursive: true });
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app"></main><script type="module" src="/scripts/play/fixtures/hud-entry.mjs"></script></body></html>';
const server = await createServer({ root: ROOT, logLevel: 'error', plugins: [{ name: 'shell-diagnostic', configureServer(s) {
 s.middlewares.use((req, res, next) => { if (req.url?.startsWith('/__shell.html')) { res.setHeader('Content-Type', 'text/html'); res.end(html); } else next(); });
} }], server: { host: '127.0.0.1', port: 0 } });
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), dirtyWorktree: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0, passed: false, cases: [], limitations: ['Chromium viewport emulation, not physical touch/controller acceptance', 'Stock shell controls over a diagnostic world; no general game playability certification'] };
const evidence = diagnosticReport(report,resolve(out,'report.json'));
try {
 await server.listen();
 for (const [name, view, mode] of [
  ['portrait', { width: 390, height: 844, mobile: true }, 'compact'],
  ['landscape', { width: 844, height: 390, mobile: true }, 'compact'],
  ['desktop', { width: 1280, height: 800 }, 'expanded'],
 ]) {
  const browser = await launch({...view,strictClose:true});
  const page = browser.page;
  try {
   await page.goto(`${server.resolvedUrls.local[0]}__shell.html?flags=dev.silent&quality=reference&shell=${mode}#scene/sample`);
   await page.waitForFunction(() => window.hudCheck?.state().world?.state.frames > 2 && document.querySelector('#graphics-button'));
   const trigger = page.locator('.shell-menu summary');
   if (mode === 'expanded') {
    assert.equal(await page.locator('.shell-menu-compact').count(), 0);
    await trigger.click();
    assert.equal(await page.locator('.shell-compact-panel').count(), 0);
    assert.equal(await page.locator('#shell-sound').isVisible(), true);
    await page.screenshot({ path: resolve(out, `${name}.png`) });
   } else {
    for (const large of [false, true]) {
     if (large) await page.evaluate(() => document.documentElement.style.setProperty('--engine-text-md', '28px'));
     const bounds = await trigger.boundingBox();
     assert.ok(bounds.width >= 48 && bounds.height >= 48);
     await page.locator('.scene-view').focus();
     await page.keyboard.down('ArrowRight');
     await page.waitForFunction(() => window.hudCheck.state().world.state.move === 1);
     await trigger.tap();
     await page.locator('.shell-compact-panel').waitFor();
     await page.waitForTimeout(60);
     const paused = await page.evaluate(() => window.hudCheck.state().world.state.frames);
     await page.waitForTimeout(80);
     assert.equal(await page.evaluate(() => window.hudCheck.state().world.state.frames), paused);
     for (const selector of ['#shell-sound', '#graphics-button', '.shell-compact-close']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.width >= 48 && box.height >= 48);
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height);
     }
     await page.screenshot({ path: resolve(out, `${name}${large ? '-text-200' : ''}.png`) });
     await page.keyboard.press('Escape');
     await page.locator('.shell-compact-panel').waitFor({ state: 'detached' });
     assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
     await page.waitForFunction(frames => window.hudCheck.state().world.state.frames > frames, paused);
     assert.equal(await page.evaluate(() => window.hudCheck.state().world.state.move), 0);
     await page.keyboard.up('ArrowRight');
    }
    await trigger.tap();
    const before = await page.locator('#shell-sound').textContent();
    await page.locator('#shell-sound').tap();
    await page.locator('.shell-compact-panel').waitFor({ state: 'detached' });
    assert.notEqual(await page.locator('#shell-sound').textContent(), before);
    await trigger.tap();
    await page.locator('#graphics-button').tap();
    await page.locator('.shell-compact-panel').waitFor({ state: 'detached' });
    await page.locator('dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
   }
   assert.deepEqual(browser.errors, []);
   report.cases.push({ name, view, mode, errors: browser.errors });
  } finally { await evidence.close(browser,`${name} browser cleanup`); }
 }
 report.passed = true;
} catch(error) { evidence.fail(error); } finally {
 await evidence.close(server,'server cleanup');
 evidence.finish();
}
