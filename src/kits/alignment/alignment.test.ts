import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Matrix4, Vector3} from 'three';
import {createFrames} from '../frames/frame';
import {alignmentDestination, createAlignment, type AlignmentLimits, type AlignmentTarget} from './index';

const limits: AlignmentLimits = {
  maxDistance: 4,
  maxAngle: Math.PI,
  distanceTolerance: 0.001,
  angleTolerance: 0.001,
  speed: 2,
  angularSpeed: Math.PI,
  maxStepSeconds: 0.25,
  timeoutSeconds: 8,
  maxSteps: 40,
  maxIdentityLength: 64,
};
const target: AlignmentTarget = {
  identity: {id: 'anchor', generation: 1},
  revision: 0,
  frame: {x: 10, z: 20, yaw: Math.PI / 2},
};

test('public planar destination agrees with resolved frames and author Y rotation', () => {
  const frames = createFrames(2, 2);
  const parent = new Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 20);
  frames.set({id: 'parent', generation: 0, matrix: parent.elements});
  frames.set({
    id: 'child',
    generation: 0,
    parent: {id: 'parent', generation: 0},
    matrix: new Matrix4().makeTranslation(2, 0, -1).elements,
  });
  const matrix = frames.resolve({id: 'child', generation: 0});
  assert.ok(matrix);
  const expected = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(matrix));
  const actual = alignmentDestination(target.frame, {x: 2, z: -1, yaw: -Math.PI / 2});
  assert.ok(Math.abs(actual.x - expected.x) < 1e-12);
  assert.ok(Math.abs(actual.z - expected.z) < 1e-12);
  assert.equal(actual.yaw, 0);
});

test('public attempt snapshots inputs, has one ticket, and requires exact acknowledgment', () => {
  const mutable = {identity: {...target.identity}, revision: 0, frame: {...target.frame}};
  const attempt = createAlignment(mutable, {x: 0, z: 0, yaw: 0}, limits);
  mutable.frame.x = 99;
  const sample = {target, actor: target.frame, eligible: true, clear: true};
  const result = attempt.step(sample, 0.1);
  assert.equal(result.kind, 'prepared');
  if (result.kind !== 'prepared') throw Error('expected preparation');
  assert.ok(Object.isFrozen(result.ticket));
  assert.ok(Object.isFrozen(result.ticket.pose));
  assert.equal(attempt.state.pendingTickets, 1);
  assert.equal(attempt.acknowledge({...result.ticket}, sample).kind, 'refused');
  assert.equal(attempt.acknowledge(result.ticket, sample).kind, 'accepted');
  assert.equal(attempt.acknowledge(result.ticket, sample).kind, 'refused');
});

test('retained identity size and numeric limits are enforced at both admission boundaries', () => {
  const long = {...target, identity: {...target.identity, id: 'x'.repeat(65)}};
  assert.throws(() => createAlignment(long, {x: 0, z: 0, yaw: 0}, limits));
  for (const maxIdentityLength of [0, 1.5, NaN, Infinity]) {
    assert.throws(() => createAlignment(target, {x: 0, z: 0, yaw: 0}, {...limits, maxIdentityLength}));
  }
  const attempt = createAlignment(target, {x: 0, z: 0, yaw: 0}, limits);
  const before = attempt.state;
  assert.throws(() => attempt.step({target: long, actor: target.frame, eligible: true, clear: true}, 0.1));
  assert.deepEqual(attempt.state, before);
});

test('runtime identity admission rejects nonstrings without retaining caller objects or consuming progress', () => {
  const attempt = createAlignment(target, {x: 0, z: 0, yaw: 0}, limits);
  const observed = {target, actor: target.frame, eligible: true, clear: true};
  const prepared = attempt.step(observed, 0.1);
  assert.equal(prepared.kind, 'prepared');
  if (prepared.kind !== 'prepared') throw Error('expected preparation');
  const before = attempt.state;
  for (const id of [123, {payload: 'x'.repeat(10000)}, ['anchor'], null, '']) {
    const malformed = {...target, identity: {...target.identity, id}};
    // Reflect supplies malformed runtime input without pretending it satisfies the public static type.
    assert.throws(() => Reflect.apply(createAlignment, undefined, [malformed, {x: 0, z: 0, yaw: 0}, limits]));
    assert.throws(() => Reflect.apply(attempt.step, undefined, [{...observed, target: malformed}, 0.1]));
    assert.throws(() =>
      Reflect.apply(attempt.acknowledge, undefined, [prepared.ticket, {...observed, target: malformed}]),
    );
    assert.deepEqual(attempt.state, before);
  }
  assert.equal(prepared.ticket.target.id, 'anchor');
  assert.equal(attempt.acknowledge(prepared.ticket, observed).kind, 'accepted');
});

test('numeric extremes reject unsafe positions before progress and avoid zero-distance underflow', () => {
  const attempt = createAlignment(target, {x: 0, z: 0, yaw: 0}, limits),
    before = attempt.state;
  assert.throws(() => attempt.step({target, actor: {x: Infinity, z: 0, yaw: 0}, eligible: true, clear: true}, 0.1));
  assert.deepEqual(attempt.state, before);
  assert.throws(() => alignmentDestination({x: 1e308, z: 0, yaw: 0}, {x: 1e308, z: 0, yaw: 0}));
  const largeTarget = {...target, frame: {x: 1e308, z: 0, yaw: 0}};
  const large = createAlignment(largeTarget, {x: 0, z: 0, yaw: 0}, {...limits, maxDistance: Number.MAX_VALUE});
  const largeBefore = large.state;
  assert.throws(() =>
    large.step({target: largeTarget, actor: {x: -1e308, z: 0, yaw: 0}, eligible: true, clear: true}, 0.1),
  );
  assert.deepEqual(large.state, largeBefore, 'finite inputs with overflowing distance consume no state');
  assert.equal(
    large.step({target: largeTarget, actor: largeTarget.frame, eligible: true, clear: true}, 0.1).kind,
    'prepared',
  );
  const hugeYaw = alignmentDestination({x: 0, z: 0, yaw: 1e308}, {x: 0, z: 0, yaw: 1e308});
  assert.ok(Number.isFinite(hugeYaw.yaw));
  const tiny = createAlignment(target, {x: 0, z: 0, yaw: 0}, {...limits, speed: Number.MIN_VALUE});
  const result = tiny.step({target, actor: {...target.frame, yaw: 0}, eligible: true, clear: true}, Number.MIN_VALUE);
  assert.equal(result.kind, 'proposal');
  if (result.kind === 'proposal') assert.ok(Object.values(result.pose).every(Number.isFinite));
  const timer = createAlignment(
    target,
    {x: 0, z: 0, yaw: 0},
    {...limits, maxStepSeconds: 1e308, timeoutSeconds: Number.MAX_VALUE},
  );
  const arrived = {target, actor: target.frame, eligible: true, clear: true};
  assert.equal(timer.step(arrived, 1e308).kind, 'prepared');
  assert.deepEqual(timer.step(arrived, 1e308), {kind: 'refused', reason: 'timeout'});
  assert.equal(timer.state.elapsed, Number.MAX_VALUE, 'elapsed state saturates at the finite timeout');
});
