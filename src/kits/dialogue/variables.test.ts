import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDialogue, DIALOGUE_LIMITS, type DialogueCondition, type DialogueDefinition} from './index';
import {defineSaveSection} from '../../author';
import {authorSaveHandle} from '../../author/save-handle';
import {createSaveStore} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';
import {must} from '../../testing/must';

const shop: DialogueDefinition = {
  id: 'shop',
  start: 'hello',
  variables: {coins: 3, friendly: false, title: 'traveller'},
  nodes: [
    {
      id: 'hello',
      text: 'shop.hello',
      options: [
        {
          id: 'buy',
          text: 'shop.buy',
          to: 'hello',
          when: {var: 'coins', op: 'ge', value: 2},
          set: [{var: 'coins', op: 'add', value: -2}],
          effects: ['give-item'],
        },
        {
          id: 'chat',
          text: 'shop.chat',
          to: 'hello',
          when: {not: {var: 'friendly', op: 'eq', value: true}},
          set: [
            {var: 'friendly', op: 'set', value: true},
            {var: 'title', op: 'set', value: 'friend'},
          ],
        },
        {
          id: 'again',
          text: 'shop.again',
          to: 'regular',
          when: {
            all: [
              {visits: 'hello', op: 'ge', value: 3},
              {any: [{fact: 'daytime'}, {var: 'friendly', op: 'eq', value: true}]},
            ],
          },
        },
        {id: 'bye', text: 'shop.bye', to: null},
      ],
    },
    {id: 'regular', text: 'shop.regular', options: []},
  ],
};
const ids = (d: ReturnType<typeof createDialogue>, facts = new Set<string>()) => d.view(facts)!.options.map(o => o.id);
const pick = (d: ReturnType<typeof createDialogue>, option: string, facts = new Set<string>()) =>
  d.choose({...d.view(facts)!, option}, facts);

test('variables gate options, assignments apply atomically with the move, visits count entries', () => {
  const d = createDialogue(shop, 'run');
  assert.deepEqual(ids(d), ['buy', 'chat', 'bye']);
  assert.deepEqual(d.view(new Set())!.variables, {coins: 3, friendly: false, title: 'traveller'});
  assert.deepEqual(pick(d, 'buy'), {status: 'applied', effects: ['give-item']});
  assert.equal(d.variables().coins, 1);
  assert.deepEqual(ids(d), ['chat', 'bye'], 'not enough coins any more');
  assert.equal(pick(d, 'chat').status, 'applied');
  assert.deepEqual(d.variables(), {coins: 1, friendly: true, title: 'friend'});
  assert.equal(d.visits('hello'), 3);
  assert.equal(d.visits('regular'), 0);
  assert.equal(d.visits('nope'), 0);
  assert.deepEqual(ids(d), ['again', 'bye']);
  assert.equal(pick(d, 'again').status, 'applied');
  assert.equal(d.visits('regular'), 1);
  // Conditions are rechecked at choose time against current values: a stale view's option is unavailable.
  const e = createDialogue(shop, 'run'),
    view = e.view(new Set())!;
  e.choose({...view, option: 'buy'}, new Set());
  const next = e.view(new Set())!;
  e.choose({...next, option: 'chat'}, new Set());
  assert.equal(e.choose({...e.view(new Set())!, option: 'buy'}, new Set()).status, 'unavailable');
});

test('facts still combine with variables; an overflowing addition changes nothing', () => {
  const d = createDialogue(shop, 'run', {
    definition: 'shop',
    session: 'run',
    node: 'hello',
    revision: 0,
    variables: {coins: 0, friendly: false, title: 'x'},
    visits: {hello: 5},
  });
  assert.deepEqual(ids(d), ['chat', 'bye']);
  assert.deepEqual(ids(d, new Set(['daytime'])), ['chat', 'again', 'bye']);
  const big: DialogueDefinition = {
    id: 'big',
    start: 'a',
    variables: {n: Number.MAX_SAFE_INTEGER - 1},
    nodes: [
      {
        id: 'a',
        text: 'a',
        options: [
          {id: 'inc', text: 'inc', to: 'a', set: [{var: 'n', op: 'add', value: 1}]},
          {id: 'x', text: 'x', to: null},
        ],
      },
    ],
  };
  const b = createDialogue(big, 's');
  assert.equal(pick(b, 'inc').status, 'applied');
  const before = b.snapshot();
  assert.equal(pick(b, 'inc').status, 'overflow');
  assert.deepEqual(b.snapshot(), before);
});

