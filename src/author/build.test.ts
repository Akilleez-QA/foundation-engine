import test from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import { briefProblems, defineBuild, TIER, type BuildInput } from './build';
const input = (): BuildInput => ({
  goal: 'Build a precise experience',
  pitch: 'A creator chooses the requirements',
  genre: 'custom',
  coreLoop: ['Explore'],
  devices: { targets: ['desktop'], minimum: 'desktop', input: ['keyboard'] },
  success: [{ id: 'S1', check: 'The chosen scene becomes visible', how: 'manual' }],
});

test('creator contract versions resolved defaults without capping explicit creator targets', () => {
  const b = input();
  b.performance = { fps: 120, firstLoadKiB: 2048, perScene: { draws: 900, textureMiB: 0, triangles: 0, heapMiB: 0 }, heapMiB: 0 };
  const result = defineBuild(b);
  assert.equal(result.contractVersion, 1);
  assert.equal(result.performance.fps, 120);
  assert.equal(result.performance.firstLoadKiB, 2048);
  assert.deepEqual(result.performance.perScene, { draws: 900, triangles: 0, textureMiB: 0, heapMiB: 0 });
  assert.equal(result.performance.loadMs, TIER.desktop.loadMs);
  assert.deepEqual(result.devices.targets, ['desktop']);
  assert.equal(result.policy, 'default');
  assert.deepEqual(result.modes, ['play']);
});

test('resolved contract is deeply frozen and detached without freezing creator-owned inputs', () => {
  const b = input();
  b.audience = { ages: [3, 90], kids: true, flags: ['readable'], notes: 'Mixed experience' };
  b.quality = { tier: 'high', views: [{ id: 'arrival', scene: 'start', mode: 'reviewed' }] };
  b.constraints = { content: ['No ads'], ip: ['Original'] };
  b.modes = ['play'];
  b.pedagogy = { maxPassiveActions: 0 };
  b.kidSafe = { maxRepeat: 2 };
  b.performance = { perScene: { draws: 5 } };
  const result = defineBuild(b);
  const before = JSON.stringify(result);
  const mutate = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) mutate(child);
      value.push('changed');
      return;
    }
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const obj = value as Record<string, unknown>;
        if (obj[key] && typeof obj[key] === 'object') mutate(obj[key]);
        else obj[key] = 'changed';
      }
    }
  };
  mutate(b);
  assert.equal(JSON.stringify(result), before);
  const frozen = (value: unknown): void => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      for (const child of Object.values(value)) frozen(child);
      assert.throws(() => Object.defineProperty(value, 'extra', { value: true }), TypeError);
    }
  };
  frozen(result);
  frozen(TIER);
  assert.equal(defineBuild(input()).performance.perScene.draws, 400);
});

test('invalid numeric creator declarations are diagnosed rather than silently clamped', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, Number.MAX_VALUE]) {
    for (const key of ['fps', 'loadMs', 'firstLoadKiB', 'heapMiB'] as const) {
      const b = input();
      b.performance = { [key]: bad };
      assert.ok(briefProblems(b).some(p => p.includes(key)));
      assert.throws(() => defineBuild(b), /build brief:/);
    }
  }
  for (const key of ['fps', 'loadMs', 'firstLoadKiB'] as const) {
    const b = input();
    b.performance = { [key]: 0 };
    assert.ok(briefProblems(b).length);
  }
  for (const key of ['draws', 'triangles'] as const) {
    const b = input();
    b.performance = { perScene: { [key]: 1.5 } };
    assert.ok(briefProblems(b).length);
  }
  const fractional = input();
  fractional.audience = { ages: [2.5, 5] };
  fractional.performance = { loadMs: 10.5, heapMiB: .25, perScene: { textureMiB: .5 } };
  assert.deepEqual(briefProblems(fractional), []);
  for (const ages of [[NaN, 5], [2, Infinity], [5, 3], [-1, 2]]) {
    const b = input();
    b.audience = { ages: ages as [number, number] };
    assert.ok(briefProblems(b).length);
  }
});

