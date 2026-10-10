import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, testScene, type InputSource} from '../../author';
import {createInputHistory, sampleActions} from './index';
import {createRng} from '../../core/rng';
import {
  createInputPlayback,
  inputPlaybackSystem,
  PLAYBACK_LIMITS,
  timelineFromHistory,
  type PlaybackOptions,
} from './playback';
import type {OppositePolicy} from './types';

/** A live input source the test controls (what the player is doing). */
function liveSource() {
  const held = new Set<string>(),
    axes = new Map<string, number>();
  const pointer = {x: 0, y: 0, down: false, pressed: false};
  const source: InputSource = {
    describe: () => null,
    pressed: () => false,
    held: id => held.has(id),
    axis: id => axes.get(id) ?? 0,
    pointer,
  };
  return {source, held, axes, pointer};
}
const read = (s: InputSource, ids: readonly string[]) =>
  ids
    .map(id => `${id}:${s.held(id) ? 'H' : '-'}${s.pressed(id) ? 'P' : '-'}${s.axis(id) ? `=${s.axis(id)}` : ''}`)
    .join(' ');

test('PLAYBACK options: bounded events, ticks and actions; an action is a button or an axis', () => {
  const bad: unknown[] = [
    null,
    {events: null},
    {events: [{tick: -1, action: 'a', kind: 'press'}]},
    {events: [{tick: 1.5, action: 'a', kind: 'press'}]},
    {events: [{tick: PLAYBACK_LIMITS.ticks, action: 'a', kind: 'press'}]},
    {events: [{tick: 0, t: 0, action: 'a', kind: 'press'}]},
    {events: [{t: -1, action: 'a', kind: 'press'}]},
    {events: [{tick: 0, action: '', kind: 'press'}]},
    {events: [{tick: 0, action: 'a', kind: 'hold'}]},
    {events: [{tick: 0, action: 'a', kind: 'axis', value: 2}]},
    {
      events: [
        {tick: 0, action: 'a', kind: 'press'},
        {tick: 1, action: 'a', kind: 'axis', value: 1},
      ],
    },
    {events: [{tick: 5, action: 'a', kind: 'press'}], length: 5},
    {events: [], length: 0},
    {events: [{tick: 0, action: 'a', kind: 'press'}], loop: 1},
    {events: Array.from({length: 3}, (_, i) => ({tick: i, action: 'a', kind: 'tap'})), maxEvents: 2},
    {events: [], maxEvents: PLAYBACK_LIMITS.events + 1},
    {events: [], deadzone: 1},
    {events: [], watch: ['']},
    {events: Array.from({length: 65}, (_, i) => ({tick: 0, action: `a${i}`, kind: 'tap'}))},
  ];
  for (const o of bad) assert.throws(() => createInputPlayback(o as PlaybackOptions), RangeError, JSON.stringify(o));
  const p = createInputPlayback({events: [{tick: 3, action: 'a', kind: 'tap'}]});
  assert.equal(p.length, 4);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.source));
});

test('PLAYBACK ticks: press holds, release ends, a tap (or same-tick press+release) is pressed but not held, axes persist', () => {
  const p = createInputPlayback({
    events: [
      {tick: 1, action: 'a', kind: 'press'},
      {tick: 3, action: 'a', kind: 'release'},
      {tick: 2, action: 'b', kind: 'tap'},
      {tick: 4, action: 'c', kind: 'press'},
      {tick: 4, action: 'c', kind: 'release'},
      {tick: 1, action: 'x', kind: 'axis', value: 0.5},
      {tick: 3, action: 'x', kind: 'axis', value: 0},
      {t: 5 / 60, action: 'a', kind: 'press'}, // seconds, rounded to the tick
    ],
  });
  const ids = ['a', 'b', 'c', 'x'];
  assert.equal(read(p.source, ids), 'a:-- b:-- c:-- x:--', 'idle before the first step');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    assert.equal(p.step().status, 'playing');
    seen.push(read(p.source, ids));
  }
  assert.deepEqual(seen, [
    'a:-- b:-- c:-- x:--',
    'a:HP b:-- c:-- x:--=0.5',
    'a:H- b:-P c:-- x:--=0.5',
    'a:-- b:-- c:-- x:--',
    'a:-- b:-- c:-P x:--',
    'a:HP b:-- c:-- x:--',
  ]);
  const end = p.step();
  assert.deepEqual({...end}, {status: 'finished', tick: 5, loops: 0, reason: null});
  assert.equal(read(p.source, ids), 'a:-- b:-- c:-- x:--', 'everything released at the end');
  assert.equal(p.step(), end, 'finished stays finished');
  p.restart();
  assert.equal(p.state().status, 'ready');
  p.step();
  p.step();
  assert.equal(read(p.source, ids), 'a:HP b:-- c:-- x:--=0.5', 'restart replays identically');
});

