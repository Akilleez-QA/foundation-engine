#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/model-preview');
mkdirSync(out, {recursive: true});
const original = readFileSync(resolve(ROOT, 'templates/mechanics/game/public/models/mechanics/beacon.glb'));
// Derive visibly distinct original variants without changing shared asset files.
function variant(missing = false) {
  const length = original.readUInt32LE(12),
    json = JSON.parse(original.subarray(20, 20 + length).toString());
  json.materials[0].pbrMetallicRoughness.baseColorFactor = [0.15, 0.8, 0.95, 1];
  json.nodes[0].scale = [2, 1, 2];
  if (missing) json.nodes.find(n => n.name === 'hand').name = 'alternate';
  const encoded = Buffer.from(JSON.stringify(json)),
    padded = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 32)]),
    rest = original.subarray(20 + length);
  const header = Buffer.from(original.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + rest.length, 8);
  header.writeUInt32LE(padded.length, 12);
  return Buffer.concat([header, padded, rest]);
}
const second = variant(),
  missing = variant(true);
assert.notDeepEqual(second, original);
// A textured variant: an embedded PNG the browser decodes into an ImageBitmap while GLTFLoader parses.
function png(size = 8) {
  const crcTable = Array.from({length: 256}, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc = buf => {
    let c = ~0;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type),
      len = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push(...((x + y) % 2 ? [40, 200, 240, 255] : [240, 240, 240, 255]));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function textured() {
  const length = original.readUInt32LE(12),
    json = JSON.parse(original.subarray(20, 20 + length).toString());
  const binAt = 20 + length,
    binLength = original.readUInt32LE(binAt),
    bin = original.subarray(binAt + 8, binAt + 8 + binLength);
  const count = json.accessors[json.meshes[0].primitives[0].attributes.POSITION].count,
    uv = Buffer.alloc(count * 8);
  for (let i = 0; i < count; i++) {
    uv.writeFloatLE((i % 4) / 3, i * 8);
    uv.writeFloatLE(Math.floor(i / 4) / 3, i * 8 + 4);
  }
  const image = png(),
    pad = n => Buffer.alloc((4 - (n % 4)) % 4);
  const data = Buffer.concat([bin, pad(bin.length), uv, image, pad(image.length)]);
  const uvAt = bin.length + pad(bin.length).length,
    imageAt = uvAt + uv.length;
  json.bufferViews.push(
    {buffer: 0, byteOffset: uvAt, byteLength: uv.length},
    {buffer: 0, byteOffset: imageAt, byteLength: image.length},
  );
  json.accessors.push({bufferView: json.bufferViews.length - 2, componentType: 5126, count, type: 'VEC2'});
  json.meshes[0].primitives[0].attributes.TEXCOORD_0 = json.accessors.length - 1;
  json.images = [{bufferView: json.bufferViews.length - 1, mimeType: 'image/png'}];
  json.samplers = [{magFilter: 9728, minFilter: 9728}];
  json.textures = [{source: 0, sampler: 0}];
  json.materials[0].pbrMetallicRoughness.baseColorTexture = {index: 0};
  json.buffers[0].byteLength = data.length;
  const encoded = Buffer.from(JSON.stringify(json)),
    text = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 32)]);
  const header = Buffer.alloc(12),
    jsonHead = Buffer.alloc(8),
    binHead = Buffer.alloc(8);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + data.length, 8);
  jsonHead.writeUInt32LE(text.length, 0);
  jsonHead.write('JSON', 4);
  binHead.writeUInt32LE(data.length, 0);
  binHead.write('BIN\0', 4);
  return Buffer.concat([header, jsonHead, text, binHead, data]);
}
const decoded = textured();
let secondUnavailable = false,
  secondMissing = false,
  held = [];
