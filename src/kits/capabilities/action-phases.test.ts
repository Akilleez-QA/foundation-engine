import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionPhases, type PhaseState, type PhaseTimelineInput} from './action-phases';
import {createInputHistory} from '../input-history';
import {resolveAction} from '../combat';
import {must} from '../../testing/must';

// Example creator data in integer ticks. These numbers are fixtures, not engine defaults.
const swing = (): PhaseTimelineInput => ({
  id: 'swing',
  length: 30,
  windows: [
    {id: 'listen', ranges: [[8, 30]]},
    {id: 'cancel:attack', ranges: [[18, 30]]},
    {id: 'cancel:evade', ranges: [[12, 30]]},
    {id: 'protected', ranges: [[0, 4]]},
    {
      id: 'contact',
      ranges: [
        [10, 14],
        [20, 23],
      ],
    },
    {
      id: 'no-turn',
      ranges: [
        [9, 15],
        [19, 24],
      ],
    },
  ],
  marks: [
    {id: 'pay-1', at: 10},
    {id: 'pay-2', at: 20},
    {id: 'sound', at: 10},
    {id: 'start', at: 0},
  ],
});

test('marks are delivered once, in position then declaration order, across jumps and zero steps', () => {
  const phases = createActionPhases({timelines: [swing()]});
  let state = phases.start('swing');
  const first = phases.advance(state, 0);
  assert.deepEqual(first.marks, [{id: 'start', at: 0}]);
  assert.deepEqual(phases.advance(first.state, 0).marks, [], 'zero step does not repeat');
  const jump = phases.advance(first.state, 25);
  assert.deepEqual(
    jump.marks.map(m => m.id),
    ['pay-1', 'sound', 'pay-2'],
  );
  assert.equal(jump.state.position, 25);
  assert.equal(jump.endedNow, false);
  const end = phases.advance(jump.state, 100);
  assert.equal(end.state.position, 30, 'clamped at the end');
  assert.equal(end.endedNow, true);
  assert.equal(end.ended, true);
  const after = phases.advance(end.state, 1);
  assert.equal(after.endedNow, false);
  assert.equal(after.ended, true);
  assert.deepEqual(after.marks, []);
  state = end.state;
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(jump.marks), true);
});

test('mark boundary: due exactly at its position, not before; marks at length fire on the ending step', () => {
  const phases = createActionPhases({
    timelines: [
      {
        id: 't',
        length: 10,
        marks: [
          {id: 'm', at: 4},
          {id: 'last', at: 10},
        ],
      },
    ],
  });
  const a = phases.advance(phases.start('t'), 3.999);
  assert.deepEqual(a.marks, []);
  const b = phases.advance(a.state, 0.001);
  assert.equal(b.state.position, 4);
  assert.deepEqual(
    b.marks.map(m => m.id),
    ['m'],
  );
  const c = phases.advance(b.state, 6);
  assert.deepEqual(
    c.marks.map(m => m.id),
    ['last'],
  );
  assert.equal(c.endedNow, true);
});

test('windows are half-open; repeated ranges of one window are queried as one id', () => {
  const phases = createActionPhases({timelines: [swing()]});
  const at = (p: number) => phases.advance(phases.start('swing'), p).state;
  assert.equal(phases.isOpen(at(0), 'protected'), true);
  assert.equal(phases.isOpen(at(4), 'protected'), false, 'end is exclusive');
  assert.equal(phases.isOpen(at(9), 'no-turn'), true, 'start is inclusive');
  assert.equal(phases.isOpen(at(17), 'no-turn'), false);
  assert.equal(phases.isOpen(at(19), 'no-turn'), true, 'second range of same window');
  assert.deepEqual(phases.open(at(12)), ['listen', 'cancel:evade', 'contact', 'no-turn']);
  assert.deepEqual(phases.open(at(30)), [], 'nothing is open at the end position');
  assert.throws(() => phases.isOpen(at(1), 'unknown'), RangeError);
});

test('claims succeed once per open range; a later range can be claimed separately', () => {
  const phases = createActionPhases({timelines: [swing()]});
  const s0 = phases.advance(phases.start('swing'), 5).state;
  assert.deepEqual(phases.claim(s0, 'contact'), {kind: 'closed'});
  const s1 = phases.advance(s0, 6).state;
  const c1 = phases.claim(s1, 'contact');
  assert.equal(c1.kind, 'claimed');
  if (c1.kind !== 'claimed') return;
  assert.equal(c1.range, 4, 'flattened declaration index of the first contact range');
  assert.deepEqual(phases.claim(c1.state, 'contact'), {kind: 'already-claimed'});
  assert.equal(phases.claim(s1, 'contact').kind, 'claimed', 'the unclaimed earlier value is unchanged');
  const s2 = phases.advance(c1.state, 10).state;
  const c2 = phases.claim(s2, 'contact');
  assert.equal(c2.kind, 'claimed');
  if (c2.kind === 'claimed') assert.equal(c2.range, 5);
});

