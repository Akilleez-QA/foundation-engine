import test from 'node:test';
import assert from 'node:assert/strict';
import { adminOf, type Registry } from './registry';
import { createApp } from './app';
import { defineModule } from './module';
import { evaluateNeeds, patch } from './patch';
import { must } from '../testing/must';

interface TrailDef { id: string; trail: string[] }
interface ShopItemDef { id: string; price: number; look: { colour: string; tags: string[] } }
declare module './registry' {
  interface Registries { ktpTrails: Registry<TrailDef>; ktpShop: Registry<ShopItemDef> }
}

const quiet = { log() {} };
const mark = (id: string, pass?: Parameters<typeof patch<'ktpTrails'>>[1]['pass'], needs?: string) =>
  patch('ktpTrails', { id, target: 'x', pass, needs, op: { kind: 'edit', edit: d => { d.trail.push(id); } } });

test('patches run in ModuleManager pass order (first → before/for/after per module in dependency order → final), honour needs, and report what they skip', async () => {
  const owner = defineModule({ id: 'domain.ktp-owner', version: '1.0.0', defines: { ktpTrails: {} },
    register(r) { r.ktpTrails.add({ id: 'x', trail: [] }, 'domain.ktp-owner'); } });
  const a = defineModule({ id: 'feature.ktp-a', version: '1.0.0', requires: ['domain.ktp-owner'],
    patches: [mark('a'), mark('a-final', 'final')] });
  const b = defineModule({ id: 'feature.ktp-b', version: '1.0.0', requires: ['feature.ktp-a'], patches: [mark('b')] });
  const z = defineModule({ id: 'pack.ktp-z', version: '1.0.0', requires: ['domain.ktp-owner'], patches: [
    mark('z-final', 'final'),
    mark('z-default'),
    mark('z-after-a', { after: 'feature.ktp-a' }),
    mark('z-before-b', { before: 'feature.ktp-b' }),
    mark('z-first', 'first'),
    mark('z-needs-missing', undefined, 'feature.ktp-missing'),
    mark('z-not-missing', undefined, '!feature.ktp-missing, feature.ktp-a | feature.ktp-missing'),
    mark('z-before-absent', { before: 'feature.ktp-absent' }),
    patch('ktpTrails', { id: 'z-no-match', target: 'nothing-*', op: { kind: 'remove' } }),
    mark('z-flag', undefined, 'flag:ktp-on'),
  ] });
  // List order is deliberately scrambled: the order comes from dependencies, then layer, then id.
  const app = createApp([z, b, owner, a], { mode: 'test', ...quiet });
  const report = await app.boot();
  assert.deepEqual(report.order, ['domain.ktp-owner', 'feature.ktp-a', 'feature.ktp-b', 'pack.ktp-z']);
  assert.deepEqual(app.registries.ktpTrails.get('x').trail,
    ['z-first', 'a', 'z-after-a', 'z-before-b', 'b', 'z-default', 'z-not-missing', 'z-final']);
  const skipped = Object.fromEntries(report.patches.skipped.map(s => [s.patch, s.reason]));
  assert.match(must(skipped['pack.ktp-z/z-needs-missing'], 'z-needs-missing'), /needs 'feature\.ktp-missing' not met/);
  assert.match(must(skipped['pack.ktp-z/z-before-absent'], 'z-before-absent'), /before:feature\.ktp-absent: that module is not installed/);
  assert.match(must(skipped['pack.ktp-z/z-no-match'], 'z-no-match'), /no entry matches nothing-\*/);
  assert.match(must(skipped['pack.ktp-z/z-flag'], 'z-flag'), /flag:ktp-on/);
  assert.deepEqual(report.patches.errors.map(e => e.patch), ['feature.ktp-a/a-final'], "'final' belongs to packs only");
  assert.deepEqual(adminOf(app.registries.ktpTrails).provenance('x').filter(p => p.action === 'patch').map(p => p.note)[0], 'pack.ktp-z/z-first');

  // A throwing patch leaves its entry untouched and is reported.
  const thrower = defineModule({ id: 'pack.ktp-throw', version: '1.0.0', requires: ['domain.ktp-owner'], patches: [
    patch('ktpTrails', { id: 'bad', target: 'x', op: { kind: 'edit', edit: d => { d.trail.push('half'); throw new Error('nope'); } } }),
  ] });
  const app2 = createApp([owner, thrower], { mode: 'test', ...quiet });
  const r2 = await app2.boot();
  assert.deepEqual(app2.registries.ktpTrails.get('x').trail, []);
  assert.equal(r2.patches.errors[0]?.error, 'nope');

  // The needs grammar: ',' and '&' are AND, '|' is OR, '!' negates.
  const has = (t: string) => t === 'a' || t === 'b';
  assert.ok(evaluateNeeds('a & b', has));
  assert.ok(evaluateNeeds('a, !c', has));
  assert.ok(evaluateNeeds('c | b', has));
  assert.ok(!evaluateNeeds('a & c', has));
  assert.throws(() => evaluateNeeds('a & !', has), /empty term/);
});

