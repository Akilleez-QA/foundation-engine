import test from 'node:test';
import assert from 'node:assert/strict';
import {World, type Entity} from '../../core/ecs/world';
import {Transform} from '../../author';
import {createRollbackSession, createRollbackSyncTest} from '../rollback';
import {Collider, createPhysicsWorld, loadPhysics, RigidBody, type PhysicsWorld, type Rapier} from './index';

const ready = async (): Promise<Rapier> => {
  const r = await loadPhysics();
  assert.equal(r.status, 'ready');
  return (r as {rapier: Rapier}).rapier;
};

/** A small pile: a floor, a ramp, and boxes and balls dropped at fixed spots (identical operations every call). */
function pile(world: World): Entity[] {
  world.spawn(Transform(), Collider({hx: 20, hy: 0.2, hz: 20}));
  world.spawn(Transform({x: 3, y: 1, rz: 0.4}), Collider({hx: 3, hy: 0.2, hz: 2}));
  const out: Entity[] = [];
  for (let i = 0; i < 12; i++)
    out.push(
      world.spawn(
        Transform({x: (i % 4) - 1.5 + i * 0.01, y: 2 + Math.floor(i / 4) * 1.2, z: (i % 3) * 0.3, ry: i * 0.3}),
        RigidBody({vx: (i % 2) - 0.5}),
        i % 2 ? Collider({shape: 'ball', radius: 0.4, restitution: 0.3}) : Collider({hx: 0.4, hy: 0.3, hz: 0.5}),
      ),
    );
  return out;
}
const bytesOf = (pw: PhysicsWorld) => {
  const s = pw.snapshot();
  assert.equal(s.status, 'ok');
  return (s as {text: string}).text;
};
const poses = (w: World) =>
  JSON.stringify([...w.query(Transform)].map(([e, t]) => [e, t.x, t.y, t.z, t.rx, t.ry, t.rz]));

test('determinism: two worlds fed the same operations produce byte-identical snapshots after N steps', async () => {
  const rapier = await ready();
  const run = () => {
    const pw = createPhysicsWorld(rapier, {math: 'deterministic'});
    const w = new World();
    pile(w);
    for (let i = 0; i < 180; i++) pw.tick(w);
    const out = {text: bytesOf(pw), poses: poses(w)};
    pw.dispose();
    return out;
  };
  const a = run(),
    b = run();
  assert.equal(a.text, b.text);
  assert.equal(a.poses, b.poses);
});

test('determinism: snapshot at step k, restore and replay to N equals the uninterrupted run byte for byte', async () => {
  const rapier = await ready();
  const N = 150,
    k = 40;
  // Several despawns and a spawn in one tick after the restore point: removal and slot reuse must not depend on the
  // owner's internal map order (which a restore rebuilds differently).
  const churn = (w: World, bodies: Entity[], i: number) => {
    if (i !== 90) return;
    for (const e of [bodies[7]!, bodies[2]!, 2, bodies[9]!]) w.despawn(e); // 2 is the static ramp
    w.spawn(Transform({x: 0.2, y: 4}), RigidBody(), Collider({shape: 'ball', radius: 0.3}));
  };
  const straight = createPhysicsWorld(rapier);
  const ws = new World();
  const bs = pile(ws);
  for (let i = 0; i < N; i++) {
    churn(ws, bs, i);
    straight.tick(ws);
  }
  const reference = bytesOf(straight);

  const pw = createPhysicsWorld(rapier);
  const w = new World();
  const bw = pile(w);
  for (let i = 0; i < k; i++) pw.tick(w);
  const atK = bytesOf(pw);
  const ecsAtK = poses(w);
  for (let i = k; i < k + 30; i++) pw.tick(w); // wander off, then go back
  const restored = pw.restore(atK);
  assert.equal(restored.status, 'restored');
  assert.equal(restored.status === 'restored' && restored.tick, k);
  assert.equal(pw.events().list.length, 0, 'events are recomputed, not restored');
  assert.notEqual(poses(w), ecsAtK, 'Transform still shows the abandoned future until the next write back');
  for (let i = k; i < N; i++) {
    churn(w, bw, i);
    pw.tick(w);
  }
  assert.equal(bytesOf(pw), reference);
  assert.equal(poses(w), poses(ws));
  straight.dispose();
  pw.dispose();
});

test('restore: invalid, foreign or oversized text is refused and leaves the live world untouched', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier, {limits: {maxSnapshotBytes: 64 * 1024}});
  const w = new World();
  pile(w);
  for (let i = 0; i < 10; i++) pw.tick(w);
  const before = bytesOf(pw);
  const good = JSON.parse(before) as {records: unknown[][]; world: string};
  const variants: [string, string][] = [
    ['not json', 'not JSON'],
    ['{"format":"other","v":1}', 'format'],
    [JSON.stringify({...good, tick: -1}), 'tick'],
    [JSON.stringify({...good, world: 'abc'}), 'world encoding'],
    [JSON.stringify({...good, world: btoa('garbage bytes!')}), 'world bytes'],
    [JSON.stringify({...good, records: good.records.slice(1)}), 'object count'],
    [
      JSON.stringify({
        ...good,
        records: [...good.records.slice(0, -1), [...good.records.at(-1)!.slice(0, 3), 'zz', '', 0]],
      }),
      'handle',
    ],
    [JSON.stringify({...good, records: [good.records[0], good.records[0], ...good.records.slice(2)]}), 'entity'],
  ];
  for (const [text, reason] of variants) {
    const r = pw.restore(text);
    assert.equal(r.status, 'invalid', reason);
    assert.equal(r.status === 'invalid' && r.reason, reason);
    assert.equal(bytesOf(pw), before, `${reason}: unchanged`);
  }
  assert.equal(pw.restore('x'.repeat(64 * 1024 + 1)).status, 'too-large');
  const other = createPhysicsWorld(rapier, {gravity: {x: 0, y: -3, z: 0}});
  other.sync(w);
  assert.equal(other.restore(before).status, 'invalid', 'a snapshot from another configuration is refused');
  const tiny = createPhysicsWorld(rapier, {limits: {maxSnapshotBytes: 1024}});
  tiny.sync(w);
  assert.equal(tiny.snapshot().status, 'too-large');
  // Only the 'object count' candidate decoded into a library world before validation refused it; it was freed.
  assert.equal(pw.status().released.worlds, 1);
  for (let i = 0; i < 5; i++) pw.tick(w);
  assert.equal(pw.status().tick, 15, 'the live world keeps stepping after refused restores');
  for (const p of [pw, other, tiny]) p.dispose();
});

