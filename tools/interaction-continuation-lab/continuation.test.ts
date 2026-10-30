import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore, type Timers} from '../../src/core/save/store';
import {MemoryBackend} from '../../src/core/save/storage-port';
import {createInventoryLedger} from '../../src/kits/inventory/ledger';
import {createObjectiveRun} from '../../src/kits/objectives/run';
import {fixture, type Consumer, type Envelope} from './continuation';

const timers: Timers = {now: () => 0, set: fn => fn, clear: () => {}};
function open(consumer: Consumer, disk = new MemoryBackend(), max = 4, capacity = 8) {
  const adapter = fixture(consumer, max, capacity);
  const store = createSaveStore({
    local: disk.port(),
    session: new MemoryBackend().port(0, 'session'),
    build: 'continuation-lab',
    timers,
    sections: [adapter.section],
  });
  const abort = new AbortController();
  const owner = adapter.owner(store, abort.signal);
  return {adapter, store, owner, disk, abort};
}
type Lab = ReturnType<typeof open>;
function diskCopy(lab: Lab) {
  // Crash cut: copy ONLY committed storage. dispose() would perform a final flush.
  const copy = new MemoryBackend();
  for (const [key, value] of lab.disk.data) copy.data.set(key, value);
  return copy;
}
function request(lab: Lab, option = 'accept') {
  const view = lab.owner.view()!;
  return {session: view.session, revision: view.revision, node: view.node, option};
}
function finish(lab: Lab) {
  const ticket = lab.owner.begin()!;
  assert.ok(ticket);
  const result = lab.owner.deliver(ticket);
  assert.equal(result.status, 'saved');
  assert.equal(lab.owner.acknowledge(ticket), 'saved');
  return result;
}
function effect(state: Envelope) {
  if (state.consumer === 'reward')
    return createInventoryLedger({capacities: {bag: 8}, maxOperations: 4}, state.inventory).quantity('bag', 'reward');
  return createObjectiveRun(
    {runId: 'visit-unlock', maxEvents: 4, requirements: [{id: 'access', event: 'unlock', target: 1}]},
    state.objective,
  ).isComplete();
}

for (const consumer of ['reward', 'unlock'] as const) {
  for (const cut of ['before-choice', 'before-delivery', 'before-acknowledgment', 'after-acknowledgment'] as const) {
    test(`${consumer}: fresh-store continuation across ${cut}`, () => {
      const live = open(consumer);
      const choice = request(live);
      if (cut !== 'before-choice') assert.equal(live.owner.choose(choice), 'saved');
      let ticket = live.owner.begin();
      if (cut === 'before-acknowledgment' || cut === 'after-acknowledgment') {
        assert.equal(live.owner.deliver(ticket!).status, 'saved');
        if (cut === 'after-acknowledgment') assert.equal(live.owner.acknowledge(ticket!), 'saved');
      }
      const resumed = open(consumer, diskCopy(live));
      try {
        assert.deepEqual(resumed.owner.snapshot(), live.owner.snapshot());
        if (cut === 'before-choice') {
          assert.equal(live.owner.choose(choice), 'saved');
          assert.equal(resumed.owner.choose(choice), 'saved');
        }
        if (cut !== 'after-acknowledgment') {
          assert.deepEqual(finish(resumed), finish(live));
          assert.equal(effect(resumed.owner.snapshot()), consumer === 'reward' ? 1 : true);
        } else assert.equal(resumed.owner.begin(), null);
        assert.deepEqual(resumed.owner.snapshot(), live.owner.snapshot());
        assert.equal(resumed.owner.choose(choice), consumer === 'reward' ? 'stale' : 'closed');
        assert.equal(resumed.owner.begin(), null);
        if (ticket) assert.equal(resumed.owner.deliver(ticket).status, 'stale');
      } finally {
        live.owner.dispose();
        resumed.owner.dispose();
        live.store.dispose();
        resumed.store.dispose();
      }
    });
  }
  for (const phase of ['choice', 'delivery', 'acknowledgment'] as const) {
    test(`${consumer}: failed ${phase} write retains recoverable work and blocks delivery`, () => {
      const live = open(consumer),
        choice = request(live);
      if (phase !== 'choice') assert.equal(live.owner.choose(choice), 'saved');
      const ticket = live.owner.begin();
      if (phase === 'acknowledgment') assert.equal(live.owner.deliver(ticket!).status, 'saved');
      const before = diskCopy(live);
      live.disk.failSet = key => key.endsWith(live.adapter.section.id);
      const result =
        phase === 'choice'
          ? live.owner.choose(choice)
          : phase === 'delivery'
            ? live.owner.deliver(ticket!).status
            : live.owner.acknowledge(ticket!);
      assert.equal(result, 'save-failed');
      assert.equal(live.owner.begin(), null);
      assert.equal(live.owner.choose(choice), 'blocked');
      assert.deepEqual([...live.disk.data], [...before.data]);
      const resumed = open(consumer, diskCopy(live));
      try {
        if (phase === 'choice') assert.equal(resumed.owner.choose(choice), 'saved');
        const retry = finish(resumed);
        assert.equal(retry.duplicate, phase === 'acknowledgment');
        assert.equal(effect(resumed.owner.snapshot()), consumer === 'reward' ? 1 : true);
        live.disk.failSet = () => false;
        assert.equal(live.owner.checkpoint(), 'saved');
        if (phase !== 'acknowledgment') finish(live);
        assert.deepEqual(live.owner.snapshot(), resumed.owner.snapshot());
      } finally {
        live.owner.dispose();
        resumed.owner.dispose();
        live.store.dispose();
        resumed.store.dispose();
      }
    });
  }
}

