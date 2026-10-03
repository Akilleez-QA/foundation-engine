#!/usr/bin/env node
// Stock arcade shell: native button activation must not dispatch the scene's Space/Enter binding.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {serve, open, ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/ui/native-controls');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  dirtyWorktree: execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim().length > 0,
  states: [],
  limitations: [
    'Stock arcade and browser keyboard only',
    'No controller, physical-device or whole-application acceptance',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
let server, b;
try {
  server = await serve();
  b = await launch({width: 1280, height: 800, strictClose: true});
  await open(b, server.url, 'play');
  await b.page.evaluate(() => {
    window.nativeKeyEvents = [];
    window.addEventListener(
      'keydown',
      event => {
        window.nativeKeyEvents.push({key: event.key, prevented: event.defaultPrevented});
      },
      {capture: true},
    );
  });
  const summary = b.page.locator('details.shell-menu > summary'),
    sound = b.page.locator('#shell-sound');
  for (const [key, label] of [
    ['Space', 'Sound: off'],
    ['Enter', 'Sound: on'],
  ]) {
    await summary.click();
    await sound.focus();
    await b.page.keyboard.press(key);
    assert.equal(await sound.textContent(), label);
    assert.equal(await b.page.locator('details.shell-menu').getAttribute('open'), null);
    report.states.push({key, label, events: await b.page.evaluate(() => window.nativeKeyEvents.splice(0))});
    assert.equal(report.states.at(-1).events.at(-1).prevented, false);
  }
  await b.page.locator('.scene-view').focus();
  await b.page.keyboard.press('Space');
  const sceneEvents = await b.page.evaluate(() => window.nativeKeyEvents.splice(0));
  assert.equal(sceneEvents.at(-1).prevented, true, 'Scene still consumes its declared Space binding');
  report.states.push({sceneEvents});
  await b.page.screenshot({path: resolve(out, 'after-native-controls.png')});
  assert.deepEqual(b.errors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(b, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(`Native controls: PASS; ${out}`);