test('restore: stale entity ids from the snapshot are removed at the next sync; current entities are admitted', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier);
  const w = new World();
  const [first] = pile(w);
  pw.tick(w);
  const snap = bytesOf(pw);
  w.despawn(first!);
  const late = w.spawn(Transform({y: 5}), RigidBody(), Collider());
  pw.tick(w);
  pw.restore(snap);
  assert.ok(pw.handles(first!), 'restored mapping holds the old entity until sync');
  assert.equal(pw.handles(late), null);
  pw.tick(w);
  assert.equal(pw.handles(first!), null, 'an entity the game no longer has is removed');
  assert.ok(pw.handles(late), 'an entity the snapshot did not know is admitted');
  pw.dispose();
});

/** The ports a creator writes: the ECS state they own plus the physics snapshot, as one text. */
function ports(rapier: Rapier) {
  const pw = createPhysicsWorld(rapier, {math: 'deterministic'});
  const world = new World();
  const bodies = pile(world);
  pw.sync(world);
  const save = () => {
    const s = pw.snapshot();
    if (s.status !== 'ok') throw Error(s.status);
    return s.text;
  };
  return {
    pw,
    world,
    ports: {
      save,
      load(text: string) {
        const r = pw.restore(text);
        if (r.status !== 'restored') throw Error(r.status);
        pw.writeBack(world); // Transform is derived from the physics state, so restoring it here is enough
      },
      step(inputs: readonly string[]) {
        // Input: a player nudges a body sideways.
        for (const [i, input] of inputs.entries())
          if (input === 'push')
            pw.teleport(
              bodies[i]!,
              {...world.get(bodies[i]!, Transform)!, x: world.get(bodies[i]!, Transform)!.x + 0.05},
              false,
            );
        pw.tick(world);
      },
    },
  };
}

test('rollback: the physics snapshot passes the rollback kit sync test (save/load/step ports)', async () => {
  const rapier = await ready();
  const {pw, ports: p} = ports(rapier);
  const sync = createRollbackSyncTest({
    checkDistance: 8,
    players: 2,
    maxStateBytes: 1 << 20,
    maxInputBytes: 8,
    ports: p,
  });
  for (let frame = 0; frame < 90; frame++) {
    const r = sync.advance([frame % 7 === 0 ? 'push' : 'idle', frame % 5 === 0 ? 'push' : 'idle']);
    assert.equal(r.status, 'checked', `frame ${frame}: ${JSON.stringify(r)}`);
  }
  sync.dispose();
  pw.dispose();
});

test('rollback: two peers on a delayed link end with identical physics state', async () => {
  const rapier = await ready();
  const peers = [ports(rapier), ports(rapier)];
  const limits = {
    players: 2,
    maxPredictionFrames: 8,
    inputDelay: 1,
    maxInputBytes: 8,
    maxStateBytes: 1 << 20,
    checksumInterval: 10,
    maxChecksumHistory: 64,
    maxPendingChecksums: 64,
  };
  const sessions = peers.map((peer, local) =>
    createRollbackSession({local, neutralInput: 'idle', limits, ports: peer.ports}),
  );
  let wire: {to: number; frame: number; input: string; at: number}[] = [];
  for (let tick = 0; tick < 120; tick++) {
    const arrived = wire.filter(m => m.at <= tick);
    wire = wire.filter(m => m.at > tick);
    for (const m of arrived) sessions[m.to]!.remote(1 - m.to, m.frame, m.input);
    for (const [i, s] of sessions.entries()) {
      const l = s.local((tick + i) % 9 === 0 ? 'push' : 'idle');
      if (l.status === 'queued') wire.push({to: 1 - i, frame: l.frame, input: l.input, at: tick + 3});
      const r = s.advance();
      assert.ok(r.status === 'advanced' || r.status === 'stalled', `${r.status}`);
    }
  }
  const a = sessions[0]!.confirmedState()!,
    b = sessions[1]!.confirmedState()!;
  assert.equal(a.frame, b.frame);
  assert.equal(a.checksum, b.checksum);
  assert.ok(
    sessions.every(s => s.read().stats.rollbacks > 0),
    'predictions were wrong and rolled back',
  );
  assert.ok(sessions.every(s => s.read().desync === null));
  for (const s of sessions) s.dispose();
  for (const p of peers) p.pw.dispose();
});
