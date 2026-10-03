#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/custody-composition');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  consoleErrors: [],
  screenshots: [],
  limitations: [
    'Desktop Chromium keyboard/pointer only, not physical-device or phone/tablet certification.',
    'Finite authored identity universe and one writer; no distributed authority or general issuance service.',
    'Projection evidence observes accepted Shape identities and actual ECS transforms, not only controller snapshots.',
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
  const read = () => page.evaluate(() => custody.read()),
    ui = () => page.evaluate(() => custody.ui()),
    world = () => page.evaluate(() => custody.world()),
    click = id => page.locator('#' + id).click();
  const ready = () => page.waitForFunction(() => window.custody?.read());
  const open = async () => {
    if (!(await ui()).sheet) {
      await page.locator('#open').focus();
      await page.keyboard.press('Enter');
      await page.locator('#details').waitFor({state: 'visible'});
    }
  };
  const reload = async () => {
    await Promise.all([page.waitForNavigation({waitUntil: 'load'}), click('reload')]);
    await ready();
    await open();
  };
  const shot = async name => {
    const path = resolve(out, name + '.png');
    await page.screenshot({path});
    report.screenshots.push(path);
  };
  const prepare = async (kind, item) => {
    await open();
    if (item) await page.locator('#item').selectOption(item);
    await click(kind);
    return ui();
  };
  const acknowledge = async () => {
    await page.waitForFunction(() => custody.read().canAcknowledge);
    const before = await page.evaluate(() => engine.loop().renders),
      priorWorld = JSON.stringify(await world());
    await click('acknowledge');
    assert.equal((await read()).pending, false);
    assert.equal((await ui()).result.status, 'accepted');
    if (JSON.stringify(await world()) !== priorWorld)
      await page.waitForFunction(before => !custody.ui().sheet && engine.loop().renders > before, before);
    else await page.waitForFunction(() => !custody.ui().sheet);
    snapshots.renderedPublications ??= [];
    snapshots.renderedPublications.push({
      revision: (await read()).envelope.revision,
      renders: await page.evaluate(() => engine.loop().renders),
      world: await world(),
    });
    await shot(`world-accepted-${(await read()).envelope.revision}`);
    await open();
  };
  const publish = async (kind, item) => {
    const result = await prepare(kind, item);
    assert.equal(result.result.status, 'prepared', JSON.stringify(result));
    await click('commit');
    await acknowledge();
    await coherent();
  };
  async function coherent() {
    const s = await read(),
      rows = await world();
    const expected = [
      ...s.view.world.map(v => ({id: v.id, position: v.position})),
      ...s.view.bag.map((v, i) => ({id: v.id, position: [0, 0.5, i * 1.4]})),
      ...s.view.equipped.map((v, i) => ({id: v.id, position: [3, 0.8, i * 1.4]})),
    ];
    assert.deepEqual(rows.map(v => v.id).sort(), expected.map(v => v.id).sort());
    assert.equal(new Set(rows.map(v => v.id)).size, rows.length);
    assert.ok(rows.length <= 4);
    for (const row of rows) {
      assert.ok(row.transform);
      assert.equal(row.shape?.kind, 'box');
      assert.deepEqual(row.shape.size, [0.7, 0.7, 0.7]);
      assert.deepEqual(
        [row.transform.x, row.transform.y, row.transform.z],
        expected.find(v => v.id === row.id).position,
      );
    }
    return rows;
  }

  await page.goto(server.resolvedUrls.local[0] + 'tools/custody-composition/index.html?flags=dev.silent');
  await ready();
  assert.equal((await ui()).sheet, false);
  snapshots.initial = await coherent();
  await shot('closed-world');
  await open();
  let before = await world();
  await prepare('pickup', 'a');
  assert.equal((await ui()).result.status, 'refused');
  assert.match((await ui()).result.reason, /capacity/);
  assert.deepEqual(await world(), before);
  await shot('capacity-refused');
  await publish('drop', 'blocker');
  await prepare('pickup', 'a');
  await click('cancel');
  assert.equal(await page.locator('#commit').isDisabled(), true);
  assert.equal(
    (await read()).view.world.some(v => v.id === 'a'),
    true,
  );
  await prepare('pickup', 'a');
  const staleRevision = (await read()).envelope.revision;
  await click('stale');
  await page.waitForFunction(() => !custody.ui().sheet);
  await open();
  assert.ok((await read()).envelope.revision > staleRevision);
  before = await world();
  await click('commit');
  assert.equal((await ui()).result.status, 'stale');
  assert.deepEqual(await world(), before);
  await click('cancel');
  await prepare('pickup', 'a');
  await click('remember');
  await page.locator('#commit').dblclick();
  await acknowledge();
  assert.equal((await read()).view.bag[0].id, 'a');
  await publish('drop', 'a');
  before = await world();
  await click('replay');
  assert.equal((await ui()).result.status, 'duplicate');
  assert.deepEqual(await world(), before);
  await coherent();
  await shot('redrop-replay');
  await publish('pickup', 'b');
  const reservation = (await read()).view.reservation;
  assert.notEqual(reservation, null);
  before = await world();
  await prepare('settle');
  assert.equal((await ui()).result.status, 'refused');
  assert.match((await ui()).result.reason, /capacity/);
  assert.equal((await read()).view.reservation, reservation);
  assert.deepEqual(await world(), before);
  await publish('equip', 'b');
  before = await world();
  await page.locator('#fail-storage').check();
  await prepare('settle');
  await click('commit');
  assert.equal((await read()).pending, true);
  assert.equal((await read()).view.issued, false);
  assert.deepEqual(await world(), before);
  assert.equal(await page.locator('#cancel').isDisabled(), true);
  assert.equal(await page.locator('#pickup').isDisabled(), true);
  await shot('pending-old-world');
  await click('close');
  await page.waitForFunction(() => !custody.ui().sheet);
  await shot('pending-old-world-canvas');
  assert.deepEqual(await world(), before);
  await open();
  await page.locator('#fail-storage').uncheck();
  await click('retry');
  assert.equal((await read()).pending, true);
  assert.deepEqual(await world(), before);
  await acknowledge();
  assert.equal((await read()).view.issued, true);
  assert.equal((await read()).view.bag[0].id, 'crafted');
  snapshots.settled = await coherent();
  await shot('settled');
  await reload();
  assert.equal((await read()).view.issued, true);
  await coherent();
  // Sustain refusal through teardown: reload restores the previous coherent custody.
  await page.locator('#fail-storage').check();
  await prepare('drop', 'crafted');
  before = await world();
  await click('commit');
  assert.equal((await read()).pending, true);
  await reload();
  assert.equal((await read()).view.bag[0].id, 'crafted');
  assert.equal((await read()).pending, false);
  await coherent();
  // Remove refusal but do not acknowledge: SaveStore teardown may durably publish the exact pending envelope.
  await prepare('drop', 'crafted');
  await click('commit');
  assert.equal((await read()).pending, true);
  await page.locator('#fail-storage').uncheck();
  await reload();
  assert.equal(
    (await read()).view.world.some(v => v.id === 'crafted'),
    true,
  );
  assert.equal((await read()).view.issued, true);
  await coherent();
  await publish('checkpoint');
  const saved = await page.evaluate(() => localStorage.getItem('custody-composition|device|custody.session'));
  assert.ok(saved);
  await prepare('pickup', 'crafted');
  await click('retire');
  assert.equal((await read()).retired, true);
  const late = await page.evaluate(() => custody.retired());
  assert.notEqual(late.status, 'accepted');
  await reload();
  assert.equal(
    (await read()).view.world.some(v => v.id === 'crafted'),
    true,
  );
  await click('close');
  await page.locator('#details').waitFor({state: 'hidden'});
  assert.equal(await page.evaluate(() => document.activeElement.id), 'open');
  await open();
  await page.evaluate(() => {
    const key = 'custody-composition|device|custody.session',
      value = JSON.parse(localStorage.getItem(key));
    value.v = 99;
    localStorage.setItem(key, JSON.stringify(value));
  });
  const newer = await page.evaluate(() => localStorage.getItem('custody-composition|device|custody.session'));
  await reload();
  assert.ok((await read()).blocked);
  assert.equal((await world()).length, 0);
  assert.equal(await page.locator('#pickup').isDisabled(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('custody-composition|device|custody.session')), newer);
  await shot('newer-blocked');
  await page.evaluate(() => localStorage.setItem('custody-composition|device|custody.session', '{broken'));
  await reload();
  assert.ok((await read()).blocked);
  assert.equal((await world()).length, 0);
  await shot('corrupt-blocked');
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
console.log(`Custody composition passed; evidence ${out}`);
