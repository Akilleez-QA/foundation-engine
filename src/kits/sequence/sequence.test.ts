import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  createSequence,
  defineSequence,
  defineSequenceSection,
  parseSequenceState,
  SEQUENCE_LIMITS,
  type SequenceDefinitionInput,
  type SequenceEvent,
} from './index';
import {createDialogue, type DialogueDefinition} from '../dialogue/index';
import {authorSaveHandle} from '../../author/save-handle';
import {createSaveStore} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';

/** camera pans for 30 ticks while an actor walks 20; the line waits for both, holds for the reader, then a gate opens. */
const scene: SequenceDefinitionInput = {
  id: 'gate-intro',
  tracks: [
    {
      id: 'camera',
      cues: [
        {id: 'pan', ticks: 30},
        {id: 'settle', ticks: 10, after: ['line']},
      ],
    },
    {
      id: 'actor',
      cues: [
        {id: 'walk', ticks: 20, effect: 'actor-arrives'},
        {id: 'wave', ticks: 5},
      ],
    },
    {
      id: 'story',
      cues: [
        {id: 'line', ticks: 0, after: ['pan', 'walk'], hold: true},
        {id: 'open', ticks: 4, effect: 'gate-open'},
        {id: 'sting', ticks: 0, effect: 'play-sting', onSkip: 'drop'},
      ],
    },
  ],
};
const brief = (events: readonly SequenceEvent[]) =>
  events.map(e => ('cue' in e ? `${e.kind}:${e.cue}@${e.tick}` : `${e.kind}@${e.tick}`));
const effects = (events: readonly SequenceEvent[]) => events.filter(e => e.kind === 'effect').map(e => e.id);

test('tracks run in parallel, barriers wait for cues on other tracks, holds wait for release', () => {
  const s = createSequence(defineSequence(scene), 'slot1');
  assert.deepEqual(brief(s.advance(0).events), ['start:pan@0', 'start:walk@0']);
  assert.equal(s.active('camera')!.alpha, 0);
  const r = s.advance(25);
  assert.deepEqual(brief(r.events), ['end:walk@20', 'effect:walk@20', 'start:wave@20', 'end:wave@25']);
  assert.equal(s.active('camera')!.alpha, 25 / 30);
  assert.equal(s.active('story'), null, 'line waits on its barrier');
  assert.deepEqual(brief(s.advance(10).events), ['end:pan@30', 'start:line@30']);
  assert.equal(s.active('story')!.waiting, true);
  assert.deepEqual(s.advance(100).events, [], 'a held cue waits for release');
  assert.equal(s.release('line'), 'released');
  assert.deepEqual(brief(s.advance(0).events), ['end:line@135', 'start:settle@135', 'start:open@135']);
  const end = s.advance(20);
  assert.deepEqual(brief(end.events), [
    'end:open@139',
    'effect:open@139',
    'start:sting@139',
    'end:sting@139',
    'effect:sting@139',
    'end:settle@145',
    'finished@145',
  ]);
  assert.equal(end.status, 'finished');
  assert.deepEqual(s.advance(5).events, []);
});

test('one large advance equals many small ones, and the transition budget only splits the work', () => {
  const def = defineSequence(scene);
  const run = (steps: number[], maxTransitions?: number) => {
    const s = createSequence(def, 'k', null, maxTransitions === undefined ? {} : {maxTransitions});
    const out: string[] = [];
    let partials = 0;
    for (const n of steps) {
      if (n === -1) assert.equal(s.release('line'), 'released');
      else {
        const r = s.advance(n);
        if (r.status === 'partial') partials++;
        out.push(...brief(r.events));
      }
      // A budgeted caller drains owed ticks (on later frames) before acting on what it observes.
      for (let i = 0; i < 50 && !s.settled; i++) out.push(...brief(s.advance(0).events));
    }
    return {out, partials, status: s.status};
  };
  const big = run([40, -1, 1000]);
  const small = run([...Array(40).fill(1), -1, ...Array(30).fill(1)]);
  const budgeted = run([40, -1, 1000], 1);
  assert.deepEqual(small.out, big.out);
  assert.deepEqual(budgeted.out, big.out);
  assert.ok(budgeted.partials > 0);
  assert.equal(budgeted.status, 'finished');
});

