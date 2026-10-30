#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/action-workbench');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  consoleErrors: [],
  screenshots: [],
  limitations: [
    'Desktop Chromium1440x960 keyboard/pointer only; no physical-device, phone/tablet or multiplayer certification.',
    'Session-owned accepted results; no durable or cross-reload exactly-once claim.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json')),
  server = await createServer({root: ROOT, logLevel: 'error', server: {host: '127.0.0.1', port: 0}});
let browser;
const snapshots = {};
try {
  await server.listen();
  browser = await launch({width: 1440, height: 960, strictClose: true});
  const page = browser.page;
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') report.consoleErrors.push(m.text());
  });
  const read = () => page.evaluate(() => actionWorkbench.read()),
    ui = () => page.evaluate(() => actionWorkbench.ui()),
    world = () => page.evaluate(() => actionWorkbench.world()),
    cue = () => page.evaluate(() => actionWorkbench.cue()),
    click = id => page.locator('#' + id).click(),
    fill = (id, n) => page.locator('#' + id).fill(String(n));
  const open = async () => {
    if (!(await ui()).sheet) {
      await page.locator('#open').focus();
      await page.keyboard.press('Enter');
      await page
        .locator('#details')
        .waitFor({state: 'visible'})
        .catch(async error => {
          report.openFailure = await page.evaluate(() => ({
            ui: actionWorkbench.ui(),
            state: engine.state(),
            text: document.body.innerText,
          }));
          throw error;
        });
    }
  };
  const shot = async name => {
    const path = resolve(out, name + '.png');
    await page.screenshot({path});
    report.screenshots.push(path);
  };
  const result = async () => (await ui()).result;
  const visible = async () => {
    const before = await page.evaluate(() => engine.loop().renders);
    if ((await ui()).sheet) await click('close');
    await page.waitForFunction(() => !actionWorkbench.ui().sheet);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.evaluate(() => engine.loop().renders);
    snapshots.renderObservations ??= [];
    snapshots.renderObservations.push({before, after, world: await world()});
  };
  const mutation = async button => {
    const before = await page.evaluate(() => engine.loop().renders),
      prior = JSON.stringify(await world());
    await click(button);
    if (!(await ui()).sheet && JSON.stringify(await world()) !== prior)
      await page.waitForFunction(n => engine.loop().renders > n, before);
    await open();
    return result();
  };
  const prepare = async ({target = 'a', amount = 3, delay = 2, expiry = 10} = {}) => {
    await open();
    await page.locator('#target').selectOption(target);
    await fill('amount', amount);
    await fill('delay', delay);
    await fill('expiry', expiry);
    await click('prepare');
    assert.equal((await result()).status, 'admitted');
    return (await ui()).selected;
  };
  const advance = async amount => {
    await fill('advance-by', amount);
    await click('advance');
    assert.equal((await result()).status, 'advanced');
  };
  const accepted = async (expectedA, expectedB, count) => {
    const s = await read();
    assert.equal(s.accepted.resources.a ?? 0, expectedA);
    assert.equal(s.accepted.resources.b ?? 0, expectedB);
    assert.equal(s.accepted.receipts.length, count);
    assert.equal(new Set(s.accepted.receipts.map(r => r.id)).size, count);
    for (const row of (await world()).filter(r => r.name?.startsWith('target-'))) {
      const id = row.name.slice(-1);
      assert.ok(row.target);
      assert.equal(row.shape.kind, 'box');
      assert.deepEqual(row.shape.size, [0.8, 0.8, 0.8]);
      assert.deepEqual([row.transform.x, row.transform.y, row.transform.z], [id === 'a' ? -1.5 : 1.5, 0.5, 0]);
      assert.equal(row.transform.scale, 1 + (id === 'a' ? expectedA : expectedB) / 100);
    }
    const rows = await world(),
      named = rows.filter(r => r.name?.startsWith('target-'));
    assert.equal(new Set(named.map(r => r.name)).size, named.length);
    assert.ok(named.length <= 2);
    assert.ok(rows.length <= 4);
    assert.equal(rows.filter(r => !r.name && r.shape.kind === 'box').length, 1);
    for (const row of rows)
      assert.ok(
        row.name === 'target-a' || row.name === 'target-b' || (!row.name && ['box', 'sphere'].includes(row.shape.kind)),
      );
  };
  await page.goto(server.resolvedUrls.local[0] + 'tools/action-workbench/index.html?flags=dev.silent');
  await page
    .waitForFunction(() => window.actionWorkbench?.read())
    .catch(async error => {
      report.startup = await page.evaluate(() => ({
        state: window.engine?.state(),
        text: document.body.innerText,
        api: !!window.actionWorkbench,
      }));
      throw error;
    });
  await accepted(0, 0, 0);
  assert.equal((await world()).filter(r => r.target).length, 2);
  await shot('closed-targets');
  const first = await prepare();
  await shot('disclosed-controls');
  await click('resolve');
  assert.deepEqual(await result(), {status: 'refused', reason: 'pending'});
  await advance(2);
  assert.equal((await mutation('resolve')).status, 'accepted');
  await accepted(3, 0, 1);
  await visible();
  await shot('accepted-targets');
  await open();
  // Cue work uses a separate clock and does not change accepted authority.
  const stable = (await read()).accepted;
  await fill('cue-step', 1);
  assert.equal((await mutation('cue-advance')).status, 'presented');
  assert.equal((await cue()).emitted, 2);
  const spheres = (await world()).filter(r => r.shape.kind === 'sphere');
  assert.equal(spheres.length, 1);
  assert.deepEqual(
    [spheres[0].transform.x, spheres[0].transform.y, spheres[0].transform.z, spheres[0].transform.scale],
    [-1.5, 1.3, 0, 0.3],
  );
  assert.deepEqual((await read()).accepted, stable);
  await visible();
  await shot('optional-cue-visible');
  await open();
  const cursor = (await cue()).time;
  await click('cue-overload');
  assert.equal((await result()).status, 'refused');
  assert.equal((await cue()).time, cursor);
  assert.deepEqual((await read()).accepted, stable);
  await fill('cue-step', 4);
  await mutation('cue-seek');
  assert.equal((await cue()).time, cursor + 4);
  assert.equal((await cue()).emitted, 2);
  assert.equal((await world()).filter(r => r.shape.kind === 'sphere').length, 0);
  assert.deepEqual((await read()).accepted, stable);
  // Exact accepted retry is checked before the now-absent target.
  await mutation('despawn');
  assert.equal(
    (await world()).some(r => r.name === 'target-a'),
    false,
  );
  await page.locator('#action').selectOption(first);
  assert.equal((await mutation('resolve')).status, 'duplicate');
  await accepted(3, 0, 1);
  await mutation('restore');
  const stale = await prepare({delay: 0});
  const oldEntity = (await world()).find(r => r.name === 'target-a').entity;
  await mutation('replace');
  assert.notEqual((await world()).find(r => r.name === 'target-a').entity, oldEntity);
  await click('resolve');
  assert.deepEqual(await result(), {status: 'refused', reason: 'stale'});
  await accepted(3, 0, 1);
  const cancelled = await prepare({target: 'b', delay: 0});
  await click('cancel');
  await click('resolve');
  assert.equal((await result()).reason, 'cancelled');
  await accepted(3, 0, 1);
  const expired = await prepare({target: 'b', delay: 0, expiry: 1});
  await advance(1);
  await click('resolve');
  assert.equal((await result()).reason, 'expired');
  await accepted(3, 0, 1);
  // Native policy callbacks replace or revise actual target state during resolution.
  for (const policy of ['replace', 'revise']) {
    await prepare({target: 'b', delay: 0});
    await page.locator('#policy').selectOption(policy);
    await click('set-policy');
    await click('resolve');
    assert.equal((await result()).reason, 'stale');
    await accepted(3, 0, 1);
  }
  await page.locator('#policy').selectOption('normal');
  await click('set-policy');
  await page.locator('#target').selectOption('b');
  await click('toggle-target');
  await prepare({target: 'b', delay: 0});
  await click('resolve');
  assert.equal((await result()).reason, 'ineligible');
  await accepted(3, 0, 1);
  await click('toggle-target');
  // Replacing an effect key does not give its first handle authority over the replacement.
  await fill('multiplier', 2);
  await fill('effect-duration', 2);
  await click('effect');
  assert.equal((await result()).kind, 'applied');
  await fill('multiplier', 3);
  await fill('effect-duration', 5);
  await click('effect');
  assert.equal((await result()).kind, 'applied');
  await click('cancel-old-effect');
  assert.equal((await result()).status, 'missing');
  assert.equal((await read()).effects.length, 1);
  await advance(2);
  assert.equal((await read()).effects.length, 1);
  await page.locator('#cues').uncheck();
  const multiplied = await prepare({target: 'b', amount: 2, delay: 0});
  assert.equal((await mutation('resolve')).status, 'accepted');
  await accepted(3, 6, 2);
  await fill('cue-step', 1);
  assert.equal((await mutation('cue-advance')).status, 'skipped');
  assert.equal((await world()).filter(r => r.shape.kind === 'sphere').length, 0);
  await accepted(3, 6, 2);
  await advance(3);
  assert.equal((await read()).effects.length, 0);
  await prepare({target: 'b', amount: 2, delay: 0});
  await mutation('resolve');
  await accepted(3, 8, 3);
  snapshots.completed = await read();
  snapshots.actions = {first, stale, cancelled, expired, multiplied};
  await visible();
  await shot('accepted-without-media');
  await open();
  // Pending authority and retained presentation callbacks cannot survive scene exit.
  await prepare({target: 'b', delay: 2});
  await click('exit-scene');
  await page.waitForFunction(
    () =>
      actionWorkbench.read().retired &&
      engine.state().scene?.scene === 'scene.retired' &&
      engine.state().scene.state === 'active' &&
      actionWorkbench.ui().contextScene === 'retired',
  );
  assert.equal((await world()).length, 0);
  await open();
  await click('late-resolve');
  assert.equal((await result()).resolution.reason, 'retired');
  assert.equal((await result()).cue.status, 'retired');
  assert.deepEqual((await read()).accepted, snapshots.completed.accepted);
  await shot('retired-authority');
  await click('reenter');
  await page.waitForFunction(
    () =>
      !actionWorkbench.read().retired &&
      engine.state().scene?.scene === 'scene.sample' &&
      engine.state().scene.state === 'active' &&
      actionWorkbench.ui().contextScene === 'sample',
  );
  await accepted(0, 0, 0);
  assert.equal((await world()).filter(r => r.target).length, 2);
  await shot('fresh-session');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  snapshots.final = await read();
  writeFileSync(resolve(out, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser close');
  await evidence.close(server, 'server close');
  evidence.finish();
}
console.log(`Action workbench passed; evidence ${out}`);