// Server-side record of each decoded.glb response: bytes written and whether Node finished handing them to the socket.
const decodedResponses = [];
const release = () => {
  for (const respond of held.splice(0)) respond();
};
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Model candidate preview</title><style>body{margin:0;background:#172332;color:white;font:16px sans-serif}.workspace{display:grid;grid-template-columns:2fr 1fr;height:88vh}#app{position:relative;min-width:0}aside{padding:16px;overflow:auto;background:#eee;color:#111}button,select{padding:10px;margin:4px}pre{white-space:pre-wrap;font-size:13px}header,footer{padding:12px}</style></head><body><header class="shell-header"><div class="header-left">Model candidates · accepted left / preview right</div></header><main class="workspace"><div id="app" class="app-root"></div><aside><label for="form">Candidate</label><select id="form">${['first', 'second', 'slow', 'failed', 'missing', 'decoded'].map(id => `<option>${id}</option>`).join('')}</select>${['preview', 'cancel', 'commit', 'save', 'retry', 'reload'].map(id => `<button id="${id}">${id}</button>`).join('')}<pre id="state" role="status"></pre></aside></main><footer>Desktop keyboard + pointer · original GLB assets · local saves</footer><script type="module" src="/scripts/play/fixtures/model-preview-entry.mjs"></script></body></html>`;
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'model-preview-fixture',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__model-preview.html')) {
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
            return;
          }
          const match = /^\/__model-preview\/(first|second|slow|failed|missing|decoded)\.glb$/.exec(req.url ?? '');
          if (!match) {
            next();
            return;
          }
          const id = match[1];
          if (id === 'failed' || (id === 'second' && secondUnavailable)) {
            res.statusCode = 503;
            res.end('Injected unavailable model');
            return;
          }
          res.setHeader('Cache-Control', 'no-store');
          const respond = () => {
            if (res.destroyed) return;
            res.setHeader('Content-Type', 'model/gltf-binary');
            res.end(
              id === 'first'
                ? original
                : id === 'decoded'
                  ? decoded
                  : id === 'missing' || (id === 'second' && secondMissing)
                    ? missing
                    : second,
            );
          };
          if (id === 'decoded') {
            const row = {bytes: decoded.length, finished: false, closedEarly: false};
            decodedResponses.push(row);
            res.on('finish', () => (row.finished = true));
            res.on('close', () => (row.closedEarly = !row.finished));
          }
          if (id === 'slow') held.push(respond);
          else respond();
        });
      },
    },
  ],
  server: {host: '127.0.0.1', port: 0},
});
const report = {
  dirtyWorktree: !!execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  consoleErrors: [],
  screenshots: [],
  limitations: [
    'Desktop Chromium emulation only; no physical-device, phone or full accessibility acceptance.',
    'Two original fixture variants; no skeletal fusion or retargeting claim.',
    'Single-writer local save; readiness is separate from durable publication.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
let browser;
const assertExpectedErrors = () => {
  assert.deepEqual(report.errors, []);
  for (const id of ['failed', 'second']) {
    const resource = report.consoleErrors.filter(
      e => e.url.endsWith(`/__model-preview/${id}.glb`) && /^Failed to load resource:.*503/.test(e.text),
    );
    const runtime = report.consoleErrors.filter(e =>
      e.text.startsWith(`[feature.sample] sample: model failed Error: [assets] /__model-preview/${id}.glb: HTTP 503`),
    );
    assert.equal(resource.length, 1, `${id} expected browser HTTP failure`);
    assert.equal(runtime.length, 1, `${id} expected owned failure report`);
  }
  assert.equal(report.consoleErrors.length, 4, 'only the four explicit injected error reports are allowed');
};
try {
  await server.listen();
  browser = await launch({width: 1440, height: 960, strictClose: true});
  const page = browser.page;
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') report.consoleErrors.push({text: m.text(), url: m.location().url});
  });
  await page.addInitScript(() => {
    window.__modelDraws = 0;
    for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!ctor) continue;
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const original = ctor.prototype[name];
        if (original)
          ctor.prototype[name] = function (...args) {
            window.__modelDraws++;
            return original.apply(this, args);
          };
      }
    }
  });
  // Decode hold (test-only): while armed, the real createImageBitmap decodes, then its result is withheld until released.
  await page.addInitScript(() => {
    const real = window.createImageBitmap.bind(window);
    window.__decodeHold = {armed: false, cycle: null, decoded: [], held: [], releases: [], started: 0, startedAt: null};
    // Page-side transfer record for the decoded model: a cloned body is read to the end, so its byte count and the
    // time it completed come from the page itself rather than from the browser's network event bookkeeping.
    const realFetch = window.fetch.bind(window);
    window.__decodedTransfers = [];
    window.fetch = function (input, init) {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const result = realFetch(input, init);
      if (url.pathname !== '/__model-preview/decoded.glb') return result;
      const row = {status: null, bytes: null, completedAt: null, error: null};
      window.__decodedTransfers.push(row);
      return result.then(response => {
        row.status = response.status;
        response
          .clone()
          .arrayBuffer()
          .then(
            body => {
              row.bytes = body.byteLength;
              row.completedAt = performance.now();
            },
            error => (row.error = String(error)),
          );
        return response;
      });
    };
    window.createImageBitmap = function (...args) {
      const hold = window.__decodeHold;
      if (!hold.armed) return real(...args);
      hold.started++;
      hold.startedAt ??= performance.now();
      return real(...args).then(bitmap => {
        hold.decoded.push({width: bitmap.width, height: bitmap.height});
        hold.held.push({cycle: hold.cycle, bitmap});
        return new Promise(resolve => hold.releases.push(() => resolve(bitmap)));
      });
    };
  });
  const read = () => page.evaluate(() => modelPreview.read());
  const click = id => page.locator('#' + id).click();
  const choose = async id => {
    await page.locator('#form').selectOption(id);
    await click('preview');
  };
  const heldRequest = async () => {
    const end = Date.now() + 5000;
    while (!held.length) {
      assert.ok(Date.now() < end, 'delayed model request reached server');
      await new Promise(r => setTimeout(r, 10));
    }
  };
  const candidateReady = () =>
    page.waitForFunction(
      () => modelPreview.read().candidate?.status === 'ready' && modelPreview.read().candidate?.visible,
    );
  const acceptedReady = () =>
    page.waitForFunction(
      () => window.modelPreview?.read().accepted?.status === 'ready' && modelPreview.read().accepted?.visible,
    );
  const shot = async name => {
    const path = resolve(out, name + '.png');
    await page.screenshot({path, fullPage: true});
    report.screenshots.push(path);
  };
  await page.goto(server.resolvedUrls.local[0] + '__model-preview.html?flags=dev.silent');
  await acceptedReady();
  const initial = await read();
  assert.equal(initial.value.parts.form, 'first');
  assert.equal(initial.count, 1);
  assert.equal(initial.save, 'not-saved');
  await choose('slow');
  await heldRequest();
  await page.waitForFunction(() => modelPreview.read().candidate?.status === 'loading');
  const pending = await read();
  assert.equal(pending.candidate.visible, false);
  assert.equal(pending.accepted.entity, initial.accepted.entity);
  assert.equal(pending.count, 2);
  assert.equal(await page.locator('#commit').isDisabled(), true);
  await shot('pending');
  await click('cancel');
  assert.equal((await read()).count, 1);
  release();
  await choose('second');
  await candidateReady();
  const preview = await read();
  assert.equal(preview.value.parts.form, 'first');
  assert.equal(preview.accepted.entity, initial.accepted.entity);
  await shot('preview');
  await page.locator('#commit').focus();
  await page.keyboard.press('Enter');
  assert.equal((await read()).value.parts.form, 'second');
  assert.equal((await read()).count, 1);
  assert.equal((await read()).save, 'unsaved');
  await click('save');
  assert.equal((await read()).save, 'saved');
  await click('reload');
  await acceptedReady();
  assert.equal((await read()).accepted.adoptedAsset, 'second');
  await page.waitForFunction(() => modelPreview.read().message === 'Accepted model ready.');
  assert.equal(await page.locator('#form').inputValue(), 'second');
  await shot('restored');
  // A schema-valid stored selection can still be incompatible with its actual model.
  const storageKey = 'model-preview|device|model.profile';
  const savedBytes = await page.evaluate(key => localStorage.getItem(key), storageKey);
  assert.ok(savedBytes);
  await page.evaluate(key => {
    const envelope = JSON.parse(localStorage.getItem(key));
    envelope.data.parts.form = 'missing';
    localStorage.setItem(key, JSON.stringify(envelope));
  }, storageKey);
  await click('reload');
  await page.waitForFunction(() => window.modelPreview?.read().message.includes('Accepted model is incompatible'));
  assert.equal((await read()).accepted.status, 'ready');
  assert.equal((await read()).accepted.visible, false);
  assert.equal((await read()).value.parts.form, 'missing');
  assert.equal(await page.locator('#save').isDisabled(), true);
  const missingBytes = await page.evaluate(key => localStorage.getItem(key), storageKey);
  assert.equal(await page.locator('#retry').isDisabled(), true);
  assert.match((await read()).message, /Reload after fixing the asset/);
  await click('reload');
  await page.waitForFunction(() => window.modelPreview?.read().message.includes('Accepted model is incompatible'));
  assert.equal((await read()).accepted.visible, false);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), missingBytes);
  await shot('restore-incompatible');
  await page.evaluate(({key, bytes}) => localStorage.setItem(key, bytes), {key: storageKey, bytes: savedBytes});
  secondMissing = true;
  await click('reload');
  await page.waitForFunction(() => window.modelPreview?.read().message.includes('Accepted model is incompatible'));
  assert.equal((await read()).value.parts.form, 'second');
  assert.equal((await read()).accepted.visible, false);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), savedBytes);
  assert.match((await read()).message, /Reload after fixing the asset/);
  assert.equal(await page.locator('#retry').isDisabled(), true);
  secondMissing = false;
  await click('reload');
  await acceptedReady();
  const accepted = (await read()).accepted.entity;
  await choose('failed');
  await page.waitForFunction(() => modelPreview.read().candidate?.status === 'failed');
  assert.equal((await read()).accepted.entity, accepted);
  assert.equal((await read()).value.parts.form, 'second');
  assert.equal(await page.locator('#commit').isDisabled(), true);
  await click('cancel');
  await choose('missing');
  await page.waitForFunction(() => modelPreview.read().message.includes('socket missing'));
  assert.equal((await read()).candidate.visible, false);
  assert.equal((await read()).value.parts.form, 'second');
  await click('cancel');
  // Supersede a pending candidate. Its later network completion cannot adopt it.
  await choose('slow');
  await heldRequest();
  await page.waitForFunction(() => modelPreview.read().candidate?.status === 'loading');
  const stale = (await read()).candidate.entity;
  await choose('first');
  await candidateReady();
  release();
  await page.waitForTimeout(100);
  assert.notEqual((await read()).candidate.entity, stale);
  assert.equal((await read()).candidate.adoptedAsset, 'first');
  assert.equal((await read()).accepted.adoptedAsset, 'second');
  await click('cancel');
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => ({models: engine.probe('models'), draws: window.__modelDraws}));
  await page.evaluate(() => modelPreview.queryRepeated());
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({models: engine.probe('models'), draws: window.__modelDraws}));
  assert.deepEqual(after, before);
  secondUnavailable = true;
  await click('reload');
  await page.waitForFunction(() => window.modelPreview?.read().accepted?.status === 'failed');
  assert.equal((await read()).value.parts.form, 'second');
  assert.equal((await read()).accepted.visible, false);
  await shot('restore-failed');
  secondUnavailable = false;
  await click('retry');
  await acceptedReady();
  assert.equal((await read()).value.parts.form, 'second');
  await choose('slow');
  await heldRequest();
  await page.waitForFunction(() => modelPreview.read().candidate?.status === 'loading');
  const epoch = await page.evaluate(() => engine.state().scene.epoch);
  await page.evaluate(() => engine.goto('sample', {again: 'replacement'}));
  release();
  await page.waitForFunction(
    epoch => engine.state().scene?.epoch !== epoch && modelPreview.read().accepted?.status === 'ready',
    epoch,
  );
  assert.equal((await read()).candidate, null);
  assert.equal((await read()).count, 1);
  assert.equal((await read()).accepted.adoptedAsset, 'second');
  // Correlate terminal events with the exact request object, not a reused URL or earlier injected failure.
  const terminalFor = request => {
    let timer, finished, failed;
    const promise = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        page.off('requestfinished', finished);
        page.off('requestfailed', failed);
      };
      const settle = (candidate, status) => {
        if (candidate !== request) return;
        cleanup();
        resolve({url: request.url(), status, error: request.failure()?.errorText ?? null});
      };
      finished = candidate => settle(candidate, 'finished');
      failed = candidate => settle(candidate, 'failed');
      page.on('requestfinished', finished);
      page.on('requestfailed', failed);
      timer = setTimeout(() => {
        cleanup();
        reject(Error('exact delayed request did not settle'));
      }, 5000);
    });
    // Preserve a meaningful scenario failure if an action throws before this terminal wait is awaited.
    promise.catch(() => {});
    return promise;
  };
  const beginDelayed = async () => {
    const started = page.waitForEvent('request', {
      predicate: request => new URL(request.url()).pathname === '/__model-preview/slow.glb',
      timeout: 5000,
    });
    await choose('slow');
    const request = await started;
    const terminal = terminalFor(request);
    await heldRequest();
    await page.waitForFunction(() => modelPreview.read().candidate?.status === 'loading');
    return {terminal};
  };
  const resources = () => page.evaluate(() => modelPreview.resources());
  const baseline = await resources();
  assert.equal(baseline.instances, 1);
  assert.equal(baseline.cleanupFailures, 0);
  const cycles = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const {terminal} = await beginDelayed();
    const prior = (await read()).accepted.entity;
    await click('cancel');
    const transport = await terminal;
    release();
    const cancelled = await read(),
      settled = await resources();
    assert.equal(cancelled.candidate, null);
    assert.equal(cancelled.accepted.entity, prior);
    assert.equal(cancelled.accepted.adoptedAsset, 'second');
    assert.equal(settled.instances, 1);
    assert.ok(settled.residentMiB <= baseline.residentMiB);
    assert.ok(settled.bytesKeptMiB <= baseline.bytesKeptMiB);
    assert.equal(settled.cleanupFailures, 0);
    const previousEpoch = await page.evaluate(() => engine.state().scene.epoch);
    await page.evaluate(cycle => engine.goto('sample', {cycle: String(cycle)}), cycle);
    await acceptedReady();
    assert.notEqual(await page.evaluate(() => engine.state().scene.epoch), previousEpoch);
    const reentered = await read(),
      retained = await resources();
    assert.equal(reentered.candidate, null);
    assert.equal(reentered.accepted.adoptedAsset, 'second');
    assert.equal(reentered.count, 1);
    assert.equal(retained.instances, 1);
    assert.ok(retained.residentMiB <= baseline.residentMiB);
    assert.ok(retained.bytesKeptMiB <= baseline.bytesKeptMiB);
    assert.equal(retained.cleanupFailures, 0);
    cycles.push({cycle, transport, cancelled, settled, reentered, retained});
  }
  // Cancellation after decode: the GLB response is delivered in full and its embedded image is decoded to an
  // ImageBitmap; the candidate is cancelled while that decoded result is withheld from the parse, so preparation finishes
  // only after cancellation. Nothing may attach, and every decoded resource must be released.
  const decodeBaseline = await resources(),
    decodeCycles = [];
  assert.equal(decodeBaseline.instances, 1);
  assert.equal(decodeBaseline.cleanupFailures, 0);
  for (let cycle = 0; cycle < 3; cycle++) {
    const before = await resources(),
      prior = (await read()).accepted;
    await page.evaluate(cycle => {
      Object.assign(window.__decodeHold, {armed: true, cycle, decoded: [], startedAt: null});
      modelPreview.decodeTrack.arm(cycle);
    }, cycle);
    // Subscribe to the exact request's terminal event inside its request event, before the immediate response can finish.
    let terminal = null;
    const onRequest = request => {
      if (!terminal && new URL(request.url()).pathname === '/__model-preview/decoded.glb')
        terminal = terminalFor(request);
    };
    if (cycle === 0) page.on('request', onRequest);
    let transport = null;
    try {
      await choose('decoded');
      // Wait for the decode to be held before reading any transfer evidence; no cancellation has happened yet.
      await page.waitForFunction(
        () =>
          window.__decodeHold.decoded.length > 0 &&
          window.__decodeHold.releases.length === window.__decodeHold.decoded.length,
        null,
        {timeout: 10000},
      );
      if (cycle === 0) {
        // Informational only: Chromium may report a fully consumed body as net::ERR_ABORTED when the renderer
        // drops its loader before the network service's completion message, which raced under load in CI.
        const end = Date.now() + 5000;
        while (!terminal) {
          assert.ok(Date.now() < end, 'decoded model request observed');
          await new Promise(r => setTimeout(r, 10));
        }
        transport = await terminal;
      }
    } finally {
      page.off('request', onRequest);
    }
    // Transfer completion, asserted from the server and the page rather than from the browser's network event.
    await page.waitForFunction(
      () => window.__decodedTransfers.every(t => t.completedAt !== null || t.error !== null),
      null,
      {
        timeout: 5000,
      },
    );
    const transfers = await page.evaluate(() => window.__decodedTransfers.map(t => ({...t}))),
      decodeStartedAt = await page.evaluate(() => window.__decodeHold.startedAt);
    if (cycle === 0) {
      assert.equal(decodedResponses.length, 1, 'one decoded model response served');
      assert.deepEqual(
        decodedResponses[0],
        {bytes: decoded.length, finished: true, closedEarly: false},
        'server sent the whole body',
      );
      assert.equal(transfers.length, 1, 'one page fetch of the decoded model');
      assert.equal(transfers[0].error, null);
      assert.equal(transfers[0].status, 200);
      assert.equal(transfers[0].bytes, decoded.length, 'page received the whole body before cancellation');
      // The decode itself proves full delivery too: the library parses only after validateEmbeddedGlb accepts a
      // byte length equal to the GLB header's declared total, and the image decodes only inside that parse.
      assert.ok(decodeStartedAt !== null, 'image decode started before cancellation');
    } else assert.equal(transfers.length, 1, 'repeat cycles make no new page fetch');
    const decodedImages = await page.evaluate(() =>
      window.__decodeHold.decoded.map(d => ({width: d.width, height: d.height})),
    );
    const pending = await read();
    assert.equal(pending.candidate?.status, 'loading');
    assert.equal(pending.candidate?.visible, false);
    assert.equal(pending.accepted.entity, prior.entity);
    await click('cancel');
    const cancelled = await read();
    assert.equal(cancelled.candidate, null);
    // The scene's model owner retires a despawned entity's slot (and aborts its lease) at its next frame sync.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Let the withheld decode finish the parse after cancellation; the library must discard it, never upload it.
    await page.evaluate(() => {
      const hold = window.__decodeHold;
      hold.armed = false;
      for (const release of hold.releases.splice(0)) release();
    });
    await page.waitForFunction(drops => modelPreview.resources().lateDrops > drops, before.lateDrops, {timeout: 5000});
    await page.waitForTimeout(100);
    const settled = await resources(),
      track = await page.evaluate(cycle => modelPreview.decodeTrack.read(cycle), cycle),
      after = await read();
    await page.evaluate(() => modelPreview.decodeTrack.disarm());
    assert.equal(settled.lateDrops, before.lateDrops + 1, 'late decoded result discarded once');
    assert.equal(settled.parses, before.parses + 1, 'one parse per cycle');
    assert.equal(settled.disposed, before.disposed, 'no uploaded template disposed: nothing was published');
    assert.equal(settled.instances, 1);
    assert.equal(settled.residentMiB, before.residentMiB, 'no decoded resident bytes admitted');
    assert.ok(settled.residentMiB <= decodeBaseline.residentMiB);
    assert.equal(settled.cleanupFailures, 0);
    assert.equal(
      settled.fetches['/__model-preview/decoded.glb'],
      1,
      'repeat cycles decode retained file bytes; no second request',
    );
    assert.equal(after.candidate, null);
    assert.equal(after.accepted.entity, prior.entity);
    assert.equal(after.accepted.adoptedAsset, prior.adoptedAsset);
    assert.equal(after.count, 1);
    assert.equal(after.value.parts.form, 'second');
    assert.equal(track.parses, 1, 'the cancelled load finished one parse after cancellation');
    for (const kind of ['geometry', 'material', 'texture', 'bitmap']) {
      assert.ok(track[kind].total >= 1, `the cancelled parse produced ${kind}`);
      assert.equal(track[kind].released, track[kind].total, `every decoded ${kind} released`);
    }
    assert.equal(
      track.heldBitmapsInParse,
      decodedImages.length,
      'the bitmaps decoded before cancellation are the ones released',
    );
    decodeCycles.push({
      cycle,
      transport,
      transfers,
      server: cycle === 0 ? decodedResponses[0] : null,
      decodeStartedAt,
      decodedImages,
      pending: {candidate: pending.candidate, accepted: pending.accepted.entity},
      before,
      settled,
      track,
    });
  }
  const decodeEnd = await resources();
  assert.equal(decodeEnd.residentMiB, decodeBaseline.residentMiB);
  assert.equal(decodeEnd.instances, decodeBaseline.instances);
  assert.equal(decodeEnd.lateDrops, decodeBaseline.lateDrops + 3);
  // The library keeps fetched file bytes for the session (bounded LRU); the cancelled file is kept once, not per cycle.
  assert.equal(decodeCycles[1].settled.bytesKeptMiB, decodeCycles[0].settled.bytesKeptMiB);
  assert.equal(decodeEnd.bytesKeptMiB, decodeCycles[0].settled.bytesKeptMiB);
  report.decodeCancellation = {
    baseline: decodeBaseline,
    cycles: decodeCycles,
    end: decodeEnd,
    decodedFileBytes: decoded.length,
    scope:
      "The server finishes sending the whole GLB and the page reads exactly that many bytes (a cloned body; the Playwright terminal event is recorded but not asserted), and its embedded PNG is decoded to an ImageBitmap before cancellation; the decoded bitmap is withheld from GLTFLoader by a test-only createImageBitmap wrapper, so geometry/material creation and parse completion happen after cancellation. Cycles 2 and 3 decode the library's retained file bytes without a new request. The hold point is inside parsing, not between a completed parse and upload (that hop is a microtask in LeaseCache).",
  };
  await shot('decode-cancellation');
  await shot('repeated-retirement');
  const {terminal} = await beginDelayed();
  await page.evaluate(() => modelPreview.dispose());
  const disposalTransport = await terminal;
  release();
  assert.equal((await read()).retired, true);
  assert.equal((await read()).count, 0);
  const released = await resources();
  assert.equal(released.instances, 0);
  assert.equal(released.residentMiB, 0);
  assert.equal(released.bytesKeptMiB, 0);
  assert.equal(released.pinnedMiB, 0);
  assert.equal(released.cleanupFailures, 0);
  report.retirement = {
    baseline,
    cycles,
    disposalTransport,
    released,
    scope:
      'Exact browser transport terminal events precede owned-resource assertions. Requests can abort before decode; this is not decoded-work completion or document-owned renderer disposal evidence.',
  };
  writeFileSync(
    resolve(out, 'snapshots.json'),
    JSON.stringify({initial, pending, preview, before, after, released}, null, 2),
  );
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  release();
  await evidence.close(browser, 'browser close');
  await evidence.close(server, 'server close');
  try {
    assertExpectedErrors();
  } catch (error) {
    evidence.fail(error);
  }
  evidence.finish();
}
console.log(`Model preview passed; evidence ${out}`);