test('variables and visits survive a real save section and a fresh store reload', () => {
  const section = defineSaveSection({id: 'dialogue.shop', scope: 'device', initial: {json: ''}});
  const backend = new MemoryBackend();
  const store = (tab: number) =>
    createSaveStore({
      local: backend.port(tab),
      session: new MemoryBackend().port(tab, 'session'),
      namespace: 'dialogue-test',
      build: 'test',
      timers: {set: () => 0, clear: () => {}, now: () => 0},
    });
  const d = createDialogue(shop, 'run');
  pick(d, 'buy');
  pick(d, 'chat');
  const first = store(0);
  assert.equal(
    authorSaveHandle(first, section).update(
      s => {
        s.json = JSON.stringify(d.snapshot());
      },
      {now: true},
    ),
    'saved',
  );
  first.dispose();
  const second = store(1);
  const restored = createDialogue(shop, 'run', JSON.parse(authorSaveHandle(second, section).get().json));
  assert.deepEqual(restored.snapshot(), d.snapshot());
  assert.deepEqual(ids(restored), ids(d));
  second.dispose();
});

test('first-version snapshots restore with initial variables and one visit to the current node', () => {
  const r = createDialogue(shop, 'run', {definition: 'shop', session: 'run', node: 'hello', revision: 4});
  assert.deepEqual(r.variables(), {coins: 3, friendly: false, title: 'traveller'});
  assert.equal(r.visits('hello'), 1);
  assert.equal(r.snapshot().revision, 4);
  // A definition without variables behaves exactly as before.
  const plain = createDialogue(
    {id: 'p', start: 'a', nodes: [{id: 'a', text: 'a', options: [{id: 'x', text: 'x', to: null}]}]},
    's',
  );
  assert.deepEqual(plain.snapshot(), {
    definition: 'p',
    session: 's',
    node: 'a',
    revision: 0,
    variables: {},
    visits: {a: 1},
  });
});

test('snapshots with unknown, retyped or malformed variables and visits are refused', () => {
  const base = {definition: 'shop', session: 'run', node: 'hello', revision: 0};
  const bad = [
    {...base, variables: {coins: '3'}},
    {...base, variables: {gone: 1}},
    {...base, variables: {coins: 1.5}},
    {...base, variables: []},
    {...base, visits: {nope: 1}},
    {...base, visits: {hello: -1}},
    {...base, visits: {hello: 0.5}},
    {...base, visits: []},
    {...base, variables: {title: 'x'.repeat(DIALOGUE_LIMITS.maxStringLength + 1)}},
  ];
  for (const snap of bad)
    assert.throws(() => createDialogue(shop, 'run', snap as never), JSON.stringify(snap).slice(0, 80));
});

