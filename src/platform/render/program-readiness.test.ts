import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForPrograms} from './program-readiness';
function fixture() {
  const owner = new AbortController(),
    tracked = new Map<object, string>(),
    ready = new Set<object>(),
    queries: object[] = [];
  let callback: (() => void) | undefined,
    time = 0,
    lost = false,
    canceled = 0;
  const gl = {
    getExtension: () => ({COMPLETION_STATUS_KHR: 0x91b1}),
    isContextLost: () => lost,
    getProgramParameter: (p: object) => {
      queries.push(p);
      return ready.has(p);
    },
  } as unknown as Parameters<typeof waitForPrograms>[0];
  const options = {
    now: () => time,
    request: (fn: () => void) => {
      callback = fn;
      return 1;
    },
    cancel: () => {
      callback = undefined;
      canceled++;
    },
    maxWaitMs: 100,
  };
  return {
    owner,
    tracked,
    ready,
    queries,
    gl,
    options,
    step() {
      const fn = callback;
      callback = undefined;
      fn?.();
    },
    lose() {
      lost = true;
    },
    advance() {
      time = 101;
    },
    get pending() {
      return !!callback;
    },
    get canceled() {
      return canceled;
    },
  };
}
test('all captured live programs, including earlier pending programs, finish before readiness', async () => {
  const f = fixture(),
    a = {},
    b = {};
  f.tracked.set(a, 'deleteProgram');
  f.tracked.set(b, 'deleteProgram');
  f.tracked.set({}, 'deleteBuffer');
  f.ready.add(a);
  const p = waitForPrograms(f.gl, f.tracked, f.owner.signal, f.options);
  assert.equal(f.pending, true);
  f.ready.add(b);
  f.step();
  assert.equal(await p, 'ready');
  assert.deepEqual(f.queries, [a, b, a, b]);
  assert.equal(f.pending, false);
});
test('abort and context loss stop pending queries without retaining a material or renderer', async () => {
  for (const cause of ['abort', 'loss']) {
    const f = fixture();
    f.tracked.set({}, 'deleteProgram');
    const p = waitForPrograms(f.gl, f.tracked, f.owner.signal, f.options);
    if (cause === 'abort') f.owner.abort();
    else {
      f.lose();
      f.step();
    }
    assert.equal(await p, 'retired');
    const count = f.queries.length;
    f.step();
    assert.equal(f.queries.length, count);
    assert.equal(f.pending, false);
  }
});
test('deleted program is never polled again; unsupported fallback does not claim parallel readiness', async () => {
  const f = fixture(),
    a = {};
  f.tracked.set(a, 'deleteProgram');
  const p = waitForPrograms(f.gl, f.tracked, f.owner.signal, f.options);
  f.tracked.delete(a);
  f.step();
  assert.equal(await p, 'ready');
  assert.equal(f.queries.length, 1);
  f.gl.getExtension = () => null;
  assert.equal(await waitForPrograms(f.gl, f.tracked, f.owner.signal, f.options), 'unsupported');
});
test('capacity, timeout and GL failures reject rather than reporting ready', async () => {
  const f = fixture();
  f.tracked.set({}, 'deleteProgram');
  f.tracked.set({}, 'deleteProgram');
  await assert.rejects(waitForPrograms(f.gl, f.tracked, f.owner.signal, {...f.options, maxPrograms: 1}), /capacity/);
  const pending = waitForPrograms(f.gl, f.tracked, f.owner.signal, f.options);
  f.advance();
  f.step();
  await assert.rejects(pending, /timed out/);
  assert.equal(f.pending, false);
  f.gl.getProgramParameter = () => {
    throw Error('driver');
  };
  await assert.rejects(waitForPrograms(f.gl, f.tracked, f.owner.signal, f.options), /driver/);
});
test('abort during a driver query retires before another program is queried', async () => {
  const f = fixture();
  f.tracked.set({}, 'deleteProgram');
  f.tracked.set({}, 'deleteProgram');
  let count = 0;
  f.gl.getProgramParameter = () => {
    count++;
    f.owner.abort();
    return true;
  };
  assert.equal(await waitForPrograms(f.gl, f.tracked, f.owner.signal, f.options), 'retired');
  assert.equal(count, 1);
});

test('validation uses the bounded submission snapshot, excluding later handles and retaining unsupported bounds', async () => {
  const first = {} as WebGLProgram,
    later = {} as WebGLProgram,
    tracked = new Map<object, string>([[first, 'deleteProgram']]);
  const validated: WebGLProgram[] = [],
    frames: (() => void)[] = [];
  let ready = false;
  const gl = {
    isContextLost: () => false,
    getExtension: () => ({COMPLETION_STATUS_KHR: 1}),
    getProgramParameter: () => ready,
  } as unknown as WebGL2RenderingContext;
  const pending = waitForPrograms(gl, tracked, new AbortController().signal, {
    maxPrograms: 1,
    validate: p => validated.push(p),
    request: fn => {
      frames.push(fn);
      return 1;
    },
    cancel: () => {},
  });
  tracked.set(later, 'deleteProgram');
  ready = true;
  frames.shift()!();
  assert.equal(await pending, 'ready');
  assert.deepEqual(validated, [first]);
  gl.getExtension = () => null;
  await assert.rejects(
    waitForPrograms(gl, tracked, new AbortController().signal, {maxPrograms: 1, validate: p => validated.push(p)}),
    /capacity/,
  );
  assert.deepEqual(validated, [first]);
});

test('last validation callback retirement cannot publish ready or unsupported', async () => {
  for (const supported of [false, true]) {
    const owner = new AbortController(),
      program = {} as WebGLProgram;
    const gl = {
      isContextLost: () => false,
      getExtension: () => (supported ? {COMPLETION_STATUS_KHR: 1} : null),
      getProgramParameter: () => true,
    } as unknown as WebGL2RenderingContext;
    assert.equal(
      await waitForPrograms(gl, new Map([[program, 'deleteProgram']]), owner.signal, {validate: () => owner.abort()}),
      'retired',
    );
  }
});