test('PLAYBACK loop: a rest step with everything released, then tick 0 again; deterministic, loops counted', () => {
  const p = createInputPlayback({
    events: [
      {tick: 0, action: 'a', kind: 'press'},
      {tick: 2, action: 'b', kind: 'axis', value: -1},
    ],
    length: 4,
    loop: true,
  });
  const trace: string[] = [];
  for (let i = 0; i < 12; i++) {
    const s = p.step();
    assert.equal(s.status, 'playing');
    trace.push(`${s.tick}/${s.loops}:${read(p.source, ['a', 'b'])}`);
  }
  assert.deepEqual(trace.slice(0, 5), [
    '0/0:a:HP b:--',
    '1/0:a:H- b:--',
    '2/0:a:H- b:--=-1',
    '3/0:a:H- b:--=-1',
    '-1/1:a:-- b:--',
  ]);
  assert.deepEqual(trace.slice(5, 10), [
    '0/1:a:HP b:--',
    '1/1:a:H- b:--',
    '2/1:a:H- b:--=-1',
    '3/1:a:H- b:--=-1',
    '-1/2:a:-- b:--',
  ]);
  assert.equal(trace[11], '1/2:a:H- b:--');
  // Recorded through input-history, the held action shows a release at the wrap and a fresh press after it.
  const h = createInputHistory({actions: ['a', 'b'], capacity: 16});
  const q = createInputPlayback({events: [{tick: 0, action: 'a', kind: 'press'}], length: 3, loop: true});
  for (let f = 0; f < 8; f++) {
    q.step();
    const {held, taps} = sampleActions(q.source, h);
    h.record(f, held, taps);
  }
  assert.deepEqual(
    Array.from({length: 8}, (_, f) =>
      h.pressed('a', f) ? 'P' : h.released('a', f) ? 'R' : h.held('a', f) ? 'H' : '-',
    ),
    ['P', 'H', 'H', 'R', 'P', 'H', 'H', 'R'],
  );
});

test('PLAYBACK tap matches a real testScene press: pressed for one tick, never held', async () => {
  const reads: string[] = [];
  const reader = defineSystem({
    id: 'input-playback-tap-reader',
    run(ctx) {
      reads.push(`${ctx.input.pressed('p') ? 'P' : '-'}${ctx.input.held('p') ? 'H' : '-'}`);
    },
  });
  const scene = defineScene({id: 'input-playback-tap', title: 'Tap', systems: [reader]});
  const real = await testScene(scene);
  real.run(1 / 60);
  real.press('p');
  real.run(2 / 60);
  real.dispose();
  const live = reads.splice(0);
  for (const events of [
    [{tick: 1, action: 'p', kind: 'tap'}],
    [
      {tick: 1, action: 'p', kind: 'press'},
      {tick: 1, action: 'p', kind: 'release'},
    ],
  ] as const) {
    const playback = createInputPlayback({events, length: 3});
    const scripted = await testScene(
      defineScene({id: 'input-playback-tap', title: 'Tap', systems: [inputPlaybackSystem(playback), reader]}),
      {input: playback.source},
    );
    scripted.run(3 / 60);
    scripted.dispose();
    assert.deepEqual(reads.splice(0), live);
  }
  assert.deepEqual(live, ['--', 'P-', '--']);
});

test('PLAYBACK cancel: watched live input ends playback on that tick and reaches systems through over()', () => {
  const live = liveSource();
  const make = (o: Partial<PlaybackOptions> = {}) =>
    createInputPlayback({events: [{tick: 0, action: 'move', kind: 'axis', value: 1}], length: 100, ...o});
  let p = make({watch: ['move', 'jump']});
  const view = p.over(live.source);
  assert.equal(p.step(live.source).status, 'playing');
  assert.equal(view.axis('move'), 1, 'scripted while playing');
  live.axes.set('move', 0.1);
  assert.equal(p.step(live.source).status, 'playing', 'stick noise inside the deadzone');
  live.held.add('jump');
  const s = p.step(live.source);
  assert.deepEqual({...s}, {status: 'cancelled', tick: 1, loops: 0, reason: 'input'});
  assert.equal(p.source.axis('move'), 0, 'scripted actions released');
  assert.equal(view.held('jump'), true, 'the cancelling input is live on the same tick');
  assert.equal(view.axis('move'), 0.1);
  assert.equal(p.step(live.source), s, 'stays cancelled');
  live.held.clear();
  live.axes.clear();
  // An axis beyond the deadzone and a pointer touch also cancel; an unwatched action does not.
  p = make();
  p.step(live.source);
  live.axes.set('move', -0.5);
  assert.equal(p.step(live.source).status, 'cancelled');
  live.axes.clear();
  p = make({watch: ['move']});
  live.held.add('menu');
  assert.equal(p.step(live.source).status, 'playing', "'menu' is not watched");
  live.pointer.down = true;
  assert.equal(p.step(live.source).status, 'cancelled', 'touch');
  p = make({watchPointer: false});
  assert.equal(p.step(live.source).status, 'playing');
  assert.equal(p.cancel('scene-exit').reason, 'scene-exit');
  assert.equal(p.cancel('again').reason, 'scene-exit', 'idempotent');
});

