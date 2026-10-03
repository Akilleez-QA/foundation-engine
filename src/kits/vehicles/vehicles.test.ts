import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4} from 'three';
import {createFrames} from '../frames';
import {createVehicles, vehicleRiderSystem, VehicleRider} from './index';
import {defineScene, testScene, Name, Transform} from '../../author';
const pose = (x: number) => new Matrix4().makeTranslation(x, 0, 0).toArray();
function setup() {
  const frames = createFrames(),
    frame = {id: 'ship-frame', generation: 1};
  frames.set({...frame, matrix: pose(10)});
  const v = createVehicles(frames);
  v.register('ship', frame, [{id: 'high', sockets: {pilot: pose(2), passenger: pose(3)}}], 'high');
  return {frames, frame, v};
}
test('boarding preserves world pose, follows parent, and enforces one rider/seat owner', () => {
  const {frames, frame, v} = setup();
  assert.equal(v.board('a', 'ship', 'pilot', pose(15)), true);
  assert.equal(v.pose('a')?.[12], 15);
  assert.equal(v.board('a', 'ship', 'passenger', pose(0)), false);
  assert.equal(v.board('b', 'ship', 'pilot', pose(0)), false);
  frames.set({...frame, matrix: pose(20)});
  assert.equal(v.pose('a')?.[12], 25);
  assert.equal(v.unregister('ship'), false);
});
test('invalid exit cannot detach; valid exit preserves pose and releases seat', () => {
  const {v} = setup();
  v.board('a', 'ship', 'pilot', pose(15));
  assert.equal(
    v.exit('a', pose(100), () => false),
    null,
  );
  assert.equal(v.hasRider('a'), true);
  assert.equal(v.exit('a', null, p => p[12] === 15)?.[12], 15);
  assert.equal(v.hasRider('a'), false);
  assert.equal(v.board('b', 'ship', 'pilot', pose(16)), true);
});
test('missing generation holds ownership without inventing a pose; failed board stays atomic', () => {
  const {frames, frame, v} = setup();
  assert.throws(() => v.board('a', 'ship', 'unknown', pose(1)));
  assert.equal(v.size, 0);
  v.board('a', 'ship', 'pilot', pose(15));
  frames.remove(frame);
  assert.equal(v.pose('a'), null);
  assert.equal(
    v.exit('a', null, () => true),
    null,
  );
  assert.equal(v.hasRider('a'), true);
});
test('rider-follow system moves author Transform after parent movement', async () => {
  const {frames, frame, v} = setup();
  v.board('actor', 'ship', 'pilot', pose(15));
  const s = await testScene(
    defineScene({
      id: 'seats',
      title: 'seats.title',
      entities: [[Name({name: 'actor'}), Transform({x: 15}), VehicleRider({id: 'actor'})]],
      systems: [vehicleRiderSystem(v)],
    }),
  );
  frames.set({...frame, matrix: pose(30)});
  s.run(1 / 60);
  assert.equal(s.world.get(s.ctx.named('actor')!, Transform)?.x, 35);
});

test('author exit helper changes pose only after validated detachment', async () => {
  const {v} = setup();
  const {boardVehicle, exitVehicle} = await import('./index');
  const s = await testScene(
    defineScene({
      id: 'exit',
      title: 'exit.title',
      entities: [[Name({name: 'actor'}), Transform({x: 15}), VehicleRider({id: 'actor'})]],
    }),
  );
  const e = s.ctx.named('actor')!;
  assert.equal(boardVehicle(s.ctx, e, v, 'ship', 'pilot'), true);
  assert.equal(
    exitVehicle(s.ctx, e, v, pose(20), () => false),
    false,
  );
  assert.equal(s.world.get(e, Transform)?.x, 15);
  assert.equal(
    exitVehicle(s.ctx, e, v, pose(20), () => true),
    true,
  );
  assert.equal(s.world.get(e, Transform)?.x, 20);
  assert.equal(v.hasRider('actor'), false);
});
