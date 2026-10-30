import test from 'node:test';
import assert from 'node:assert/strict';
import {createItinerary, type ItineraryEdit, type ItineraryOptions} from './index';
import {defineSaveSection} from '../../author';
import {authorSaveHandle} from '../../author/save-handle';
import {createSaveStore} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';
import {must} from '../../testing/must';

const options: ItineraryOptions = {maxOrders: 4, maxTextLength: 32, tags: ['visit']};
const input = {tag: 'visit', destination: {id: 'a', generation: 1}, value: 0};
function active() {
  const route = createItinerary(options);
  assert.equal(route.edit(0, {type: 'insert', index: 0, order: input}), 'accepted');
  const id = must(route.snapshot().orders[0]).id;
  assert.equal(route.start(1, id), 'accepted');
  return {route, id, ticket: must(route.begin())};
}

test('public options and commands reject accessors without executing or partially publishing', () => {
  let reads = 0;
  assert.throws(() =>
    createItinerary({
      ...options,
      get tags() {
        reads++;
        return options.tags;
      },
    }),
  );
  const {route, id, ticket} = active();
  const before = route.snapshot();
  const edit: ItineraryEdit = {
    type: 'remove',
    id,
    get current(): 'advance' {
      reads++;
      throw new Error('getter ran');
    },
  };
  assert.throws(() => route.edit(before.revision, edit));
  assert.equal(reads, 0);
  assert.deepEqual(route.snapshot(), before);
  assert.equal(route.check(ticket), true);
});

test('reentrant proxy trap cannot mutate accepted state and guard recovers after refusal', () => {
  const {route, id, ticket} = active();
  const before = route.snapshot();
  const edit = new Proxy<ItineraryEdit>(
    {type: 'remove', id, current: 'stop'},
    {
      getOwnPropertyDescriptor() {
        route.dispose();
        return undefined;
      },
    },
  );
  assert.throws(() => route.edit(before.revision, edit), /Reentrant/);
  assert.deepEqual(route.snapshot(), before);
  assert.equal(route.finish(ticket), true);
});

test('save section and fresh store preserve cursor/data but never revive in-process completion', () => {
  const section = defineSaveSection({
    id: 'itinerary-test.route',
    scope: 'device',
    initial: {json: ''},
    parse(raw: unknown) {
      if (!raw || typeof raw !== 'object' || !('json' in raw) || typeof raw.json !== 'string')
        throw new TypeError('Invalid route envelope');
      if (raw.json !== '') {
        const validator = createItinerary(options);
        try {
          if (validator.restore(0, JSON.parse(raw.json)) !== 'accepted') throw new TypeError('Invalid route');
        } finally {
          validator.dispose();
        }
      }
      return {json: raw.json};
    },
  });
  const backend = new MemoryBackend();
  const open = (tab: number) =>
    createSaveStore({
      local: backend.port(tab),
      session: new MemoryBackend().port(tab, 'session'),
      namespace: 'itinerary-test',
      build: 'test',
      timers: {set: () => 0, clear: () => {}, now: () => 0},
    });
  const {route, ticket} = active();
  const saved = route.snapshot();
  const first = open(0);
  assert.equal(
    authorSaveHandle(first, section).update(
      draft => {
        draft.json = JSON.stringify(saved);
      },
      {now: true},
    ),
    'saved',
  );
  first.dispose();
  route.dispose();
  const second = open(1);
  const json = authorSaveHandle(second, section).get().json;
  const resumed = createItinerary(options);
  assert.equal(resumed.restore(0, JSON.parse(json)), 'accepted');
  assert.deepEqual(resumed.snapshot().orders, saved.orders);
  assert.equal(resumed.snapshot().activeId, saved.activeId);
  assert.equal(resumed.finish(ticket), false);
  // The destination owner must revalidate saved references before execution.
  assert.equal(resumed.invalidateDestination(input.destination), 'accepted');
  assert.equal(resumed.begin(), null);
  const before = resumed.snapshot();
  assert.throws(() => resumed.restore(before.revision, {...saved, version: 99}));
  assert.deepEqual(resumed.snapshot(), before);
  assert.equal(authorSaveHandle(second, section).get().json, json);
  second.dispose();
  resumed.dispose();
});

test('ID and order-generation exhaustion are refused without retiring unrelated work', () => {
  const {route, id} = active();
  const snapshot = route.snapshot();
  const terminal = {
    ...snapshot,
    nextId: Number.MAX_SAFE_INTEGER,
    orders: snapshot.orders.map(order => ({...order, generation: Number.MAX_SAFE_INTEGER})),
  };
  assert.equal(route.restore(snapshot.revision, terminal), 'accepted');
  const ticket = must(route.begin());
  const before = route.snapshot();
  assert.equal(route.edit(before.revision, {type: 'insert', index: 1, order: input}), 'exhausted');
  assert.equal(route.edit(before.revision, {type: 'replace', id, order: input}), 'exhausted');
  assert.deepEqual(route.snapshot(), before);
  assert.equal(route.finish(ticket), true);
});

test('deleting the final active order advances to idle without implicit wrap', () => {
  const {route, id, ticket} = active();
  assert.equal(route.edit(route.snapshot().revision, {type: 'remove', id, current: 'advance'}), 'accepted');
  assert.equal(route.snapshot().activeId, null);
  assert.equal(route.finish(ticket), false);
  assert.equal(route.begin(), null);
});
