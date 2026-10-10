import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuTimer} from './gpu-timer';
import {fakeTimerGl as fakeGl} from './testing/fake-timer-gl';

const frame = (t: ReturnType<typeof createGpuTimer>, n: number) => {
  const began = t.begin(n);
  if (began) t.end();
  return began;
};

test('gpu timer: unavailable extension leaves gpuMs undefined and makes no query', () => {
  const f = fakeGl({extension: false});
  const t = createGpuTimer(f.gl);
  assert.equal(t.status, 'unavailable');
  assert.equal(frame(t, 1), false);
  assert.equal(t.poll(), 0);
  assert.equal(t.lastMs, undefined);
  assert.deepEqual(t.take(), []);
  assert.equal(f.live.size, 0);
  assert.equal(t.stats().measured, 0);
});

test('gpu timer: results arrive frames later and are attributed to the frame that opened them', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  assert.equal(t.status, 'available');
  frame(t, 10);
  frame(t, 11);
  assert.equal(t.poll(), 0, 'nothing answered yet: poll returns at once');
  frame(t, 12);
  f.answer([2.5, 3], 2);
  assert.equal(t.poll(), 2);
  assert.deepEqual(t.take(), [
    {frame: 10, gpuMs: 2.5},
    {frame: 11, gpuMs: 3},
  ]);
  assert.equal(t.lastMs, 3);
  f.answer(1.25);
  t.poll();
  assert.deepEqual(t.take(), [{frame: 12, gpuMs: 1.25}]);
  assert.equal(t.stats().inFlight, 0);
});

test('gpu timer: readback stops at the first unanswered query (completion order is kept)', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  frame(t, 1);
  frame(t, 2);
  // Answer only the second: the first is still pending, so nothing is reported out of order.
  f.answerAt(1, 9);
  assert.equal(t.poll(), 0);
  assert.deepEqual(t.take(), []);
  f.answer(4);
  assert.equal(t.poll(), 2);
  assert.deepEqual(t.take(), [
    {frame: 1, gpuMs: 4},
    {frame: 2, gpuMs: 9},
  ]);
});

test('gpu timer: a full ring skips frames instead of blocking or growing', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl, {capacity: 2});
  assert.equal(frame(t, 1), true);
  assert.equal(frame(t, 2), true);
  assert.equal(frame(t, 3), false);
  assert.equal(frame(t, 4), false);
  assert.equal(t.stats().skippedBusy, 2);
  assert.equal(f.live.size, 2, 'never more queries than capacity');
  f.answer(1, 2);
  t.poll();
  assert.equal(frame(t, 5), true, 'answered slots are reused');
  assert.equal(f.live.size, 2);
});

test('gpu timer: one active query at a time; nested begin is refused and counted', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  assert.equal(t.begin(1), true);
  assert.equal(t.begin(2), false);
  t.end();
  t.end(); // a second end is a no-op
  assert.equal(t.stats().skippedNested, 1);
  assert.equal(f.calls.filter(c => c === 'end').length, 1);
});

test('gpu timer: a disjoint operation discards every answered and pending result', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  frame(t, 1);
  frame(t, 2);
  frame(t, 3);
  f.answer(4, 2);
  f.disjoint();
  assert.equal(t.poll(), 0);
  assert.deepEqual(t.take(), []);
  assert.equal(t.lastMs, undefined);
  assert.equal(t.stats().disjoint, 3);
  assert.equal(t.stats().inFlight, 0);
  frame(t, 4);
  f.answer(2);
  t.poll();
  assert.deepEqual(t.take(), [{frame: 4, gpuMs: 2}], 'measurement resumes after the disjoint batch');
});

test('gpu timer: a query that never answers is abandoned after maxPendingPolls', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl, {capacity: 1, maxPendingPolls: 3});
  frame(t, 1);
  for (let i = 0; i < 3; i++) t.poll();
  assert.equal(frame(t, 2), false, 'still pending: busy');
  t.poll();
  assert.equal(t.stats().abandoned, 1);
  assert.equal(frame(t, 3), true, 'the ring frees after abandonment');
});

test('gpu timer: context loss drops the ring; restore reacquires the extension and measures again', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  frame(t, 1);
  t.begin(2);
  f.lose();
  t.end();
  assert.equal(t.status, 'lost');
  assert.equal(t.poll(), 0);
  assert.equal(frame(t, 3), false);
  assert.equal(t.stats().losses, 1);
  assert.equal(t.stats().inFlight, 0);
  const deletes = f.calls.filter(c => c === 'delete').length;
  assert.equal(deletes, 0, 'objects of a lost context are never deleted through it');
  f.restore();
  t.contextRestored();
  assert.equal(t.status, 'available');
  frame(t, 4);
  f.answer(1.5);
  t.poll();
  assert.deepEqual(t.take(), [{frame: 4, gpuMs: 1.5}]);
});

