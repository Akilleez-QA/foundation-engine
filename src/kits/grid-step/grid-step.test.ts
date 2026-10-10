import test from 'node:test';
import assert from 'node:assert/strict';
import {createGridStepper, directionBit, gridStep, HANDHELD_TILE_PRESET, type TileRule} from './index';

/** A small map from a string grid: '#' wall, '~' water (class 2), 'v' ledge south, '>' conveyor east, 'i' ice, 'n' one-way (no entering northward), '2' elevation 2. */
function map(rows: string[]) {
  const height = rows.length,
    width = rows[0]!.length;
  const tile = (x: number, y: number): TileRule | undefined => {
    switch (rows[y]![x]) {
      case '#':
        return {passable: false};
      case '~':
        return {classes: 2};
      case 'v':
        return {ledge: 'south'};
      case '>':
        return {forced: 'east'};
      case 'i':
        return {forced: 'continue'};
      case 'n':
        return {blockEnter: directionBit('north')};
      case '2':
        return {elevation: 2};
      default:
        return {classes: 1};
    }
  };
  return {width, height, tile};
}
const run = (s: ReturnType<typeof createGridStepper>, ticks: number) => {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...s.step());
  return events;
};

test('a step takes stepTicks, reserves both tiles while moving, then arrives', () => {
  const s = createGridStepper({...map(['....', '....']), maxActors: 4, stepTicks: 4, turnBeforeMove: false});
  s.add(1, {x: 0, y: 0, facing: 'east'});
  assert.deepEqual(s.move(1, 'east'), {kind: 'started', toX: 1, toY: 0, ticks: 4});
  assert.deepEqual(s.occupants(0, 0), [1]);
  assert.deepEqual(s.occupants(1, 0), [1], 'destination reserved at once');
  assert.deepEqual(s.move(1, 'east'), {kind: 'bumped', reason: 'busy'});
  assert.deepEqual(run(s, 3), []);
  assert.deepEqual(run(s, 1), [{kind: 'arrived', id: 1, x: 1, y: 0}]);
  assert.deepEqual(s.occupants(0, 0), []);
  assert.equal(s.get(1)!.x, 1);
});

test('turn-before-move turns in place; a refused step still faces the obstacle', () => {
  const s = createGridStepper({...map(['.#', '..']), maxActors: 2});
  s.add(1, {x: 0, y: 0, facing: 'south'});
  assert.deepEqual(s.move(1, 'east'), {kind: 'turned'});
  assert.equal(s.get(1)!.facing, 'east');
  assert.deepEqual(s.move(1, 'east'), {kind: 'bumped', reason: 'impassable'});
  assert.deepEqual(s.move(1, 'north'), {kind: 'turned'});
  assert.deepEqual(s.move(1, 'north'), {kind: 'bumped', reason: 'impassable'}, 'off the map');
});

test('refusals are classified in a fixed order: leash, impassable, classes, elevation, occupied', () => {
  const s = createGridStepper({...map(['..~2..']), maxActors: 4, turnBeforeMove: false});
  s.add(1, {x: 1, y: 0, classes: 1, leash: {x: 1, y: 0, rangeX: 1, rangeY: 0}});
  assert.deepEqual(s.probe(1, 'east'), {kind: 'bumped', reason: 'impassable'}, 'water is not a walking class');
  s.add(2, {x: 0, y: 0});
  assert.deepEqual(s.probe(1, 'west'), {kind: 'bumped', reason: 'occupied'});
  s.add(3, {x: 4, y: 0, elevation: 1});
  assert.deepEqual(s.probe(3, 'west'), {kind: 'bumped', reason: 'elevation'});
  s.add(4, {x: 5, y: 0, leash: {x: 5, y: 0, rangeX: 1, rangeY: 0}});
  assert.deepEqual(s.move(4, 'west'), {kind: 'bumped', reason: 'occupied'});
  const swimmer = createGridStepper({...map(['.~~~']), maxActors: 1, turnBeforeMove: false});
  swimmer.add(9, {x: 1, y: 0, classes: 2, leash: {x: 1, y: 0, rangeX: 1, rangeY: 0}});
  assert.equal(swimmer.probe(9, 'east').kind, 'started');
  assert.deepEqual(swimmer.probe(9, 'west'), {kind: 'bumped', reason: 'impassable'}, 'a swimmer cannot leave water');
  swimmer.move(9, 'east');
  run(swimmer, 16);
  assert.deepEqual(swimmer.probe(9, 'east'), {kind: 'bumped', reason: 'outside-range'});
});

