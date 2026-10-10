import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, testScene, Name, Transform} from '../../author';
import {Solid, Walls} from '../character';
import {createSampledSurface} from '../terrain';
import {createRollbackSyncTest} from '../rollback';
import {
  boardConfig,
  boardSystem,
  createBoard,
  defineRails,
  sampledBoardGround,
  type BoardControls,
  type BoardEvent,
  type BoardGround,
} from './index';

const flat: BoardGround = (_x, _z, below, out) => {
  if (below < 0) return false;
  Object.assign(out, {height: 0, nx: 0, ny: 1, nz: 0});
  return true;
};

test('board-traversal consumer: the fixed-step adapter writes the Transform and the character kit walls bail a fast rider', async () => {
  const board = createBoard(boardConfig('arcade', {bail: {wallSpeed: 3}}));
  board.place({x: 0, y: 0, z: 0});
  const events: BoardEvent[] = [];
  let owned = true;
  const scene = defineScene({
    id: 'park',
    title: 'park',
    entities: [
      [Name({name: 'rider'}), Transform({x: 0, y: 0, z: 0})],
      [Walls({minX: -20, maxX: 20, minZ: -20, maxZ: 40})],
      [Transform({x: 0, z: 25}), Solid({halfX: 3, halfZ: 0.5, r: 0})],
    ],
  });
  const t = await testScene(scene, {
    systems: [
      boardSystem({
        board,
        ground: flat,
        walls: {radius: 0.3},
        controls: () => ({push: true}),
        when: () => owned,
        after: r => events.push(...r.events),
      }),
    ],
  });
  const tr = t.world.get(t.ctx.named('rider')!, Transform)!;
  t.run(1);
  assert.ok(tr.z > 1 && Math.abs(tr.z - board.read().position[2]) < 1e-12);
  owned = false;
  const before = events.filter(e => e === 'push').length;
  t.run(0.5);
  assert.equal(events.filter(e => e === 'push').length, before, 'neutral controls while not owned: no pushes');
  owned = true;
  t.run(6);
  assert.ok(events.includes('bail'), 'hit the solid box');
  assert.ok(tr.z < 25 - 0.5 - 0.3 + 1e-9, 'never passed through it');
  t.dispose();
});

test('board-traversal consumer: rides a terrain-kit sampled surface downhill and lands back on it', () => {
  const cells = 32,
    spacing = 2;
  const heights: number[] = [];
  for (let z = 0; z <= cells; z++) for (let x = 0; x <= cells; x++) heights.push(20 - 0.2 * z * spacing);
  const surface = createSampledSurface({
    id: 'hill',
    revision: 1,
    originX: -32,
    originZ: 0,
    spacing,
    cellsX: cells,
    cellsZ: cells,
    heights,
  });
  const ground = sampledBoardGround((x, z) => surface.sample(x, z));
  const board = createBoard(boardConfig('sim-lite'));
  board.place({x: 0, y: 20 - 0.2 * 2, z: 2});
  const events: BoardEvent[] = [];
  for (let i = 0; i < 120; i++) events.push(...board.step(1 / 60, {}, {ground}).events);
  assert.equal(board.mode, 'rolling');
  assert.ok(board.speed > 2);
  for (let i = 0; i < 20; i++) events.push(...board.step(1 / 60, {ollie: true}, {ground}).events);
  for (let i = 0; i < 240; i++) events.push(...board.step(1 / 60, {}, {ground}).events);
  assert.ok(events.includes('pop') && events.includes('land-clean'), events.join(','));
  const [x, y, z] = board.read().position;
  assert.ok(Math.abs(y - surface.sample(x, z)!.height) < 1e-9, 'on the surface');
});

test('board-traversal consumer: the rollback kit sync test finds no hidden state through pushes, grinds, tricks and bails', () => {
  const board = createBoard(boardConfig('arcade'), {math: 'deterministic'});
  board.place({x: 0, y: 0, z: 0});
  const rails = defineRails({
    revision: 1,
    maxSegments: 8,
    rails: [
      {
        id: 'ledge',
        points: [
          [0.1, 0.4, 6],
          [0.1, 0.4, 30],
        ],
      },
    ],
  });
  const decode = (text: string): BoardControls => {
    const [push, ollie, steer, manual, trick] = text.split(',');
    return {
      push: push === '1',
      ollie: ollie === '1',
      steer: Number(steer),
      manual: Number(manual) as -1 | 0 | 1,
      trick: Number(trick),
    };
  };
  const seen = new Set<BoardEvent>();
  const sync = createRollbackSyncTest({
    checkDistance: 8,
    maxStateBytes: 1 << 16,
    maxInputBytes: 64,
    players: 1,
    ports: {
      save: () => JSON.stringify(board.snapshot()),
      load: text => board.restore(JSON.parse(text)),
      step: inputs => {
        for (const e of board.step(1 / 60, decode(inputs[0]!), {ground: flat, rails}).events) seen.add(e);
      },
    },
  });
  for (let f = 0; f < 900; f++) {
    const p = f % 300;
    const input = [
      p < 60 ? 1 : 0,
      p >= 60 && p < 72 ? 1 : 0,
      p > 200 ? (Math.sin(f / 7) * 0.8).toFixed(3) : '0',
      p > 140 && p < 190 ? 1 : 0,
      p === 75 && f > 300 ? '2' : '0',
    ].join(',');
    const r = sync.advance([input]);
    assert.equal(r.status, 'checked', JSON.stringify(r));
  }
  sync.dispose();
  for (const e of ['push', 'pop', 'grind-start', 'grind-end', 'trick-start', 'bail', 'recover'] as const)
    assert.ok(seen.has(e), `${e} exercised: ${[...seen].join(',')}`);
});
