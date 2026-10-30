#!/usr/bin/env node
// Real composition fixture, not shipped application/device acceptance.
// node -r ./scripts/silent-browser.cjs scripts/play/hud-check.mjs [output-directory]
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-hud-evidence');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>HUD lifecycle diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/hud-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'hud-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__hud-check.html')) {
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          } else next();
        });
      },
    },
  ],
  server: {host: '127.0.0.1', port: 0},
});
await server.listen();
const url = server.resolvedUrls.local[0];
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  profiles: [],
  limitations: [
    'Chromium emulation, not physical-device acceptance',
    'Controller tests include both dispatcher injection and synthetic navigator snapshots through the installed poll adapter; no physical hardware acceptance',
    'Diagnostic scene only; existing templates keep their authored presentation',
    'Inline screenshots intentionally overflow and obscure the game world; passing lifecycle assertions do not certify application visibility, readability or desktop playability',
  ],
};
try {
  for (const [name, view] of Object.entries({
    phone: {width: 390, height: 844, mobile: true},
    tablet: {width: 820, height: 1180, mobile: true},
    desktop: {width: 1280, height: 800},
  })) {
    const b = await launch(view);
    const p = b.page;
    const requests = [];
    p.on('request', request => requests.push(request.url()));
    await p.addInitScript(connected => {
      const buttons = Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}));
      let revision = 0,
        queued = -1;
      window.testPadInput = {
        sampled: -1,
        set(index, pressed) {
          buttons[index] = {pressed, touched: pressed, value: pressed ? 1 : 0};
          return ++revision;
        },
        neutral() {
          for (let index = 0; index < buttons.length; index++)
            buttons[index] = {pressed: false, touched: false, value: 0};
          return ++revision;
        },
      };
      window.testPad = {
        index: 0,
        id: 'Standard diagnostic controller',
        mapping: 'standard',
        connected,
        axes: [0, 0, 0, 0],
        get buttons() {
          // Only the installed sampler reads buttons; lazy availability checks do not.
          // Publish acknowledgement after that synchronous sample has processed edges/neutrality.
          const observed = revision;
          if (queued !== observed) {
            queued = observed;
            queueMicrotask(() => {
              window.testPadInput.sampled = Math.max(window.testPadInput.sampled, observed);
            });
          }
          return buttons;
        },
      };
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => (window.testPad.connected ? [window.testPad] : []),
      });
    }, name === 'desktop');
    try {
      await p.goto(`${url}__hud-check.html?flags=dev.silent&quality=reference&layout=disclose#scene/sample`);
      await p.waitForFunction(() => window.hudCheck?.state().world?.state.frames > 2, {}, {timeout: 10000});
      const state = () => p.evaluate(() => window.hudCheck.state());
      const base = await state();
      assert.equal(await p.locator('.hud-lines [data-hud]').count(), 1);
      const visibility = await p.evaluate(() => window.hudCheck.measure());
      assert.equal(visibility.report.criticalRegions[0].area, 4096);
      assert.equal(visibility.report.criticalRegions[0].occupiedArea, 0);
      await p.screenshot({path: resolve(out, `${name}-closed.png`)});
      const target = p.locator('.hud-details-trigger');
      const bounds = await target.boundingBox();
      assert.ok(bounds.width >= 48 && bounds.height >= 48);
      if (view.mobile) await target.tap();
      else await target.click();
      await p.locator('.hud-details-sheet').waitFor();
      await p.waitForTimeout(60);
      const paused = await state();
      await p.waitForTimeout(100);
      const still = await state();
      assert.equal(still.world.state.frames, paused.world.state.frames, 'reading sheet pauses simulation');
      assert.equal(still.activities, base.activities + 1);
      assert.equal(still.layers, base.layers + 1);
      assert.equal(await p.locator('.hud-detail-content [data-hud]').count(), 12);
      await p.screenshot({path: resolve(out, `${name}-sheet.png`)});
      assert.equal(await p.locator('.hud-details-scroll').evaluate(e => e === document.activeElement), true);
      assert.equal(
        await p.locator('.hud-details-scroll').evaluate(e => e.scrollHeight > e.clientHeight),
        true,
        'fixture requires paging',
      );
      await p.keyboard.press('PageDown');
      await p.waitForFunction(() => document.querySelector('.hud-details-scroll').scrollTop > 0);
      // No-op modal helpers must preserve native scrolling and same-element custom Enter behavior.
      await p.evaluate(() => {
        const box = document.createElement('div');
        box.className = 'native-reading-diagnostic';
        box.tabIndex = 0;
        box.style.cssText = 'height:70px;flex:none;overflow:auto;';
        box.textContent = 'Native scrolling content. '.repeat(100);
        box.addEventListener('keydown', e => {
          if (e.key === 'Enter') box.dataset.confirmed = 'yes';
        });
        document.querySelector('.hud-details-sheet').append(box);
        box.focus();
      });
      await p.keyboard.press('PageDown');
      await p.waitForFunction(() => document.querySelector('.native-reading-diagnostic').scrollTop > 0);
      await p.keyboard.press('Enter');
      assert.equal(await p.locator('.native-reading-diagnostic').getAttribute('data-confirmed'), 'yes');
      await p.locator('.native-reading-diagnostic').evaluate(e => e.remove());
      await p.locator('.hud-details-close').click();
      await p.locator('.hud-details-sheet').waitFor({state: 'detached'});
      assert.equal(await target.evaluate(e => e === document.activeElement), true);
      await p.waitForFunction(frames => window.hudCheck.state().world.state.frames > frames, paused.world.state.frames);
      // Same named action through keyboard, then layer-owned Back.
      await p.locator('.scene-view').focus();
      await p.keyboard.press('i');
      await p.locator('.hud-details-sheet').waitFor();
      await p.keyboard.press('Escape');
      await p.locator('.hud-details-sheet').waitFor({state: 'detached'});
      // Existing controller dispatcher path (not simulated keyboard).
      await p.locator('.scene-view').focus();
      await p.evaluate(() => {
        window.hudCheck.pad('y', true);
        window.hudCheck.pad('y', false);
      });
      await p.locator('.hud-details-sheet').waitFor();
      await p.evaluate(() => {
        window.hudCheck.pad('b', true);
        window.hudCheck.pad('b', false);
      });
      await p.locator('.hud-details-sheet').waitFor({state: 'detached'});
      await p.locator('.scene-view').focus();
      await p.keyboard.down('ArrowRight');
      await p.waitForFunction(() => window.hudCheck.state().world.state.move === 1);
      await target.click();
      await p.locator('.hud-details-sheet').waitFor();
      const heldPause = await state();
      await p.locator('.hud-details-close').click();
      await p.waitForFunction(
        frame => window.hudCheck.state().world.state.frames > frame,
        heldPause.world.state.frames,
      );
      assert.equal((await state()).world.state.move, 0, 'opening cancels held gameplay input');
      await p.keyboard.up('ArrowRight');
      await p.locator('.scene-view').focus();
      await p.evaluate(() => {
        window.hudCheck.pad('y', true);
        window.hudCheck.pad('y', false);
      });
      await p.locator('.hud-details-sheet').waitFor();
      await p.evaluate(() => {
        window.hudCheck.pad('rb', true);
        window.hudCheck.pad('rb', false);
      });
      await p.waitForFunction(() => document.querySelector('.hud-details-scroll').scrollTop > 0);
      await p.evaluate(() => {
        window.hudCheck.pad('dpad-down', true);
        window.hudCheck.pad('dpad-down', false);
        window.hudCheck.pad('a', true);
        window.hudCheck.pad('a', false);
      });
      await p.locator('.hud-details-sheet').waitFor({state: 'detached'});
      // Bounded repeated child ownership; every opening crosses an asynchronous adoption boundary.
      await p.evaluate(async () => {
        for (let i = 0; i < 100; i++) {
          window.hudCheck.details(true);
          await new Promise(r => setTimeout(r, 0));
          window.hudCheck.details(false);
          await Promise.resolve();
        }
      });
      const cycled = await state();
      assert.equal(cycled.activities, base.activities);
      assert.equal(cycled.layers, base.layers);
      for (const key of ['created', 'contexts', 'leases', 'losses'])
        assert.equal(cycled.pool[key], base.pool[key], `render pool ${key} remains bounded`);
      assert.equal(await p.locator('.hud-details-sheet').count(), 0);
      // Exercise the installed navigator polling adapter, not dispatcher injection.
      if (name !== 'desktop') {
        assert.equal(
          requests.some(url => url.includes('/input/action-gamepad.ts')),
          false,
          'no controller adapter request before connection',
        );
        const loaded = p.waitForResponse(
          response => response.url().includes('/input/action-gamepad.ts') && response.ok(),
        );
        await p.evaluate(() => {
          window.testPad.connected = true;
          window.dispatchEvent(Object.assign(new Event('gamepadconnected'), {gamepad: window.testPad}));
        });
        await loaded;
      }
      const sampled = revision => p.waitForFunction(value => window.testPadInput.sampled >= value, revision);
      const padButton = async (index, pressed) => {
        const revision = await p.evaluate(({index, pressed}) => window.testPadInput.set(index, pressed), {
          index,
          pressed,
        });
        await sampled(revision);
      };
      await p.locator('.scene-view').focus();
      await sampled(await p.evaluate(() => window.testPadInput.neutral()));
      await padButton(3, true);
      await p.locator('.hud-details-sheet').waitFor();
      await padButton(3, false);
      assert.equal(await p.locator('.hud-details-scroll').evaluate(e => e === document.activeElement), true);
      await padButton(5, true);
      await p.waitForFunction(() => document.querySelector('.hud-details-scroll').scrollTop > 0);
      await padButton(5, false);
      await padButton(13, true);
      await padButton(13, false);
      assert.equal(await p.locator('.hud-details-close').evaluate(e => e === document.activeElement), true);
      await padButton(0, true);
      await p.locator('.hud-details-sheet').waitFor({state: 'detached'});
      await padButton(0, false);
      await p.locator('.scene-view').focus();
      await padButton(15, true);
      await p.waitForFunction(() => window.hudCheck.state().world.state.move === 1);
      await p.evaluate(() => {
        window.testPad.connected = false;
        window.dispatchEvent(new Event('gamepaddisconnected'));
      });
      await p.waitForFunction(() => window.hudCheck.state().world.state.move === 0);
      await p.evaluate(() => {
        document.documentElement.style.setProperty('--engine-text-lg', '32px');
        document.documentElement.style.setProperty('--engine-text-xl', '36px');
        window.hudCheck.presentLong();
      });
      const largeVisibility = await p.evaluate(() => window.hudCheck.measure());
      assert.equal(largeVisibility.report.criticalRegions[0].occupiedArea, 0);
      await p.screenshot({path: resolve(out, `${name}-long-label.png`)});
      await target.click();
      await p.locator('.hud-details-sheet').waitFor();
      const close = await p.locator('.hud-details-close').boundingBox();
      assert.ok(
        close.x >= 0 && close.y >= 0 && close.x + close.width <= view.width && close.y + close.height <= view.height,
      );
      await p.screenshot({path: resolve(out, `${name}-text-200.png`)});
      await p.locator('.hud-details-close').click();
      await p.evaluate(() => {
        document.documentElement.style.removeProperty('--engine-text-lg');
        document.documentElement.style.removeProperty('--engine-text-xl');
      });
      await p.evaluate(() => window.hudCheck.present('inline'));
      assert.equal(await p.locator('.hud-lines [data-hud]').count(), 13);
      assert.equal(await target.isVisible(), false);
      // Authored negative case: inline secondary text must fail this fixture's clear-subject criterion.
      // The header uses display:contents here; measuring its box would falsely report zero obstruction.
      const overcrowded = await p.evaluate(() => window.hudCheck.measure());
      assert.equal(overcrowded.report.criticalRegions[0].area, 4096, 'subject must remain in view');
      assert.ok(
        overcrowded.footprints.some(rect => rect.width > 0 && rect.height > 0),
        'measure rendered children',
      );
      assert.ok(
        overcrowded.report.criticalRegions[0].occupiedArea > 0,
        'overcrowded inline layout must fail clear-subject criterion',
      );
      await p.screenshot({path: resolve(out, `${name}-inline.png`)});
      await p.evaluate(() => window.hudCheck.present('disclose'));
      assert.equal(await p.locator('.hud-lines [data-hud]').count(), 1);
      const recoveredVisibility = await p.evaluate(() => window.hudCheck.measure());
      assert.equal(recoveredVisibility.report.criticalRegions[0].area, 4096);
      assert.equal(recoveredVisibility.report.criticalRegions[0].occupiedArea, 0, 'disclosure restores clear subject');
      await target.click();
      await p.locator('.hud-details-sheet').waitFor();
      await p.evaluate(() => window.hudCheck.goto('other'));
      await p.waitForFunction(() => window.hudCheck.state().world?.scene === 'other');
      assert.equal(await p.locator('.hud-details-sheet').count(), 0);
      assert.equal((await state()).activities, base.activities);
      assert.deepEqual(b.errors, []);
      report.profiles.push({
        name,
        view,
        base,
        paused,
        cycled,
        visibility,
        largeVisibility,
        overcrowded,
        recoveredVisibility,
        errors: b.errors,
        browser: b.version,
      });
    } catch (error) {
      console.error(
        name,
        b.errors,
        await p
          .evaluate(() => ({
            boot: window.hudBoot ? true : false,
            check: window.hudCheck?.state(),
            scroll: (() => {
              const e = document.querySelector('.hud-details-scroll');
              return (
                e && {client: e.clientHeight, height: e.scrollHeight, top: e.scrollTop, html: e.outerHTML.slice(0, 500)}
              );
            })(),
            text: document.body.innerText,
          }))
          .catch(() => null),
      );
      throw error;
    } finally {
      await b.close();
    }
  }
  // Creator-authored viewport selection: one real visit crossing its configured boundary.
  const layoutBrowser = await launch({width: 390, height: 844});
  const page = layoutBrowser.page;
  try {
    await page.goto(`${url}__hud-check.html?flags=dev.silent&quality=reference&layout=profiles#scene/sample`);
    await page.waitForFunction(() => window.hudCheck?.state().world?.state.frames > 2, {}, {timeout: 10000});
    const trigger = page.locator('.hud-details-trigger');
    const state = () => page.evaluate(() => window.hudCheck.state());
    const baseline = await state();
    const resizeEvidence = [];
    const resizeObserved = async (width, height) => {
      const before = (await state()).observedView.notifications;
      await page.setViewportSize({width, height});
      // The shell occupies part of the viewport; acknowledge the actual scene area.
      const sceneSize = await page.locator('.scene-view').evaluate(element => ({
        width: element.clientWidth,
        height: element.clientHeight,
      }));
      assert.equal(sceneSize.width, width, 'fixture scene spans the requested viewport width');
      await page.waitForFunction(
        ({sceneSize, before}) => {
          const observed = window.hudCheck.state().observedView;
          return (
            observed?.width === sceneSize.width &&
            observed.height === sceneSize.height &&
            observed.notifications > before
          );
        },
        {sceneSize, before},
      );
      const observed = (await state()).observedView;
      resizeEvidence.push({requested: {width, height}, sceneSize, observed});
    };
    assert.equal(await page.locator('.hud-lines [data-hud]').count(), 1);
    await page.locator('.scene-view').focus();
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => window.hudCheck.state().world.state.move === 1);
    await trigger.click();
    await page.locator('.hud-details-sheet').waitFor();
    await page.waitForTimeout(60);
    const paused = await state();
    await page.locator('.hud-details-sheet').evaluate(element => {
      element.dataset.layoutIdentity = 'original';
    });
    await resizeObserved(600, 844);
    assert.equal(
      await page.locator('.hud-details-sheet').getAttribute('data-layout-identity'),
      'original',
      'same selected layout retains the owned sheet',
    );
    assert.equal(
      await page.locator('.hud-details-scroll').evaluate(element => element === document.activeElement),
      true,
    );
    assert.equal(
      (await state()).world.state.frames,
      paused.world.state.frames,
      'same-layout resize keeps simulation paused',
    );
    await page.screenshot({path: resolve(out, 'layout-profiles-sheet-retained.png')});
    await resizeObserved(1000, 800);
    await page.locator('.hud-details-sheet').waitFor({state: 'detached'});
    await page.waitForFunction(
      frames => window.hudCheck.state().world.state.frames > frames,
      paused.world.state.frames,
    );
    const resumed = await state();
    assert.equal(resumed.layers, baseline.layers);
    assert.equal(resumed.activities, baseline.activities);
    assert.equal(resumed.world.state.move, 0, 'resize closure must not revive the key held before disclosure');
    assert.equal(
      await page.locator('.scene-view').evaluate(element => element === document.activeElement),
      true,
      'hidden trigger restores scene focus',
    );
    assert.equal(await page.locator('.hud-lines [data-hud]').count(), 13);
    assert.equal(await trigger.isVisible(), false);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => window.hudCheck.state().world.state.move === 1);
    await page.keyboard.up('ArrowRight');
    await page.waitForFunction(() => window.hudCheck.state().world.state.move === 0);
    await page.screenshot({path: resolve(out, 'layout-profiles-inline.png')});
    await resizeObserved(390, 844);
    await trigger.waitFor({state: 'visible'});
    assert.equal(await page.locator('.hud-details-sheet').count(), 0, 'selecting disclosure does not open a sheet');
    await page.evaluate(() => window.hudCheck.present('inline'));
    await resizeObserved(1100, 800);
    await resizeObserved(400, 844);
    assert.equal(await trigger.isVisible(), false, 'manual presentation detaches automatic selection');
    assert.equal(await page.locator('.hud-lines [data-hud]').count(), 13);
    await page.evaluate(() => window.hudCheck.goto('other'));
    await page.waitForFunction(() => window.hudCheck.state().world?.scene === 'other');
    await resizeObserved(500, 800);
    assert.equal(await page.locator('.hud-details-sheet').count(), 0);
    assert.deepEqual(layoutBrowser.errors, []);
    report.layoutSelection = {
      baseline,
      paused,
      resumed,
      resizeEvidence,
      browser: layoutBrowser.version,
      errors: layoutBrowser.errors,
      assertions: [
        'same-selection sheet and focus retained',
        'inline transition closes owned sheet and resumes scene',
        'held input cancelled and fresh input works',
        'manual override survives resizing',
        'route exit leaves no sheet',
      ],
    };
  } finally {
    await layoutBrowser.close();
  }
  report.passed = true;
} finally {
  await server.close();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`HUD lifecycle: ${report.profiles.length} profiles passed; evidence ${out}`);
