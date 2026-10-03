#!/usr/bin/env node
// Independent handwritten oracle; real controls, actual engine ECS/Shape renderer,
// and separately parsed storage. Run only after the SaveHandle feedback integration.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? '/tmp/foundation-authoring-browser');
mkdirSync(out, {recursive: true});
const server = await createServer({root: ROOT, logLevel: 'error', server: {host: '127.0.0.1', port: 0}});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  screenshots: [],
  limitations: [
    'Desktop 1440×960 Chromium emulation only; no physical-device or sustained performance acceptance.',
    'World transforms are queried from renderer inputs; screenshots require visual review, not pixel-level mesh verification.',
    'Single writer; no cross-tab isolation, arbitrary callback rollback, crash durability or full accessibility certification.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const key = 'manual-authoring|device|authoring.document';
const a0 = {id: 'A', incarnation: 0, x: -2, y: 0, z: 0, ry: 0};
const b0 = {id: 'B', incarnation: 0, x: 2, y: 0, z: 1, ry: 0};
const moved = {id: 'A', incarnation: 0, x: 3, y: 0, z: -2, ry: Math.PI / 2};
const changed = {...moved, x: 1};
const doc = objects => ({id: 'manual-sample', objects});
let browser;
try {
  await server.listen();
  browser = await launch({width: 1440, height: 960, strictClose: true});
  report.browser = browser.version;
  report.launchArguments = browser.launchArguments;
  const page = browser.page;
  page.on('pageerror', e => report.errors.push(String(e)));
  const base = `${server.resolvedUrls.local[0]}tools/authoring/index.html?flags=dev.silent`;
  const ready = async () => {
    await page.waitForFunction(
      () =>
        window.authoring?.world()?.objects?.length !== undefined &&
        window.engine?.state().scene?.scene === 'scene.sample',
    );
    await page.locator('#app canvas').waitFor();
  };
  const state = () => page.evaluate(() => window.authoring.state());
  const world = () => page.evaluate(() => window.authoring.world());
  const bytes = () => page.evaluate(key => localStorage.getItem(key), key);
  const click = id => page.locator(`#${id}`).click();
  const assertWorld = async expected => {
    const actual = (await world()).objects
      .map(o => ({id: o.id, x: o.x, y: o.y, z: o.z, ry: o.ry}))
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(
      actual,
      expected.map(({id, x, y, z, ry}) => ({id, x, y, z, ry})).sort((a, b) => a.id.localeCompare(b.id)),
    );
    const named = await page.evaluate(() => window.engine.state().world.named);
    for (const o of expected) assert.deepEqual(named[o.id], {x: o.x, y: o.y, z: o.z});
  };
  const fields = async object => {
    for (const k of ['x', 'y', 'z', 'ry']) {
      await page.locator(`#${k}`).fill('');
      await page.locator(`#${k}`).pressSequentially(String(object[k]));
    }
  };
  const screenshot = async name => {
    // Let the existing renderer synchronize after command completion.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const path = resolve(out, `${name}.png`);
    await page.screenshot({path, fullPage: true});
    report.screenshots.push(path);
  };
  await page.goto(base);
  await ready();
  assert.deepEqual((await state()).value, doc([a0, b0]));
  assert.equal((await state()).persistence, 'Not saved yet');
  const initialWorld = await world();
  const originalBytes = await bytes();
  await assertWorld([a0, b0]);
  await page.locator('#selection').selectOption('A');
  await fields(moved);
  await click('preview');
  await assertWorld([a0, b0]);
  assert.deepEqual((await state()).value, doc([a0, b0]));
  const ghost = (await world()).ghost;
  assert.deepEqual([ghost.x, ghost.y, ghost.z, ghost.ry], [3, 0, -2, Math.PI / 2]);
  assert.equal((await world()).count, 3);
  await screenshot('preview');
  await click('cancel');
  assert.equal((await world()).ghost, null);
  assert.equal((await state()).history.entries, 0);
  assert.equal(await bytes(), originalBytes);
  await assertWorld([a0, b0]);
  // Invalid editing must destroy a previously valid preview, even before Preview.
  await click('preview');
  await page.locator('#x').fill('');
  assert.equal((await state()).preview, null);
  assert.equal((await world()).ghost, null);
  assert.equal(await page.locator('#commit').isDisabled(), true);
  await click('preview');
  assert.equal((await state()).preview, null);
  await fields(moved);
  await click('preview');
  await page.locator('#commit').focus();
  await page.keyboard.press('Enter');
  await assertWorld([moved, b0]);
  assert.equal((await state()).history.entries, 1);
  await click('undo');
  await assertWorld([a0, b0]);
  await click('redo');
  await assertWorld([moved, b0]);
  await page.locator('#selection').selectOption('B');
  await click('remove');
  await assertWorld([moved]);
  await click('undo');
  await assertWorld([moved, b0]);
  await click('redo');
  await assertWorld([moved]);
  await click('save');
  assert.equal((await state()).persistence, 'Saved locally');
  assert.deepEqual(JSON.parse(await bytes()).data, doc([moved]));
  // Restore B through history, save both and prove reversed allocation after reload.
  await click('undo');
  await click('save');
  const acceptedBytes = await bytes();
  const envelope = JSON.parse(acceptedBytes);
  assert.equal(envelope.v, 1);
  assert.deepEqual(envelope.data, doc([moved, b0]));
  await click('reload');
  await ready();
  await assertWorld([moved, b0]);
  assert.deepEqual((await state()).value, doc([moved, b0]));
  const reversed = await world();
  for (const id of ['A', 'B'])
    assert.notEqual(
      reversed.objects.find(o => o.id === id).runtime,
      initialWorld.objects.find(o => o.id === id).runtime,
    );
  assert.equal((await state()).history.entries, 0);
  await screenshot('reloaded');
  // SaveStore owns persistence. Failure injection occurs only at its StoragePort.
  await page.evaluate(() => window.authoring.failure('quota'));
  await page.locator('#selection').selectOption('A');
  await fields(changed);
  await click('preview');
  await click('commit');
  await click('save');
  assert.deepEqual((await state()).value, doc([changed, b0]));
  await assertWorld([changed, b0]);
  assert.equal((await state()).saveStatus, 'session');
  assert.match((await state()).persistence, /Unsaved/);
  assert.equal((await state()).history.entries, 1);
  assert.equal(await bytes(), acceptedBytes);
  await screenshot('quota-unsaved');
  // A fresh independent store reads only the old bytes while the failed editor stays open.
  const reader = await browser.context.newPage();
  await reader.goto(`${base}&mode=view&reverse=1`);
  await reader.waitForFunction(() => window.authoring?.world()?.objects?.length === 2);
  assert.deepEqual(await reader.evaluate(() => window.authoring.state().value), doc([moved, b0]));
  assert.equal(await reader.locator('#editor').count(), 0);
  await reader.close();
  await page.evaluate(() => window.authoring.failure('quota', false));
  await click('save');
  assert.equal((await state()).persistence, 'Saved locally');
  assert.deepEqual(JSON.parse(await bytes()).data, doc([changed, b0]));
  await click('reload');
  await ready();
  await assertWorld([changed, b0]);
  // Explicit projection failure keeps the document authoritative and blocks editing.
  await page.evaluate(() => {
    const c = window.authoring.commands;
    c.select('A');
    c.preview({x: 0, y: 0, z: -2, ry: Math.PI / 2});
    window.authoring.failure('projection');
    c.commit();
  });
  assert.equal((await state()).blocked, true);
  assert.equal((await state()).value.objects[0].x, 0);
  await assertWorld([changed, b0]);
  await click('recover');
  assert.equal((await state()).blocked, false);
  await assertWorld([{...changed, x: 0}, b0]);
  await click('undo');
  await assertWorld([changed, b0]);
  // View-only mode reads accepted bytes and has neither command owner nor editor DOM.
  await page.goto(`${base}&mode=view&reverse=1`);
  await ready();
  await assertWorld([changed, b0]);
  assert.equal(await page.locator('#editor').count(), 0);
  assert.equal(await page.evaluate(() => window.authoring.commands === undefined), true);
  await screenshot('view-only');
  const canvas = await page.locator('#app canvas').boundingBox();
  assert.ok(canvas.width > 500 && canvas.height >= 360);
  report.world = await world();
  report.envelope = JSON.parse(await bytes());
  await page.evaluate(() => window.authoring.dispose());
  assert.equal((await world()).count, 0);
  assert.deepEqual(report.errors, []);
  writeFileSync(
    resolve(out, 'snapshots.json'),
    JSON.stringify({initialWorld, reversed, envelope, final: report.world}, null, 2),
  );
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser close');
  await evidence.close(server, 'server close');
  evidence.finish();
}
console.log(`Authoring acceptance passed; evidence ${out}`);
