import { createTestWorkerHost } from '@engine';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene, Transform, projectToView } from '@engine';
import game from './game';
import yard from './yard';
import { region } from './region';

/** Resolves once the terrain revision's off-frame preparation has handed its builder to the frame loop.
 * Polls the scene state the preparation publishes; fails with the preparation error, or after a generous bound. */
async function preparedOrFailed(state: Record<string, unknown>, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (state.terrainWorker === undefined) {
    if (state.terrainPreparationError !== undefined) assert.fail(`terrain preparation failed: ${String(state.terrainPreparationError)}`);
    if (Date.now() - start > timeoutMs) assert.fail(`terrain preparation did not finish within ${timeoutMs} ms`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('S1: the character follows rendered ground while walking and after teleport', async () => {
  const t = await testScene(yard, { game });
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  tr.x = -5; tr.z = 3;
  t.hold('character-z', -1);
  for (let i = 0; i < 150; i++) {
    t.run(1 / 60);
    assert.ok(Math.abs(tr.y - region.sample(tr.x, tr.z)!.height - 0.7) < 1e-6);
  }
  assert.ok(tr.y > 2, 'walked onto the ridge');
  t.release('character-z'); tr.x = 5; tr.z = -5;
  t.run(1 / 60);
  assert.ok(tr.y < 0, 'basin contact does not flatten to zero');
});

test('S2: pad placement and exclusion use the same surface', async () => {
  const t = await testScene(yard, { game });
  const tr = t.world.get(t.ctx.named('pad-marker')!, Transform)!;
  const s = region.sample(tr.x, tr.z)!;
  assert.ok(Math.abs(s.height - 0.55) < 1e-6);
  assert.ok(s.excluded);
  assert.equal(s.material, 1);
  assert.ok(Math.abs(tr.y - s.height - 0.2) < 1e-6);
});

test('S3: an elevated pointer destination moves toward the actual terrain hit', async () => {
  const t = await testScene(yard, { game });
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  const target = projectToView(t.ctx.view, [-5, region.sample(-5, -4)!.height, -4])!;
  Object.assign(t.ctx.input.pointer, target, { down: true });
  t.run(4);
  assert.ok(Math.hypot(tr.x + 5, tr.z + 4) < 0.4, `arrived at ${tr.x},${tr.z}`);
});

test('chunk refinement and coarsening preserve coverage with at most one replacement per frame', async () => {
  const { Mesh } = await import('@engine');
  const { tiles } = await import('./chunks');
  const t = await testScene(yard, { game });
  const player = t.world.get(t.ctx.named('player')!, Transform)!;
  const probe = () => t.ctx.state.terrain as { builds: number; publications: number; strides: number[] };
  const edge = (name: string, axis: 0 | 2, at: number) => {
    const mesh = t.world.get(t.ctx.named(name)!, Mesh)!;
    const points = [];
    for (let i = 0; i < mesh.positions.length; i += 3) if (mesh.positions[i + axis] === at) points.push(mesh.positions.slice(i, i + 3));
    return points.sort((a, b) => a[axis === 0 ? 2 : 0]! - b[axis === 0 ? 2 : 0]!);
  };
  const coverage = () => {
    let area = 0, triangles = 0;
    for (const tile of tiles) {
      const mesh = t.world.get(t.ctx.named(tile.id)!, Mesh)!;
      assert.ok(mesh.visible);
      triangles += mesh.indices.length / 3;
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i]! * 3, b = mesh.indices[i + 1]! * 3, c = mesh.indices[i + 2]! * 3;
        area += ((mesh.positions[b + 2]! - mesh.positions[a + 2]!) * (mesh.positions[c]! - mesh.positions[a]!) - (mesh.positions[b]! - mesh.positions[a]!) * (mesh.positions[c + 2]! - mesh.positions[a + 2]!)) / 2;
      }
    }
    assert.equal(area, 24 * 24);
    assert.ok(triangles <= 4608);
    assert.deepEqual(edge('surface-nw', 0, 0), edge('surface-ne', 0, 0));
    assert.deepEqual(edge('surface-sw', 0, 0), edge('surface-se', 0, 0));
    assert.deepEqual(edge('surface-nw', 2, 0), edge('surface-sw', 2, 0));
    assert.deepEqual(edge('surface-ne', 2, 0), edge('surface-se', 2, 0));
  };
  coverage();
  for (const height of [1000, 8, 1000, 8]) {
    t.ctx.view.camera.position=[0,height,0];t.ctx.view.camera.target=[0,0,0];
    for(let frame=0;frame<9;frame++){
      const previous={...probe()};t.run(1/60);
      assert.ok(probe().builds-previous.builds<=1);assert.ok(probe().publications-previous.publications<=1);coverage();
    }
    assert.equal(probe().strides[0],height===1000?2:1);
    assert.equal(probe().strides[3],1,'authored material boundary remains exact');
    assert.ok(Math.abs(player.y-region.sample(player.x,player.z)!.height-0.7)<1e-6);
  }
  assert.ok(probe().builds <= 4, 'each far tile prepared at most once per visit');
  const before = { ...probe() }; t.run(1);
  assert.equal(probe().builds, before.builds); assert.equal(probe().publications, before.publications);
  yard.exit!(t.ctx);
  for (const tile of tiles) assert.equal(t.ctx.named(tile.id), undefined);
  const closed = t.ctx.state.terrain; t.run(1);
  assert.equal(t.ctx.state.terrain, closed, 'closed controller cannot republish');
});

test('chunk ownership is independent across visits and cleanup is idempotent', async () => {
  const a = await testScene(yard, { game }), b = await testScene(yard, { game });
  yard.exit!(a.ctx); yard.exit!(a.ctx);
  b.run(1);
  assert.ok(b.ctx.named('surface-nw'));
  assert.equal((b.ctx.state.terrain as { closed: boolean }).closed, false);
  yard.exit!(b.ctx);
});

test('S5: surface revision swaps render, contact and navigation epoch together', async () => {
  const { Mesh } = await import('@engine');
  const { currentSurface, subscribeTerrainRevision, tiles } = await import('./chunks');
  const { createPathSearch, createNavigationGraph } = await import('@kits/navigation');
  const jobs=createTestWorkerHost();
  const t = await testScene(yard, { game, services:{jobs} });
  const player = t.world.get(t.ctx.named('player')!, Transform)!;
  player.x = -5; player.z = -4; t.run(1 / 60);
  const originalHeight = player.y, epochs: number[] = [];
  const path = createPathSearch(createNavigationGraph([{ id: 'a', edges: [{ to: 'b', cost: 1 }] }, { id: 'b', edges: [] }]), 'a', 'b');
  const unsubscribe = subscribeTerrainRevision(t.ctx, epoch => {
    epochs.push(epoch); path.cancel();
    assert.equal(currentSurface(t.ctx).revision, epoch);
    assert.ok(Math.abs(player.y - currentSurface(t.ctx).sample(player.x, player.z)!.height - 0.7) < 1e-6);
  });
  t.press('terrain-revise');t.run(1/60);
  // The patch is prepared on the jobs service (inline slices on timers here); wait for that hand-off itself,
  // not a fixed wall-clock sleep, so machine load changes only how long this takes, never the outcome.
  await preparedOrFailed(t.ctx.state);
  for (let frame = 0; frame < 14; frame++) {
    const oldBuilds = (t.ctx.state.terrain as { builds: number }).builds;
    t.run(1 / 60);
    assert.ok((t.ctx.state.terrain as { builds: number }).builds - oldBuilds <= 1);
    const surface = currentSurface(t.ctx);
    assert.ok(Math.abs(player.y - surface.sample(player.x, player.z)!.height - 0.7) < 1e-6);
    for (const tile of tiles) {
      const mesh = t.world.get(t.ctx.named(tile.id)!, Mesh)!;
      for (let i = 0; i < mesh.positions.length; i += 3) assert.ok(Math.abs(mesh.positions[i + 1]! - surface.sample(mesh.positions[i]!, mesh.positions[i + 2]!)!.height) < 1e-6, 'all chunks match the same published canonical surface');
    }
    await Promise.resolve();
  }
  assert.equal(currentSurface(t.ctx).revision, 2); assert.deepEqual(epochs, [2]);
  assert.equal(path.result.status, 'cancelled'); assert.ok(player.y > originalHeight + 0.49);
  unsubscribe(); yard.exit!(t.ctx);jobs.dispose();
});

test('leaving during a sliced generation build cannot publish late geometry', async () => {
  const jobs=createTestWorkerHost();const t = await testScene(yard, { game,services:{jobs} }); t.press('terrain-revise'); t.run(1 / 60);
  await Promise.resolve(); t.run(1 / 60); yard.exit!(t.ctx);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const closed = t.ctx.state.terrain; t.run(1);
  assert.equal(t.ctx.state.terrain, closed); assert.equal(t.ctx.named('surface-nw'), undefined);jobs.dispose();
});