test('definitions validate variables, conditions and assignments, with bounded trees', () => {
  const option = (extra: object) =>
    ({
      id: 'o',
      start: 'a',
      variables: {n: 1, flag: true, name: 'a'},
      nodes: [{id: 'a', text: 'a', options: [{id: 'x', text: 'x', to: null, ...extra}]}],
    }) as DialogueDefinition;
  const invalid: object[] = [
    {when: {var: 'missing', op: 'eq', value: 1}},
    {when: {var: 'n', op: 'eq', value: 'one'}},
    {when: {var: 'name', op: 'lt', value: 'b'}},
    {when: {var: 'n', op: 'like', value: 1}},
    {when: {visits: 'nowhere', op: 'ge', value: 1}},
    {when: {visits: 'a', op: 'ge', value: true}},
    {when: {fact: ''}},
    {when: {all: 'x'}},
    {when: {var: 'n', op: 'eq', value: 1, extra: 1}},
    {when: 'n > 1'},
    {set: [{var: 'n', op: 'set', value: 'x'}]},
    {set: [{var: 'name', op: 'add', value: 1}]},
    {set: [{var: 'n', op: 'mul', value: 2}]},
    {set: [{var: 'ghost', op: 'set', value: 1}]},
    {set: Array(DIALOGUE_LIMITS.maxAssignments + 1).fill({var: 'n', op: 'add', value: 1})},
    {when: {var: 'n', op: 'eq', value: Number.MAX_SAFE_INTEGER + 2}},
  ];
  for (const extra of invalid)
    assert.throws(() => createDialogue(option(extra), 's'), JSON.stringify(extra).slice(0, 80));
  assert.throws(() => createDialogue({...option({}), variables: {n: NaN}}, 's'));
  assert.throws(() => createDialogue({...option({}), variables: {n: {} as never}}, 's'));
  let deep: DialogueCondition = {fact: 'f'};
  for (let k = 0; k < DIALOGUE_LIMITS.maxConditionDepth; k++) deep = {not: deep};
  assert.throws(() => createDialogue(option({when: deep}), 's'), /too large/);
  const wide = {any: Array(DIALOGUE_LIMITS.maxConditionNodes).fill({fact: 'f'})};
  assert.throws(() => createDialogue(option({when: wide}), 's'), /too large/);
  assert.doesNotThrow(() =>
    createDialogue(option({when: {any: Array(DIALOGUE_LIMITS.maxConditionNodes - 1).fill({fact: 'f'})}}), 's'),
  );
});

test('authored definitions are copied: later edits to conditions or variables change nothing', () => {
  const def = structuredClone(shop),
    d = createDialogue(def, 'run');
  (def.variables as Record<string, unknown>).coins = 0;
  (must(def.nodes[0]?.options[0]) as {when: unknown}).when = {fact: 'never'};
  assert.deepEqual(ids(d), ['buy', 'chat', 'bye']);
  const vars = d.variables() as Record<string, unknown>;
  vars.coins = 99;
  assert.equal(d.variables().coins, 3);
});

test('node ids named like Object.prototype members keep their visit counts through a JSON save', () => {
  const def = JSON.parse(
    '{"id":"p","start":"__proto__","variables":{"__proto__":1},"nodes":[{"id":"__proto__","text":"a","options":[{"id":"loop","text":"l","to":"__proto__","when":{"visits":"__proto__","op":"lt","value":3},"set":[{"var":"__proto__","op":"add","value":1}]},{"id":"x","text":"x","to":null}]}]}',
  ) as DialogueDefinition;
  const d = createDialogue(def, 's');
  assert.equal(pick(d, 'loop').status, 'applied');
  assert.equal(d.visits('__proto__'), 2);
  const saved = JSON.parse(JSON.stringify(d.snapshot()));
  assert.equal(Object.hasOwn(saved.visits, '__proto__'), true);
  assert.equal(Object.hasOwn(saved.variables, '__proto__'), true);
  const r = createDialogue(def, 's', saved);
  assert.equal(r.visits('__proto__'), 2);
  assert.equal(r.variables()['__proto__'], 2);
  assert.equal(pick(r, 'loop').status, 'applied');
  assert.deepEqual(ids(r), ['x'], 'the visit condition sees the restored count');
});

test('malformed option lists are invalid options, and a restored current node must have been visited', () => {
  const def = (extra: object) =>
    ({
      id: 'o',
      start: 'a',
      nodes: [{id: 'a', text: 'a', options: [{id: 'x', text: 'x', to: null, ...extra}]}],
    }) as DialogueDefinition;
  for (const extra of [{requires: 'abc'}, {effects: 'abc'}, {requires: {length: 1}}])
    assert.throws(() => createDialogue(def(extra), 's'), /invalid option/);
  const base = {definition: 'shop', session: 'run', node: 'hello', revision: 1};
  assert.throws(() => createDialogue(shop, 'run', {...base, visits: {}}), /visits/);
  assert.throws(() => createDialogue(shop, 'run', {...base, visits: {hello: 0}}), /visits/);
  assert.doesNotThrow(() => createDialogue(shop, 'run', {...base, node: null, visits: {}}));
});