test('the first content pack: a seasonal shop that edits, copies and removes entries it does not own, gated by a flag', async () => {
  const shopRows: ShopItemDef[] = [
    { id: 'hat-plain', price: 3, look: { colour: 'grey', tags: ['hat'] } },
    { id: 'hat-summer', price: 2, look: { colour: 'yellow', tags: ['hat', 'summer'] } },
    { id: 'scarf', price: 4, look: { colour: 'red', tags: ['neck'] } },
  ];
  const shop = defineModule({ id: 'feature.ktp-shop', version: '2.1.0', defines: { ktpShop: {} },
    register(r) { for (const row of shopRows) r.ktpShop.add(row, 'feature.ktp-shop'); } });
  const seasonal = defineModule({ id: 'pack.ktp-seasonal-shop', version: '1.0.0', requires: ['feature.ktp-shop@^2'], patches: [
    patch('ktpShop', { id: 'halloween-prices', target: 'hat-*', needs: 'flag:ktp-halloween', op: { kind: 'merge', merge: { price: 1, look: { colour: 'orange' } } } }),
    patch('ktpShop', { id: 'witch-hat', target: 'hat-plain', needs: 'flag:ktp-halloween',
      op: { kind: 'copy', as: 'hat-witch', edit: d => { d.look.tags.push('halloween'); d.price = 5; } } }),
    patch('ktpShop', { id: 'no-summer', target: 'hat-summer', needs: 'flag:ktp-halloween', op: { kind: 'remove' } }),
  ] });

  const off = createApp([seasonal, shop], { mode: 'test', flag: () => false, ...quiet });
  const offReport = await off.boot();
  assert.deepEqual(off.registries.ktpShop.all().map(i => `${i.id}:${i.price}`), ['hat-plain:3', 'hat-summer:2', 'scarf:4']);
  assert.equal(offReport.patches.skipped.length, 3);

  const on = createApp([seasonal, shop], { mode: 'test', flag: id => id === 'ktp-halloween', ...quiet });
  const report = await on.boot();
  const items = on.registries.ktpShop;
  assert.deepEqual(items.all().map(i => `${i.id}:${i.price}:${i.look.colour}`), ['hat-plain:1:orange', 'scarf:4:red', 'hat-witch:5:orange']);
  assert.deepEqual(items.get('hat-witch').look.tags, ['hat', 'halloween']);
  assert.deepEqual(items.get('hat-plain').look.tags, ['hat'], 'the copy does not share arrays with its source');
  const firstRow = must(shopRows[0], 'the first shop row');
  assert.equal(firstRow.price, 3, 'authored content objects are never mutated');
  assert.equal(firstRow.look.colour, 'grey');
  assert.equal(adminOf(items).sourceOf('hat-witch'), 'pack.ktp-seasonal-shop');
  assert.deepEqual(adminOf(items).provenance('hat-summer').map(p => `${p.action}:${p.source}`), ['add:feature.ktp-shop', 'patch:pack.ktp-seasonal-shop', 'remove:pack.ktp-seasonal-shop']);
  assert.deepEqual(report.patches.applied.map(p => p.patch), [
    'pack.ktp-seasonal-shop/halloween-prices', 'pack.ktp-seasonal-shop/witch-hat', 'pack.ktp-seasonal-shop/no-summer']);

  // The same pack against an out-of-range shop is disabled, not fatal.
  const oldShop = { ...shop, version: '1.9.0' };
  const r3 = await createApp([seasonal, oldShop], { mode: 'test', ...quiet }).boot();
  assert.equal(r3.modules.find(m => m.id === 'pack.ktp-seasonal-shop')!.status, 'disabled');
  assert.match(r3.modules.find(m => m.id === 'pack.ktp-seasonal-shop')!.reason!, /requires feature\.ktp-shop@\^2, found feature\.ktp-shop@1\.9\.0/);
});
