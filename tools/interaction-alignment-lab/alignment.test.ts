import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAlignment, destination, type Limits, type Pose, type Sample, type Target, type Ticket} from './alignment';

const limits: Limits = {
  maxDistance: 4,
  maxAngle: Math.PI,
  distanceTolerance: 0.001,
  angleTolerance: 0.001,
  speed: 2,
  angularSpeed: Math.PI,
  maxStepSeconds: 0.25,
  timeoutSeconds: 8,
  maxSteps: 40,
};
const base: Target = {identity: {id: 'station', generation: 1}, revision: 3, frame: {x: 10, z: 20, yaw: Math.PI / 2}};
const local: Pose = {x: 0, z: -1, yaw: 0};
function sample(actor: Pose, current = base): Sample {
  return {target: current, actor, eligible: true, clear: true};
}
function prepared() {
  const attempt = createAlignment(base, local, limits),
    observed = sample(destination(base.frame, local));
  const result = attempt.step(observed, 0.1);
  assert.equal(result.kind, 'prepared');
  if (result.kind !== 'prepared') throw Error('expected ticket');
  return {attempt, observed, ticket: result.ticket};
}

test('console fixture: rotated local approach proposes motion; acknowledgment alone admits activation', () => {
  const attempt = createAlignment(base, local, limits);
  let actor: Pose = {x: 12, z: 20, yaw: 0},
    activations = 0;
  let ticket: Ticket | undefined;
  for (let i = 0; i < limits.maxSteps; i++) {
    const before = {...actor},
      result = attempt.step(sample(actor), 0.25);
    assert.deepEqual(actor, before, 'proposal cannot mutate creator pose');
    assert.equal(activations, 0);
    if (result.kind === 'prepared') {
      ticket = result.ticket;
      break;
    }
    assert.equal(result.kind, 'proposal');
    if (result.kind === 'proposal') {
      assert.ok(Math.hypot(result.pose.x - actor.x, result.pose.z - actor.z) <= 0.5 + 1e-12);
      // Test-only motion owner applies a clearance-approved proposal; no runtime movement integration.
      actor = result.pose;
    }
  }
  assert.ok(ticket);
  assert.ok(Math.abs(actor.x - 11) < 1e-12);
  assert.ok(Math.abs(actor.z - 20) < 1e-12);
  assert.ok(Math.abs(actor.yaw - Math.PI / 2) < 1e-12);
  if (attempt.acknowledge(ticket, sample(actor)).kind === 'accepted') activations++;
  if (attempt.acknowledge(ticket, sample(actor)).kind === 'accepted') activations++;
  assert.equal(activations, 1);
  assert.equal(attempt.state.pendingTickets, 0);
});

test('socket fixture: asymmetric local placement uses creator eligibility and retains custody until accepted', () => {
  const socket: Target = {identity: {id: 'socket', generation: 4}, revision: 0, frame: {x: -5, z: 3, yaw: Math.PI}};
  const offset: Pose = {x: 2, z: 0.5, yaw: -Math.PI / 2};
  const attempt = createAlignment(socket, offset, limits);
  let item: Pose = {x: -6, z: 3, yaw: Math.PI / 2},
    custody = 'held';
  let ticket: Ticket | undefined;
  for (let i = 0; i < 20; i++) {
    const result = attempt.step(sample(item, socket), 0.25);
    assert.equal(custody, 'held');
    if (result.kind === 'prepared') {
      ticket = result.ticket;
      break;
    }
    if (result.kind === 'proposal') item = result.pose;
    else assert.fail('unexpected refusal');
  }
  assert.ok(ticket);
  assert.ok(Math.abs(item.x + 7) < 1e-12);
  assert.ok(Math.abs(item.z - 2.5) < 1e-12);
  // Placement policy belongs to the fixture, not an inventory or physics implementation.
  if (attempt.acknowledge(ticket, sample(item, socket)).kind === 'accepted') custody = 'placed';
  assert.equal(custody, 'placed');
});

test('pause and zero time consume no budget or acceptance; pending ticket can resume', () => {
  const {attempt, observed, ticket} = prepared(),
    before = attempt.state;
  for (let i = 0; i < 100; i++) assert.equal(attempt.step(observed, 0.25, true).kind, 'paused');
  assert.equal(attempt.step(observed, 0).kind, 'paused');
  assert.equal(attempt.acknowledge(ticket, observed, true).kind, 'paused');
  assert.deepEqual(attempt.state, before);
  assert.equal(attempt.acknowledge(ticket, observed).kind, 'accepted');
});

test('prepared drift retires tickets during paused steps, zero-time steps and paused acknowledgment', () => {
  for (const mode of ['paused-step', 'zero-step', 'paused-ack'] as const) {
    for (const change of [{x: 11.1}, {yaw: Math.PI / 2 + 0.1}]) {
      const {attempt, observed, ticket} = prepared(),
        before = attempt.state;
      const drifted = {...observed, actor: {...observed.actor, ...change}};
      const result =
        mode === 'paused-ack'
          ? attempt.acknowledge(ticket, drifted, true)
          : attempt.step(drifted, mode === 'zero-step' ? 0 : 0.1, mode === 'paused-step');
      assert.deepEqual(result, {kind: 'refused', reason: 'drift'}, mode);
      assert.deepEqual(attempt.state, {...before, pendingTickets: 0, terminal: 'drift'});
      assert.deepEqual(attempt.acknowledge(ticket, observed), {kind: 'refused', reason: 'stale-ticket'});
    }
  }
});

