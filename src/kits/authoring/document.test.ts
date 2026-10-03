import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../core/ecs/world';
import { authoredReference, createAuthoredDocument, type DocumentValue } from './document';
import { must } from '../../testing/must';
const limits = { maxBytes: 4096, maxNodes: 128, maxDepth: 8 };
type Placement = { objects: { id: string; incarnation: number; x: number }[] };
const placement = (v: DocumentValue): v is Placement => {
  if (!v || Array.isArray(v) || typeof v !== 'object' || !('objects' in v) || !Array.isArray(v.objects)) return false;
  const ids = new Set<string>();
  return v.objects.every(o => {
    if (!o || Array.isArray(o) || typeof o !== 'object') return false;
    if (typeof o.id !== 'string' || ids.has(o.id) || !Number.isSafeInteger(o.incarnation) || typeof o.x !== 'number' || o.x < 0) return false;
    ids.add(o.id); return true;
  });
};
const create = () => createAuthoredDocument({ id: 'layout', json: '{"objects":[{"id":"a","incarnation":0,"x":1}]}', limits, validate: placement });

test('A1 placement oracle: accepted/rejected/stale/reload preserve authored identity independently of runtime entities', () => {
  const owner = create(), old = owner.read();
  assert.equal(owner.edit(old.ticket, () => '{"objects":[{"id":"a","incarnation":0,"x":4}]}').status, 'accepted');
  assert.deepEqual(owner.read().value, { objects: [{ id: 'a', incarnation: 0, x: 4 }] });
  assert.deepEqual(old.value, { objects: [{ id: 'a', incarnation: 0, x: 1 }] });
  assert.equal(owner.edit(old.ticket, () => { throw Error('must not run'); }).status, 'stale');
  const current = owner.read();
  assert.equal(owner.edit(current.ticket, () => '{"objects":[{"id":"a","incarnation":0,"x":-1}]}').status, 'rejected');
  assert.equal(owner.read(), current);
  assert.equal(owner.edit({ ...current.ticket }, () => { throw Error('copied ticket must not run'); }).status, 'stale');
  assert.equal(owner.edit(current.ticket, () => '{"objects":[{"id":"a","incarnation":0,"x":1},{"id":"a","incarnation":0,"x":2}]}').status, 'rejected');
  assert.equal(owner.read(), current);
  const loaded = createAuthoredDocument({ id: 'layout', json: current.json, limits, validate: placement });
  assert.equal(loaded.edit(current.ticket, () => null).status, 'stale');
  const first = new World(), second = new World(); second.spawn();
  const runtimeA = first.spawn(), runtimeB = second.spawn(); assert.notEqual(runtimeA, runtimeB);
  assert.deepEqual(authoredReference('layout', must(current.value.objects[0]).id, 0), authoredReference('layout', must(loaded.read().value.objects[0]).id, 0));
  assert.notDeepEqual(authoredReference('layout', 'a', 0), authoredReference('layout', 'a', 1));
});

test('A1 unrelated dialogue oracle needs no scene fields or transform schema', () => {
  type Cards = { cards: { key: string; text: string }[] };
  const validate = (v: DocumentValue): v is Cards => !!v && !Array.isArray(v) && typeof v === 'object' && 'cards' in v && Array.isArray(v.cards)
    && v.cards.every(c => !!c && !Array.isArray(c) && typeof c === 'object' && typeof c.key === 'string' && typeof c.text === 'string');
  const owner = createAuthoredDocument({ id: 'dialogue', json: '{"cards":[{"key":"greet","text":"Hello"}]}', limits, validate });
  assert.equal(owner.edit(owner.read().ticket, value => JSON.stringify({ cards: [...value.cards, { key: 'bye', text: 'Goodbye' }] })).status, 'accepted');
  assert.deepEqual(owner.read().value, { cards: [{ key: 'greet', text: 'Hello' }, { key: 'bye', text: 'Goodbye' }] });
  assert.equal(owner.edit(owner.read().ticket, () => null).status, 'rejected');
});

test('detached deeply frozen values and callback failure cannot mutate committed data', () => {
  const owner = create(), before = owner.read();
  assert.throws(() => owner.edit(before.ticket, value => { must(value.objects[0]).x = 900; return '{}'; }), TypeError);
  assert.equal(owner.read(), before);
  assert.throws(() => owner.edit(before.ticket, () => { throw Error('creator failed'); }), /creator failed/);
  assert.equal(owner.edit(before.ticket, () => before.json).status, 'accepted');
});

test('reentrant edits are explicit busy; callback disposal prevents publication', () => {
  const owner = create(), before = owner.read();
  assert.equal(owner.edit(before.ticket, () => {
    assert.equal(owner.edit(before.ticket, () => '{}').status, 'busy');
    owner.dispose(); return before.json;
  }).status, 'retired');
  assert.equal(owner.read(), before);
  assert.equal(owner.edit(before.ticket, () => '{}').status, 'retired');
});

test('validator disposal prevents publication and exceptions leave owner usable', () => {
  let onValidate = () => {};
  const owner = createAuthoredDocument({ id: 'x', json: '0', limits, validate: (v): v is number => { onValidate(); return typeof v === 'number'; } });
  const before = owner.read(); onValidate = () => { throw Error('validation failed'); };
  assert.throws(() => owner.edit(before.ticket, () => '1'), /validation failed/); assert.equal(owner.read(), before);
  onValidate = () => owner.dispose();
  assert.equal(owner.edit(before.ticket, () => '2').status, 'retired'); assert.equal(owner.read(), before);
});

test('UTF-8, nodes, depth and nonfinite data have explicit boundaries without partial commit', () => {
  const any = (v: DocumentValue): v is DocumentValue => true;
  const owner = createAuthoredDocument({ id: 'limits', json: 'null', limits: { maxBytes: 12, maxNodes: 3, maxDepth: 1 }, validate: any });
  const before = owner.read();
  for (const json of ['"€€€€"', '[1,2,3]', '[[0]]', '1e999', '{bad']) {
    assert.throws(() => owner.edit(before.ticket, () => json)); assert.equal(owner.read(), before);
  }
  assert.equal(owner.edit(before.ticket, () => '[1,2]').status, 'accepted');
  assert.throws(() => authoredReference('x', 'a', -1));
});
