import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineVolumeSet, headroom, overlapVolume, sweepVolume, type VolumeBody, type VolumeSetInput} from './index';

const input = (revision: number): VolumeSetInput => ({
  revision,
  maxColliders: 2,
  colliders: [
    {id: 'wall', kind: 'box', center: [2, 0, 0], halfExtents: [0.2, 5, 5], rotation: [0, 0, 0, 1], mask: 1},
    {id: 'roof', kind: 'capsule', a: [-1, 3, 0], b: [1, 3, 0], radius: 0.2, mask: 1},
  ],
});
const set = defineVolumeSet(input(7));
const other = defineVolumeSet(input(19));
const sphere: VolumeBody = {kind: 'sphere', center: [0, 0, 0], radius: 0.2};
const capsule = {kind: 'capsule' as const, a: [0, 0.2, 0] as const, b: [0, 1, 0] as const, radius: 0.2};
const options = {mask: 1, margin: 0, tolerance: 1e-6, maxEvaluations: 32, maxIterations: 32, maxResults: 2};

// Enumerate ordinary input fields, including array length: Proxy arrays still pass Array.isArray.
function paths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const keys = Array.isArray(value) ? ['length', ...Object.keys(value)] : Object.keys(value);
  return keys.flatMap(key => {
    const path = `${prefix}.${key}`;
    return [path, ...paths((value as Record<string, unknown>)[key], path)];
  });
}
function intercept<T>(value: T, target: string, effect: () => void, prefix = ''): T {
  if (!value || typeof value !== 'object') return value;
  return new Proxy(value, {
    get(object, key, receiver) {
      const path = `${prefix}.${String(key)}`;
      if (path === target) effect();
      return intercept(Reflect.get(object, key, receiver), target, effect, path);
    },
  });
}

const nestedCases = [set, other].flatMap(snapshot => [
  {name: `overlap ${snapshot.revision}`, run: () => overlapVolume(snapshot, {...sphere, center: [100, 0, 0]})},
  {name: `sweep ${snapshot.revision}`, run: () => sweepVolume(snapshot, {...sphere, center: [100, 0, 0]}, [1, 0, 0])},
  {
    name: `headroom ${snapshot.revision}`,
    run: () => headroom(snapshot, {...capsule, a: [100, 0, 0], b: [100, 1, 0]}, [0, 1, 0]),
  },
  {
    name: `snapshot ${snapshot.revision}`,
    run: () => {
      const created = defineVolumeSet(input(snapshot.revision));
      return overlapVolume(created, sphere);
    },
  },
]);

const outerCases = [
  {
    name: 'sphere sweep',
    values: {body: sphere, displacement: [4, 0, 0] as const, options},
    run: (v: {body: VolumeBody; displacement: readonly [number, number, number]; options: typeof options}) =>
      sweepVolume(set, v.body, v.displacement, v.options),
  },
  {
    name: 'capsule sweep',
    values: {body: capsule, displacement: [4, 0, 0] as const, options},
    run: (v: {body: VolumeBody; displacement: readonly [number, number, number]; options: typeof options}) =>
      sweepVolume(set, v.body, v.displacement, v.options),
  },
  {
    name: 'overlap',
    values: {body: {...sphere, center: [2, 0, 0] as const}, options},
    run: (v: {body: VolumeBody; options: typeof options}) => overlapVolume(set, v.body, v.options),
  },
  {
    name: 'headroom',
    values: {body: capsule, rise: [0, 3, 0] as const, options},
    run: (v: {body: typeof capsule; rise: readonly [number, number, number]; options: typeof options}) =>
      headroom(set, v.body, v.rise, v.options),
  },
  {
    name: 'snapshot construction',
    values: input(31),
    run: (v: VolumeSetInput) => {
      const created = defineVolumeSet(v);
      return [created.revision, created.size, sweepVolume(created, sphere, [4, 0, 0])];
    },
  },
];

// A generic runner preserves each case's associated input type without widening production APIs.
function matrix<T>(entry: {name: string; values: T; run: (value: T) => unknown}) {
  const expected = entry.run(entry.values);
  for (const path of paths(entry.values)) {
    for (const nested of nestedCases) {
      let calls = 0;
      const innerExpected = nested.run();
      const wrapped = intercept(entry.values, path, () => {
        calls++;
        assert.deepEqual(nested.run(), innerExpected, `${entry.name} ${path}: inner ${nested.name}`);
      });
      assert.deepEqual(entry.run(wrapped), expected, `${entry.name} ${path}: outer after ${nested.name}`);
      assert.ok(calls > 0, `${entry.name} ${path}: accessor exercised`);
    }
  }
}
for (const entry of outerCases) {
  test(`nested query input reads preserve ${entry.name} geometry and bounds`, () => {
    // Union cases remain paired here; the cast only erases the heterogeneous test table's parameter type.
    matrix(entry as {name: string; values: unknown; run: (value: unknown) => unknown});
  });
}

test('a displacement accessor cannot turn a blocked sweep into clear', () => {
  const plain = sweepVolume(set, sphere, [4, 0, 0]);
  assert.equal(plain.status, 'hit');
  if (plain.status === 'hit') assert.equal(plain.fraction, 0.4);
  const displacement = [4, 0, 0] as [number, number, number];
  Object.defineProperty(displacement, 0, {
    get() {
      overlapVolume(other, {...sphere, center: [100, 0, 0]});
      return 4;
    },
  });
  assert.deepEqual(sweepVolume(set, sphere, displacement), plain);
});

test('throwing and malformed nested input cannot poison subsequent queries or a caught outer query', () => {
  const sentinel = new Error('creator accessor');
  const expected = sweepVolume(set, capsule, [4, 0, 0], options);
  for (const nested of [
    () => sweepVolume(other, {...sphere, radius: -1}, [1, 0, 0]),
    () => sweepVolume(other, sphere, [Infinity, 0, 0]),
    () => overlapVolume(other, sphere, {maxEvaluations: 0}),
    () => {
      throw sentinel;
    },
  ]) {
    const values = {body: capsule, displacement: [4, 0, 0] as const, options};
    for (const path of paths(values)) {
      const throwing = intercept(values, path, nested);
      assert.throws(() => sweepVolume(set, throwing.body, throwing.displacement, throwing.options));
      assert.deepEqual(sweepVolume(set, capsule, [4, 0, 0], options), expected);
      const caught = intercept(values, path, () => {
        assert.throws(nested);
        // Even a successful query before the accessor returns must not overwrite the outer body.
        overlapVolume(other, {...sphere, center: [100, 0, 0]});
      });
      assert.deepEqual(sweepVolume(set, caught.body, caught.displacement, caught.options), expected);
    }
  }
  const d = [4, 0, 0] as [number, number, number];
  Object.defineProperty(d, 0, {
    get() {
      throw sentinel;
    },
  });
  assert.throws(
    () => sweepVolume(set, sphere, d),
    error => error === sentinel,
  );
  assert.throws(() => sweepVolume(set, sphere, [NaN, 0, 0]), RangeError);
  assert.deepEqual(sweepVolume(set, capsule, [4, 0, 0], options), expected);
});