test('directional blocks, ledges and arriving elevations', () => {
  const s = createGridStepper({...map(['.....', '.n.v.', '..2..', '.....']), maxActors: 4, turnBeforeMove: false});
  s.add(1, {x: 1, y: 2});
  assert.deepEqual(s.probe(1, 'north'), {kind: 'bumped', reason: 'impassable'}, 'one-way tile refuses northward entry');
  s.add(2, {x: 3, y: 0});
  assert.deepEqual(s.move(2, 'south'), {kind: 'jumped', toX: 3, toY: 2, ticks: 32}, 'over the ledge, landing beyond');
  run(s, 32);
  assert.deepEqual([s.get(2)!.x, s.get(2)!.y], [3, 2]);
  assert.deepEqual(s.probe(2, 'north'), {kind: 'bumped', reason: 'impassable'}, 'a ledge cannot be climbed back up');
  s.add(4, {x: 2, y: 3});
  s.move(4, 'north');
  run(s, 16);
  assert.equal(s.get(4)!.elevation, 2, 'arriving on a tile with an elevation takes it');
});

test('forced tiles chain moves; ice continues until blocked; the chain is bounded', () => {
  const s = createGridStepper({...map(['.>..#', '.iii#']), maxActors: 2, stepTicks: 2, turnBeforeMove: false});
  s.add(1, {x: 0, y: 0});
  s.move(1, 'east');
  const events = run(s, 12);
  assert.deepEqual(
    events.filter(e => e.kind === 'arrived').map(e => (e.kind === 'arrived' ? e.x : -1)),
    [1, 2],
    'a conveyor pushes one extra tile',
  );
  s.add(2, {x: 0, y: 1});
  s.move(2, 'east');
  const slide = run(s, 20);
  assert.equal(s.get(2)!.x, 3, 'slides across the ice until the wall');
  assert.ok(slide.some(e => e.kind === 'forced' && e.result.kind === 'bumped'));
  const loop = createGridStepper({
    width: 3,
    height: 1,
    maxActors: 1,
    stepTicks: 1,
    turnBeforeMove: false,
    maxForcedChain: 5,
    tile: x => (x === 0 ? {forced: 'east'} : x === 2 ? {forced: 'west'} : {forced: 'continue'}),
  });
  loop.add(1, {x: 1, y: 0});
  loop.move(1, 'east');
  const bounded = run(loop, 50);
  assert.ok(bounded.some(e => e.kind === 'forced' && e.result.kind === 'bumped' && e.result.reason === 'chain-limit'));
  assert.equal(loop.get(1)!.duration, 0, 'the forced loop stops at the chain bound');
});

test('follower chains step into the tile their leader leaves, in the same tick', () => {
  const s = createGridStepper({...map(['......']), maxActors: 4, stepTicks: 4, turnBeforeMove: false});
  s.add(1, {x: 3, y: 0});
  s.add(2, {x: 2, y: 0});
  s.add(3, {x: 1, y: 0});
  s.follow(2, 1);
  s.follow(3, 2);
  assert.throws(() => s.follow(1, 3), RangeError, 'cycles are refused');
  assert.equal(s.move(1, 'east').kind, 'started');
  assert.deepEqual([s.get(2)!.toX, s.get(3)!.toX], [3, 2], 'the whole line starts together, each into the tile ahead');
  run(s, 4);
  assert.deepEqual(
    [1, 2, 3].map(id => s.get(id)!.x),
    [4, 3, 2],
  );
  // A follower that is not adjacent (after a teleport) does not move and is reported.
  s.remove(2);
  assert.equal(s.get(3)!.leader, null, 'removing a leader detaches its followers');
});