test('suppress retires marks without delivering them; pending lists the rest in delivery order', () => {
  const phases = createActionPhases({timelines: [swing()]});
  const s = phases.suppress(phases.start('swing'), ['pay-2', 'pay-2']);
  assert.deepEqual(
    phases.pending(s).map(m => m.id),
    ['start', 'pay-1', 'sound'],
  );
  assert.deepEqual(
    phases.advance(s, 30).marks.map(m => m.id),
    ['start', 'pay-1', 'sound'],
  );
  assert.throws(() => phases.suppress(s, ['missing']), RangeError);
});

test('definitions are captured once, validated before use and bounded', () => {
  const input = swing();
  const phases = createActionPhases({timelines: [input]});
  (input.marks as {id: string; at: number}[])[0]!.at = 29;
  assert.deepEqual(
    phases.advance(phases.start('swing'), 10).marks.map(m => m.id),
    ['start', 'pay-1', 'sound'],
    'later edits to the input do not change the definition',
  );
  const bad: PhaseTimelineInput[] = [
    {id: '', length: 1},
    {id: 't', length: 0},
    {id: 't', length: Infinity},
    {id: 't', length: 5, windows: [{id: 'w', ranges: []}]},
    {id: 't', length: 5, windows: [{id: 'w', ranges: [[3, 3]]}]},
    {id: 't', length: 5, windows: [{id: 'w', ranges: [[-1, 2]]}]},
    {id: 't', length: 5, windows: [{id: 'w', ranges: [[1, 6]]}]},
    {
      id: 't',
      length: 5,
      windows: [
        {id: 'w', ranges: [[1, 2]]},
        {id: 'w', ranges: [[3, 4]]},
      ],
    },
    {id: 't', length: 5, marks: [{id: 'm', at: 6}]},
    {id: 't', length: 5, marks: [{id: 'm', at: NaN}]},
    {
      id: 't',
      length: 5,
      marks: [
        {id: 'm', at: 1},
        {id: 'm', at: 2},
      ],
    },
    {id: 't', length: 99, windows: [{id: 'w', ranges: Array.from({length: 33}, (_, i) => [i, i + 1] as const)}]},
    {id: 't', length: 99, marks: Array.from({length: 33}, (_, i) => ({id: `m${i}`, at: i}))},
  ];
  for (const timeline of bad) assert.throws(() => createActionPhases({timelines: [timeline]}), RangeError);
  assert.throws(
    () =>
      createActionPhases({
        timelines: [
          {id: 'a', length: 1},
          {id: 'a', length: 2},
        ],
      }),
    RangeError,
  );
  assert.throws(() =>
    createActionPhases({
      timelines: [
        {id: 'a', length: 1},
        {id: 'b', length: 1},
      ],
      maxTimelines: 1,
    }),
  );
  for (const maxTimelines of [0, 1.5, 4097]) assert.throws(() => createActionPhases({timelines: [], maxTimelines}));
  // Exactly 32 ranges split across windows and 32 marks are accepted.
  const wide = createActionPhases({
    timelines: [
      {
        id: 'wide',
        length: 64,
        windows: [
          {id: 'a', ranges: Array.from({length: 16}, (_, i) => [i * 2, i * 2 + 1] as const)},
          {id: 'b', ranges: Array.from({length: 16}, (_, i) => [32 + i * 2, 32 + i * 2 + 1] as const)},
        ],
        marks: Array.from({length: 32}, (_, i) => ({id: `m${i}`, at: i * 2})),
      },
    ],
  });
  let s = wide.start('wide');
  let claims = 0;
  for (let p = 0; p < 64; p++) {
    const claimA = wide.claim(s, 'a');
    if (claimA.kind === 'claimed') ((s = claimA.state), claims++);
    const claimB = wide.claim(s, 'b');
    if (claimB.kind === 'claimed') ((s = claimB.state), claims++);
    s = wide.advance(s, 1).state;
  }
  assert.equal(claims, 32);
  assert.equal(s.claims, 2 ** 32 - 1);
  assert.equal(s.marks, 2 ** 32 - 1);
});

