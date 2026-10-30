#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/crafting-workbench');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim(),
  passed: false,
  errors: [],
  consoleErrors: [],
  screenshots: [],
  limitations: [
    'Desktop Chromium keyboard/pointer only; no physical-device, thermal or multiplayer certification.',
    'Independent recipe/runtime saves and one local writer; no cross-process CAS.',
    'Numeric stock/weighted values and native ECS geometry are checked; screenshots are not a pixel conservation oracle.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json')),
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: {host: '127.0.0.1', port: 0},
  });
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
  const read = () => page.evaluate(() => craftingWorkbench.read()),
    ui = () => page.evaluate(() => craftingWorkbench.ui()),
    world = () => page.evaluate(() => craftingWorkbench.world()),
    click = name => page.locator('#' + name).click(),
    fill = (name, value) => page.locator('#' + name).fill(String(value)),
    select = (name, value) => page.locator('#' + name).selectOption(value);
  const ready = () =>
    page
      .waitForFunction(
        () =>
          window.craftingWorkbench?.read() &&
          !document.getElementById('open').disabled &&
          engine.state().scene?.scene === 'scene.sample' &&
          engine.state().scene.state === 'active' &&
          engine.loop().renders > 0,
      )
      .catch(async error => {
        report.startup = await page.evaluate(() => ({
          state: window.engine?.state(),
          loop: window.engine?.loop(),
          text: document.body.innerText,
          ui: window.craftingWorkbench?.ui(),
          read: window.craftingWorkbench?.read(),
        }));
        throw error;
      });
  const open = async (pane = 'runtime') => {
    if (!(await ui()).sheet) {
      await page.locator('#open').focus();
      await page.keyboard.press('Enter');
      await page.locator('#details').waitFor({state: 'visible'});
    }
    await click('tab-' + pane);
  };
  const shot = async name => {
    const path = resolve(out, name + '.png');
    await page.screenshot({path});
    report.screenshots.push(path);
  };
  const stock = async () => (await read()).runtime.view.stock;
  const total = state =>
    state.positions.reduce((sum, p) => sum + p.quantity * state.batches.find(b => b.id === p.batch).massMg, 0);
  const coherent = async () => {
    const state = (await read()).runtime,
      rows = await world();
    if (state.blocked) {
      assert.equal(rows.length, 0);
      return;
    }
    assert.equal(rows.length, state.view.stock.positions.length);
    for (const p of state.view.stock.positions) {
      const row = rows.find(r => r.id === `stock:${p.container}:${p.batch}`);
      assert.ok(row);
      assert.equal(row.shape.kind, 'box');
      assert.equal(row.shape.size[1], 0.4 + p.quantity * 0.08);
      assert.equal(row.transform.y, 0.2 + p.quantity * 0.04);
    }
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  };
  const ack = async () => {
    await page.waitForFunction(() => craftingWorkbench.read().runtime.canAcknowledge);
    const previous = JSON.stringify(await world()),
      renders = await page.evaluate(() => engine.loop().renders);
    await click('ack-runtime');
    assert.equal((await ui()).result.status, 'accepted', JSON.stringify(await ui()));
    await page.waitForFunction(() => !craftingWorkbench.ui().sheet);
    if (JSON.stringify(await world()) !== previous) await page.waitForFunction(n => engine.loop().renders > n, renders);
    await coherent();
    await open();
  };
  const publish = async button => {
    await click(button);
    assert.equal((await ui()).result.status, 'prepared', JSON.stringify(await ui()));
    await click('commit-runtime');
    assert.equal((await read()).runtime.pending, true);
    await ack();
  };
  const reload = async () => {
    await Promise.all([page.waitForNavigation({waitUntil: 'load'}), click('reload')]);
    await ready();
    await open();
  };
  await page.goto(server.resolvedUrls.local[0] + 'tools/crafting-workbench/index.html?flags=dev.silent');
  await ready();
  await coherent();
  assert.equal(total(await stock()), 80);
  await shot('accepted-sources');
  await open('editor');
  const initial = (await read()).runtime.envelope;
  // Hand arithmetic: equal1-unit grade400/800 -> ceiling600; initial500permille ->300.
  await click('preview-recipe');
  assert.equal((await ui()).result.status, 'prepared');
  assert.deepEqual((await read()).editor.evaluation.values, [{id: 'quality', ceiling: 600, value: 300}]);
  assert.deepEqual((await read()).runtime.envelope, initial);
  await fill('slot-quantity', 0);
  await click('apply-fields');
  await click('preview-recipe');
  assert.equal((await ui()).result.status, 'rejected');
  await click('discard-recipe');
  await fill('attribute-initial', 600);
  await click('apply-fields');
  await click('preview-recipe');
  assert.equal((await read()).editor.evaluation.values[0].value, 360);
  await click('commit-recipe');
  assert.equal((await ui()).result.status, 'accepted');
  await click('undo');
  assert.equal((await read()).editor.recipe.attributes[0].initialPermille, 500);
  await click('redo');
  assert.equal((await read()).editor.recipe.attributes[0].initialPermille, 600);
  await click('save-recipe');
  const constant = structuredClone((await read()).editor.recipe);
  constant.attributes = [];
  constant.output.properties.grade = {base: 10, terms: []};
  await page.locator('summary').click();
  await fill('recipe-json', JSON.stringify(constant));
  await click('apply-json');
  await click('preview-recipe');
  assert.equal((await ui()).result.status, 'prepared');
  await click('commit-recipe');
  assert.equal((await ui()).result.status, 'accepted');
  assert.equal(await page.locator('#attribute-initial').isDisabled(), true);
  await click('undo');
  assert.equal((await read()).editor.recipe.attributes[0].initialPermille, 600);
  await click('save-recipe');
  await shot('recipe-effect-inspector');
  await reload();
  assert.equal((await read()).editor.recipe.attributes[0].initialPermille, 600);
  // Dirty SaveStore memory must not become accepted merely because the scene changes.
  const acceptedBeforeEntry = (await read()).runtime.envelope,
    worldBeforeEntry = (await world()).map(({entity, ...facts}) => facts);
  await page.locator('#fail-storage').check();
  await click('begin');
  assert.equal((await ui()).result.status, 'prepared');
  await click('commit-runtime');
  assert.equal((await read()).runtime.pending, true);
  assert.equal((await read()).runtime.canAcknowledge, false);
  assert.deepEqual((await read()).runtime.envelope, acceptedBeforeEntry);
  await click('close');
  await click('exit-scene');
  await page.waitForFunction(
    () =>
      !document.getElementById('reenter').disabled &&
      engine.state().scene?.scene === 'scene.retired' &&
      engine.state().scene.state === 'active',
  );
  const beforeDirtyReturn = await page.evaluate(() => engine.loop().renders);
  await click('reenter');
  await ready();
  await page.waitForFunction(n => engine.loop().renders > n, beforeDirtyReturn);
  await coherent();
  assert.deepEqual((await read()).runtime.envelope, acceptedBeforeEntry);
  assert.equal((await read()).runtime.pending, true);
  assert.equal((await read()).runtime.blocked, null);
  assert.equal((await read()).runtime.view.sessions.length, 0);
  assert.deepEqual(
    (await world()).map(({entity, ...facts}) => facts),
    worldBeforeEntry,
  );
  await shot('dirty-return-old-custody');
  await open();
  await page.locator('#fail-storage').uncheck();
  await click('retry-runtime');
  assert.equal((await read()).runtime.pending, true);
  assert.equal((await read()).runtime.canAcknowledge, true);
  assert.deepEqual((await read()).runtime.envelope, acceptedBeforeEntry);
  await ack();
  let r = (await read()).runtime;
  assert.equal(r.view.sessions.length, 1);
  assert.equal(r.envelope.receipts.length, 1);
  const first = r.view.sessions[0].id;
  assert.equal(r.view.sessions[0].values[0].value, 360);
  assert.equal(total(r.view.stock), 80);
  await publish('begin');
  r = (await read()).runtime;
  const second = r.view.sessions[1].id;
  const beforeFull = r.envelope;
  await click('begin');
  assert.equal((await ui()).result.status, 'refused');
  assert.deepEqual((await read()).runtime.envelope, beforeFull);
  await select('capacity-container', 'source-a');
  await fill('capacity-mass', 20);
  await fill('capacity-volume', 10);
  await publish('resize');
  await select('session', second);
  const held = (await read()).runtime.envelope;
  await click('cancel-session');
  assert.equal((await ui()).result.status, 'refused');
  assert.deepEqual((await read()).runtime.envelope, held);
  await select('capacity-container', 'source-a');
  await fill('capacity-mass', 40);
  await fill('capacity-volume', 20);
  await publish('resize');
  await select('session', second);
  await publish('cancel-session');
  assert.equal((await read()).runtime.view.sessions.find(s => s.id === second).phase, 'cancelled');
  assert.equal(total(await stock()), 80);
  // Same recipe id/version edit affects new definitions only; accepted selection stays600permille.
  await open('editor');
  await fill('attribute-initial', 500);
  await click('apply-fields');
  await click('preview-recipe');
  await click('commit-recipe');
  assert.equal((await read()).runtime.view.sessions[0].recipe.attributes[0].initialPermille, 600);
  await open();
  await select('session', first);
  await publish('experiment');
  assert.equal((await read()).runtime.view.sessions[0].values[0].value, 510);
  await select('session', first);
  await publish('lock');
  await select('session', first);
  await publish('assign');
  // Complete work blocked by selected output capacity; exact work remains protected.
  await select('capacity-container', 'm-a.output');
  await fill('capacity-mass', 0);
  await fill('capacity-volume', 0);
  await publish('resize');
  await select('session', first);
  await publish('step');
  assert.equal((await read()).runtime.view.machines.find(m => m.id === 'm-a').completed, 0);
  assert.equal(total(await stock()), 80);
  await shot('protected-factory-work');
  await select('capacity-container', 'm-a.output');
  await fill('capacity-mass', 20);
  await fill('capacity-volume', 10);
  await publish('resize');
  await select('session', first);
  await page.locator('#fail-storage').check();
  const old = await stock(),
    oldWorld = await world();
  await click('step');
  assert.equal((await ui()).result.status, 'prepared');
  await click('commit-runtime');
  assert.equal((await read()).runtime.pending, true);
  assert.deepEqual(await stock(), old);
  assert.deepEqual(await world(), oldWorld);
  await shot('failed-write-keeps-accepted-stock');
  await page.locator('#fail-storage').uncheck();
  await click('retry-runtime');
  await ack();
  r = (await read()).runtime;
  assert.equal(r.view.machines.find(m => m.id === 'm-a').completed, 1);
  assert.equal(total(r.view.stock), 80);
  const output = r.view.stock.positions.filter(p => p.container === 'm-a.output');
  assert.equal(
    output.reduce((n, p) => n + p.quantity, 0),
    3,
  );
  assert.equal(
    output.reduce((n, p) => n + p.quantity * r.view.stock.batches.find(b => b.id === p.batch).massMg, 0),
    20,
  );
  await click('close');
  await shot('accepted-factory-output');
  await open();
  snapshots.produced = await read();
  await reload();
  assert.deepEqual((await read()).runtime.envelope, snapshots.produced.runtime.envelope);
  await select('session', first);
  await publish('repeat');
  const repeat = (await read()).runtime.view.sessions.at(-1);
  assert.equal(repeat.phase, 'locked');
  assert.equal(repeat.values[0].value, 510);
  await select('session', repeat.id);
  await select('machine', 'm-b');
  await publish('assign');
  await select('session', repeat.id);
  await publish('step');
  assert.equal((await read()).runtime.view.machines.find(m => m.id === 'm-b').completed, 1);
  assert.equal(total(await stock()), 80);
  assert.equal(
    (await stock()).positions.filter(p => p.batch === 'crafted-1').reduce((n, p) => n + p.quantity, 0),
    2,
  );
  await open('survey');
  await click('survey-start');
  await click('survey-step');
  assert.equal((await ui()).result.sampled, 8);
  const oldFacts = (await stock()).batches.find(b => b.id === 'input-a');
  await publish('replace-spawn');
  await open('survey');
  await click('survey-late');
  assert.equal((await ui()).result.status, 'stale');
  assert.deepEqual(
    (await stock()).batches.find(b => b.id === 'input-a'),
    oldFacts,
  );
  await click('survey-start');
  for (let i = 0; i < 8; i++) await click('survey-step');
  assert.equal((await read()).survey.points.length, 64);
  await shot('bounded-survey');
  await fill('clock', 100);
  await publish('advance');
  await open('survey');
  await click('survey-late');
  assert.equal((await ui()).result.status, 'stale');
  // A retired observation callback must not write into a reentered owner.
  await click('close');
  await click('exit-scene');
  await page.waitForFunction(
    () =>
      !document.getElementById('reenter').disabled &&
      engine.state().scene?.scene === 'scene.retired' &&
      engine.state().scene.state === 'active',
  );
  await click('retired-survey');
  assert.ok(['retired', 'empty'].includes((await ui()).result.status));
  const beforeReentry = await page.evaluate(() => engine.loop().renders);
  await click('reenter');
  await ready();
  await page.waitForFunction(n => engine.loop().renders > n, beforeReentry);
  await open();
  await coherent();
  snapshots.final = await read();
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  writeFileSync(resolve(out, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser close');
  await evidence.close(server, 'server close');
  evidence.finish();
}
console.log(`Crafting workbench passed; evidence ${out}`);
