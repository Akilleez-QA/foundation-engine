import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, testScene, type InputSource} from '../../author';
import {createInputHistory, sampleActions} from './index';
import {createInputPlayback, PLAYBACK_LIMITS, timelineFromHistory, type PlaybackOptions} from './playback';

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

test('PLAYBACK ticks: press holds, release ends, tap and same-tick press+release last one tick, axes persist', () => {
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
    'a:H- b:HP c:-- x:--=0.5',
    'a:-- b:-- c:-- x:--',
    'a:-- b:-- c:HP x:--',
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

test('PLAYBACK loop: wraps to tick 0 with everything released, deterministically, and counts loops', () => {
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
    trace.push(`${s.tick}/${s.loops}:${read(p.source, ['a', 'b'])}`);
  }
  assert.deepEqual(trace.slice(0, 4), ['0/0:a:HP b:--', '1/0:a:H- b:--', '2/0:a:H- b:--=-1', '3/0:a:H- b:--=-1']);
  assert.deepEqual(trace.slice(4, 8), ['0/1:a:HP b:--', '1/1:a:H- b:--', '2/1:a:H- b:--=-1', '3/1:a:H- b:--=-1']);
  assert.equal(trace[11], '3/2:a:H- b:--=-1');
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

test('PLAYBACK reproduces a recorded input-history session, played as normal actions through testScene', async () => {
  const ACTIONS = ['left', 'right', 'p', 'k'];
  const recordInto = (history: ReturnType<typeof createInputHistory>, before?: () => void) => {
    let tick = 0;
    return defineSystem({
      id: 'input-history-record',
      run(ctx) {
        before?.();
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
  const playback = createInputPlayback(timeline);
  const replayed = createInputHistory({actions: ACTIONS, capacity: 64, opposites});
  const r = await testScene(scene(recordInto(replayed, () => playback.step())), {input: playback.source});
  r.run(16 / 60);
  r.dispose();
  assert.equal(playback.state().tick, 15);
  const a = original.save(),
    b = replayed.save();
  assert.deepEqual(b.held, a.held, 'same cleaned held masks');
  assert.deepEqual(b.press, a.press, 'same press edges');
  assert.deepEqual(b.release, a.release, 'same release edges');
  assert.equal(JSON.stringify(b), JSON.stringify(a), 'the whole snapshot matches');
  assert.ok(original.pressed('p', 5) && original.released('p', 6), 'the tap survived the round trip');

  // A window from the middle: actions already held at `from` start as presses at tick 0.
  const middle = timelineFromHistory(original, {from: 3, to: 5});
  assert.deepEqual(middle.events.slice(0, 1), [{tick: 0, action: 'left', kind: 'press'}]);
  assert.throws(() => timelineFromHistory(original, {from: 5, to: 3}), RangeError);
  assert.throws(() => timelineFromHistory(createInputHistory({actions: ['a'], capacity: 2})), RangeError);
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
  t.run(2);
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