test('capacity refusal never acknowledges or loses intent; duplicate delivery has a stable inventory receipt', () => {
  const live = open('reward', undefined, 4, 1);
  try {
    assert.equal(live.owner.choose(request(live)), 'saved');
    const ticket = live.owner.begin()!;
    assert.equal(live.owner.acknowledge(ticket), 'refused');
    assert.deepEqual(live.owner.deliver(ticket), {status: 'saved', duplicate: false});
    assert.deepEqual(live.owner.deliver(ticket), {status: 'saved', duplicate: true});
    assert.equal(live.owner.acknowledge(ticket), 'saved');
    assert.equal(live.owner.choose(request(live)), 'saved');
    const refused = live.owner.begin()!,
      before = live.owner.snapshot();
    assert.equal(live.owner.deliver(refused).status, 'refused');
    assert.equal(live.owner.acknowledge(refused), 'refused');
    assert.deepEqual(live.owner.snapshot(), before);
    assert.equal(before.inventory.operations.length, 1);
  } finally {
    live.owner.dispose();
    live.store.dispose();
  }
});

test('intent bound refuses before dialogue changes; closing without effects remains possible', () => {
  const live = open('reward', undefined, 1);
  try {
    assert.equal(live.owner.choose(request(live, 'missing')), 'refused');
    assert.equal(live.owner.choose(request(live)), 'saved');
    const before = live.owner.snapshot();
    assert.equal(live.owner.choose(request(live)), 'saturated');
    assert.deepEqual(live.owner.snapshot(), before);
    assert.equal(live.owner.choose(request(live, 'leave')), 'saved');
    finish(live);
  } finally {
    live.owner.dispose();
    live.store.dispose();
  }
});

test('abort, replacement and copied tickets cannot invoke a sink; cancellation leaves durable intent', () => {
  const live = open('reward');
  try {
    live.owner.choose(request(live));
    const ticket = live.owner.begin()!,
      before = live.owner.snapshot();
    assert.equal(live.owner.deliver({...ticket}).status, 'stale');
    live.abort.abort();
    assert.equal(live.owner.deliver(ticket).status, 'stale');
    assert.equal(live.owner.acknowledge(ticket), 'stale');
    live.owner.dispose();
    const replacement = live.adapter.owner(live.store, new AbortController().signal);
    assert.equal(replacement.deliver(ticket).status, 'stale');
    assert.deepEqual(replacement.snapshot(), before);
    const fresh = replacement.begin()!;
    assert.notEqual(fresh, ticket);
    assert.equal(replacement.deliver(fresh).status, 'saved');
    assert.equal(replacement.acknowledge(fresh), 'saved');
    replacement.dispose();
  } finally {
    live.store.dispose();
  }
});