test('PLAYBACK step refuses its own source or view as the live input (it would cancel itself)', () => {
  const live = liveSource();
  const p = createInputPlayback({events: [{tick: 0, action: 'move', kind: 'axis', value: 1}], length: 10});
  const view = p.over(live.source);
  assert.equal(p.over(live.source), view, 'one cached view per live source');
  assert.throws(() => p.step(p.source), RangeError);
  assert.throws(() => p.step(view), RangeError);
  assert.equal(p.state().status, 'ready', 'a refused step changes nothing');
  assert.equal(p.step(live.source).status, 'playing');
  assert.equal(p.step(live.source).status, 'playing', 'the script itself never cancels');
  // Duplicate watch ids count once against the bound.
  assert.doesNotThrow(() => createInputPlayback({events: [], watch: Array.from({length: 100}, () => 'a')}));
});

test('PLAYBACK reads each event field once: a getter cannot pass validation and then change', () => {
  let reads = 0;
  const event = {
    action: 'a',
    kind: 'press',
    get tick() {
      reads++;
      return reads === 1 ? 2 : -5;
    },
  };
  const p = createInputPlayback({events: [event as never]});
  assert.equal(reads, 1);
  assert.equal(p.length, 3);
  // A list whose iterator yields more than its length is walked by index.
  const list = [{tick: 0, action: 'a', kind: 'tap'}] as unknown[];
  Object.defineProperty(list, Symbol.iterator, {
    value: function* () {
      for (let i = 0; i < 10; i++) yield {tick: i, action: 'a', kind: 'tap'};
    },
  });
  assert.equal(createInputPlayback({events: list as never, maxEvents: 1}).length, 1);
});

test('PLAYBACK reproduces a recorded input-history session, played as normal actions through testScene', async () => {
  const ACTIONS = ['left', 'right', 'p', 'k'];
  const recordInto = (history: ReturnType<typeof createInputHistory>) => {
    let tick = 0;
    return defineSystem({
      id: 'input-history-record',
      run(ctx) {
        const {held, taps} = sampleActions(ctx.input, history);
        assert.equal(history.record(tick++, held, taps).status, 'recorded');
      },
    });
  };
  const opposites = [{a: 'left', b: 'right', policy: 'last' as const}];
  const original = createInputHistory({actions: ACTIONS, capacity: 64, opposites});
  const scene = (system: ReturnType<typeof recordInto>) =>
    defineScene({id: 'input-playback-session', title: 'Playback session', systems: [system]});
  const t = await testScene(scene(recordInto(original)));
  t.run(2 / 60);
  t.hold('left');
  t.run(3 / 60);
  t.hold('right'); // both held: 'last' keeps right
  t.press('p'); // a tap inside one tick
  t.run(2 / 60);
  t.release('left');
  t.run(2 / 60);
  t.release('right');
  t.hold('k');
  t.run(4 / 60);
  t.release('k');
  t.press('p');
  t.run(3 / 60);
  t.dispose();
  assert.equal(original.latest(), 15);

  const timeline = timelineFromHistory(original);
  assert.equal(timeline.length, 16);
  assert.equal(timeline.maxEvents, timeline.events.length);
  const playback = createInputPlayback(timeline);
  const replayed = createInputHistory({actions: ACTIONS, capacity: 64, opposites});
  // The stepping system runs first in the fixed lane, so the recorder reads the tick it made current.
  const r = await testScene(
    defineScene({
      id: 'input-playback-session',
      title: 'Playback session',
      systems: [inputPlaybackSystem(playback), recordInto(replayed)],
    }),
    {input: playback.source},
  );
  r.run(16 / 60);
  r.dispose();
  assert.equal(playback.state().tick, 15);
  const a = original.save(),
    b = replayed.save();
  assert.deepEqual(b.held, a.held, 'same cleaned held masks');
  assert.deepEqual(b.press, a.press, 'same press edges');
  assert.deepEqual(b.release, a.release, 'same release edges');
  assert.equal(JSON.stringify(b), JSON.stringify(a), 'for this session the raw bookkeeping matches too');
  assert.ok(original.pressed('p', 5) && original.released('p', 6), 'the tap survived the round trip');

  // A window from the middle: actions already held at `from` start as presses at tick 0.
  const middle = timelineFromHistory(original, {from: 3, to: 5});
  assert.deepEqual(middle.events.slice(0, 1), [{tick: 0, action: 'left', kind: 'press'}]);
  assert.throws(() => timelineFromHistory(original, {from: 5, to: 3}), RangeError);
  assert.throws(() => timelineFromHistory(createInputHistory({actions: ['a'], capacity: 2})), RangeError);
});

