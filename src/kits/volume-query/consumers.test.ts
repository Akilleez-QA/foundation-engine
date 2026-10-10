// Real consumers: the navigation kit's portal crossing and a body-height system on the existing World and fixed runner.
// The volume query supplies observations; each consumer keeps its own authority and applies its own effect.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {World, component} from '../../core/ecs/world';
import {createSystemRunner} from '../../core/ecs/systems';
import {createFrames} from '../frames/frame';
import {crossPortal, definePortal, type AgentClearance} from '../navigation';
import {defineVolumeSet, headroom, sweepVolume, type VolumeCollider, type VolumeSet} from './index';

const matrix = (x = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
const floor: VolumeCollider = {id: 'floor', kind: 'box', center: [0, -1, 0], halfExtents: [20, 1, 20]};

test('portal crossing uses a swept body as its clearance evidence and still owns staleness', () => {
  const frames = createFrames();
  frames.set({id: 'hall', generation: 0, matrix: matrix()});
  frames.set({id: 'room', generation: 0, matrix: matrix(4)});
  const portal = definePortal({
    id: 'door',
    revision: 0,
    from: {frame: {id: 'hall', generation: 0}, position: [0, 0, 0]},
    to: {frame: {id: 'room', generation: 0}, position: [0, 0, 0]},
    width: 1.2,
    height: 2.2,
    open: true,
  });
  // A beam lower than the body's height crosses the corridor; both endpoints are clear of it.
  const beam: VolumeCollider = {id: 'beam', kind: 'box', center: [2, 1.6, 0], halfExtents: [0.05, 0.05, 3]};
  let set: VolumeSet = defineVolumeSet({revision: 1, maxColliders: 2, colliders: [floor, beam]});
  let calls = 0;
  const clear = (from: readonly number[], to: readonly number[], agent: AgentClearance) => {
    calls++;
    const r = agent.radius;
    const result = sweepVolume(
      set,
      {
        kind: 'capsule',
        a: [from[0]!, from[1]! + r, from[2]!],
        b: [from[0]!, from[1]! + agent.height - r, from[2]!],
        radius: r,
      },
      [to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!],
      {margin: 0.01},
    );
    return result.status === 'clear';
  };
  const agent = {radius: 0.3, height: 1.8};
  assert.equal(crossPortal(portal, 0, agent, frames, () => true, clear).status, 'blocked');
  // A shorter body passes under the beam; the same query, a different body.
  assert.equal(crossPortal(portal, 0, {radius: 0.3, height: 1.2}, frames, () => true, clear).status, 'ready');
  set = defineVolumeSet({revision: 2, maxColliders: 2, colliders: [floor]});
  assert.equal(crossPortal(portal, 0, agent, frames, () => true, clear).status, 'ready');
  // The portal still refuses when a dependency moves during the clearance evidence.
  const moving = (from: readonly number[], to: readonly number[], body: AgentClearance) => {
    frames.set({id: 'room', generation: 0, matrix: matrix(5)});
    return clear(from, to, body);
  };
  assert.equal(crossPortal(portal, 0, agent, frames, () => true, moving).status, 'stale');
  assert.equal(calls, 4);
});

test('a body-height system grows only on complete current room, keeps its feet and refuses stale evidence', () => {
  const world = new World(),
    Body = component('volume-body', {
      x: 0,
      feet: 0,
      z: 0,
      height: 1,
      wantHeight: 1.8,
      radius: 0.3,
      grown: 0,
      refused: 0,
    });
  const actor = world.spawn(Body({}));
  let collisionRevision = 1;
  let set = defineVolumeSet({
    revision: collisionRevision,
    maxColliders: 2,
    colliders: [floor, {id: 'duct', kind: 'box', center: [0, 2, 0], halfExtents: [1, 0.5, 1]}],
  });
  let swap: (() => void) | null = null;
  const runner = createSystemRunner(
    [
      {
        id: 'volume-body-height',
        phase: 'fixed',
        run() {
          const b = world.get(actor, Body);
          if (!b || b.height >= b.wantHeight) return;
          const r = b.radius;
          const result = headroom(
            set,
            {kind: 'capsule', a: [b.x, b.feet + r, b.z], b: [b.x, b.feet + b.height - r, b.z], radius: r},
            [0, b.wantHeight - b.height, 0],
          );
          swap?.(); // Creator code that replaces the collision data between query and effect.
          swap = null;
          // Creator policy: only a complete clear result for the current collision revision changes the body.
          if (result.status !== 'clear' || result.revision !== collisionRevision) {
            b.refused++;
            return;
          }
          b.height = b.wantHeight;
          b.grown++;
          world.touch();
        },
      },
    ],
    {step: 0.5},
  );
  runner.frame(null, 1);
  let b = world.get(actor, Body)!;
  assert.equal(b.height, 1);
  assert.equal(b.refused, 2);
  // The duct is removed, but the result computed against the old snapshot is refused once.
  swap = () => {
    collisionRevision = 2;
    set = defineVolumeSet({revision: 2, maxColliders: 1, colliders: [floor]});
  };
  const refusedBefore = b.refused;
  runner.frame(null, 0.5);
  b = world.get(actor, Body)!;
  assert.equal(b.height, 1);
  assert.equal(b.refused, refusedBefore + 1);
  runner.frame(null, 0.5);
  b = world.get(actor, Body)!;
  assert.equal(b.height, 1.8);
  assert.equal(b.feet, 0);
  assert.equal(b.grown, 1);
  assert.equal(runner.stats.errors, 0);
  world.despawn(actor);
});
