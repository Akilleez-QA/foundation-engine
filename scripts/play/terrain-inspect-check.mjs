#!/usr/bin/env node
// Optional finite terrain inspection consumer; not a shipped gameplay feature.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {captureDiagnosticSubjects} from './diagnostic-subjects.mjs';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';

const out = resolve(process.argv[2] ?? '/tmp/foundation-terrain-inspect-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"><title>Terrain inspection diagnostic</title></head><body><h1>Prepared versus selected terrain</h1><p id="selection"></p><canvas width="400" height="400"></canvas><script type="module" src="/scripts/play/fixtures/terrain-inspect-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'terrain-inspect-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/__terrain-inspect-check.html')) return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        });
      },
    },
  ],
  server: {host: '127.0.0.1', port: 0},
});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  limitations: [
    'Finite diagnostic wireframe consumer, not application or GPU acceptance',
    'Displayed variants are explicitly consumer-reported',
  ],
};
let browser;
try {
  await server.listen();
  browser = await launch({width: 800, height: 600});
  browser.page.on('pageerror', error => report.errors.push(String(error)));
  await browser.page.goto(`${server.resolvedUrls.local[0]}__terrain-inspect-check.html?flags=dev.silent`);
  const page = browser.page;
  await page.waitForFunction(() => !!window.terrainInspect);
  const captures = [];
  const capture = async id => {
    const observed = await page.evaluate(() => ({
      before: window.terrainInspect.state().epoch,
      data: window.terrainInspect.inspect(),
      after: window.terrainInspect.state().epoch,
    }));
    const target = {
      ownerId: 'terrain-diagnostic',
      epoch: String(observed.data.state.epoch),
      kind: 'terrain-inspection',
      id,
    };
    const sourcePath = 'scripts/play/fixtures/terrain-inspect-entry.mjs';
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const result = captureDiagnosticSubjects({
      captureId: id,
      before: {available: true, token: String(observed.before)},
      after: {available: true, token: String(observed.after)},
      digests: {
        build: {provenance: 'unavailable', value: null},
        configuration: {
          provenance: 'observed',
          value: hash(JSON.stringify({viewport: [800, 600], silent: true, sample: [1, 1], limit: 1})),
        },
      },
      records: [
        {
          target,
          provenance: 'observed',
          artifact: `snapshots.json#${id}`,
          completeness: {
            status: 'partial',
            counters: [
              {name: 'tilesReturned', value: observed.data.tiles.length},
              {name: 'totalTiles', value: observed.data.total},
            ],
          },
        },
      ],
      associations: [
        {
          subject: {namespace: 'terrain-fixture', subjectId: 'diagnostic', revision: String(observed.data.state.epoch)},
          source: {
            path: sourcePath,
            selector: 'generation(revision)',
            digest: {provenance: 'observed', value: hash(readFileSync(resolve(ROOT, sourcePath)))},
          },
          relationship: 'fixture generation defines this finite surface',
          provenance: 'declared',
          targets: [target],
        },
      ],
    });
    assert.equal(result.ok, true);
    captures.push(result.sidecar);
    return observed.data;
  };
  const initial = await capture('initial');
  assert.equal(initial.status, 'ready');
  assert.equal(initial.tiles[0].prepared.stride, 1);
  assert.equal(initial.tiles[0].displayed.stride, 2);
  await page.screenshot({path: resolve(out, 'initial.png')});
  assert.equal(await page.evaluate(() => window.terrainInspect.begin()), 'accepted');
  await page.waitForFunction(() => window.terrainInspect.state().builds === 1);
  const pending = await capture('pending');
  assert.equal(pending.state.epoch, 1);
  assert.equal(pending.state.desiredEpoch, 2);
  assert.equal(pending.state.requests, 1);
  assert.equal(pending.contact.sample.height, 1);
  await page.evaluate(() => window.terrainInspect.complete());
  await page.waitForFunction(() => window.terrainInspect.state().ready === 1);
  assert.equal(await page.evaluate(() => window.terrainInspect.publish()), true);
  const published = await capture('published');
  assert.equal(published.state.epoch, 2);
  assert.equal(published.tiles[0].displayed.stride, 1);
  assert.equal(published.contact.sample.height, 2);
  assert.equal(await page.evaluate(() => window.terrainInspect.inspect(1).status), 'stale');
  assert.equal(await page.evaluate(() => window.terrainInspect.inspect(2, 1).status), 'stale-display');
  await page.screenshot({path: resolve(out, 'published.png')});
  const before = await page.evaluate(() => window.terrainInspect.state());
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.terrainInspect.inspect());
  assert.deepEqual(
    await page.evaluate(() => window.terrainInspect.state()),
    before,
    'inspection starts no build or rendering work',
  );
  await page.evaluate(() => window.terrainInspect.close());
  const closed = await page.evaluate(() => window.terrainInspect.inspect());
  assert.equal(closed.status, 'closed');
  assert.equal(closed.state.bytes, 0);
  assert.equal(closed.state.requests, 0);
  assert.deepEqual(report.errors, []);
  writeFileSync(resolve(out, 'snapshots.json'), JSON.stringify({initial, pending, published, closed}, null, 2));
  assert.deepEqual(
    captures.map(c => c.associations[0].subject.revision),
    ['1', '1', '2'],
  );
  assert.ok(captures.every(c => c.records[0].completeness.status === 'partial'));
  writeFileSync(resolve(out, 'subjects.json'), JSON.stringify(captures, null, 2));
  report.limitations.push(
    'Subject links are fixture declarations; source/configuration hashes are observed, executable build identity is unavailable for this Vite dev capture',
  );
  report.passed = true;
  console.log(`Terrain inspection export passed; evidence ${out}`);
} catch (error) {
  report.errors.push(String(error));
  throw error;
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
