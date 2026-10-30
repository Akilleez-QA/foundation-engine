import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDialogue, type DialogueDefinition} from './index';
import {must} from '../../testing/must';
const definition: DialogueDefinition = {
  id: 'guide',
  start: 'hello',
  nodes: [
    {
      id: 'hello',
      text: 'guide.hello',
      options: [
        {id: 'build', text: 'guide.build', to: 'done', requires: ['sample'], effects: ['inspect']},
        {id: 'exit', text: 'guide.exit', to: null},
      ],
    },
    {id: 'done', text: 'guide.done', options: []},
  ],
};
test('dialogue choices carry session/node/revision and recheck current facts', () => {
  const d = createDialogue(definition, 'run'),
    facts = new Set(['sample']);
  const view = d.view(facts)!;
  facts.clear();
  assert.equal(d.choose({...view, option: 'build'}, facts).status, 'unavailable');
  facts.add('sample');
  assert.deepEqual(d.choose({...view, option: 'build'}, facts), {status: 'applied', effects: ['inspect']});
  assert.equal(d.choose({...view, option: 'build'}, facts).status, 'stale');
  assert.equal(d.view(facts)!.node, 'done');
  d.close();
  assert.equal(d.view(facts), null);
});
test('dialogue snapshot and authored arrays are isolated and restorable', () => {
  const def = structuredClone(definition),
    d = createDialogue(def, 'run');
  must(def.nodes[0]).options = [];
  assert.equal(d.view(new Set())!.options.length, 1);
  const snap = d.snapshot();
  snap.node = 'bogus';
  assert.equal(d.snapshot().node, 'hello');
  assert.deepEqual(createDialogue(definition, 'run', d.snapshot()).snapshot(), d.snapshot());
  assert.throws(() => createDialogue(definition, 'other', d.snapshot()));
});
test('dialogue validates graph links, duplicate IDs and exit reachability', () => {
  assert.throws(() => createDialogue({...definition, start: 'missing'}, 'run'));
  assert.throws(
    () =>
      createDialogue(
        {id: 'loop', start: 'a', nodes: [{id: 'a', text: 'a', options: [{id: 'again', text: 'again', to: 'a'}]}]},
        'run',
      ),
    /exit/,
  );
  assert.throws(() => createDialogue({...definition, nodes: [...definition.nodes, must(definition.nodes[0])]}, 'run'));
  const d = createDialogue(definition, 'run');
  assert.equal(d.choose({session: 'old', revision: 0, node: 'hello', option: 'exit'}, new Set()).status, 'stale');
  d.close();
  d.close();
  assert.equal(d.snapshot().revision, 1);
});
