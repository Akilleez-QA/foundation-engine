import test from 'node:test';
import assert from 'node:assert/strict';
import {captureResourceState} from './resource-state';
import {createApp} from '../core/app';
import {defineModule} from '../core/module';
import {createTestApi} from '../dev/test-api';
import {World} from '../core/ecs/world';

test('resource observation preserves detached JSON and explicit creator projection', () => {
  const source = {list: [1, null, false], projected: {toJSON: () => ({value: 2})}};
  const snapshot = captureResourceState(source);
  assert.deepEqual(snapshot, {list: [1, null, false], projected: {value: 2}});
  source.list[0] = 3;
  assert.deepEqual(snapshot.list, [1, null, false]);
});

test('resource observation fails visibly for invalid numbers and serialization errors', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const source of [
    {value: NaN},
    {value: [Infinity]},
    {value: -Infinity},
    cycle,
    {value: 1n},
    {
      get value() {
        throw Error('getter');
      },
    },
    {
      toJSON() {
        throw Error('projection');
      },
    },
  ]) {
    assert.throws(() => captureResourceState(source), /RESOURCE_CAPTURE_FAILED/);
  }
});

test('real probe and test API propagate resource failure then recover without replacing the world', async () => {
  const world = new World();
  world.resources.value = NaN;
  const resources = world.resources;
  const app = createApp(
    [
      defineModule({
        id: 'feature.capture-test',
        install(s) {
          s.probes.register(
            'world',
            () => ({
              scene: 'test',
              entities: world.count,
              state: captureResourceState(world.resources),
              named: {},
              frame: 0,
            }),
            s.signal,
          );
        },
      }),
    ],
    {mode: 'test', log() {}},
  );
  const booted = app.boot();
  const api = createTestApi(app, booted);
  await booted;
  try {
    assert.throws(() => api.state(), /RESOURCE_CAPTURE_FAILED/);
    assert.throws(() => api.probe('world'), /RESOURCE_CAPTURE_FAILED/);
    assert.equal(world.resources, resources);
    assert.ok(Number.isNaN(world.resources.value));
    world.resources.value = null;
    assert.equal(api.state().world?.state.value, null);
  } finally {
    app.dispose();
  }
});
