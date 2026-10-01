import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndustrialState, prepareIndustryCommand, type IndustrialState, type IndustryBounds, type IndustryCommand } from './industry';
import type { StockBatch } from '../inventory/dimensional';
const bounds: IndustryBounds = { stock: { containers: 32, batches: 32, positions: 64, changes: 64, properties: 8 }, deposits: 8, plans: 8, machines: 4, maxStepTicks: 1000 };
const batch = (id: string): StockBatch => ({ id, material: id, phase: 'solid', unit: 'g', massMg: 1000, volumeUl: 100, properties: {} });
const ore = batch('ore'), part = batch('part'), waste = batch('waste'), kit = batch('kit');
const ports = (prefix: string) => ['input', 'output', 'work', 'installed'].map(p => ({ id: `${prefix}/${p}`, maxMassMg: 1000000, maxVolumeUl: 1000000, phases: ['solid'] }));
function fresh(): IndustrialState {
 return { version: 1, stock: { version: 1, containers: [{ id: 'rover', maxMassMg: 1000000, maxVolumeUl: 1000000, phases: ['solid'] }], batches: [ore, kit], positions: [{ container: 'rover', batch: 'kit', quantity: 10 }] },
 deposits: [{ id: 'site', body: 'moon', region: 'south', batch: 'ore', remaining: 100 }], plans: [{ id: 'plan', inputs: [{ batch: 'ore', quantity: 10 }], outputs: [{ batch: part, quantity: 7 }, { batch: waste, quantity: 3 }], workJ: 10, maxPowerW: 10 }], machines: [] };
}
function construct(id = 'one'): IndustryCommand { return { kind: 'construct', machine: { id, plan: 'plan', input: `${id}/input`, output: `${id}/output`, work: `${id}/work`, installed: `${id}/installed` }, containers: ports(id), bill: [{ container: 'rover', batch: 'kit', quantity: 2 }] }; }
function accepted(s: IndustrialState, c: IndustryCommand): IndustrialState { const r = prepareIndustryCommand(s, c, bounds); assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw Error('Unexpected failed candidate'); return r.state; }
function machine(): IndustrialState {
 let s = accepted(fresh(), construct()); s = accepted(s, { kind: 'harvest', deposit: 'site', container: 'rover', quantity: 20 });
 s = accepted(s, { kind: 'transfer', from: 'rover', to: 'one/input', batch: 'ore', quantity: 20 });
 return accepted(s, { kind: 'power', machine: 'one', enabled: true });
}
const mass = (s: IndustrialState) => s.stock.positions.reduce((sum, p) => sum + p.quantity * s.stock.batches.find(b => b.id === p.batch)!.massMg, 0) + s.deposits.reduce((sum, d) => sum + d.remaining * s.stock.batches.find(b => b.id === d.batch)!.massMg, 0);
describe('composed industrial stock candidates', () => {
 it('builds a machine with real installed custody and mines only finite stock', () => {
  const original = fresh(); let s = accepted(original, construct()); assert.equal(mass(s), mass(original));
  assert.equal(s.stock.positions.find(p => p.container === 'one/installed')!.quantity, 2);
  s = accepted(s, { kind: 'harvest', deposit: 'site', container: 'rover', quantity: 100 }); assert.equal(s.deposits[0]!.remaining, 0); assert.equal(mass(s), mass(original));
  assert.deepEqual(prepareIndustryCommand(s, { kind: 'harvest', deposit: 'site', container: 'rover', quantity: 1 }, bounds), { ok: false, reason: 'depleted' });
  assert.equal(original.machines.length, 0); assert.equal(original.deposits[0]!.remaining, 100);
 });
 it('fails construction atomically when the finite bill cannot be paid', () => {
  const s = fresh(); const c = construct(); if (c.kind !== 'construct') throw Error(); c.bill[0]!.quantity = 11;
  assert.deepEqual(prepareIndustryCommand(s, c, bounds), { ok: false, reason: 'insufficient' }); assert.equal(s.stock.containers.length, 1); assert.equal(s.machines.length, 0);
 });
 it('reserves process stock, survives reload/power loss, and produces all streams together', () => {
  let s = machine(); const initial = mass(s);
  const partial = prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 4, allocatedPowerW: 10 }, bounds); assert.equal(partial.ok, true); if (!partial.ok) return;
  assert.equal(partial.workJ, 4); assert.equal(partial.state.machines[0]!.progressJ, 4);
  s = parseIndustrialState(JSON.parse(JSON.stringify(partial.state)), bounds);
  assert.equal(s.stock.positions.find(p => p.container === 'one/work')!.quantity, 10);
  assert.deepEqual(prepareIndustryCommand(s, { kind: 'transfer', from: 'one/work', to: 'rover', batch: 'ore', quantity: 1 }, bounds), { ok: false, reason: 'protected-container' });
  s = accepted(s, { kind: 'power', machine: 'one', enabled: false });
  const off = prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 100, allocatedPowerW: 10 }, bounds); assert.equal(off.ok, true); if (!off.ok) return;
  assert.equal(off.workJ, 0); assert.equal(off.state.machines[0]!.progressJ, 4);
  s = accepted(off.state, { kind: 'power', machine: 'one', enabled: true });
  const done = prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 100, allocatedPowerW: 10 }, bounds); assert.equal(done.ok, true); if (!done.ok) return;
  assert.equal(done.completed, true); assert.equal(done.workJ, 6); assert.equal(done.elapsedTicks, 6);
  assert.equal(done.state.stock.positions.find(p => p.batch === 'part')!.quantity, 7); assert.equal(done.state.stock.positions.find(p => p.batch === 'waste')!.quantity, 3);
  assert.equal(mass(done.state), initial); assert.equal(done.state.machines[0]!.completed, 1);
 });
 it('retains completed work and reserved inputs under full output, then commits once with zero extra work', () => {
  let s = machine(); s.stock.containers.find(c => c.id === 'one/output')!.maxMassMg = 9999;
  const blocked = prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 100, allocatedPowerW: 10 }, bounds); assert.equal(blocked.ok, true); if (!blocked.ok) return;
  assert.equal(blocked.blocked, 'output'); assert.equal(blocked.workJ, 10); assert.equal(blocked.state.machines[0]!.active, true);
  s = parseIndustrialState(JSON.parse(JSON.stringify(blocked.state)), bounds); s.stock.containers.find(c => c.id === 'one/output')!.maxMassMg = 10000;
  const done = prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 1, allocatedPowerW: 10 }, bounds); assert.equal(done.ok, true); if (!done.ok) return;
  assert.equal(done.workJ, 0); assert.equal(done.elapsedTicks, 0); assert.equal(done.completed, true);
  assert.equal(done.state.machines[0]!.completed, 1); assert.equal(mass(done.state), mass(machine()));
 });
 it('cancellation returns the same batch; a full return destination preserves active custody', () => {
  let s = accepted(machine(), { kind: 'step', machine: 'one', ticks: 4, allocatedPowerW: 10 });
  s.stock.containers.find(c => c.id === 'one/input')!.maxMassMg = 10000;
  assert.deepEqual(prepareIndustryCommand(s, { kind: 'cancel', machine: 'one' }, bounds), { ok: false, reason: 'capacity' });
  s.stock.containers.find(c => c.id === 'one/input')!.maxMassMg = 20000; s = accepted(s, { kind: 'cancel', machine: 'one' });
  assert.equal(s.machines[0]!.active, false); assert.equal(s.machines[0]!.progressJ, 0); assert.equal(s.stock.positions.find(p => p.container === 'one/input')!.quantity, 20);
 });
 it('preserves sub-joule work remainders and enforces bounded power and step size', () => {
  let s = machine();
  for (let i = 0; i < 9; i++) s = accepted(s, { kind: 'step', machine: 'one', ticks: 1, allocatedPowerW: 1 });
  assert.equal(s.machines[0]!.progressJ, 0); assert.equal(s.machines[0]!.energyRemainder, 9);
  s = accepted(s, { kind: 'step', machine: 'one', ticks: 1, allocatedPowerW: 1 }); assert.equal(s.machines[0]!.progressJ, 1);
  assert.deepEqual(prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 1001, allocatedPowerW: 1 }, bounds), { ok: false, reason: 'limit' });
  assert.deepEqual(prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 1, allocatedPowerW: 11 }, bounds), { ok: false, reason: 'limit' });
 });
 it('rejects unbalanced plans, forged work custody, shared private ports and malformed restored arrays', () => {
  const wrong = fresh(); wrong.plans[0]!.outputs[0]!.quantity = 8; assert.throws(() => parseIndustrialState(wrong, bounds), /unbalanced/);
  const forged = machine(); forged.machines[0]!.active = true; assert.throws(() => parseIndustrialState(forged, bounds), /custody/);
  const overlap = machine(); overlap.machines.push({ ...overlap.machines[0]!, id: 'two' }); assert.throws(() => parseIndustrialState(overlap, bounds), /container/);
  const holes = fresh(); holes.deposits = new Array(1); assert.throws(() => parseIndustrialState(holes, bounds));
 });
 it('supports a manufactured expansion bill without generating a free second machine', () => {
  let s = accepted(machine(), { kind: 'step', machine: 'one', ticks: 10, allocatedPowerW: 10 });
  const c = construct('two'); if (c.kind !== 'construct') throw Error(); c.bill = [{ container: 'one/output', batch: 'part', quantity: 7 }];
  const before = mass(s); s = accepted(s, c); assert.equal(s.machines.length, 2); assert.equal(mass(s), before);
  assert.equal(s.stock.positions.find(p => p.container === 'two/installed')!.batch, 'part');
 });
 it('rejects complete work with fractional remainder before it can return negative elapsed time', () => {
  const s = accepted(machine(), { kind: 'step', machine: 'one', ticks: 4, allocatedPowerW: 10 });
  s.machines[0]!.progressJ = 10; s.machines[0]!.energyRemainder = 9;
  assert.throws(() => parseIndustrialState(s, bounds), /invalid-progress/);
 });
 it('captures bounded array indices without executing caller iterators', () => {
  const s = fresh(); let called = false;
  Object.defineProperty(s.deposits, Symbol.iterator, { value: function* () { called = true; for (let i = 0; i < 99; i++) yield { ...s.deposits[0]!, id: String(i) }; } });
  const restored = parseIndustrialState(s, bounds); assert.equal(restored.deposits.length, 1); assert.equal(called, false);
 });
 it('rejects plans whose compound admission or completion can never fit the configured operation bound', () => {
  const s = fresh(); assert.throws(() => parseIndustrialState(s, { ...bounds, stock: { ...bounds.stock, changes: 4 } }), /plan-operation-limit/);
 });

 it('normalizes malformed stock and accounts fractional supply even if processing is cancelled', () => {
  const invalid = fresh(); (invalid.stock as { version: number }).version = 99;
  assert.deepEqual(prepareIndustryCommand(invalid, { kind: 'harvest', deposit: 'site', container: 'rover', quantity: 1 }, bounds), { ok: false, reason: 'invalid' });
  let s = machine(), delivered = 0;
  for (let i = 0; i < 9; i++) {
   const step = prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 1, allocatedPowerW: 1 }, bounds);
   assert.equal(step.ok, true); if (!step.ok) return; delivered += step.energyDeciJ; s = step.state;
  }
  assert.equal(delivered, 9); assert.equal(s.machines[0]!.progressJ, 0);
  s = accepted(s, { kind: 'cancel', machine: 'one' }); assert.equal(s.machines[0]!.energyRemainder, 0);
  assert.equal(delivered, 9); // No energy refund: enclosing supply ledger retains the debit.
 });
 it('allows passive publication of completed work during blackout, with zero supplied energy and no negative time', () => {
  let s = machine(); s.stock.containers.find(c => c.id === 'one/output')!.maxMassMg = 9999;
  s = accepted(s, { kind: 'step', machine: 'one', ticks: 20, allocatedPowerW: 10 });
  s = accepted(s, { kind: 'power', machine: 'one', enabled: false }); s.stock.containers.find(c => c.id === 'one/output')!.maxMassMg = 10000;
  const done = prepareIndustryCommand(s, { kind: 'step', machine: 'one', ticks: 1, allocatedPowerW: 0 }, bounds);
  assert.equal(done.ok, true); if (!done.ok) return;
  assert.equal(done.completed, true); assert.equal(done.elapsedTicks, 0); assert.equal(done.energyDeciJ, 0); assert.equal(done.workJ, 0);
 });

});
