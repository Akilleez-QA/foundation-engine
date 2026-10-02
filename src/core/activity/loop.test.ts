import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameLoop, type FrameInfo } from './loop';
import type { Coverage, LoopFrameSample, VisibilityPort } from './ports';

/** A fake rAF: frames run only when the test advances time. */
function fakeFrames() {
  const pending = new Map<number, (t: number) => void>();
  let serial = 0, requests = 0;
  return {
    scheduler: {
      request(cb: (t: number) => void) { requests++; pending.set(++serial, cb); return serial; },
      cancel(id: number) { pending.delete(id); },
    },
    get pending() { return pending.size; },
    get requests() { return requests; },
    /** Run the frames requested so far at time `ms`. */
    run(ms: number) { const work = [...pending.values()]; pending.clear(); for (const cb of work) cb(ms); },
  };
}

/** A fake layer port: coverage and preview per owner, with change notifications. */
function fakeLayers() {
  const cov = new Map<string, Coverage>(), preview = new Set<string>(), listeners = new Set<() => void>();
  const changed = () => { for (const l of [...listeners]) l(); };
  return {
    coverage: (owner: string) => cov.get(owner) ?? 'top',
    previewing: (owner: string) => preview.has(owner),
    onChange(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
    set(owner: string, c: Coverage) { cov.set(owner, c); changed(); },
    setPreview(owner: string, on: boolean) { if (on) preview.add(owner); else preview.delete(owner); changed(); },
    get listeners() { return listeners.size; },
  };
}

function setup(extra: Partial<ConstructorParameters<typeof FrameLoop>[0]> = {}) {
  const frames = fakeFrames(), layers = fakeLayers();
  let calm = false;
  const loop = new FrameLoop({ scheduler: frames.scheduler, layers, calm: () => calm, now: () => 0, ...extra });
  return { frames, layers, loop, setCalm: (c: boolean) => { calm = c; } };
}

test('no frame is scheduled when nothing is invalidated', () => {
  const { frames, loop } = setup();
  assert.equal(frames.pending, 0, 'an empty loop schedules nothing');
  let renders = 0;
  const h = loop.add({ owner: 'a', render: () => renders++ });
  assert.equal(frames.pending, 1, 'a new on-demand ticker draws once');
  frames.run(16);
  assert.equal(renders, 1);
  assert.equal(frames.pending, 0, 'a still scene schedules no frames');
  assert.equal(loop.scheduled, false);
  frames.run(32); frames.run(48);
  assert.equal(renders, 1);
  assert.equal(frames.requests, 1);
  h.invalidate(); h.invalidate();
  assert.equal(frames.pending, 1, 'invalidating twice asks for one frame');
  frames.run(64);
  assert.equal(renders, 2);
  assert.equal(frames.pending, 0);
  h.remove();
  h.invalidate();
  assert.equal(frames.pending, 0, 'a removed ticker never schedules');
});

test('continuous tickers keep the loop running; switching to on-demand lets it idle', () => {
  const { frames, loop } = setup();
  const dts: number[] = [];
  const h = loop.add({ owner: 'a', mode: 'continuous', update: f => dts.push(f.dt), render: () => {} });
  frames.run(0); frames.run(16); frames.run(32);
  assert.deepEqual(dts.map(d => +d.toFixed(9)), [0, 0.016, 0.016]);
  h.setMode('on-demand');
  frames.run(48);
  assert.equal(frames.pending, 0);
  assert.equal(loop.stats.frames, 3);
});

test('an update that invalidates keeps its ticker dirty for the next frame only', () => {
  const { frames, loop } = setup();
  let left = 3, renders = 0;
  const h = loop.add({ owner: 'a', update: () => { if (--left > 0) h.invalidate(); }, render: () => renders++ });
  for (let i = 0; i < 6; i++) frames.run(i * 16);
  assert.equal(renders, 3);
  assert.equal(frames.pending, 0);
});

test('a covered activity pauses and gets dt = 0 on resume', () => {
  const { frames, layers, loop } = setup();
  const seen: FrameInfo[] = [];
  loop.add({ owner: 'scene', mode: 'continuous', update: f => seen.push(f) });
  frames.run(0); frames.run(16);
  assert.equal(seen.at(-1)!.dt, 0.016);
  layers.set('scene', 'scrim');
  assert.equal(frames.pending, 0, 'a paused ticker wants no frame: the loop idles');
  frames.run(1000);
  layers.set('scene', 'top');
  frames.run(5000);
  assert.equal(seen.length, 3);
  assert.equal(seen.at(-1)!.dt, 0, 'resume dt is 0, not a catch-up step');
  frames.run(5016);
  assert.ok(Math.abs(seen.at(-1)!.dt - 0.016) < 1e-9);
});

test('a covered activity gets dt = 0 on resume while another activity keeps the loop running', () => {
  const { frames, layers, loop } = setup();
  const scene: number[] = [];
  loop.add({ owner: 'scene', mode: 'continuous', update: f => scene.push(f.dt) });
  loop.add({ owner: 'modal', mode: 'continuous', update: () => {} });
  frames.run(0); frames.run(16);
  layers.set('scene', 'opaque');
  frames.run(32); frames.run(48); frames.run(64);
  assert.equal(scene.length, 2, 'opaque never runs');
  layers.set('scene', 'top');
  frames.run(80);
  assert.deepEqual(scene.map(d => +d.toFixed(9)), [0, 0.016, 0]);
});

test('a scrim throttles a ticker that asks for {hz}; "run" keeps full rate; preview overrides coverage', () => {
  const { frames, layers, loop } = setup();
  const ambient: number[] = [], runner: number[] = [], previewed: FrameInfo[] = [];
  loop.add({ owner: 'amb', mode: 'continuous', whenCovered: { hz: 10 }, update: f => ambient.push(f.dt), maxDt: 1 });
  loop.add({ owner: 'run', mode: 'continuous', whenCovered: 'run', update: f => runner.push(f.dt) });
  loop.add({ owner: 'prev', mode: 'continuous', update: f => previewed.push(f) });
  layers.set('amb', 'scrim'); layers.set('run', 'scrim'); layers.set('prev', 'opaque');
  for (let i = 0; i <= 12; i++) frames.run(i * 20);
  assert.equal(runner.length, 13);
  assert.equal(previewed.length, 0);
  // 20 ms frames at 10 Hz: the ticker runs every 100 ms with the accumulated time.
  assert.equal(ambient.length, 2);
  assert.ok(Math.abs(ambient[0] - 0.1) < 1e-9);
  layers.setPreview('prev', true);
  frames.run(260); frames.run(280);
  assert.equal(previewed.length, 2);
  assert.equal(previewed[0].dt, 0);
  assert.equal(previewed[1].coverage, 'opaque', 'the frame still reports the real coverage');
  layers.set('prev', 'hidden');
  frames.run(300);
  assert.equal(previewed.length, 2, 'preview never runs a hidden layer');
});

test('the hidden tab stops ticking and resumes with dt = 0', () => {
  const listeners = new Set<(h: boolean) => void>();
  let hidden = false, resumed = 0;
  const visibility: VisibilityPort = { hidden: () => hidden, onChange: l => { listeners.add(l); return () => listeners.delete(l); } };
  const clock = { advance: (dt: number) => ({ to: (ut += dt) }), resumeFromAway: () => { resumed++; } };
  let ut = 0;
  const { frames, loop } = setup({ visibility, clock });
  const dts: number[] = [];
  loop.add({ owner: 'a', mode: 'continuous', update: f => dts.push(f.dt) });
  frames.run(0); frames.run(16);
  hidden = true; for (const l of listeners) l(true);
  assert.equal(frames.pending, 0, 'nothing is scheduled while hidden');
  frames.run(10_000);
  const h = loop.add({ owner: 'b', mode: 'continuous', update: () => { throw new Error('must not run'); } });
  h.invalidate();
  assert.equal(frames.pending, 0, 'adding or invalidating while hidden schedules nothing');
  h.remove();
  assert.equal(dts.length, 2);
  hidden = false; for (const l of listeners) l(false);
  assert.equal(resumed, 1, 'the clock is told the tab came back');
  frames.run(60_000);
  assert.equal(dts.at(-1), 0);
  assert.ok(Math.abs(ut - 0.016) < 1e-9, 'the hidden time never reaches the clock through the loop');
  loop.dispose();
  assert.equal(listeners.size, 0);
});

test('a loop that starts hidden schedules nothing until visible', () => {
  const { frames, loop } = setup({ visibility: { hidden: () => true, onChange: () => () => {} } });
  loop.add({ owner: 'a', render: () => {} });
  assert.equal(frames.pending, 0);
  loop.setHidden(false);
  assert.equal(frames.pending, 1);
});

test('the frame carries ut, calm, preset and coverage; quality gets one sample per frame', () => {
  const samples: LoopFrameSample[] = [];
  let ut = 100;
  const { frames, loop, layers, setCalm } = setup({
    clock: { advance: dt => ({ to: (ut += dt * 2) }), resumeFromAway() {} },
    quality: { preset: () => 'medium', frame: s => samples.push(s) },
  });
  const seen: FrameInfo[] = [];
  const h = loop.add({ owner: 'a', update: f => seen.push(f) , render: () => {} });
  const other = loop.add({ owner: 'b', mode: 'continuous', update: () => {} });
  frames.run(1000);
  setCalm(true); layers.set('a', 'scrim');
  h.invalidate();
  frames.run(1016);
  assert.equal(seen.length, 1, 'a paused dirty ticker does not run');
  assert.deepEqual({ ...seen[0] }, { dt: 0, t: 1, frame: 1, ut: 100, calm: false, preset: 'medium', coverage: 'top' });
  assert.deepEqual(samples.map(s => s.rendered), [true, false], 'a frame that drew nothing is marked');
  assert.ok(Math.abs(samples[1].intervalMs - 16) < 1e-9);
  assert.ok(Math.abs(ut - 100.032) < 1e-9);
  other.remove();
  layers.set('a', 'top');
  frames.run(2000);
  assert.equal(seen.at(-1)!.calm, true);
  assert.equal(seen.at(-1)!.dt, 0);
});

test('tickers run in priority order, and a throwing ticker is dropped and reported once', () => {
  const errors: string[] = [], order: string[] = [];
  const { frames, loop } = setup({ report: owner => errors.push(owner) });
  loop.add({ owner: 'render', priority: 2, mode: 'continuous', update: () => order.push('render') });
  loop.add({ owner: 'bad', priority: 1, mode: 'continuous', update: () => { order.push('bad'); throw new Error('boom'); } });
  loop.add({ owner: 'sim', priority: -1, mode: 'continuous', update: () => order.push('sim') });
  frames.run(0); frames.run(16);
  assert.deepEqual(order, ['sim', 'bad', 'render', 'sim', 'render']);
  assert.deepEqual(errors, ['bad']);
});

test('dispose cancels the pending frame and unsubscribes from layers', () => {
  const { frames, layers, loop } = setup();
  loop.add({ owner: 'a', mode: 'continuous' });
  assert.equal(frames.pending, 1);
  assert.equal(layers.listeners, 1);
  loop.dispose();
  assert.equal(frames.pending, 0);
  assert.equal(layers.listeners, 0);
  assert.throws(() => loop.add({ owner: 'b' }));
});

test('manual capture holds real animation and steps the same clock, updates and renderers', () => {
  let ut = 20;
  const { loop, frames } = setup({ clock: { advance: dt => ({ to: ut += dt }), resumeFromAway() {} } });
  const seen: FrameInfo[] = [];
  loop.add({ owner: 'world', mode: 'continuous', render: f => seen.push(f) });
  loop.holdFrames(true);
  frames.run(1000);
  assert.equal(seen.length, 0); assert.equal(ut, 20); assert.equal(frames.pending, 0);
  loop.stepFrame(0); loop.stepFrame(1 / 60); loop.stepFrame(1 / 60);
  assert.equal(seen.length, 3); assert.equal(seen[0].dt, 0);
  assert.ok(Math.abs(seen[2].dt - 1 / 60) < 1e-12);
  assert.ok(Math.abs(ut - (20 + 2 / 60)) < 1e-12);
  assert.equal(frames.pending, 0, 'manual ticks never schedule free-running animation');
  loop.add({ owner: 'handover', update: () => seen.push({} as FrameInfo) });
  loop.stepFrame(0); assert.equal(seen.length, 5, 'zero-time tick completes real one-shot handover work');
  loop.holdFrames(false); frames.run(2000);
  assert.equal(seen.at(-1)!.dt, 0, 'resume does not catch up capture wall time');
  assert.throws(() => loop.stepFrame(.01), /Hold/);
});

test('held frames continue from the loop clock, so event timestamps and stepped frame times share one timebase', () => {
  let now = 5000;
  const { loop } = setup({ now: () => now });
  const times: number[] = [];
  loop.add({ owner: 'world', mode: 'continuous', render: f => times.push(f.t * 1000) });
  loop.holdFrames(true); loop.stepFrame(.01); loop.stepFrame(.01);
  assert.deepEqual(times.map(t => Math.round(t)), [5010, 5020]);
  loop.holdFrames(false); now = 9000; loop.holdFrames(true); loop.stepFrame(.02);
  assert.equal(Math.round(times.at(-1)!), 9020, 'a new hold starts from the current time');
  loop.dispose();
});

test('application updates bypass layer coverage, never hidden documents or render ownership', () => {
 const {frames,layers,loop}=setup();let owner=0;const coverage:Coverage[]=[];
 loop.add({owner:'scene',mode:'continuous',update(){owner++;}});
 const application=loop.add({owner:'app-input',scope:'application',mode:'continuous',update(f){coverage.push(f.coverage);}});
 layers.set('scene','opaque');layers.set('app-input','opaque');frames.run(16);
 assert.equal(owner,0);assert.deepEqual(coverage,['opaque'],'coverage remains truthful');
 loop.setHidden(true);frames.run(32);assert.equal(coverage.length,1);assert.equal(frames.pending,0);
 loop.setHidden(false);frames.run(48);assert.equal(coverage.length,2);
 assert.throws(()=>loop.add({owner:'invalid',scope:'application',render(){}}),/cannot render/);
 application.remove();assert.equal(frames.pending,0);loop.dispose();
});

for (const fallbackThrows of [false, true]) {
  test(`a throwing ticker reporter cannot freeze healthy owners (fallback throws: ${fallbackThrows})`, () => {
    const original = Error('ticker failed'), reporting = Error('reporter failed');
    const diagnostics: unknown[][] = [];
    const oldError = console.error;
    console.error = (...args) => { diagnostics.push(args); if (fallbackThrows) throw Error('sink failed'); };
    const reported: unknown[] = [];
    const { frames, loop } = setup({ report: (owner, error) => { reported.push(owner, error); throw reporting; } });
    try {
      let healthy = 0;
      const bad = loop.add({ owner: 'bad', mode: 'continuous', update() { throw original; } });
      loop.add({ owner: 'healthy', mode: 'continuous', update() { healthy++; } });
      assert.doesNotThrow(() => frames.run(0));
      assert.equal(bad.removed, true);
      assert.equal(healthy, 1);
      assert.equal(frames.pending, 1);
      frames.run(16);
      assert.equal(healthy, 2);
      assert.deepEqual(reported, ['bad', original]);
      assert.equal(diagnostics.length, 1);
      assert.deepEqual((diagnostics[0][1] as AggregateError).errors, [original, reporting]);
    } finally { loop.dispose(); console.error = oldError; }
  });
}

test('reporter disposal followed by a throw cannot revive tickers or schedule another frame', () => {
  const oldError = console.error;
  console.error = () => {};
  const { frames, loop } = setup({ report: () => { loop.dispose(); throw Error('report failed'); } });
  try {
    let healthy = 0;
    loop.add({ owner: 'bad', mode: 'continuous', update() { throw Error('ticker failed'); } });
    const retained = loop.add({ owner: 'healthy', mode: 'continuous', update() { healthy++; }, render() { healthy++; } });
    assert.doesNotThrow(() => frames.run(0));
    assert.equal(retained.removed, true);
    assert.equal(healthy, 0);
    retained.invalidate();
    retained.setMode('continuous');
    assert.equal(frames.pending, 0);
    assert.equal(loop.scheduled, false);
    assert.throws(() => loop.add({ owner: 'late' }), /disposed/);
  } finally { loop.dispose(); console.error = oldError; }
});

test('PERF-01: without a sampler a frame reads no extra clock; a sampler gets one reused record per frame', () => {
  let reads = 0, clock = 0;
  const { frames, loop } = setup({ now: () => { reads++; return clock; } });
  loop.add({ owner: 'a', mode: 'continuous', render: () => { clock += 3; } });
  frames.run(0); frames.run(16); frames.run(33);
  assert.equal(reads, 0, 'the zero-overhead path makes no now() call inside frames');
  assert.equal(loop.hasSampler, false);
  const seen: { timeMs: number; intervalMs: number; workMs: number; rendered: boolean; hidden: boolean }[] = [];
  let record: unknown;
  const off = loop.attachSampler({ frame(r) { record ??= r; assert.equal(r, record, 'one reused record'); seen.push({ ...r }); } });
  assert.equal(frames.pending, 1, 'attaching neither schedules nor cancels');
  frames.run(50); frames.run(66);
  assert.equal(reads, 4, 'two clock reads per sampled frame');
  assert.deepEqual(seen.map(s => [s.timeMs, Math.round(s.intervalMs), s.workMs, s.rendered, s.hidden]), [[50, 17, 3, true, false], [66, 16, 3, true, false]]);
  assert.throws(() => loop.attachSampler({ frame() {} }), /already has a frame sampler/);
  off(); off();
  frames.run(83);
  assert.equal(seen.length, 2, 'detached: no more records');
  assert.equal(reads, 4);
});

test('PERF-01: an attached sampler never wakes an idle loop and sees the hidden transition once', () => {
  let hidden = false; const listeners = new Set<(h: boolean) => void>();
  const visibility: VisibilityPort = { hidden: () => hidden, onChange(l) { listeners.add(l); return () => listeners.delete(l); } };
  const { frames, loop } = setup({ visibility });
  const seen: { hidden: boolean; intervalMs: number }[] = [];
  loop.add({ owner: 'a', render: () => {} });
  frames.run(16);
  assert.equal(frames.pending, 0, 'idle');
  loop.attachSampler({ frame: r => { seen.push({ hidden: r.hidden, intervalMs: r.intervalMs }); } });
  assert.equal(frames.pending, 0, 'a sampler keeps nothing awake');
  hidden = true; for (const l of listeners) l(true);
  assert.deepEqual(seen, [{ hidden: true, intervalMs: 0 }]);
});

test('PERF-01: a throwing sampler is detached and reported; tickers keep running', () => {
  const reports: string[] = [];
  const { frames, loop } = setup({ report: owner => reports.push(owner) });
  let renders = 0;
  loop.add({ owner: 'a', mode: 'continuous', render: () => { renders++; } });
  loop.attachSampler({ frame() { throw new Error('broken sampler'); } });
  frames.run(16); frames.run(33);
  assert.equal(renders, 2);
  assert.deepEqual(reports, ['frame-sampler']);
  assert.equal(loop.hasSampler, false);
  loop.dispose();
  assert.throws(() => loop.attachSampler({ frame() {} }), /disposed/);
});

test('PERF-01: frames stepped while held are marked stepped; released frames are not', () => {
  const { frames, loop } = setup();
  loop.add({ owner: 'a', mode: 'continuous', render: () => {} });
  const seen: boolean[] = [];
  loop.attachSampler({ frame: r => { seen.push(r.stepped); } });
  frames.run(16);
  loop.holdFrames(true);
  loop.stepFrame(0.05); loop.stepFrame(0.05);
  loop.holdFrames(false);
  frames.run(100);
  assert.deepEqual(seen, [false, true, true, false]);
});
