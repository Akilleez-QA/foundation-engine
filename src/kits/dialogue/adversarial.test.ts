import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDialogue} from './index';
test('dialogue permission callback cannot resurrect a closed session', () => {
  const d = createDialogue(
    {
      id: 'd',
      start: 'a',
      nodes: [
        {id: 'a', text: 'text', options: [{id: 'go', text: 'go', to: 'b', requires: ['key']}]},
        {id: 'b', text: 'end', options: []},
      ],
    },
    's',
  );
  const facts = new Set(['key']);
  facts.has = () => {
    d.close();
    return true;
  };
  assert.equal(d.choose({session: 's', node: 'a', revision: 0, option: 'go'}, facts).status, 'closed');
  assert.equal(d.snapshot().node, null);
});