test('skip lands each remaining gameplay effect exactly once, drops presentation effects, and is final', () => {
  const s = createSequence(defineSequence(scene), 'slot1');
  const landed = effects(s.advance(22).events);
  assert.deepEqual(landed, [JSON.stringify(['gate-intro', 'slot1', 'walk'])]);
  const skipped = s.skip();
  assert.equal(skipped.status, 'skipped');
  assert.deepEqual(
    effects(skipped.events),
    [JSON.stringify(['gate-intro', 'slot1', 'open'])],
    'walk is not repeated; sting is dropped',
  );
  assert.ok(
    skipped.events.every(e => e.kind === 'effect' || e.kind === 'skipped'),
    'no presentation events',
  );
  assert.equal(s.snapshot().dropped.join(), 'sting');
  assert.equal(s.skip().status, 'inactive');
  assert.deepEqual(s.advance(10).events, []);
  assert.ok(s.completed('settle'));
  const locked = createSequence(defineSequence({...scene, id: 'locked', skippable: false}), 'x');
  assert.equal(locked.skip().status, 'refused');
  assert.equal(locked.status, 'running');
});

test('cancel lands nothing further and reports the effects that never will', () => {
  const s = createSequence(defineSequence(scene), 'slot1');
  s.advance(21);
  assert.deepEqual([...s.cancel()], ['open', 'sting']);
  assert.equal(s.status, 'cancelled');
  assert.deepEqual(s.advance(500).events, []);
  assert.equal(s.release('line'), 'inactive');
  assert.deepEqual([...s.cancel()], []);
});

test('a snapshot taken mid-sequence restores to the same future, including owed ticks and releases', () => {
  const def = defineSequence(scene);
  const reference = createSequence(def, 's');
  const ref: string[] = [];
  ref.push(...brief(reference.advance(31).events));
  reference.release('line');
  ref.push(...brief(reference.advance(3).events));
  ref.push(...brief(reference.advance(100).events));

  const a = createSequence(def, 's', null, {maxTransitions: 2});
  const out: string[] = [];
  out.push(...brief(a.advance(31).events));
  assert.ok(a.owed > 0, 'stopped by its budget');
  const resumed = createSequence(def, 's', JSON.parse(JSON.stringify(a.snapshot())));
  for (let i = 0; i < 10 && !resumed.settled; i++) out.push(...brief(resumed.advance(0).events));
  resumed.release('line');
  const again = createSequence(def, 's', resumed.snapshot());
  out.push(...brief(again.advance(3).events));
  out.push(...brief(again.advance(100).events));
  assert.deepEqual(out, ref);
});

test('restore refuses edited definitions, other sessions and inconsistent or forged states', () => {
  const def = defineSequence(scene);
  const s = createSequence(def, 's');
  s.advance(31);
  const good = JSON.parse(JSON.stringify(s.snapshot()));
  const edited = defineSequence({
    ...scene,
    tracks: [
      {...scene.tracks[0]!, cues: [{id: 'pan', ticks: 31}, scene.tracks[0]!.cues[1]!]},
      ...scene.tracks.slice(1),
    ],
  });
  assert.notEqual(edited.fingerprint, def.fingerprint);
  assert.throws(() => createSequence(edited, 's', good), /another definition/);
  assert.throws(() => createSequence(def, 'other', good), /another session/);
  type Mutable = Record<string, unknown> & {tracks: Record<string, unknown>[]; tick: number};
  const bad: [string, (x: Mutable) => void][] = [
    ['extra field', x => (x.extra = 1)],
    ['index range', x => (x.tracks[0] = {index: 9, startedAt: null})],
    ['start after tick', x => (x.tracks[1] = {index: 0, startedAt: x.tick + 1})],
    ['completed track with active cue', x => (x.tracks[1] = {index: 2, startedAt: 3})],
    ['barrier skipped', x => ((x.tracks[2] = {index: 1, startedAt: null}), (x.tracks[0] = {index: 0, startedAt: 0}))],
    ['release not active', x => ((x.released = ['line']), (x.tracks[2] = {index: 0, startedAt: null}))],
    ['drop while running', x => (x.dropped = ['sting'])],
    ['finished but incomplete', x => (x.status = 'finished')],
    ['owed when cancelled', x => ((x.status = 'cancelled'), (x.owed = 3))],
    ['unsafe time', x => (x.owed = Number.MAX_SAFE_INTEGER)],
    ['negative tick', x => (x.tick = -1)],
    ['non-plain', x => Object.setPrototypeOf(x, Array.prototype)],
  ];
  for (const [what, mutate] of bad) {
    const copy = structuredClone(good);
    mutate(copy);
    assert.throws(() => parseSequenceState(def, copy), RangeError, what);
  }
  assert.deepEqual(parseSequenceState(def, good), s.snapshot());
});

