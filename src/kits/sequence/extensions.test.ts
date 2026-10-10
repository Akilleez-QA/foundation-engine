import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  createCast,
  createEventArbiter,
  createSequenceGraph,
  defineCast,
  defineSequence,
  defineSequenceGraph,
  parseSequenceGraphState,
  type SequenceEvent,
} from './index';
import {World} from '../../core/ecs/world';
import {createSystemRunner} from '../../core/ecs/systems';
import {Transform} from '../../author';

const effects = (events: readonly SequenceEvent[]) => events.filter(e => e.kind === 'effect').map(e => e.id);

test('cast binds roles, drives only declared channels, freezes others after busy ones settle, and releases', () => {
  const def = defineCast({
    id: 'meeting',
    roles: [
      {role: 'guide', channels: ['position', 'clip']},
      {role: 'listener', channels: ['rotation'], need: 'optional'},
    ],
  });
  const cast = createCast(def);
  assert.deepEqual(
    createCast(def).start(() => null),
    {status: 'missing', roles: ['guide']},
  );
  assert.equal(createCast(def).start(() => 7).status, 'conflict');
  assert.equal(cast.start(role => (role === 'guide' ? 1 : null), {exempt: [9], busy: [5, 1]}).status, 'started');
  assert.equal(cast.entity('guide'), 1);
  assert.equal(cast.entity('listener'), null);
  assert.equal(cast.drives(1, 'position'), true);
  assert.equal(cast.drives(1, 'ai'), false, 'undeclared channels stay with gameplay');
  assert.equal(cast.gate(1), 'run');
  assert.equal(cast.gate(9), 'run', 'exempt');
  assert.equal(cast.gate(5), 'run', 'busy entities finish their action first');
  assert.equal(cast.gate(6), 'freeze');
  assert.equal(cast.ready(), false);
  assert.equal(cast.settled(5), true);
  assert.equal(cast.ready(), true);
  assert.equal(cast.gate(5), 'freeze');
  assert.deepEqual(cast.release(), [{entity: 1, role: 'guide', channels: ['position', 'clip']}]);
  assert.equal(cast.gate(6), 'run');
  assert.equal(cast.drives(1, 'position'), false);
  assert.deepEqual(cast.release(), []);
  assert.throws(() => cast.start(() => 1), /starts once/);
  assert.throws(() => defineCast({id: 'x', roles: [{role: 'a', channels: []}]}), RangeError);
  assert.throws(() => defineCast({id: 'x', roles: [{role: 'a', channels: ['p', 'p']}]}), RangeError);
});

test('a frozen ECS world skips non-participants while the cast drives its member', () => {
  const world = new World();
  const guide = world.spawn(Transform({})),
    bystander = world.spawn(Transform({}));
  const cast = createCast(defineCast({id: 'walk', roles: [{role: 'guide', channels: ['position']}]}));
  cast.start(() => guide);
  const runner = createSystemRunner(
    [
      {
        id: 'wander',
        run(_c: null, dt: number) {
          for (const [e, t] of world.query(Transform)) {
            if (cast.gate(e) === 'freeze' || cast.drives(e, 'position')) continue;
            t.x += dt;
          }
        },
      },
      {
        id: 'scripted',
        run(_c: null, dt: number) {
          const e = cast.entity('guide');
          if (e !== null) world.get(e, Transform)!.z += dt;
        },
      },
    ],
    {step: 0.5, maxSteps: 10},
  );
  runner.frame(null, 1);
  assert.deepEqual([world.get(guide, Transform)!.x, world.get(guide, Transform)!.z], [0, 1]);
  assert.equal(world.get(bystander, Transform)!.x, 0, 'bystander frozen');
  cast.release();
  runner.frame(null, 1);
  assert.equal(world.get(bystander, Transform)!.x, 1);
});

const intro = defineSequence({
  id: 'intro',
  tracks: [
    {
      id: 'story',
      cues: [
        {id: 'greet', ticks: 2, effect: 'met'},
        {id: 'ask', ticks: 0, hold: true},
        {id: 'after-ask', ticks: 1, effect: 'never-on-branch'},
      ],
    },
  ],
});
const yes = defineSequence({id: 'yes', tracks: [{id: 'story', cues: [{id: 'reward', ticks: 1, effect: 'gift'}]}]});
const no = defineSequence({
  id: 'no',
  tracks: [{id: 'story', cues: [{id: 'shrug', ticks: 1, effect: 'shrugged', onSkip: 'drop'}]}],
});
const graph = defineSequenceGraph({
  id: 'offer',
  start: 'intro',
  nodes: {intro, yes, no},
  branches: [{node: 'intro', at: 'ask', choices: {accept: 'yes', decline: 'no', leave: null}, default: 'accept'}],
});

