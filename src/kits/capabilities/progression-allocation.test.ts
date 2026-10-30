import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  createProgressionState,
  deriveProgressionGrants,
  parseProgressionRules,
  parseProgressionState,
  prepareProgressionChange,
  type ProgressionBounds,
  type ProgressionChange,
  type ProgressionRules,
  type ProgressionState,
} from './progression';
import {must} from '../../testing/must';
const bounds: ProgressionBounds = {xpTypes: 8, skills: 16, prerequisites: 32, grants: 32, learned: 8};
const rules: ProgressionRules = {
  id: 'training-v1',
  allocationLimit: 6,
  xpTypes: [
    {id: 'field', maxBalance: 1000},
    {id: 'craft', maxBalance: 1000},
  ],
  skills: [
    {
      id: 'survey',
      xpType: 'field',
      xpCost: 100,
      pointCost: 2,
      requires: [],
      certificates: ['scanner'],
      schematics: ['beacon'],
    },
    {
      id: 'analysis',
      xpType: 'field',
      xpCost: 200,
      pointCost: 3,
      requires: ['survey'],
      certificates: ['assay'],
      schematics: ['beacon'],
    },
    {
      id: 'fabrication',
      xpType: 'craft',
      xpCost: 150,
      pointCost: 3,
      requires: [],
      certificates: ['scanner', 'machine'],
      schematics: ['beacon', 'fixture'],
    },
  ],
};
const clone = <T>(value: T): T => structuredClone(value);
function accept(s: ProgressionState, c: ProgressionChange, r = rules, b = bounds): ProgressionState {
  const before = clone(s),
    commandBefore = clone(c),
    result = prepareProgressionChange(s, c, r, b);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(s, before);
  assert.deepEqual(c, commandBefore);
  assert.deepEqual(parseProgressionState(JSON.parse(JSON.stringify(result.state)), r, b), result.state);
  assert.deepEqual(deriveProgressionGrants(result.state, r, b), result.grants);
  return result.state;
}
function funded(): ProgressionState {
  let s = createProgressionState(rules, bounds);
  s = accept(s, {kind: 'earn', xpType: 'field', amount: 500});
  return accept(s, {kind: 'earn', xpType: 'craft', amount: 500});
}
const balance = (s: ProgressionState, type: string) => s.xp.find(x => x.type === type)!.balance;
function reject(s: ProgressionState, c: ProgressionChange, reason: string, r = rules, b = bounds) {
  const before = clone(s);
  assert.deepEqual(prepareProgressionChange(s, c, r, b), {ok: false, reason});
  assert.deepEqual(s, before);
}
describe('persistent skill allocation candidates', () => {
  it('mixes authored branches using separate XP types, preserves inputs, and restores canonical data', () => {
    let s = funded();
    s = accept(s, {kind: 'learn', skill: 'survey'});
    s = accept(s, {kind: 'learn', skill: 'fabrication'});
    assert.deepEqual(s.learned, ['fabrication', 'survey']);
    assert.equal(s.spentAllocation, 5);
    assert.equal(balance(s, 'field'), 400);
    assert.equal(balance(s, 'craft'), 350);
    assert.deepEqual(deriveProgressionGrants(s, rules, bounds), {
      certificates: ['machine', 'scanner'],
      schematics: ['beacon', 'fixture'],
    });
    const restored = parseProgressionState(
      {...s, xp: [...s.xp].reverse(), learned: [...s.learned].reverse()},
      rules,
      bounds,
    );
    assert.deepEqual(restored, s);
    restored.learned.length = 0;
    must(restored.xp[0]).balance = 0;
    assert.equal(s.learned.length, 2);
    assert.equal(balance(s, 'craft'), 350);
  });
  it('respec refuses dependent surrender, refunds points only, and charges XP again on relearning', () => {
    let s = funded();
    reject(s, {kind: 'learn', skill: 'analysis'}, 'prerequisites');
    s = accept(s, {kind: 'learn', skill: 'survey'});
    s = accept(s, {kind: 'learn', skill: 'analysis'});
    reject(s, {kind: 'surrender', skill: 'survey'}, 'dependent');
    s = accept(s, {kind: 'surrender', skill: 'analysis'});
    assert.equal(s.spentAllocation, 2);
    assert.equal(balance(s, 'field'), 200);
    s = accept(s, {kind: 'surrender', skill: 'survey'});
    assert.equal(s.spentAllocation, 0);
    assert.equal(balance(s, 'field'), 200);
    s = accept(s, {kind: 'learn', skill: 'fabrication'});
    s = accept(s, {kind: 'learn', skill: 'survey'});
    assert.equal(s.spentAllocation, 5);
    assert.equal(balance(s, 'field'), 100);
  });
  it('retains shared certificates and schematics until their last granting skill is surrendered', () => {
    let s = accept(accept(funded(), {kind: 'learn', skill: 'survey'}), {kind: 'learn', skill: 'fabrication'});
    s = accept(s, {kind: 'surrender', skill: 'fabrication'});
    assert.deepEqual(deriveProgressionGrants(s, rules, bounds), {certificates: ['scanner'], schematics: ['beacon']});
    s = accept(s, {kind: 'surrender', skill: 'survey'});
    assert.deepEqual(deriveProgressionGrants(s, rules, bounds), {certificates: [], schematics: []});
  });
  it('rejects repeat learning/surrender and unknown commands without charging any XP', () => {
    let s = funded();
    reject(s, {kind: 'surrender', skill: 'survey'}, 'not-learned');
    s = accept(s, {kind: 'learn', skill: 'survey'});
    reject(s, {kind: 'learn', skill: 'survey'}, 'already-learned');
    reject(s, {kind: 'learn', skill: 'missing'}, 'unknown');
    reject(s, {kind: 'earn', xpType: 'missing', amount: 1}, 'unknown');
    reject(s, {kind: 'invented'} as unknown as ProgressionChange, 'invalid');
  });
  it('cannot fund a skill from the wrong XP balance or exceed the shared allocation ceiling', () => {
    let s = accept(createProgressionState(rules, bounds), {kind: 'earn', xpType: 'craft', amount: 500});
    reject(s, {kind: 'learn', skill: 'survey'}, 'insufficient-xp');
    s = accept(funded(), {kind: 'learn', skill: 'survey'});
    s = accept(s, {kind: 'learn', skill: 'analysis'});
    reject(s, {kind: 'learn', skill: 'fabrication'}, 'allocation');
    reject(funded(), {kind: 'learn', skill: 'survey'}, 'limit', rules, {...bounds, learned: 0});
  });
  it('spends typed XP and deliberately leaves repeat earn deduplication to the enclosing world', () => {
    let s = createProgressionState(rules, bounds);
    s = accept(s, {kind: 'earn', xpType: 'field', amount: 50});
    s = accept(s, {kind: 'earn', xpType: 'field', amount: 50});
    assert.equal(balance(s, 'field'), 100);
    s = accept(s, {kind: 'spend', xpType: 'field', amount: 40});
    assert.equal(balance(s, 'field'), 60);
    reject(s, {kind: 'spend', xpType: 'field', amount: 61}, 'insufficient-xp');
    reject(s, {kind: 'earn', xpType: 'field', amount: 941}, 'xp-capacity');
    assert.equal(balance(accept(s, {kind: 'earn', xpType: 'field', amount: 940}), 'field'), 1000);
  });
  it('never rounds balances or allocations beyond safe integer capacity', () => {
    const r = clone(rules);
    r.allocationLimit = Number.MAX_SAFE_INTEGER;
    must(r.xpTypes[0]).maxBalance = Number.MAX_SAFE_INTEGER;
    must(r.skills[0]).pointCost = Number.MAX_SAFE_INTEGER;
    must(r.skills[1]).pointCost = 1;
    let s = createProgressionState(r, bounds);
    s = accept(s, {kind: 'earn', xpType: 'field', amount: Number.MAX_SAFE_INTEGER}, r);
    reject(s, {kind: 'earn', xpType: 'field', amount: 1}, 'xp-capacity', r);
    s = accept(s, {kind: 'learn', skill: 'survey'}, r);
    reject(s, {kind: 'learn', skill: 'analysis'}, 'allocation', r);
    assert.equal(balance(s, 'field'), Number.MAX_SAFE_INTEGER - 100);
    for (const amount of [NaN, Infinity, -1, 0.1, 0, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      reject(s, {kind: 'earn', xpType: 'field', amount} as ProgressionChange, 'invalid', r);
    }
  });
  it('rejects corrupt saved allocation, prerequisites, XP rows, versions and rules identities', () => {
    const s = accept(funded(), {kind: 'learn', skill: 'survey'});
    for (const corrupt of [
      null,
      [],
      {},
      {...s, version: 2},
      {...s, rulesId: 'different'},
      {...s, spentAllocation: 0},
      {...s, spentAllocation: Number.MAX_SAFE_INTEGER + 1},
      {...s, learned: ['analysis'], spentAllocation: 3},
      {...s, learned: ['survey', 'survey']},
      {...s, learned: ['missing']},
      {...s, xp: s.xp.slice(1)},
      {...s, xp: [s.xp[0], s.xp[0]]},
      {...s, xp: [{type: 'craft', balance: -1}, s.xp[1]]},
      {...s, xp: [{type: 'craft', balance: 1001}, s.xp[1]]},
      {...s, xp: [{type: 'other', balance: 0}, s.xp[1]]},
      {...s, grants: ['forged']},
    ]) {
      assert.throws(() => parseProgressionState(corrupt, rules, bounds));
      assert.equal(
        prepareProgressionChange(corrupt, {kind: 'earn', xpType: 'field', amount: 1}, rules, bounds).ok,
        false,
      );
    }
  });
  it('validates all authored types, missing prerequisites, duplicate IDs, cycles and bounds', () => {
    const variants: ProgressionRules[] = [];
    let r = clone(rules);
    must(r.skills[0]).requires = ['analysis'];
    variants.push(r);
    r = clone(rules);
    must(r.skills[0]).requires = ['survey'];
    variants.push(r);
    r = clone(rules);
    must(r.skills[0]).requires = ['missing'];
    variants.push(r);
    r = clone(rules);
    must(r.skills[0]).xpType = 'missing';
    variants.push(r);
    r = clone(rules);
    must(r.skills[0]).pointCost = 0.5;
    variants.push(r);
    r = clone(rules);
    must(r.skills[0]).xpCost = -1;
    variants.push(r);
    r = clone(rules);
    must(r.skills[0]).certificates.push('scanner');
    variants.push(r);
    r = clone(rules);
    r.skills.push(must(r.skills[0]));
    variants.push(r);
    r = clone(rules);
    r.xpTypes.push(must(r.xpTypes[0]));
    variants.push(r);
    for (const invalid of variants) assert.throws(() => parseProgressionRules(invalid, bounds));
    for (const b of [
      {...bounds, xpTypes: 1},
      {...bounds, skills: 2},
      {...bounds, prerequisites: 0},
      {...bounds, grants: 1},
      {...bounds, learned: NaN},
    ])
      assert.throws(() => parseProgressionRules(rules, b));
    const detached = parseProgressionRules(rules, bounds);
    must(detached.skills[0]).requires.length = 0;
    assert.deepEqual(must(rules.skills[1]).requires, ['survey']);
  });
  it('rejects sparse arrays and ignores supplied array iteration methods during indexed capture', () => {
    const s = funded();
    for (const corrupt of [
      {...s, xp: new Array(2)},
      {...s, learned: new Array(1)},
    ]) {
      assert.deepEqual(prepareProgressionChange(corrupt, {kind: 'learn', skill: 'survey'}, rules, bounds), {
        ok: false,
        reason: 'invalid',
      });
    }
    const r = clone(rules);
    must(r.skills[0]).certificates = new Array(1);
    assert.throws(() => parseProgressionRules(r, bounds));
    const guarded = clone(rules);
    guarded.skills.map = () => {
      throw Error('caller map');
    };
    guarded.skills[Symbol.iterator] = () => {
      throw Error('caller iterator');
    };
    assert.equal(parseProgressionRules(guarded, bounds).skills.length, 3);
    guarded.skills = new Proxy(guarded.skills, {
      get(target, key, receiver) {
        return key === 'length' ? NaN : Reflect.get(target, key, receiver);
      },
    });
    assert.throws(() => parseProgressionRules(guarded, bounds));
  });
  it('supports zero-cost skills, empty rules, and special IDs as data', () => {
    const r = clone(rules);
    must(r.skills[0]).xpCost = 0;
    must(r.skills[0]).pointCost = 0;
    let s = accept(createProgressionState(r, bounds), {kind: 'learn', skill: 'survey'}, r);
    assert.equal(s.spentAllocation, 0);
    s = accept(s, {kind: 'surrender', skill: 'survey'}, r);
    assert.equal(balance(s, 'field'), 0);
    const empty = {id: 'empty', allocationLimit: 0, xpTypes: [], skills: []};
    const zero = {xpTypes: 0, skills: 0, prerequisites: 0, grants: 0, learned: 0};
    assert.deepEqual(parseProgressionState(createProgressionState(empty, zero), empty, zero).learned, []);
    must(r.xpTypes[0]).id = '__proto__';
    must(r.skills[0]).xpType = '__proto__';
    must(r.skills[1]).xpType = '__proto__';
    s = accept(createProgressionState(r, bounds), {kind: 'earn', xpType: '__proto__', amount: 1}, r);
    assert.equal(balance(s, '__proto__'), 1);
  });
  it('validates a deep DAG iteratively and prevents surrender anywhere below a learned dependent', () => {
    const count = 12000,
      r: ProgressionRules = {
        id: 'deep',
        allocationLimit: count,
        xpTypes: [{id: 'xp', maxBalance: 0}],
        skills: Array.from({length: count}, (_, i) => ({
          id: `s${i}`,
          xpType: 'xp',
          xpCost: 0,
          pointCost: 1,
          requires: i ? [`s${i - 1}`] : [],
          certificates: [],
          schematics: [],
        })),
      };
    const b = {xpTypes: 1, skills: count, prerequisites: count, grants: 0, learned: count};
    const s = {...createProgressionState(r, b), learned: r.skills.map(s => s.id), spentAllocation: count};
    reject(s, {kind: 'surrender', skill: 's0'}, 'dependent', r, b);
    assert.equal(accept(s, {kind: 'surrender', skill: `s${count - 1}`}, r, b).spentAllocation, count - 1);
  });
});
