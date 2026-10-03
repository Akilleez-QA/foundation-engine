#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? 'playtest/appearance');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  screenshots: [],
  limitations: [
    'Desktop 1440x960 Chromium emulation. No phone, physical-device or full accessibility acceptance.',
    'Primitive projection consumer, not skeletal customization or asynchronous model replacement.',
    'Single-writer local save; no concurrent-writer isolation or durable external effects.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const server = await createServer({root: ROOT, logLevel: 'error', server: {host: '127.0.0.1', port: 0}});
const initial = {version: 1, parts: {form: 'box'}, parameters: {scale: 1, tint: 0x75d8d0}};
const edited = {version: 1, parts: {form: 'sphere'}, parameters: {scale: 1.4, tint: 0x90aaff}};
const key = 'appearance-preview|device|appearance.profile';
let browser;
try {
  await server.listen();
  browser = await launch({width: 1440, height: 960, strictClose: true});
  report.browser = browser.version;
  const page = browser.page;
  page.on('pageerror', e => report.errors.push(String(e)));
  const ready = () =>
    page.waitForFunction(
      () => window.appearance?.world()?.accepted && window.engine?.state().scene?.scene === 'scene.sample',
    );
  const state = () => page.evaluate(() => window.appearance.state());
  const world = () => page.evaluate(() => window.appearance.world());
  const bytes = () => page.evaluate(k => localStorage.getItem(k), key);
  const click = id => page.locator('#' + id).click();
  const fields = async value => {
    await page.locator('#form').selectOption(value.parts.form);
    await page.locator('#scale').fill(String(value.parameters.scale));
    await page.locator('#tint').fill('#' + value.parameters.tint.toString(16).padStart(6, '0'));
  };
  const shot = async name => {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const path = resolve(out, name + '.png');
    await page.screenshot({path, fullPage: true});
    report.screenshots.push(path);
  };
  const assertProjection = async value => {
    const w = await world();
    assert.equal(w.accepted.shape.kind, value.parts.form);
    assert.equal(w.accepted.shape.color, value.parameters.tint);
    assert.deepEqual(w.accepted.shape.size, [value.parameters.scale, value.parameters.scale, value.parameters.scale]);
    assert.equal(w.accepted.transform.x, -1.5);
  };
  await page.goto(server.resolvedUrls.local[0] + 'tools/appearance/index.html?flags=dev.silent');
  await ready();
  assert.deepEqual((await state()).value, initial);
  assert.equal((await state()).persistence, 'Not saved yet');
  await assertProjection(initial);
  const canvas = await page.locator('#app canvas').boundingBox(),
    panel = await page.locator('#editor').boundingBox();
  assert.ok(canvas && panel && canvas.x + canvas.width <= panel.x, 'controls do not overlap the rendered world');
  await fields(edited);
  await click('preview');
  assert.deepEqual((await state()).preview, edited);
  await assertProjection(initial);
  assert.equal((await world()).preview.shape.kind, 'sphere');
  assert.equal((await world()).count, 2);
  await shot('preview');
  await click('cancel');
  assert.equal((await world()).count, 1);
  assert.equal((await state()).preview, null);
  await assertProjection(initial);
  await click('preview');
  await page.locator('#scale').fill('2');
  assert.equal((await state()).preview, null);
  assert.equal(await page.locator('#commit').isDisabled(), true);
  await click('preview');
  assert.deepEqual((await state()).value, initial);
  assert.equal((await world()).preview, null);
  await fields(edited);
  await click('preview');
  await page.locator('#commit').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual((await state()).value, edited);
  await assertProjection(edited);
  assert.equal((await world()).count, 1);
  await click('undo');
  await assertProjection(initial);
  await click('redo');
  await assertProjection(edited);
  await click('save');
  assert.equal((await state()).persistence, 'Saved locally');
  assert.deepEqual(JSON.parse(await bytes()).data, edited);
  await click('reload');
  await ready();
  await assertProjection(edited);
  assert.deepEqual((await state()).value, edited);
  await shot('reloaded');
  const acceptedBytes = await bytes();
  await fields(initial);
  await page.evaluate(() => window.appearance.failure('projection'));
  await click('preview');
  assert.equal((await state()).preview, null);
  await assertProjection(edited);
  assert.deepEqual((await state()).value, edited);
  // Publication and view are distinct: failure after acceptance blocks edits until recovery.
  await click('preview');
  await page.evaluate(() => window.appearance.failure('projection'));
  await click('commit');
  assert.deepEqual((await state()).value, initial);
  assert.equal((await state()).blocked, true);
  await assertProjection(edited);
  assert.equal(await page.locator('#save').isDisabled(), true);
  await click('recover');
  await assertProjection(initial);
  assert.equal((await state()).blocked, false);
  await page.evaluate(() => window.appearance.failure('storage'));
  await click('save');
  assert.match((await state()).persistence, /Unsaved/);
  assert.equal(await bytes(), acceptedBytes);
  assert.deepEqual((await state()).value, initial);
  await shot('unsaved');
  await page.evaluate(() => window.appearance.failure('restore-storage'));
  await page.waitForFunction(() => document.querySelector('#persistence').textContent === 'Saved locally');
  assert.equal((await state()).persistence, 'Saved locally');
  assert.deepEqual(JSON.parse(await bytes()).data, initial);
  await click('reload');
  await ready();
  await assertProjection(initial);
  // A scene transition preserves accepted in-memory edits, even without Save.
  await fields(edited);
  await click('preview');
  await click('commit');
  assert.deepEqual((await state()).value, edited);
  const epoch = await page.evaluate(() => window.engine.state().scene.epoch);
  await page.evaluate(() => window.engine.goto('sample'));
  await page.waitForFunction(
    previous => window.engine.state().scene.epoch > previous && window.appearance.world()?.accepted,
    epoch,
  );
  assert.deepEqual((await state()).value, edited);
  await assertProjection(edited);
  assert.equal((await state()).persistence, 'Unsaved changes');
  await fields(initial);
  await click('preview');
  assert.deepEqual((await state()).preview, initial);
  await click('cancel');
  assert.equal((await state()).preview, null);
  await assertProjection(edited);
  // An invalid stored appearance must enter the existing quarantine path, not crash entry.
  await page.evaluate(k => {
    const envelope = JSON.parse(localStorage.getItem(k));
    envelope.data.parameters.scale = 99;
    localStorage.setItem(k, JSON.stringify(envelope));
  }, key);
  await click('reload');
  await ready();
  assert.deepEqual((await state()).value, initial);
  assert.match((await state()).persistence, /quarantined/);
  await assertProjection(initial);
  await page.evaluate(() => window.appearance.dispose());
  assert.equal((await world()).count, 0);
  assert.deepEqual(browser.errors, []);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser close');
  await evidence.close(server, 'server close');
  evidence.finish();
  writeFileSync(resolve(out, 'summary.txt'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