test('a branch is offered at its held cue; choosing abandons the rest of the node and starts the next', () => {
  const g = createSequenceGraph(graph, 'slot1');
  assert.deepEqual(effects(g.advance(2).events), ['["intro","slot1#0","greet"]']);
  assert.deepEqual(g.offered(), ['accept', 'decline', 'leave']);
  assert.equal(g.choose('decline').status, 'chosen');
  assert.equal(g.node, 'no');
  assert.equal(g.step, 1);
  const out = g.advance(5);
  assert.deepEqual(effects(out.events), ['["no","slot1#1","shrug"]']);
  assert.equal(g.status, 'finished');
  assert.equal(g.choose('accept').status, 'not-offered');
  // The abandoned effect after the branch never landed.
  assert.ok(!effects(out.events).some(id => id.includes('after-ask')));
  const leave = createSequenceGraph(graph, 'slot2');
  leave.advance(2);
  leave.choose('leave');
  assert.equal(leave.status, 'finished');
});

test('graph snapshots restore mid-node and at a branch; skip follows defaults and lands gameplay effects once', () => {
  const g = createSequenceGraph(graph, 's');
  g.advance(1);
  const restored = createSequenceGraph(graph, 's', JSON.parse(JSON.stringify(g.snapshot())));
  assert.deepEqual(effects(restored.advance(1).events), ['["intro","s#0","greet"]']);
  const atBranch = createSequenceGraph(graph, 's', restored.snapshot());
  assert.ok(atBranch.offered());
  atBranch.choose('accept');
  const mid = createSequenceGraph(graph, 's', atBranch.snapshot());
  assert.equal(mid.node, 'yes');
  const skipped = mid.skip();
  assert.deepEqual(effects(skipped.events), ['["yes","s#1","reward"]']);
  assert.equal(mid.status, 'skipped');
  const fresh = createSequenceGraph(graph, 'k');
  const all = fresh.skip();
  assert.deepEqual(effects(all.events), ['["intro","k#0","greet"]', '["yes","k#1","reward"]']);
  const bad = {...fresh.snapshot(), status: 'running'};
  assert.throws(() => parseSequenceGraphState(graph, bad), RangeError);
  assert.throws(() => createSequenceGraph(graph, 'other', g.snapshot()), /another session/);
});

test('graph definitions are validated and loops are bounded by maxSteps', () => {
  assert.throws(
    () =>
      defineSequenceGraph({
        id: 'g',
        start: 'intro',
        nodes: {intro},
        branches: [{node: 'intro', at: 'greet', choices: {a: null}, default: 'a'}],
      }),
    /held cue/,
  );
  assert.throws(
    () =>
      defineSequenceGraph({
        id: 'g',
        start: 'intro',
        nodes: {intro},
        branches: [{node: 'intro', at: 'ask', choices: {a: 'nope'}, default: 'a'}],
      }),
    RangeError,
  );
  assert.throws(() => defineSequenceGraph({id: 'g', start: 'nope', nodes: {intro}}), RangeError);
  const loop = defineSequenceGraph({
    id: 'loop',
    start: 'intro',
    nodes: {intro},
    branches: [{node: 'intro', at: 'ask', choices: {again: 'intro'}, default: 'again'}],
    maxSteps: 3,
  });
  const g = createSequenceGraph(loop, 's');
  g.advance(2);
  g.choose('again');
  g.advance(2);
  g.choose('again');
  g.advance(2);
  assert.throws(() => g.choose('again'), /maxSteps/);
  assert.throws(() => createSequenceGraph(loop, 's').skip(), /maxSteps/);
});

test('the arbiter lets one event claim the stage, by priority, with cooldown and stale-release refusal', () => {
  const arb = createEventArbiter<string>({sources: [{id: 'sight'}, {id: 'trigger', cooldown: 3}, {id: 'talk'}]});
  arb.tick();
  assert.equal(arb.offer('talk', 'npc-1'), 'offered');
  assert.equal(arb.offer('trigger', 'door'), 'offered');
  assert.equal(arb.offer('trigger', 'door2'), 'duplicate');
  const claim = arb.resolve()!;
  assert.deepEqual([claim.source, claim.payload], ['trigger', 'door']);
  arb.tick();
  assert.equal(arb.offer('sight', 'guard'), 'held');
  assert.equal(arb.resolve(), null);
  assert.equal(arb.release({...claim}), 'stale');
  assert.equal(arb.release(claim), 'released');
  arb.tick();
  assert.equal(arb.offer('trigger', 'door'), 'cooling');
  arb.tick();
  arb.tick();
  assert.equal(arb.offer('trigger', 'door'), 'offered');
  assert.throws(() => arb.offer('nope', 'x'), RangeError);
  assert.throws(() => createEventArbiter({sources: [{id: 'a'}, {id: 'a'}]}), RangeError);
});