test('changed target identity, generation, revision or unversioned pose invalidate acknowledgment', () => {
  for (const changed of [
    {...base, identity: {...base.identity, id: 'other'}},
    {...base, identity: {...base.identity, generation: 2}},
    {...base, revision: 4},
    {...base, frame: {...base.frame, x: 11}},
  ]) {
    const {attempt, observed, ticket} = prepared();
    assert.deepEqual(attempt.acknowledge(ticket, {...observed, target: changed}), {
      kind: 'refused',
      reason: 'target-changed',
    });
    assert.equal(attempt.state.pendingTickets, 0);
    assert.equal(attempt.acknowledge(ticket, observed).kind, 'refused');
  }
});

test('cancel/dispose retire tickets; foreign and copied tickets cannot consume a live attempt', () => {
  for (const retire of ['cancel', 'dispose'] as const) {
    const {attempt, observed, ticket} = prepared();
    attempt[retire]();
    attempt[retire]();
    assert.equal(attempt.state.pendingTickets, 0);
    assert.deepEqual(attempt.acknowledge(ticket, observed), {kind: 'refused', reason: 'stale-ticket'});
  }
  const first = prepared(),
    next = prepared();
  for (const stale of [first.ticket, {...next.ticket}]) {
    assert.equal(next.attempt.acknowledge(stale, next.observed).kind, 'refused');
    assert.equal(next.attempt.state.pendingTickets, 1);
  }
  assert.equal(next.attempt.acknowledge(next.ticket, next.observed).kind, 'accepted');
});

test('clearance, eligibility and observed drift are rechecked at acknowledgment', () => {
  for (const [patch, reason] of [
    [{clear: false}, 'blocked'],
    [{eligible: false}, 'ineligible'],
    [{actor: {x: 11.1, z: 20, yaw: Math.PI / 2}}, 'drift'],
  ] as const) {
    const {attempt, observed, ticket} = prepared();
    assert.deepEqual(attempt.acknowledge(ticket, {...observed, ...patch}), {kind: 'refused', reason});
    assert.equal(attempt.state.pendingTickets, 0);
  }
});

test('refusals preserve creator pose; stalled movement and pending acknowledgment have finite budgets', () => {
  const far = sample({x: 30, z: 20, yaw: 0});
  assert.deepEqual(createAlignment(base, local, limits).step(far, 0.1), {kind: 'refused', reason: 'approach-limit'});
  assert.equal(far.actor.x, 30);
  const stalled = createAlignment(base, local, {...limits, maxSteps: 2});
  const near = sample({x: 12, z: 20, yaw: 0});
  assert.equal(stalled.step(near, 0.1).kind, 'proposal');
  assert.equal(stalled.step(near, 0.1).kind, 'proposal');
  assert.deepEqual(stalled.step(near, 0.1), {kind: 'refused', reason: 'step-budget'});
  const waiting = createAlignment(base, local, {...limits, timeoutSeconds: 0.5});
  const observed = sample(destination(base.frame, local));
  assert.equal(waiting.step(observed, 0.25).kind, 'prepared');
  assert.deepEqual(waiting.step(observed, 0.25), {kind: 'refused', reason: 'timeout'});
  assert.equal(waiting.state.pendingTickets, 0);
});

test('numeric validation refuses invalid limits and steps; failed validation does not consume a ticket', () => {
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => createAlignment(base, local, {...limits, speed: bad}));
  assert.throws(() => createAlignment(base, local, {...limits, maxSteps: 1.5}));
  assert.throws(() => destination(base.frame, {...local, x: Infinity}));
  const {attempt, observed, ticket} = prepared(),
    before = attempt.state;
  for (const bad of [-1, NaN, Infinity, 0.26]) assert.throws(() => attempt.step(observed, bad));
  assert.deepEqual(attempt.state, before);
  assert.equal(attempt.acknowledge(ticket, observed).kind, 'accepted');
});

test('rotation takes the short route with bounded turn; blocked approach never emits a proposal', () => {
  const target: Target = {...base, frame: {x: 0, z: 0, yaw: -Math.PI + 0.1}};
  const attempt = createAlignment(target, {x: 0, z: 0, yaw: 0}, {...limits, angularSpeed: 0.1});
  const start = sample({x: 0, z: 0, yaw: Math.PI - 0.1}, target);
  const result = attempt.step(start, 0.25);
  assert.equal(result.kind, 'proposal');
  if (result.kind === 'proposal') assert.ok(Math.abs(result.pose.yaw - (Math.PI - 0.075)) < 1e-12);
  const blocked = createAlignment(base, local, limits);
  assert.deepEqual(blocked.step({...sample({x: 12, z: 20, yaw: 0}), clear: false}, 0.1), {
    kind: 'refused',
    reason: 'blocked',
  });
  assert.equal(blocked.state.steps, 0);
});
