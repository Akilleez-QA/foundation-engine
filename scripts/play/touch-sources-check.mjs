#!/usr/bin/env node
// Genuine simultaneous Chromium contacts; not physical touchscreen/device acceptance.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out = resolve(process.argv[2] ?? 'playtest/touch-sources');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Touch sources diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/touch-sources-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'touch-sources-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__touch-sources.html')) {
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
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  limitations: ['Chromium CDP touch emulation; not physical-device evidence'],
  errors: [],
};
const browser = await launch({width: 390, height: 844, mobile: true, hasTouch: true});
const p = browser.page;
await browser.cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 2});
try {
  await p.goto(
    `${server.resolvedUrls.local[0]}__touch-sources.html?touch-sources=1&flags=dev.silent&quality=reference#scene/sample`,
  );
  await p.waitForFunction(() => window.touchCheck && window.hudCheck.state().world?.state.frames > 2);
  report.maxTouchPoints = await p.evaluate(() => navigator.maxTouchPoints);
  assert.equal(report.maxTouchPoints, 2);
  const point = async (id, selector) => {
    const r = await p.locator(selector).boundingBox();
    return {id, x: r.x + r.width / 2, y: r.y + r.height / 2};
  };
  const movement = await point(1, '#touch-movement');
  const details = await point(2, '#touch-details');
  const send = (type, touchPoints) => browser.cdp.send('Input.dispatchTouchEvent', {type, touchPoints});
  await send('touchStart', [movement]);
  assert.equal(await p.evaluate(() => window.touchCheck.held()), true);
  // Second concurrent contact reaches its action while movement remains physically down.
  await send('touchStart', [movement, details]);
  await p.waitForFunction(() => window.touchCheck.presses() === 1);
  assert.equal(await p.evaluate(() => window.touchCheck.presses()), 1);
  assert.equal(
    await p.evaluate(() => window.touchCheck.held()),
    true,
    'independent second contact does not release movement',
  );
  await send('touchEnd', [details]);
  assert.equal(await p.evaluate(() => window.touchCheck.held()), true, 'releasing action contact preserves movement');
  await p.evaluate(() => window.touchCheck.enableModal());
  await send('touchStart', [movement, details]);
  await p.locator('.hud-details-sheet').waitFor();
  assert.equal(await p.evaluate(() => window.touchCheck.held()), false, 'modal cancels old movement');
  await send('touchEnd', [details]);
  await p.keyboard.press('Escape');
  await p.locator('.hud-details-sheet').waitFor({state: 'detached'});
  await send('touchMove', [{...movement, x: movement.x + 5}]);
  assert.equal(await p.evaluate(() => window.touchCheck.held()), false, 'old held contact cannot restart after modal');
  await send('touchEnd', []);
  await send('touchStart', [movement]);
  assert.equal(await p.evaluate(() => window.touchCheck.held()), true, 'fresh contact rearms');
  await p.screenshot({path: resolve(out, 'held.png')});
  report.contacts = await p.evaluate(() => window.touchCheck.contacts());
  assert.ok(report.contacts.some(contact => contact.primary === false && contact.target === 'touch-details'));
  // The ui kit's touch button: one press, held across fixed ticks, released on slide-off and lift.
  await send('touchEnd', []);
  report.holdButton = await p.locator('.touch-button').boundingBox();
  assert.ok(report.holdButton.width >= 48 && report.holdButton.height >= 48, 'touch button is at least 48 CSS px');
  const hold = await point(3, '.touch-button');
  const holdState = () => p.evaluate(() => window.touchCheck.holdState());
  const frames = n =>
    p.evaluate(
      n =>
        new Promise(r => {
          const step = k => (k ? requestAnimationFrame(() => step(k - 1)) : r());
          step(n);
        }),
      n,
    );
  await send('touchStart', [hold]);
  await p.waitForFunction(() => window.touchCheck.holdState().ticks > 6);
  report.holdHeld = await holdState();
  assert.equal(report.holdHeld.presses, 1, 'a held touch is one press');
  assert.equal(report.holdHeld.held, true);
  assert.equal(report.holdHeld.down, true);
  await send('touchMove', [{...hold, x: hold.x + 4}]);
  await frames(3);
  assert.deepEqual(
    [(await holdState()).presses, (await holdState()).held],
    [1, true],
    'moving on the button keeps one held press',
  );
  await send('touchMove', [{...hold, x: hold.x - 200}]);
  await frames(2);
  assert.equal((await holdState()).held, false, 'sliding off releases');
  await send('touchMove', [hold]);
  await frames(2);
  assert.deepEqual(
    [(await holdState()).presses, (await holdState()).held],
    [1, false],
    'sliding back does not re-press',
  );
  await send('touchEnd', []);
  await send('touchStart', [hold]);
  await p.waitForFunction(() => window.touchCheck.holdState().presses === 2);
  assert.equal((await holdState()).held, true, 'a fresh touch presses and holds again');
  await send('touchEnd', []);
  await frames(2);
  report.holdReleased = await holdState();
  assert.deepEqual(
    [report.holdReleased.presses, report.holdReleased.held, report.holdReleased.down],
    [2, false, false],
    'lift releases',
  );
  // Hold movement again so owner disposal below still releases a held contact.
  await send('touchStart', [movement]);
  assert.equal(await p.evaluate(() => window.touchCheck.held()), true);
  await p.evaluate(() => window.touchCheck.dispose());
  assert.equal(await p.evaluate(() => window.touchCheck.held()), false, 'owner disposal releases held action');
  await send('touchEnd', []);
  await p.locator('.scene-view').focus();
  await p.keyboard.down('ArrowRight');
  assert.equal(await p.evaluate(() => window.touchCheck.held()), true);
  await p.keyboard.up('ArrowRight');
  assert.equal(await p.evaluate(() => window.touchCheck.held()), false);
  report.errors = [...browser.errors];
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  console.error(browser.errors);
  console.error(
    await p.evaluate(() => ({
      contacts: window.touchCheck?.contacts(),
      held: window.touchCheck?.held(),
      layers: window.hudCheck?.state().layers,
    })),
  );
  await p.screenshot({path: resolve(out, 'failure.png')});
  throw error;
} finally {
  await browser.close();
  await server.close();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`Touch sources passed; evidence ${out}`);
