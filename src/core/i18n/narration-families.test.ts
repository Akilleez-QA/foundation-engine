import test from 'node:test';
import assert from 'node:assert/strict';
import { expandNarrationFamily, narrationFamilyProblems, narrationFamilyGaps, narrationKey, narrationFamilyShape, type NarrationFamilyDef } from './narration-families';

const deep: NarrationFamilyDef = {
  id: 'narration-family.tour-deep', pattern: 'tour-deep-{stop}-{step}',
  domain: { stop: ['gate', 'tower'], step: [0, 1, 2] }, except: ['tour-deep-gate-0'],
};

test('a family expands to its full grid minus exceptions, in domain order', () => {
  assert.deepEqual(expandNarrationFamily(deep), ['tour-deep-gate-1', 'tour-deep-gate-2', 'tour-deep-tower-0', 'tour-deep-tower-1', 'tour-deep-tower-2']);
  assert.equal(narrationFamilyShape(deep.pattern), 'tour-deep-*-*');
});

test('narrationKey fills a pattern only with values from the domain', () => {
  assert.equal(narrationKey(deep, { stop: 'tower', step: 2 }), 'tour-deep-tower-2');
  assert.throws(() => narrationKey(deep, { stop: 'towers', step: 2 }), /not in the domain of \{stop\}/);
  assert.throws(() => narrationKey(deep, { stop: 'tower' }), /no value for \{step\}/);
  assert.throws(() => narrationKey(deep, { stop: 'gate', step: 0 }), /exception/);
});

test('structural problems are named', () => {
  const bad: NarrationFamilyDef = { id: 'x', pattern: 'a-{b}-{c}', domain: { b: [], d: [1] }, except: ['zzz'] };
  assert.deepEqual(narrationFamilyProblems(bad), [
    'x: id must start with "narration-family."', 'x: hole {b} has an empty domain', 'x: hole {c} has no domain',
    'x: domain "d" is not a hole in "a-{b}-{c}"',
  ]);
  assert.throws(() => expandNarrationFamily(bad));
  assert.deepEqual(narrationFamilyProblems({ id: 'narration-family.f', pattern: 'fixed', domain: {} }), ['narration-family.f: pattern "fixed" has no {holes}; a fixed key is not a family']);
  assert.deepEqual(narrationFamilyProblems({ ...deep, except: ['tour-deep-lake-0'] }), ['narration-family.tour-deep: exception "tour-deep-lake-0" is not in the family\'s grid']);
});

test('gaps list every key without text or audio in a voice', () => {
  const text = new Set(['tour-deep-gate-1', 'tour-deep-gate-2', 'tour-deep-tower-0', 'tour-deep-tower-1']);
  const gaps = narrationFamilyGaps([deep, deep], ['brave', 'curious'], k => text.has(k), (v, k) => !(v === 'curious' && k === 'tour-deep-gate-2'));
  assert.deepEqual(gaps, [
    'narration-family.tour-deep: "tour-deep-gate-2" has no audio for voice "curious"',
    'narration-family.tour-deep: "tour-deep-tower-2" has no narration text',
    'narration-family.tour-deep: declared twice',
    'narration-family.tour-deep: "tour-deep-gate-2" has no audio for voice "curious"',
    'narration-family.tour-deep: "tour-deep-tower-2" has no narration text',
  ]);
});