test('PLAYBACK round trip under all five opposite policies: cleaned held masks and edges are reproduced', () => {
  const ACTIONS = ['left', 'right', 'up', 'down', 'p'];
  for (const policy of ['neutral', 'last', 'first', 'a', 'b'] as OppositePolicy[]) {
    const options = {
      actions: ACTIONS,
      capacity: 200,
      opposites: [
        {a: 'left', b: 'right', policy},
        {a: 'up', b: 'down', policy},
      ],
    };
    const rng = createRng(`playback-${policy}`);
    const original = createInputHistory(options);
    for (let f = 0; f < 200; f++)
      original.record(f, rng.int(0, 31) & rng.int(0, 31), rng.int(0, 31) & rng.int(0, 31) & 16);
    const playback = createInputPlayback(timelineFromHistory(original));
    const replayed = createInputHistory(options);
    for (let f = 0; f < 200; f++) {
      playback.step();
      const {held, taps} = sampleActions(playback.source, replayed);
      assert.equal(replayed.record(f, held, taps).status, 'recorded');
    }
    const a = original.save(),
      b = replayed.save();
    assert.deepEqual([b.held, b.press, b.release], [a.held, a.press, a.release], policy);
  }
});

test('PLAYBACK conversion bound: the event count travels as maxEvents; too many edges is a clear RangeError', () => {
  const two = createInputHistory({actions: ['a', 'b'], capacity: 3600});
  for (let f = 0; f < 3000; f++) two.record(f, f % 2 ? 3 : 0);
  const timeline = timelineFromHistory(two);
  assert.ok(timeline.events.length > 4096, 'more than the default maxEvents');
  assert.equal(createInputPlayback(timeline).length, 3000);
  const wide = createInputHistory({actions: Array.from({length: 32}, (_, i) => `a${i}`), capacity: 3600});
  for (let f = 0; f < 3600; f++) wide.record(f, f % 2 ? 0xffffffff : 0);
  assert.throws(() => timelineFromHistory(wide), /convert a shorter range/);
  assert.equal(
    timelineFromHistory(wide, {from: 0, to: 99}).events.length,
    32 * 99,
    'an edge on every frame after the first',
  );
});

test('PLAYBACK attract mode in a scene: systems read over(ctx.input) and a real press ends the demo', async () => {
  const playback = createInputPlayback({
    events: [
      {tick: 0, action: 'move', kind: 'axis', value: 1},
      {tick: 30, action: 'move', kind: 'axis', value: -1},
    ],
    length: 60,
    loop: true,
    watch: ['move', 'jump'],
  });
  const state = {x: 0, demo: true};
  const system = defineSystem({
    id: 'input-playback-attract',
    run(ctx, dt) {
      if (state.demo && playback.step(ctx.input).status === 'cancelled') state.demo = false;
      const input = playback.over(ctx.input);
      state.x += input.axis('move') * dt;
    },
  });
  const t = await testScene(defineScene({id: 'input-playback-attract', title: 'Attract', systems: [system]}));
  t.run(122 / 60); // two loops of 60 ticks, each followed by its rest step
  assert.ok(state.demo && Math.abs(state.x) < 1e-9, `two whole loops return to the start (${state.x})`);
  t.run(0.25);
  assert.ok(state.x > 0.2);
  t.press('jump');
  t.run(1 / 60);
  assert.equal(state.demo, false);
  assert.equal(playback.state().reason, 'input');
  const at = state.x;
  t.hold('move', -1);
  t.run(0.5);
  assert.ok(Math.abs(state.x - (at - 0.5)) < 1e-9, 'live input drives the scene after the demo');
  t.dispose();
});
