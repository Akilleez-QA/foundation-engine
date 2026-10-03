import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilities, createModifiers, type CapabilityRevocation, type CapabilitySnapshot, type Grant } from './index';
import { must } from '../../testing/must';
const definitions = [
  { id: 'foundation', requires: [], evidence: ['practice'] },
  { id: 'specialist', requires: ['foundation'], evidence: [] },
  { id: 'advanced', requires: ['specialist'], evidence: [] },
];
const request = (dependents: 'reject' | 'cascade', privilegedDependents: 'include' | 'retain' = 'include'): CapabilityRevocation =>
  ({ capabilities: ['foundation'], dependents, privilegedDependents });
function trained() {
  const owner = createCapabilities(definitions);
  owner.record('practice');
  for (const definition of definitions) owner.grant({ capability: definition.id, reason: 'earned', event: `accepted:${definition.id}` });
  return owner;
}

test('respec consumer previews denial without changing possession or derived values, then cascades and restores', () => {
  const owner = trained(), modifiers = createModifiers({ capacity: 10 });
  const reconcile = () => {
    if (owner.has('specialist')) modifiers.set('specialist', [{ stat: 'capacity', add: 5, multiply: 1 }]);
    else modifiers.remove('specialist');
  };
  reconcile();
  const before = owner.snapshot(), denied = owner.previewRevocation(request('reject'));
  assert.deepEqual(denied.blocked, ['advanced', 'specialist']);
  assert.equal(owner.revoke(denied.request, denied.revision).status, 'blocked');
  assert.deepEqual(owner.snapshot(), before); assert.equal(modifiers.values().capacity, 15);
  const accepted = owner.previewRevocation(request('cascade'));
  assert.equal(owner.revoke(accepted.request, accepted.revision).status, 'revoked');
  reconcile(); assert.equal(modifiers.values().capacity, 10);
  assert.deepEqual(owner.snapshot().grants, []);
  assert.deepEqual(owner.snapshot().evidence, ['practice']);
  assert.equal(owner.eligible('foundation'), true);
  assert.deepEqual(createCapabilities(definitions, owner.snapshot()).snapshot(), owner.snapshot());
  assert.equal(owner.revoke(accepted.request, owner.revision).status, 'unchanged');
});

test('evidence and grants invalidate previews; duplicate operations do not advance revision', () => {
  const owner = trained(), plan = owner.previewRevocation(request('cascade'));
  owner.record('new-evidence');
  assert.equal(owner.revoke(plan.request, plan.revision).status, 'stale');
  assert.equal(owner.has('foundation'), true);
  const revision = owner.revision;
  owner.record('new-evidence');
  assert.equal(owner.grant({ capability: 'foundation', reason: 'earned', event: 'accepted:foundation' }), 'duplicate');
  assert.equal(owner.revision, revision);
  const fresh = createCapabilities(definitions), freshPlan = fresh.previewRevocation(request('cascade'));
  fresh.grant({ capability: 'foundation', reason: 'tutorial', event: 'accepted' });
  assert.equal(fresh.revoke(freshPlan.request, freshPlan.revision).status, 'stale');
});

test('creator explicitly retains or includes tutorial and migration dependents', () => {
  for (const reason of ['tutorial', 'migration'] as const) {
    const owner = createCapabilities(definitions);
    owner.grant({ capability: 'foundation', reason: 'tutorial', event: 'onboard' });
    owner.grant({ capability: 'specialist', reason, event: 'creator-exception' });
    owner.grant({ capability: 'advanced', reason: 'earned', event: 'practice-advanced' });
    const saved = owner.snapshot();
    const retain = owner.previewRevocation(request('reject', 'retain'));
    assert.deepEqual(retain.blocked, []);
    assert.equal(owner.revoke(retain.request, retain.revision).status, 'revoked');
    assert.equal(owner.has('specialist'), true); assert.equal(owner.has('advanced'), true);
    assert.deepEqual(owner.snapshot().grants[0], { capability: 'specialist', reason, event: 'creator-exception' });
    assert.deepEqual(createCapabilities(definitions, owner.snapshot()).snapshot(), owner.snapshot());
    const include = createCapabilities(definitions, saved), plan = include.previewRevocation(request('cascade', 'include'));
    assert.equal(include.revoke(plan.request, plan.revision).status, 'revoked');
    assert.equal(include.snapshot().grants.length, 0);
    // Retain protects dependent exceptions, not explicitly selected possession.
    assert.equal(owner.revoke({ capabilities: ['specialist'], dependents: 'cascade', privilegedDependents: 'retain' }, owner.revision).status, 'revoked');
    assert.equal(owner.has('advanced'), false);
  }
});

test('explicit removal set allows reject policy and preview is detached and frozen', () => {
  const owner = trained(), input: CapabilityRevocation = { capabilities: ['foundation', 'specialist', 'advanced'], dependents: 'reject', privilegedDependents: 'include' };
  const plan = owner.previewRevocation(input);
  (input.capabilities as string[]).length = 0;
  assert.equal(plan.request.capabilities.length, 3);
  assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.request.capabilities));
  assert.ok(Object.isFrozen(plan.removed)); assert.ok(Object.isFrozen(plan.blocked));
  assert.equal(owner.revoke(plan.request, plan.revision).status, 'revoked');
});