test('definitions are validated, bounded, frozen and isolated from later edits', () => {
  const bad: [string, SequenceDefinitionInput][] = [
    ['empty', {id: 'x', tracks: []}],
    [
      'duplicate cue',
      {
        id: 'x',
        tracks: [
          {id: 'a', cues: [{id: 'c', ticks: 1}]},
          {id: 'b', cues: [{id: 'c', ticks: 1}]},
        ],
      },
    ],
    ['unknown barrier', {id: 'x', tracks: [{id: 'a', cues: [{id: 'c', ticks: 1, after: ['nope']}]}]}],
    [
      'cross-track cycle',
      {
        id: 'x',
        tracks: [
          {
            id: 'a',
            cues: [
              {id: 'a1', ticks: 1, after: ['b2']},
              {id: 'a2', ticks: 1},
            ],
          },
          {
            id: 'b',
            cues: [
              {id: 'b1', ticks: 1, after: ['a2']},
              {id: 'b2', ticks: 1},
            ],
          },
        ],
      },
    ],
    ['self wait', {id: 'x', tracks: [{id: 'a', cues: [{id: 'c', ticks: 1, after: ['c']}]}]}],
    ['fraction', {id: 'x', tracks: [{id: 'a', cues: [{id: 'c', ticks: 0.5}]}]}],
    ['huge cue', {id: 'x', tracks: [{id: 'a', cues: [{id: 'c', ticks: 2 ** 31}]}]}],
    ['onSkip without effect', {id: 'x', tracks: [{id: 'a', cues: [{id: 'c', ticks: 1, onSkip: 'drop'}]}]}],
    [
      'too many cues',
      {
        id: 'x',
        tracks: Array.from({length: 5}, (_, t) => ({
          id: `t${t}`,
          cues: Array.from({length: 256}, (_, i) => ({id: `c${t}-${i}`, ticks: 1})),
        })),
      },
    ],
  ];
  for (const [what, input] of bad) assert.throws(() => defineSequence(input), RangeError, what);
  const input = structuredClone(scene) as {tracks: {cues: {ticks: number}[]}[]} & SequenceDefinitionInput;
  const def = defineSequence(input);
  input.tracks[0]!.cues[0]!.ticks = 999;
  assert.equal(def.tracks[0]!.cues[0]!.ticks, 30);
  assert.ok(Object.isFrozen(def.tracks[0]!.cues[0]));
  assert.throws(() => createSequence(def, 's', null, {maxTransitions: SEQUENCE_LIMITS.maxTransitions + 1}), RangeError);
  assert.throws(() => createSequence(def, 's').advance(-1), RangeError);
  assert.throws(() => createSequence(def, 's').release('pan'), /no held cue/);
});