test('unsupported runtime declaration shapes and enums produce actionable problems', () => {
  for (const bad of [
    null, undefined, [], 42,
    { ...input(), devices: null },
    { ...input(), coreLoop: null },
    { ...input(), success: [null] },
    { ...input(), success: [{ id: Symbol('bad'), check: 2, how: null }] },
    { ...input(), quality: { views: [null] } },
    { ...input(), performance: { perScene: [] } },
  ]) {
    assert.ok(briefProblems(bad).length);
    assert.throws(() => defineBuild(bad as BuildInput), /^Error: build brief:/);
  }
  for (const patch of [
    { devices: { targets: ['watch'], minimum: 'watch', input: ['keyboard'] } },
    { devices: { targets: ['desktop', 'desktop'], minimum: 'desktop', input: ['telepathy'] } },
    { quality: { tier: 'ultra' } },
    { quality: { views: [
      { id: 'x', scene: 'a', mode: 'identical' },
      { id: 'x', scene: 'b', mode: 'near' },
    ] } },
    { success: [{ id: 'S1', check: 'A valid explanation of behavior', how: 'trust' }] },
  ]) {
    assert.ok(briefProblems({ ...input(), ...patch }).length);
  }
});

test('sparse declarations cannot bypass string lists or age validation', () => {
  for (const patch of [
    { coreLoop: Array(1) },
    { devices: { ...input().devices, input: Array(1) } },
    { devices: { ...input().devices, targets: Array(1) } },
    { audience: { ages: Array(2) } },
    { audience: { flags: Array(1) } },
    { constraints: { content: Array(1) } },
    { modes: Array(1) },
  ]) {
    const declaration = { ...input(), ...patch };
    assert.ok(briefProblems(declaration).length);
    assert.throws(() => defineBuild(declaration as BuildInput), /build brief:/);
  }
});


test('creator may omit named modes, forbid repetition and declare an audience starting at zero', () => {
  const declaration = input();
  declaration.modes = [];
  declaration.kidSafe = { maxRepeat: 0 };
  declaration.audience = { ages: [0, 1.5] };
  assert.deepEqual(briefProblems(declaration), []);
  const brief = defineBuild(declaration);
  assert.deepEqual(brief.modes, []);
  assert.equal(brief.kidSafe.maxRepeat, 0);
  assert.deepEqual(brief.audience.ages, [0, 1.5]);
  assert.equal(brief.policy, 'default');
  assert.deepEqual(defineBuild(input()).modes, ['play'], 'omission retains stock defaults');
});

test('success criteria accept terse numeric and non-space-delimited text without weakening their identity or evidence contract', () => {
  for (const check of ['FPS ≥ 60', 'No uncaught exceptions', '所有按钮均可操作']) {
    const b = input();
    b.success = [{ id: 'S1', check, how: 'test', by: 'game/acceptance.test.ts' }];
    assert.deepEqual(briefProblems(b), []);
    assert.equal(must(defineBuild(b).success[0], 'criterion').check, check, 'authored text is preserved verbatim');
    assert.ok(briefProblems({ ...b, success: [{ id: 'S1', check, how: 'test' }] }).some(p => p.includes('name the file')));
    assert.ok(briefProblems({ ...b, success: [{ id: 'invalid id', check, how: 'manual' }] }).some(p => p.includes('UPPER-KEBAB')));
    assert.ok(briefProblems({ ...b, success: [{ id: 'S1', check, how: 'unknown' }] }).some(p => p.includes('verification method')));
  }
});

test('success criterion text still rejects empty, whitespace-only and nonstring values', () => {
  for (const check of ['', ' \n\t ', '\u3000', null, 60]) {
    const b = { ...input(), success: [{ id: 'S1', check, how: 'manual' }] };
    assert.ok(briefProblems(b).some(p => /S1: provide nonempty success criterion text/.test(p)));
    assert.throws(() => defineBuild(b as BuildInput), /nonempty success criterion text/);
  }
});