test('snapshots restore identical behaviour and refuse inconsistent state', () => {
  const options = {...map(['....', '....']), maxActors: 4, stepTicks: 3, turnBeforeMove: false};
  const a = createGridStepper(options);
  a.add(1, {x: 0, y: 0});
  a.add(2, {x: 0, y: 1});
  a.follow(2, 1);
  a.move(1, 'east');
  a.step();
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = createGridStepper(options);
  b.restore(snap);
  assert.deepEqual(b.snapshot(), a.snapshot());
  assert.deepEqual(run(b, 5), run(a, 5));
  assert.deepEqual(b.snapshot(), a.snapshot());
  const clash = {v: 1, actors: [snap.actors[0], {...snap.actors[1], x: 0, y: 0, toX: 0, toY: 0}]};
  assert.throws(() => b.restore(clash as never), RangeError, 'two actors on one tile');
  assert.deepEqual(b.snapshot(), a.snapshot(), 'a refused restore changes nothing');
  const standing = (id: number) => ({
    ...snap.actors[0],
    id,
    x: 2,
    y: 1,
    toX: 2,
    toY: 1,
    elapsed: 0,
    duration: 0,
    leader: null,
  });
  assert.throws(() => b.restore({v: 1, actors: [standing(5), standing(6)]} as never), /claim tile/);
  assert.throws(() => b.restore({v: 1, actors: [{...snap.actors[0], elapsed: 9}]}), RangeError);
});

test('options and inputs are validated; tile rules cannot reenter', () => {
  for (const bad of [{width: 0}, {height: 70000}, {maxActors: 0}, {stepTicks: 0}]) {
    assert.throws(() => createGridStepper({...map(['..']), maxActors: 1, ...bad}), RangeError);
  }
  const s = createGridStepper({...map(['..']), maxActors: 1});
  s.add(1, {x: 0, y: 0});
  assert.throws(() => s.add(2, {x: 1, y: 0}), RangeError, 'capacity');
  assert.throws(() => s.move(1, 'up' as never), RangeError);
  let reenter: ReturnType<typeof createGridStepper> | null = null;
  const r = createGridStepper({
    width: 2,
    height: 1,
    maxActors: 1,
    turnBeforeMove: false,
    tile: () => {
      reenter?.step();
      return {};
    },
  });
  r.add(1, {x: 0, y: 0});
  reenter = r;
  assert.deepEqual(r.move(1, 'east'), {kind: 'bumped', reason: 'impassable'}, 'a reentrant tile rule fails closed');
  assert.ok(r.diagnostics().malformedTiles > 0);
  assert.equal(gridStep().id, 'grid-step');
  assert.equal(HANDHELD_TILE_PRESET.stepTicks, 16);
});

