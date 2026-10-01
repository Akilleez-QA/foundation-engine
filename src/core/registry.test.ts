import test from 'node:test';
import assert from 'node:assert/strict';
import { adminOf, defineRegistry, isLazy, lazy, type Registry } from './registry';
import { BootValidationError, createApp } from './app';
import { defineModule } from './module';

interface ItemDef { id: string; title: string; after?: string; oldIds?: string[] }
declare module './registry' {
  interface Registries { ktrItems: Registry<ItemDef> }
}

const itemsOwner = defineModule({
  id: 'domain.ktr-progression', version: '1.0.0',
  defines: { ktrItems: {
    validate: (s: ItemDef) => s.title ? [] : ['has no title'],
    problems: (all: readonly ItemDef[]) => [
      ...(all.some(s => s.id === 'first-trip') ? [] : ['required item first-trip is missing']),
      ...all.filter(s => s.after && !all.some(o => o.id === s.after)).map(s => ({ id: s.id, problem: `after '${s.after}', which does not exist` })),
    ],
    aliases: (s: ItemDef) => s.oldIds ?? [],
  } },
});
const itemRows = defineModule({
  id: 'feature.ktr-items', version: '1.0.0', requires: ['domain.ktr-progression'],
  register(r) {
    r.ktrItems.add({ id: 'tower', title: 'Tower', oldIds: ['old-tower'] }, 'feature.ktr-items');
    r.ktrItems.add({ id: 'Bad_Id', title: 'Bad' }, 'feature.ktr-items');
    r.ktrItems.add({ id: 'no-title', title: '' }, 'feature.ktr-items');
    r.ktrItems.add({ id: 'lake', title: 'Lake', after: 'forest' }, 'feature.ktr-items');
  },
});

test('registry: validate and problems throw in DEV, drop and report in production; aliases, duplicates and freeze', async () => {
  // DEV and test: one BootValidationError listing all four problems.
  const dev = createApp([itemRows, itemsOwner], { mode: 'dev', log() {} });
  const err = await dev.boot().then(() => null, e => e);
  assert.ok(err instanceof BootValidationError);
  assert.equal(err.problems.length, 4);
  assert.match(err.message, /Bad_Id.*not lowercase kebab-case/);
  assert.match(err.message, /no-title.*has no title/);
  assert.match(err.message, /first-trip is missing/);
  assert.match(err.message, /lake.*\(from feature\.ktr-items\).*forest/);

  // Production: the two invalid entries are dropped, the cross-entry problems are reported, boot continues.
  const prod = createApp([itemRows, itemsOwner], { mode: 'prod', log() {} });
  const report = await prod.boot();
  assert.deepEqual(prod.registries.ktrItems.all().map(s => s.id), ['tower', 'lake']);
  assert.equal(report.problems.length, 4);
  assert.equal(report.problems.filter(p => p.resolution === 'dropped').length, 2);
  assert.deepEqual(adminOf(prod.registries.ktrItems).provenance('no-title').map(p => p.action), ['add', 'drop']);

  // Aliases resolve; duplicates and post-freeze writes throw.
  assert.equal(prod.registries.ktrItems.get('old-tower').id, 'tower');
  assert.throws(() => prod.registries.ktrItems.get('nope'), /unknown id 'nope'/);
  assert.throws(() => prod.registries.ktrItems.add({ id: 'late', title: 'Late' }, 'feature.x'), /after freeze/);
  assert.ok(Object.isFrozen(prod.registries.ktrItems.all()));

  const r = defineRegistry<ItemDef>('ktr-local', { aliases: s => s.oldIds ?? [] });
  r.add({ id: 'a', title: 'A', oldIds: ['z'] }, 'feature.one');
  assert.throws(() => r.add({ id: 'a', title: 'again' }, 'feature.two'), /duplicate id 'a' from feature\.two \(first added by feature\.one\)/);
  assert.throws(() => r.add({ id: 'z', title: 'alias clash' }, 'feature.two'), /duplicate id 'z'/);
  assert.throws(() => r.add({ id: 'b', title: 'B', oldIds: ['a'] }, 'feature.two'), /alias 'a' of 'b' clashes/);
  assert.equal(r.find('b'), undefined, 'a rejected add leaves nothing behind');
  assert.equal(adminOf(r).sourceOf('z'), 'feature.one');
});

test('registry rollback undoes a source\'s rows and its patches, even after freeze for the validate phase', () => {
  const r = defineRegistry<ItemDef>('ktr-rollback', {}, 'domain.x');
  const admin = adminOf(r);
  r.add({ id: 'a', title: 'A' }, 'domain.x');
  r.add({ id: 'b', title: 'B' }, 'domain.x');
  admin.replace('a', { id: 'a', title: 'A by pack' }, 'pack.p');
  admin.remove('b', 'pack.p');
  r.add({ id: 'c', title: 'C' }, 'pack.p');
  admin.freeze();
  assert.throws(() => admin.rollback('pack.p'), /after freeze/);
  assert.equal(admin.rollback('pack.p', { afterFreeze: true }), 3);
  assert.deepEqual(r.all().map(s => `${s.id}:${s.title}`), ['a:A', 'b:B']);
  assert.equal(admin.sourceOf('b'), 'domain.x');
  assert.ok(Object.isFrozen(r.all()));

  // An edit someone else changed afterwards is left alone, and the history says so.
  const q = defineRegistry<ItemDef>('ktr-layered', {}, 'domain.x');
  q.add({ id: 'a', title: 'A' }, 'domain.x');
  adminOf(q).replace('a', { id: 'a', title: 'P' }, 'pack.p');
  adminOf(q).replace('a', { id: 'a', title: 'Q' }, 'pack.q');
  adminOf(q).rollback('pack.p');
  assert.equal(q.get('a').title, 'Q');
  assert.match(adminOf(q).provenance('a').at(-1)!.note!, /changed after pack\.p/);
});

test('lazy(): memoised, unwraps a default export, and retries after a failed load', async () => {
  let calls = 0;
  const l = lazy(async () => { calls++; return { default: (n: number) => n * 2 }; });
  assert.ok(isLazy(l));
  assert.equal(calls, 0, 'nothing loads until asked');
  const [a, b] = await Promise.all([l.load(), l.load()]);
  assert.equal(a, b);
  assert.equal(a(21), 42);
  assert.equal(calls, 1);

  let attempts = 0;
  const flaky = lazy<string>(() => { attempts++; if (attempts === 1) throw new Error('offline'); return Promise.resolve('ok'); });
  await assert.rejects(flaky.load(), /offline/);
  assert.equal(await flaky.load(), 'ok');
  assert.equal(attempts, 2);
  assert.ok(!isLazy({ load: 1 }));
});
