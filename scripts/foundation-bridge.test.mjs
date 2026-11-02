import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {validateRenderMask} from '../src/author/render-mask.ts';
import {validateSceneOutput} from '../src/author/scene-output.ts';

const contract = JSON.parse(readFileSync('schemas/read-only-tools.json', 'utf8'));
const request = (method, params = {}, id = 1) => ({jsonrpc: '2.0', id, method, params});
const init = request('initialize', {protocolVersion: 'foundation-engine-jsonrpc/1'});
const call = (name, args) => request('tools/call', {name, arguments: args});
const run = (frames, suffix = '\n', options = []) => {
  const proc = spawnSync('python3', ['-B', 'tools/foundation_engine_bridge.py', ...options], {
    input: frames.map(f => (typeof f === 'string' ? f : JSON.stringify(f))).join('\n') + suffix,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(proc.error);
  return {status: proc.status, replies: proc.stdout.trim().split('\n').filter(Boolean).map(JSON.parse)};
};

test('bridge handshake, describe, ordering and request-only errors match sibling framing', () => {
  const {status, replies: r} = run([
    request('tools/list'),
    request('initialize', {protocolVersion: 'MCP'}),
    init,
    init,
    request('tools/list'),
    request('ping'),
    {jsonrpc: '2.0', method: 'ping'},
    request('resources/list'),
    call('shell', {}),
    request('ping', {}, null),
    [],
    request('ping', {extra: 1}),
  ]);
  assert.equal(status, 0);
  assert.deepEqual(
    r.map(x => x.error?.code ?? 'ok'),
    [-32000, -32001, 'ok', -32000, 'ok', 'ok', -32601, -32602, -32600, -32600, -32602],
  );
  assert.equal(r[2].result.protocolVersion, 'foundation-engine-jsonrpc/1');
  assert.equal(r[2].result.mcpCompatible, false);
  assert.equal(r[2].result.limits.inputFrameBytes, 65536);
  assert.equal(r[2].result.limits.outputFrameBytes, 1048576);
  assert.deepEqual(r[4].result.tools, contract.tools);
  assert.deepEqual(r[7], {jsonrpc: '2.0', id: 1, error: {code: -32602, message: 'Unknown engine tool'}});
});

for (const [name, args, expected] of [
  ['validate_render_mask', {mask: 4294967295}, 4294967295],
  ['validate_scene_output', {output: {toneMapping: 'agx', exposure: 2}}, {toneMapping: 'agx', exposure: 2}],
  ['validate_scene_output', {}, {toneMapping: 'none', exposure: 1}],
])
  test(`bridge calls ${name} with ${JSON.stringify(args)}`, () => {
    const {status, replies} = run([init, call(name, args)]);
    assert.equal(status, 0);
    assert.deepEqual(replies[1].result, {isError: false, structuredContent: expected});
  });

test('bridge validates pinned schemas and recovers after invalid input', () => {
  const bad = [
    call('validate_render_mask', {}),
    ...[-1, 4294967296, 0.5, true, null, '1'].map(mask => call('validate_render_mask', {mask})),
    call('validate_render_mask', {mask: 1, extra: 1}),
    ...[null, [], {exposure: 0}, {exposure: 17}, {exposure: null}, {toneMapping: 'bad'}, {extra: 1}].map(output =>
      call('validate_scene_output', {output}),
    ),
  ];
  const {replies} = run([init, ...bad, request('ping')]);
  for (const r of replies.slice(1, -1)) assert.equal(r.error.code, -32602);
  assert.deepEqual(replies.at(-1).result, {});
});

test('bridge rejects malformed, duplicate, numeric and bounded-frame violations', () => {
  for (const raw of [
    '{"x":1,"x":2}',
    '{"x":1e3}',
    '{"x":NaN}',
    '{"x":1234567890123456}',
    '['.repeat(33) + ']'.repeat(33),
    JSON.stringify('x'.repeat(1025)),
    '[' + '0,'.repeat(4096) + '0]',
    '{',
  ])
    assert.ok([-32700, -32002].includes(run([raw]).replies[0].error.code));
  assert.equal(run(['x'.repeat(65538)]).status, 2);
  assert.equal(run([init], '').status, 2);
  assert.equal(run([], '\n', ['--root', '/']).status, 2);
});

test('bridge results equal the TypeScript validators', () => {
  const cases = [
    ['validate_render_mask', {mask: 0}, a => validateRenderMask(a.mask)],
    ['validate_render_mask', {mask: 4294967295}, a => validateRenderMask(a.mask)],
    ...[{}, {toneMapping: 'aces'}, {exposure: 0.25}, {toneMapping: 'neutral', exposure: 16}].map(output => [
      'validate_scene_output',
      {output},
      a => validateSceneOutput(a.output),
    ]),
    ['validate_scene_output', {}, a => validateSceneOutput(a.output)],
  ];
  const {replies} = run([init, ...cases.map(([name, args]) => call(name, args))]);
  cases.forEach(([, args, expected], i) => assert.deepEqual(replies[i + 1].result.structuredContent, expected(args)));
});

test('bridge answers a read-only call from the bridge and schema alone, without Node on PATH', () => {
  const root = mkdtempSync(join(tmpdir(), 'foundation-bridge-alone-'));
  try {
    for (const dir of ['tools', 'schemas', 'bin']) mkdirSync(join(root, dir));
    copyFileSync('tools/foundation_engine_bridge.py', join(root, 'tools/foundation_engine_bridge.py'));
    copyFileSync('schemas/read-only-tools.json', join(root, 'schemas/read-only-tools.json'));
    const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], {encoding: 'utf8'}).stdout.trim();
    symlinkSync(python, join(root, 'bin/python3'));
    const proc = spawnSync(join(root, 'bin/python3'), ['-B', join(root, 'tools/foundation_engine_bridge.py')], {
      cwd: root,
      env: {PATH: join(root, 'bin')},
      input: [init, call('validate_render_mask', {mask: 1})].map(f => JSON.stringify(f)).join('\n') + '\n',
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(proc.status, 0);
    const replies = proc.stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(replies[1].result, {isError: false, structuredContent: 1});
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