test('player switch retires callback authority for that player view', () => {
  const live = open('unlock');
  try {
    live.owner.choose(request(live));
    const ticket = live.owner.begin()!;
    const first = live.store.activePlayer();
    live.store.setActivePlayer(live.store.addPlayer('Other'));
    assert.equal(live.owner.deliver(ticket).status, 'stale');
    assert.equal(live.owner.acknowledge(ticket), 'stale');
    live.store.setActivePlayer(first);
    assert.equal(live.owner.deliver(ticket).status, 'stale');
  } finally {
    live.owner.dispose();
    live.store.dispose();
  }
});

test('external envelope rewind retires callbacks even when a new intent reuses the stable ID', () => {
  const live = open('reward');
  try {
    assert.equal(live.owner.choose(request(live)), 'saved');
    const stale = live.owner.begin()!;
    live.store.section(live.adapter.section).replace(live.adapter.section.initial());
    live.store.flush();
    assert.equal(live.owner.choose(request(live)), 'stale');
    const replacement = live.adapter.owner(live.store, new AbortController().signal);
    const view = replacement.view()!;
    assert.equal(replacement.choose({...view, option: 'accept'}), 'saved');
    const fresh = replacement.begin()!;
    assert.equal(fresh.id, stale.id);
    assert.notEqual(fresh, stale);
    assert.equal(live.owner.deliver(stale).status, 'stale');
    assert.equal(replacement.deliver(stale).status, 'stale');
    assert.equal(replacement.deliver(fresh).status, 'saved');
    replacement.dispose();
  } finally {
    live.owner.dispose();
    live.store.dispose();
  }
});

test('envelope parser refuses missing sinks, orphan receipts, early acknowledgment and unbounded intents', () => {
  const live = open('reward');
  try {
    live.owner.choose(request(live));
    const valid = live.owner.snapshot();
    assert.deepEqual(live.adapter.parse(valid), valid);
    const missing = {...valid} as Partial<Envelope>;
    delete missing.inventory;
    assert.throws(() => live.adapter.parse(missing), /missing/);
    assert.throws(() => live.adapter.parse({pending: []}), /missing/);
    assert.throws(() => live.adapter.parse({...valid, intents: Array(5).fill(valid.intents[0])}), /bounds/);
    const early = structuredClone(valid);
    early.intents[0]!.acknowledged = true;
    assert.throws(() => live.adapter.parse(early), /intent/);
    const orphan = structuredClone(valid);
    orphan.intents = [];
    assert.throws(() => live.adapter.parse(orphan), /intent/);
    const forged = structuredClone(valid);
    forged.intents[0]!.delivered = true;
    assert.throws(() => live.adapter.parse(forged), /inconsistent inventory/);
  } finally {
    live.owner.dispose();
    live.store.dispose();
  }
});

test('malformed disk quarantines through real SaveStore and cannot deliver initial fallback', () => {
  const live = open('reward');
  live.owner.choose(request(live));
  const disk = diskCopy(live),
    key = [...disk.data.keys()].find(key => key.endsWith(live.adapter.section.id))!;
  const raw = JSON.parse(disk.data.get(key)!);
  delete raw.data.inventory;
  disk.data.set(key, JSON.stringify(raw));
  const resumed = open('reward', disk);
  try {
    assert.equal(resumed.store.section(resumed.adapter.section).status(), 'quarantined');
    assert.equal(resumed.owner.checkpoint(), 'blocked');
    assert.equal(resumed.owner.begin(), null);
    assert.equal(resumed.owner.choose(request(resumed)), 'blocked');
    assert.ok(resumed.store.quarantine().length > 0);
  } finally {
    live.owner.dispose();
    resumed.owner.dispose();
    live.store.dispose();
    resumed.store.dispose();
  }
});