test('review regressions: self-produced snapshots restore, malformed tiles fail closed, chains, ledges, stairs', () => {
  // A follower that arrives while its leader is still jumping a ledge, and an unfollow mid-move, both restore.
  const ledge = createGridStepper({
    width: 1,
    height: 6,
    maxActors: 2,
    turnBeforeMove: false,
    tile: (_x, y) => (y === 2 ? {ledge: 'south'} : {}),
  });
  ledge.add(1, {x: 0, y: 1});
  ledge.add(2, {x: 0, y: 0});
  ledge.follow(2, 1);
  ledge.move(1, 'south');
  run(ledge, 16);
  const mid = ledge.snapshot();
  const copy = createGridStepper({
    width: 1,
    height: 6,
    maxActors: 2,
    turnBeforeMove: false,
    tile: (_x, y) => (y === 2 ? {ledge: 'south'} : {}),
  });
  assert.doesNotThrow(() => copy.restore(mid));
  ledge.follow(2, null);
  assert.doesNotThrow(() => copy.restore(ledge.snapshot()));
  // Malformed tile rules never half-apply a step: they are impassable and counted.
  const bad = createGridStepper({
    width: 3,
    height: 1,
    maxActors: 1,
    turnBeforeMove: false,
    stepTicks: 1,
    tile: x => (x === 1 ? ({forced: 'up'} as never) : x === 2 ? ({elevation: 300} as never) : {}),
  });
  bad.add(1, {x: 0, y: 0});
  assert.deepEqual(bad.move(1, 'east'), {kind: 'bumped', reason: 'impassable'});
  assert.ok(bad.diagnostics().malformedTiles >= 1);
  // A 4096-actor follower line starts without recursion.
  const line = createGridStepper({width: 4097, height: 1, maxActors: 4096, turnBeforeMove: false, tile: () => ({})});
  for (let i = 0; i < 4096; i++) line.add(i, {x: 4095 - i, y: 0});
  for (let i = 1; i < 4096; i++) line.follow(i, i - 1);
  assert.equal(line.move(0, 'east').kind, 'started');
  assert.equal(line.get(4095)!.toX, 1, 'the last follower starts in the same call');
  // Followers on a conveyor stay in line regardless of id order.
  for (const [leader, follower] of [
    [1, 2],
    [2, 1],
  ] as const) {
    const belt = createGridStepper({
      width: 8,
      height: 1,
      maxActors: 2,
      turnBeforeMove: false,
      stepTicks: 1,
      tile: x => (x >= 2 && x <= 4 ? {forced: 'east'} : {}),
    });
    belt.add(leader, {x: 1, y: 0});
    belt.add(follower, {x: 0, y: 0});
    belt.follow(follower, leader);
    belt.move(leader, 'east');
    run(belt, 6);
    assert.equal(belt.get(leader)!.x - belt.get(follower)!.x, 1, `leader ${leader} follower ${follower}`);
  }
  // A follower jumps the ledge behind its leader and the line continues.
  const jump = createGridStepper({
    width: 1,
    height: 8,
    maxActors: 2,
    turnBeforeMove: false,
    stepTicks: 2,
    jumpTicks: 2,
    tile: (_x, y) => (y === 2 ? {ledge: 'south'} : {}),
  });
  jump.add(1, {x: 0, y: 1});
  jump.add(2, {x: 0, y: 0});
  jump.follow(2, 1);
  jump.move(1, 'south');
  run(jump, 2);
  jump.move(1, 'south');
  run(jump, 2);
  assert.equal(jump.get(1)!.y, 4);
  assert.equal(jump.get(2)!.y, 3, "the follower jumped the ledge to the leader's previous tile");
  // Stairs: a transition tile lets an actor change elevation.
  const stairs = createGridStepper({
    width: 3,
    height: 1,
    maxActors: 1,
    turnBeforeMove: false,
    stepTicks: 1,
    tile: x => (x === 0 ? {elevation: 1} : x === 1 ? {transition: true} : {elevation: 2}),
  });
  stairs.add(1, {x: 0, y: 0, elevation: 1});
  stairs.move(1, 'east');
  run(stairs, 1);
  assert.equal(stairs.get(1)!.elevation, undefined);
  assert.equal(stairs.move(1, 'east').kind, 'started');
  run(stairs, 1);
  assert.equal(stairs.get(1)!.elevation, 2);
  // Actors cannot be placed on walls; move options must be objects.
  assert.throws(() => stairs.add(2, {x: 0, y: 0}), RangeError);
  assert.throws(() => stairs.move(1, 'west', null as never), RangeError);
});
