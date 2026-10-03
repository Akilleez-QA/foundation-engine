import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, testScene, Transform } from '@engine';
import { createSessionHost } from '@kits/network';
import game from './game';
import rules, { SIZE, type Action, type Board } from './session';
import world, { currentSession } from './world';

const at = (cell: number) => cell - (SIZE - 1) / 2;

test('S1: moving and painting change the shared world through the same rules locally and on the host', async () => {
  const t = await testScene(world, { game });
  assert.equal(t.ctx.state.session, 'local');
  assert.equal(t.ctx.state.player, 'p1');
  t.hold('move-x', 1);
  t.run(0.3); // Steps at 0, 0.12 and 0.24 s.
  t.release('move-x');
  t.press('paint');
  t.run(0.5);
  const local = currentSession()!.read().world;
  assert.deepEqual(local.p1, { x: 3, z: 0, color: 0 });
  assert.equal((local.board as Board).cells[3], 1);
  assert.equal(t.ctx.state.painted, 1);
  const me = t.ctx.named('avatar:p1')!;
  assert.ok(Math.abs(t.world.get(me, Transform)!.x - at(3)) < 0.01, 'the avatar glided to its cell');
  const mesh = t.world.get(t.ctx.named('board')!, Mesh)!; // One mesh for the board: cell 3's quad is recolored.
  assert.notDeepEqual(mesh.colors.slice(3 * 12, 3 * 12 + 3), mesh.colors.slice(0, 3));
  assert.deepEqual(mesh.colors.slice(4 * 12, 4 * 12 + 3), mesh.colors.slice(0, 3));

  // The host applies the same file authoritatively: the same actions give the same world.
  const sent: string[] = [];
  const host = createSessionHost({ rules, joinCode: 'test-join-code-000000', ports: { send: (_c, text) => { sent.push(text); return true; }, close: () => {} } });
  host.connect('tab', 0);
  host.message('tab', JSON.stringify({ v: 1, type: 'join', rules: rules.id, version: rules.version, token: 'test-join-code-000000', player: 'page-key-0123456789' }), 0);
  const actions: Action[] = [{ type: 'step', dx: 1, dz: 0 }, { type: 'step', dx: 1, dz: 0 }, { type: 'step', dx: 1, dz: 0 }, { type: 'paint' }];
  actions.forEach((action, i) => host.message('tab', JSON.stringify({ v: 1, type: 'action', seq: i + 1, action }), 100 * (i + 1)));
  host.pump(1000);
  assert.deepEqual(host.read().world, local);
  assert.equal(host.read().metrics.applied, 4);
  assert.match(sent[0]!, /"type":"welcome","player":"p1"/);
  host.dispose();
  t.dispose();
});

test('a still world does not touch the scene', async () => {
  const t = await testScene(world, { game });
  t.run(0.2);
  const v = t.world.version;
  t.run(1);
  assert.equal(t.world.version, v);
  t.dispose();
});

test('stepping into the edge is ignored and painting twice clears the cell', async () => {
  const t = await testScene(world, { game });
  t.hold('move-x', -1); t.hold('move-z', -1);
  t.run(0.5);
  t.release('move-x'); t.release('move-z');
  const session = currentSession()!;
  assert.deepEqual(session.read().world.p1, { x: 0, z: 0, color: 0 });
  t.press('paint'); t.run(0.1); t.press('paint'); t.run(0.1);
  assert.equal(t.ctx.state.painted, 0);
  t.dispose();
  assert.equal(currentSession(), null, 'exit released the session owner');
});
