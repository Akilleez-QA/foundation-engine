import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  createAlignment,
  alignmentDestination as destination,
  type AlignmentLimits as Limits,
  type AlignmentPose as Pose,
  type AlignmentSample as Sample,
  type AlignmentTarget as Target,
  type AlignmentTicket as Ticket,
} from '../../src/kits/alignment/index';

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
  maxIdentityLength: 64,
};
const base: Target = {identity: {id: 'station', generation: 1}, revision: 3, frame: {x: 10, z: 20, yaw: Math.PI / 2}};
const local: Pose = {x: 0, z: -1, yaw: 0};
function sample(actor: Pose, current = base): Sample {
  return {target: current, actor, eligible: true, clear: true};
}
test('console fixture: rotated local approach proposes motion; acknowledgment alone admits activation', () => {
  const attempt = createAlignment(base, local, limits);
  let actor: Pose = {x: 10, z: 20, yaw: 0},
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
  assert.ok(Math.abs(actor.x - 9) < 1e-12);
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