test('gpu timer: the recovery owner reporting a loss before the context says so still drops the ring', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  frame(t, 1);
  t.contextLost();
  t.contextLost();
  assert.equal(t.status, 'lost');
  assert.equal(t.stats().losses, 1, 'one loss counted once');
  assert.equal(f.live.size, 0, 'a loss reported while the context still answers leaks no query');
  // The context was in fact live: the next call observes it and resumes with fresh queries.
  assert.equal(frame(t, 2), true);
  f.answer(7, 2);
  t.poll();
  assert.deepEqual(t.take(), [{frame: 2, gpuMs: 7}], 'nothing from before the loss is reported');
});

test('gpu timer: a restore without the extension reports unavailable', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  f.lose();
  t.poll();
  f.extension = false;
  f.restore();
  t.contextRestored();
  assert.equal(t.status, 'unavailable');
  assert.equal(frame(t, 1), false);
});

test('gpu timer: disposal deletes owned queries, ends an open one and refuses further work', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  frame(t, 1);
  frame(t, 2);
  t.begin(3);
  t.dispose();
  t.dispose();
  assert.equal(t.status, 'disposed');
  assert.equal(f.live.size, 0);
  assert.equal(frame(t, 4), false);
  assert.equal(t.poll(), 0);
  t.contextRestored();
  assert.equal(t.status, 'disposed', 'a restore never revives a disposed timer');
});

test('gpu timer: disposal after loss never calls into the dead context', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  frame(t, 1);
  f.lose();
  t.dispose();
  assert.equal(f.calls.filter(c => c === 'delete').length, 0);
});

test('gpu timer: completed results are bounded and drops are counted', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl, {capacity: 4, maxResults: 3});
  for (let i = 1; i <= 5; i++) {
    frame(t, i);
    f.answer(i);
    t.poll();
  }
  assert.deepEqual(
    t.take().map(r => r.frame),
    [3, 4, 5],
  );
  assert.equal(t.stats().droppedResults, 2);
  assert.equal(t.stats().measured, 5);
});

test('gpu timer: invalid driver answers are counted and never reported', () => {
  const f = fakeGl();
  const t = createGpuTimer(f.gl);
  frame(t, 1);
  f.answer(-1);
  t.poll();
  assert.deepEqual(t.take(), []);
  assert.equal(t.stats().invalid, 1);
  assert.equal(t.lastMs, undefined);
});

test('gpu timer: bounds are checked at construction', () => {
  const f = fakeGl();
  for (const bad of [{capacity: 0}, {capacity: 17}, {capacity: 1.5}, {maxResults: 0}, {maxPendingPolls: 601}])
    assert.throws(() => createGpuTimer(f.gl, bad), RangeError);
});

test('gpu timer: seeded random begin/end/answer/disjoint/loss schedules keep every invariant', () => {
  let seed = 0x9e3779b9;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let run = 0; run < 40; run++) {
    const f = fakeGl();
    const capacity = 1 + Math.floor(rand() * 6);
    const t = createGpuTimer(f.gl, {capacity, maxResults: 8, maxPendingPolls: 5});
    const opened = new Set<number>();
    let last = 0;
    for (let n = 1; n <= 200; n++) {
      if (t.begin(n)) {
        opened.add(n);
        if (rand() < 0.05) f.lose();
        t.end();
      }
      const r = rand();
      if (r < 0.5) f.answer(rand() * 16, 1 + Math.floor(rand() * 2));
      else if (r < 0.53) f.disjoint();
      else if (r < 0.55 && t.status === 'lost') {
        f.restore();
        t.contextRestored();
      }
      t.poll();
      for (const result of t.take()) {
        assert.ok(opened.has(result.frame), 'a result belongs to a frame that was measured');
        assert.ok(result.frame > last, 'results are reported once, in frame order');
        last = result.frame;
      }
      const s = t.stats();
      assert.ok(s.inFlight <= capacity);
      assert.ok(f.live.size <= capacity, 'never more live queries than capacity');
    }
  }
});

test('gpu timer: onResult sees each result once with its frame; a throwing listener is contained', () => {
  const f = fakeGl();
  const seen: [number, number][] = [];
  const t = createGpuTimer(f.gl, {
    onResult(frame, ms) {
      seen.push([frame, ms]);
      if (frame === 2) throw Error('listener failed');
    },
  });
  frame(t, 1);
  frame(t, 2);
  frame(t, 3);
  f.answer(1, 3);
  assert.equal(t.poll(), 3);
  assert.deepEqual(seen, [
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  assert.equal(t.stats().listenerErrors, 1);
});

test('gpu timer: a context without WebGL2 queries is unavailable', () => {
  const t = createGpuTimer({isContextLost: () => false, getExtension: () => ({})});
  assert.equal(t.status, 'unavailable');
  assert.equal(t.begin(1), false);
  t.end();
  assert.equal(t.poll(), 0);
  t.dispose();
});