test('invalid steps and foreign states are rejected; restore validates untrusted data without throwing', () => {
  const phases = createActionPhases({timelines: [swing(), {id: 'short', length: 2, marks: [{id: 'm', at: 1}]}]});
  const s = phases.start('swing');
  for (const delta of [-1, NaN, Infinity]) assert.throws(() => phases.advance(s, delta), RangeError);
  assert.throws(() => phases.advance({...s, position: Number.MAX_VALUE}, Number.MAX_VALUE), RangeError);
  assert.throws(() => phases.advance({...s, timeline: 'nope'}, 1), RangeError);
  assert.throws(() => phases.advance({...s, marks: 2 ** 4}, 1), RangeError, 'mark bit beyond 4 marks');
  const saved = JSON.parse(JSON.stringify(phases.advance(s, 11).state)) as unknown;
  const restored = phases.restore(saved);
  assert.equal(restored.kind, 'restored');
  if (restored.kind === 'restored')
    assert.deepEqual(restored.state, {timeline: 'swing', position: 11, marks: 0b1101, claims: 0});
  for (const data of [
    null,
    42,
    {timeline: 'swing', position: 31, marks: 0, claims: 0},
    {timeline: 'short', position: 1, marks: 2, claims: 0},
    {timeline: 'short', position: 1, marks: 0, claims: 1},
    {timeline: 'swing', position: 1, marks: 0.5, claims: 0},
    {timeline: 'missing', position: 0, marks: 0, claims: 0},
    {
      get timeline(): string {
        throw Error('hostile');
      },
    },
  ])
    assert.equal(phases.restore(data).kind, 'invalid');
  // A getter that changes between reads cannot smuggle an unchecked value through restore.
  let reads = 0;
  const flipping = {
    timeline: 'short',
    get position() {
      return reads++ === 0 ? 1 : 99;
    },
    marks: 0,
    claims: 0,
  };
  assert.equal(phases.restore(flipping).kind, 'invalid');
});

test('composition: buffered input, per-request cancel windows, once-only costs and contact, handover and rollback', () => {
  const phases = createActionPhases({timelines: [swing(), {...swing(), id: 'swing-2'}]});
  const history = createInputHistory({actions: ['attack', 'evade'], capacity: 32});
  const attack = history.mask(['attack']);
  let stamina = 10;
  let health = 100;
  const log: string[] = [];
  interface Actor {
    action: {name: string; serial: number; phase: PhaseState} | null;
  }
  const actor: Actor = {action: {name: 'swing', serial: 1, phase: phases.start('swing')}};
  const presses = new Set([3, 15]); // tick 3 is before 'listen' opens: ignored; tick 15 buffers.
  const step = (tick: number, inContact: boolean) => {
    history.record(tick, presses.has(tick) ? attack : 0);
    const current = actor.action;
    if (!current) return;
    const listening = phases.isOpen(current.phase, 'listen');
    const advanced = phases.advance(current.phase, 1);
    let phase = advanced.state;
    for (const mark of advanced.marks)
      if (mark.id.startsWith('pay-')) ((stamina -= 2), log.push(`${current.serial}:${mark.id}`));
    if (inContact) {
      const claim = phases.claim(phase, 'contact');
      if (claim.kind === 'claimed') {
        phase = claim.state;
        resolveAction(
          {id: `${current.serial}:contact:${claim.range}`, target: 'dummy', amount: 7},
          {eligible: () => true, hit: () => true, mitigate: a => a, commit: r => ((health -= r.applied), true)},
        );
      }
    }
    const buffered = listening ? history.lastEdge('attack', 'press', 12, tick) : -1;
    if (buffered >= 0 && buffered >= tick - 12 && phases.isOpen(phase, 'cancel:attack')) {
      history.consume('attack', buffered);
      // Handover: the next action takes over; this one's later costs are settled and must not fire.
      const settled = phases.suppress(
        phase,
        phases.pending(phase).map(m => m.id),
      );
      assert.deepEqual(phases.pending(settled), []);
      actor.action = {name: 'swing-2', serial: current.serial + 1, phase: phases.start('swing-2')};
      log.push(`cancel@${tick}`);
      return;
    }
    actor.action = advanced.ended ? null : {...current, phase};
  };
  // Contact persists for several ticks; it lands once per contact range.
  for (let tick = 1; tick <= 30; tick++) step(tick, true);
  assert.deepEqual(log, ['1:pay-1', 'cancel@18', '2:pay-1']);
  assert.equal(health, 100 - 7 - 7, 'one contact for swing 1 range 1 and one for swing 2 range 1');
  assert.equal(stamina, 10 - 2 - 2);

  // Rollback: restoring a detached saved phase reproduces the same marks and claims on replay.
  const saved = JSON.stringify(must(actor.action).phase);
  const replayA = phases.advance(must(actor.action).phase, 5);
  const restored = phases.restore(JSON.parse(saved));
  assert.equal(restored.kind, 'restored');
  if (restored.kind !== 'restored') return;
  const replayB = phases.advance(restored.state, 5);
  assert.deepEqual(replayB, replayA);
});

test('integer tick partitioning does not change delivered marks or final state', () => {
  const phases = createActionPhases({timelines: [swing()]});
  const run = (steps: number[]) => {
    let state = phases.start('swing');
    const ids: string[] = [];
    for (const d of steps) {
      const r = phases.advance(state, d);
      ids.push(...r.marks.map(m => m.id));
      state = r.state;
    }
    return {ids, state};
  };
  const ones = run(Array.from({length: 30}, () => 1));
  assert.deepEqual(run([30]), ones);
  assert.deepEqual(run([0, 7, 0, 3, 13, 7]), ones);
});
