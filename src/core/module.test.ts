import test from 'node:test';
import assert from 'node:assert/strict';
import { compareModuleIds, defineModule, moduleBudgetFor } from './module';
import { compareVersions, parseVersion, satisfies, splitDep } from './version';
import { createApp } from './app';
import { must } from '../testing/must';

test('module budgets: the reference tier is primary, lower tiers fall back upward, and an overrun is reported, not fatal', async () => {
  const budget = { bootMs: 5, chunkKiB: 40, ports: { medium: { bootMs: 12 } } };
  assert.equal(moduleBudgetFor(budget, 'bootMs', 'reference'), 5);
  assert.equal(moduleBudgetFor(budget, 'bootMs', 'high'), 5, 'high has no port: falls back to reference');
  assert.equal(moduleBudgetFor(budget, 'bootMs', 'medium'), 12);
  assert.equal(moduleBudgetFor(budget, 'bootMs', 'low'), 12, 'low falls back to medium');
  assert.equal(moduleBudgetFor(budget, 'chunkKiB', 'low'), 40, 'per field');
  assert.equal(moduleBudgetFor(undefined, 'bootMs', 'low'), undefined);

  // A fake clock: each install takes 8 ms.
  let t = 0;
  const slow = defineModule({ id: 'feature.slow', version: '1.0.0', budget, install() { t += 8; } });
  const fine = defineModule({ id: 'feature.fine', version: '1.0.0', budget: { bootMs: 10 }, install() { t += 8; } });
  const app = createApp([slow, fine], { mode: 'test', now: () => t, log() {} });
  const report = await app.boot();
  assert.equal(report.modules.find(m => m.id === 'feature.slow')!.status, 'installed', 'an overrun is never fatal');
  assert.equal(report.modules.find(m => m.id === 'feature.slow')!.overBudget, true);
  assert.equal(report.modules.find(m => m.id === 'feature.fine')!.overBudget, undefined);
  assert.equal(report.warnings.filter(w => w.includes('budget')).length, 1);

  // The medium column is 12 ms, so the same install is within budget there.
  t = 0;
  const medium = await createApp([{ ...slow }], { mode: 'test', now: () => t, preset: 'medium', log() {} }).boot();
  assert.equal(must(medium.modules[0], 'the module report').overBudget, undefined);
});

test('versions: semver-lite ranges and dependency strings', () => {
  assert.deepEqual(parseVersion('2'), [2, 0, 0]);
  assert.equal(parseVersion('2.x'), null);
  assert.ok(compareVersions([1, 2, 3], [1, 10, 0]) < 0);
  assert.ok(satisfies('2.3.1', '^2'));
  assert.ok(!satisfies('3.0.0', '^2'));
  assert.ok(!satisfies('2.0.0', '^2.1'));
  assert.ok(satisfies('1.4.9', '~1.4.2'));
  assert.ok(!satisfies('1.5.0', '~1.4.2'));
  assert.ok(satisfies('9.0.0', '>=1.2'));
  assert.ok(satisfies('1.2.3', '1.2.3'));
  assert.ok(!satisfies('1.2.4', '1.2.3'));
  assert.ok(satisfies('anything', '*'));
  assert.ok(!satisfies('bad', '^1'));
  assert.deepEqual(splitDep('domain.sim@^2'), { id: 'domain.sim', range: '^2' });
  assert.deepEqual(splitDep('domain.sim'), { id: 'domain.sim' });
});

test('module ids tie-break by layer prefix, then by id', () => {
  const ids = ['pack.a', 'feature.b', 'core.z', 'kits.a', 'feature.a', 'domain.x', 'platform.y', 'odd.one'];
  assert.deepEqual([...ids].sort(compareModuleIds), ['core.z', 'platform.y', 'domain.x', 'kits.a', 'feature.a', 'feature.b', 'pack.a', 'odd.one']);
});