test('composes with the dialogue kit and a real save section across a fresh store', () => {
  const talk: DialogueDefinition = {
    id: 'keeper',
    start: 'hello',
    nodes: [{id: 'hello', text: 'keeper.hello', options: [{id: 'bye', text: 'keeper.bye', to: null}]}],
  };
  const def = defineSequence(scene);
  const section = defineSequenceSection('sequence.gate-intro', def, {scope: 'device'});
  const backend = new MemoryBackend();
  const store = (tab: number) =>
    createSaveStore({
      local: backend.port(tab),
      session: new MemoryBackend().port(tab, 'session'),
      namespace: 'sequence-test',
      build: 'test',
      timers: {set: () => 0, clear: () => {}, now: () => 0},
    });
  const run = createSequence(def, 'slot1');
  const world = {arrived: 0, gate: 0};
  const apply = (events: readonly SequenceEvent[]) => {
    for (const e of events)
      if (e.kind === 'effect') {
        if (e.effect === 'actor-arrives') world.arrived++;
        if (e.effect === 'gate-open') world.gate++;
      }
  };
  apply(run.advance(31).events);
  // The held line opens a conversation; closing it releases the cue.
  const d = createDialogue(talk, 'slot1');
  assert.ok(run.active('story')?.cue === 'line');
  const first = store(0);
  assert.equal(
    authorSaveHandle(first, section).update(r => void (r.run = run.snapshot()), {now: true}),
    'saved',
  );
  first.dispose();
  const second = store(1);
  const resumed = createSequence(def, 'slot1', authorSaveHandle(second, section).get().run);
  const view = d.view(new Set())!;
  assert.equal(d.choose({...view, option: 'bye'}, new Set()).status, 'applied');
  assert.equal(d.view(new Set()), null);
  assert.equal(resumed.release('line'), 'released');
  apply(resumed.advance(50).events);
  assert.deepEqual(world, {arrived: 1, gate: 1});
  assert.equal(resumed.status, 'finished');
  second.dispose();
  assert.throws(() => section.section.parse({run: {...run.snapshot(), session: 'x'.repeat(300)}}), RangeError);
  assert.deepEqual(section.section.parse({run: null}), {run: null});
});

test('effect ids are unambiguous across definitions and sessions; settled reports budget-stopped work; -0 normalises', () => {
  const one = defineSequence({id: 'one', tracks: [{id: 't', cues: [{id: 'b/open', ticks: 0, effect: 'e'}]}]});
  const two = defineSequence({id: 'two', tracks: [{id: 't', cues: [{id: 'open', ticks: 0, effect: 'e'}]}]});
  const ids = [
    ...effects(createSequence(one, 'a').advance(0).events),
    ...effects(createSequence(two, 'a/b').advance(0).events),
    ...effects(createSequence(two, 'a').advance(0).events),
  ];
  assert.equal(new Set(ids).size, 3);
  const held = defineSequence({
    id: 'held',
    tracks: [
      {
        id: 't',
        cues: [
          {id: 'x', ticks: 1},
          {id: 'h', ticks: 0, hold: true},
        ],
      },
    ],
  });
  const r = createSequence(held, 's', null, {maxTransitions: 1});
  r.advance(0);
  assert.equal(r.advance(1).status, 'partial');
  assert.equal(r.owed, 0);
  assert.equal(r.settled, false, 'owed is zero but transitions are still due at this tick');
  while (!r.settled) r.advance(0);
  assert.equal(r.release('h'), 'released');
  const snap = JSON.parse(JSON.stringify(r.snapshot()));
  snap.tracks[0] = {index: 1, startedAt: -0};
  snap.tick = 1;
  const parsed = parseSequenceState(held, snap);
  assert.ok(Object.is(parsed.tracks[0]!.startedAt, 0));
});

test('untrusted arrays are copied with one length read and never iterated', () => {
  const sneaky = [{id: 'c', ticks: 0}];
  Object.defineProperty(sneaky, Symbol.iterator, {
    value: function* () {
      for (;;) yield {id: 'x', ticks: 0};
    },
  });
  const def = defineSequence({id: 'sneaky', tracks: [{id: 't', cues: sneaky}]});
  assert.equal(def.tracks[0]!.cues.length, 1);
  const s = createSequence(def, 's');
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  const released: string[] = [];
  Object.defineProperty(released, Symbol.iterator, {
    value: function* () {
      for (;;) yield 'c';
    },
  });
  snap.released = released;
  assert.deepEqual(parseSequenceState(def, snap).released, []);
});