test('restore validates final earned dependencies independent of order and rejects malformed snapshots', () => {
  const saved = trained().snapshot(); saved.grants.reverse();
  assert.deepEqual(createCapabilities(definitions, saved).snapshot(), saved);
  const legacy = { evidence: saved.evidence, grants: saved.grants };
  assert.equal(createCapabilities(definitions, legacy).revision, 0);
  for (const invalid of [null, false, 0, '', { ...saved, revision: -1 }, { ...saved, revision: null },
    { ...saved, evidence: [] }, { ...saved, grants: saved.grants.slice(0, 2) },
    { ...saved, grants: [saved.grants[0], saved.grants[0]] }, { ...saved, grants: [{ ...saved.grants[0], reason: 'invented' }] }]) {
    assert.throws(() => createCapabilities(definitions, invalid as CapabilitySnapshot));
  }
});

test('bounded indexed capture ignores caller iteration hooks and captures provenance once', () => {
  const owner = trained();
  const selection = ['foundation'];
  selection.map = () => { throw Error('caller map'); };
  selection[Symbol.iterator] = () => { throw Error('caller iterator'); };
  const plan = owner.previewRevocation({ capabilities: selection, dependents: 'cascade', privilegedDependents: 'include' });
  assert.equal(plan.removed.length, 3);
  assert.throws(() => owner.previewRevocation({ capabilities: Array(1025).fill('foundation'), dependents: 'cascade', privilegedDependents: 'include' }));
  const invalidLength = new Proxy(selection, { get(target, key, receiver) { return key === 'length' ? NaN : Reflect.get(target, key, receiver); } });
  assert.throws(() => owner.previewRevocation({ capabilities: invalidLength, dependents: 'cascade', privilegedDependents: 'include' }));
  const clean = createCapabilities(definitions);
  let reads = 0;
  clean.grant({ capability: 'foundation', reason: 'tutorial', get event() { reads++; return 'captured'; } });
  assert.equal(reads, 1);
  assert.equal(clean.grant({ event: 'captured', reason: 'tutorial', capability: 'foundation' }), 'duplicate');
});

test('getter reentry cannot mutate the owner during capture and failed inputs leave state intact', () => {
  const owner = trained(), before = owner.snapshot();
  assert.throws(() => owner.previewRevocation({
    get capabilities() { owner.record('reentered'); return ['foundation']; },
    dependents: 'cascade', privilegedDependents: 'include',
  }), /reentrant/);
  assert.throws(() => owner.grant({ capability: 'foundation', reason: 'earned', get event() { owner.revoke(request('cascade'), owner.revision); return 'bad'; } }));
  assert.deepEqual(owner.snapshot(), before);
  assert.throws(() => owner.previewRevocation({ ...request('cascade'), privilegedDependents: undefined } as unknown as CapabilityRevocation));
  assert.throws(() => owner.revoke(request('cascade'), NaN));
  assert.deepEqual(owner.snapshot(), before);
});

test('revision exhaustion rejects changes atomically but leaves idempotent queries usable', () => {
  const saved = trained().snapshot(); saved.revision = Number.MAX_SAFE_INTEGER;
  const owner = createCapabilities(definitions, saved);
  assert.throws(() => owner.record('new'));
  assert.throws(() => owner.revoke(request('cascade'), owner.revision));
  owner.record('practice');
  assert.deepEqual(owner.snapshot(), saved);
  const emptied = createCapabilities(definitions, { evidence: [], grants: [], revision: Number.MAX_SAFE_INTEGER });
  assert.throws(() => emptied.grant({ capability: 'foundation', reason: 'tutorial', event: 'late' } as Grant));
  assert.equal(emptied.has('foundation'), false);
});

test('redundant prerequisite and evidence declarations retain compatibility with raw input bounds', () => {
  const definitions = [
    { id: 'base', requires: [], evidence: ['seen', 'seen'] },
    { id: 'derived', requires: ['base', 'base'], evidence: [] },
  ];
  const owner = createCapabilities(definitions);
  owner.record('seen');
  assert.equal(owner.grant({ capability: 'base', reason: 'earned', event: 'a' }), 'granted');
  assert.equal(owner.grant({ capability: 'derived', reason: 'earned', event: 'b' }), 'granted');
  const plan = owner.previewRevocation({ capabilities: ['base'], dependents: 'cascade', privilegedDependents: 'include' });
  assert.deepEqual(plan.removed, ['base', 'derived']);
  assert.deepEqual(createCapabilities(definitions, owner.snapshot()).snapshot(), owner.snapshot());
  assert.throws(() => createCapabilities([{ id: 'base', requires: [], evidence: Array(4097).fill('seen') }]));
  assert.throws(() => createCapabilities([must(definitions[0]), { id: 'derived', requires: Array(1025).fill('base'), evidence: [] }]));
});
