import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runScript} from './script.mjs';
import {snap, report} from './snap.mjs';

test('capture failure terminates script and preserves primary and cleanup failures in report', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'capture-script-'));
  const keys = [];
  let reads = 0,
    closed = 0;
  const browser = {
    errors: [],
    page: {},
    evaluate: async () => {
      reads++;
      throw Error('RESOURCE_CAPTURE_FAILED');
    },
    key: async (key, down) => {
      keys.push([key, down]);
      if (!down) throw Error('release failure');
    },
    close: async () => {
      closed++;
      throw Error('close failure');
    },
  };
  try {
    const result = await runScript(
      {
        name: 'capture',
        steps: [
          {holdUntil: 'x', until: {path: 'world.state.bad', equals: null}, every: 1},
          {expect: {path: 'world.state.bad', equals: null}},
        ],
      },
      '',
      {directory, launch: async () => browser, open: async () => {}},
    );
    assert.equal(result.pass, false);
    assert.equal(result.terminal, true);
    assert.equal(reads, 1);
    assert.equal(closed, 1);
    assert.deepEqual(keys, [
      ['x', true],
      ['x', false],
    ]);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].ok, false);
    assert.match(result.errors.join(' '), /RESOURCE_CAPTURE_FAILED/);
    assert.match(result.errors.join(' '), /release failure/);
    assert.match(result.errors.join(' '), /close failure/);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')), result);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('snap saves incomplete observation and screenshot without inventing state', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'capture-snap-'));
  let closed = 0;
  const browser = {
    errors: ['concurrent page failure'],
    page: {addInitScript: async () => {}, screenshot: async () => Buffer.from('image')},
    evaluate: async code => {
      if (code === 'window.engine.state()') throw Error('RESOURCE_CAPTURE_FAILED');
      return null;
    },
    close: async () => {
      closed++;
    },
  };
  try {
    const result = await snap(
      {scene: 'test', url: ''},
      {
        directory,
        launch: async () => browser,
        open: async () => ['warning: observation pending'],
        measure: async () => ({renders: 1}),
        activity: async () => ({}),
        gpuCensus: async () => null,
      },
    );
    assert.equal(closed, 1);
    assert.equal(result.views.desktop.status, 'incomplete');
    assert.ok(result.views.desktop.screenshot);
    assert.equal('state' in result.views.desktop, false);
    assert.match(result.errors.join(' '), /RESOURCE_CAPTURE_FAILED/);
    assert.match(result.errors.join(' '), /concurrent page failure/);
    assert.deepEqual(result.console, ['desktop: warning: observation pending']);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'probe.json'), 'utf8')), result);
    const lines = [];
    t.mock.method(console, 'log', line => lines.push(line));
    assert.equal(report(result), 1);
    assert.match(lines.join(' '), /incomplete observation/);
    assert.doesNotMatch(lines.join(' '), /0 entities|state \{\}/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('script launch failure still writes terminal evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'launch-script-'));
  try {
    const result = await runScript({name: 'launch', steps: [{expect: {path: 'world', exists: true}}]}, '', {
      directory,
      launch: async () => {
        throw Error('launch refused');
      },
    });
    assert.equal(result.pass, false);
    assert.equal(result.terminal, true);
    assert.deepEqual(result.steps, []);
    assert.match(result.errors.join(' '), /launch refused/);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')), result);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('later view launch failure preserves completed snapshot evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'launch-snap-'));
  let launches = 0,
    closes = 0;
  const browser = {
    errors: [],
    page: {addInitScript: async () => {}, screenshot: async () => Buffer.from('image')},
    evaluate: async code => (code === 'window.engine.state()' ? {world: {entities: 2, state: {ok: true}}} : null),
    close: async () => {
      closes++;
    },
  };
  try {
    const result = await snap(
      {scene: 'test', url: '', mobile: true},
      {
        directory,
        launch: async () => {
          if (++launches === 2) throw Error('mobile launch refused');
          return browser;
        },
        open: async () => [],
        measure: async () => ({renders: 1, drawsPerFrame: 1, trisPerFrame: 1}),
        activity: async () => ({}),
        gpuCensus: async () => null,
      },
    );
    assert.equal(launches, 2);
    assert.equal(closes, 1);
    assert.equal(result.views.desktop.status, 'complete');
    assert.equal(result.views.desktop.state.world.entities, 2);
    assert.equal(result.views.mobile.status, 'incomplete');
    assert.equal('state' in result.views.mobile, false);
    assert.match(result.errors.join(' '), /mobile launch refused/);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'probe.json'), 'utf8')), result);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
