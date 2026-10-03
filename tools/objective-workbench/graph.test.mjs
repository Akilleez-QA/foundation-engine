import test from 'node:test';
import assert from 'node:assert/strict';
import {captureGraph, initialGraph, outcomeFor} from './graph.mjs';
const draft = () => structuredClone(initialGraph());
test('S1 graph captures detached bounded data and exact terminal outcomes', () => {
  const input = draft(),
    g = captureGraph(input);
  input.definition.stages[0].requirements[0].target = 9;
  assert.equal(g.definition.stages[0].requirements[0].target, 1);
  assert.ok(Object.isFrozen(g.outcomes[0]));
  assert.equal(outcomeFor(g, 'prepare', 'short').units, 1);
  assert.equal(outcomeFor(g, 'prepare', 'continue'), null);
  assert.deepEqual(captureGraph(JSON.stringify(g)), g);
});
test('S1 graph rejects invalid import, deleted referenced node, dangling edge, cycle and duplicate identity', () => {
  assert.throws(() => captureGraph('{'), /graph/);
  assert.throws(() => captureGraph(' '.repeat(131073)), /bound|limit/);
  const cases = [
    g => g.definition.stages.pop(),
    g => (g.definition.stages[0].choices[1].to = 'missing'),
    g => (g.definition.stages[0].choices[1].to = 'prepare'),
    g => g.definition.stages.push(structuredClone(g.definition.stages[0])),
    g => (g.definition.stages[0].requirements[0].target = 0),
    g => (g.definition.stages[0].unknown = true),
  ];
  for (const change of cases) {
    const g = draft();
    change(g);
    assert.throws(() => captureGraph(g));
  }
});
test('S1 outcomes cannot refer to nonterminal edges or evade integer and identity bounds', () => {
  for (const change of [
    g => g.outcomes.pop(),
    g => (g.outcomes[0].choice = 'continue'),
    g => g.outcomes.push(structuredClone(g.outcomes[0])),
    g => (g.outcomes[0].units = NaN),
    g => (g.outcomes[0].units = 9),
    g => (g.outcomes[0].capability = ''),
  ]) {
    const g = draft();
    change(g);
    assert.throws(() => captureGraph(g));
  }
});
test('S1 graph captures mutable destination getter once and rejects array overload', () => {
  const g = draft();
  let reads = 0;
  Object.defineProperty(g.definition.stages[0].choices[1], 'to', {
    get() {
      reads++;
      return reads === 1 ? 'confirm' : 'missing';
    },
    enumerable: true,
  });
  assert.equal(captureGraph(g).definition.stages[0].choices[1].to, 'confirm');
  assert.equal(reads, 1);
  g.definition.stages = Array(65);
  assert.throws(() => captureGraph(g), /array bound/);
});

test('S1 raw UTF8 import limit applies before duplicate JSON keys are discarded', () => {
  const raw = '{"version":"' + '界'.repeat(50000) + '",' + JSON.stringify(initialGraph()).slice(1);
  assert.ok(raw.length < 131072);
  assert.ok(new TextEncoder().encode(raw).length > 131072);
  assert.throws(() => captureGraph(raw), /byte limit/);
});
