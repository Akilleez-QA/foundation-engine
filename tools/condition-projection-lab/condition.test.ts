import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MemoryBackend} from '../../src/core/save/storage-port';
import {createSaveStore, type Timers} from '../../src/core/save/store';
import {conditionFixture, type ConditionDefinition, type ConditionSnapshot} from './condition';
import {wearDefinition, chargeDefinition} from './consumers';

const timers: Timers = {now: () => 0, set: fn => fn, clear: () => {}};
function open(definition: ConditionDefinition, disk = new MemoryBackend()) {
  const fixture = conditionFixture(definition),
    abort = new AbortController();
  const store = createSaveStore({
    local: disk.port(),
    session: new MemoryBackend().port(0, 'session'),
    build: 'condition-lab',
    timers,
    sections: [fixture.section],
  });
  return {fixture, abort, store, disk, owner: fixture.owner(store, abort.signal)};
}
type Lab = ReturnType<typeof open>;
function close(lab: Lab) {
  lab.owner.dispose();
  lab.store.dispose();
}
function copy(lab: Lab) {
  const disk = new MemoryBackend();
  for (const [key, value] of lab.disk.data) disk.data.set(key, value);
  return disk;
}
function set(lab: Lab, id: string, value: number) {
  const ticket = lab.owner.prepare(id);
  assert.ok(ticket);
  return lab.owner.update(ticket, value);
}

test('wear removes and repairs a contribution without changing custody, arrangement or cosmetic intent', () => {
  const lab = open(wearDefinition);
  try {
    const equipment = lab.owner.snapshot().equipment;
    assert.deepEqual(lab.owner.view().values, {guard: 5});
    assert.equal(set(lab, 'coat', 0), 'saved');
    assert.deepEqual(lab.owner.view().values, {guard: 1});
    assert.deepEqual(lab.owner.view().available, []);
    assert.deepEqual(lab.owner.snapshot().equipment, equipment);
    assert.equal(set(lab, 'coat', 2), 'saved');
    assert.deepEqual(lab.owner.view().values, {guard: 5});
    assert.equal(lab.owner.equip('trim', 2), 'saved');
    assert.deepEqual(lab.owner.view().values, {guard: 1});
    assert.deepEqual(lab.owner.snapshot().equipment.equipped, ['trim']);
    assert.equal(lab.owner.snapshot().equipment.items.find(item => item.id === 'trim')!.functional, false);
  } finally {
    close(lab);
  }
});

test('charge availability changes independently from equipment intent and detached projections', () => {
  const lab = open(chargeDefinition);
  try {
    assert.equal(set(lab, 'lamp', 1), 'saved');
    assert.deepEqual(lab.owner.view().values, {light: 5});
    assert.equal(set(lab, 'lamp', 0), 'saved');
    assert.deepEqual(lab.owner.view().values, {light: 0});
    assert.equal(lab.owner.snapshot().equipment.items[0]!.functional, true);
    const view = lab.owner.view();
    view.values.light = 999;
    view.available.push('fake');
    const snapshot = lab.owner.snapshot();
    snapshot.conditions[0]!.value = 2;
    assert.deepEqual(lab.owner.view().values, {light: 0});
    assert.equal(set(lab, 'lamp', 2), 'saved');
    assert.deepEqual(lab.owner.view().values, {light: 5});
  } finally {
    close(lab);
  }
});

for (const definition of [wearDefinition, chargeDefinition]) {
  test(`${definition.id}: a real fresh-store reload preserves next accepted changes and projections`, () => {
    const live = open(definition),
      id = definition.items[0]!.item.id;
    assert.equal(set(live, id, 0), 'saved');
    const old = live.owner.prepare(id)!;
    const resumed = open(definition, copy(live));
    try {
      assert.deepEqual(resumed.owner.snapshot(), live.owner.snapshot());
      assert.deepEqual(resumed.owner.view(), live.owner.view());
      assert.equal(resumed.owner.update(old, 1), 'stale');
      assert.equal(live.owner.cancel(old), true);
      for (const value of [1, 0, definition.items[0]!.maximum]) {
        assert.equal(set(resumed, id, value), set(live, id, value));
        assert.deepEqual(resumed.owner.snapshot(), live.owner.snapshot());
        assert.deepEqual(resumed.owner.view(), live.owner.view());
      }
    } finally {
      close(live);
      close(resumed);
    }
  });
  test(`${definition.id}: failed write is session-only, blocks commands, and reload retains old coupled state`, () => {
    const live = open(definition),
      id = definition.items[0]!.item.id;
    assert.equal(set(live, id, 1), 'saved');
    const before = live.owner.snapshot(),
      oldValues = live.owner.view().values;
    live.disk.failSet = key => key.endsWith(live.fixture.section.id);
    assert.equal(set(live, id, 0), 'save-failed');
    assert.equal(live.owner.prepare(id), null);
    assert.equal(live.owner.equip(id, live.owner.snapshot().revision, false), 'blocked');
    assert.equal(live.owner.view().status, 'session');
    const resumed = open(definition, copy(live));
    try {
      assert.deepEqual(resumed.owner.snapshot(), before);
      assert.deepEqual(resumed.owner.view().values, oldValues);
      live.disk.failSet = () => false;
      assert.equal(live.owner.checkpoint(), 'saved');
      assert.equal(set(resumed, id, 0), 'saved');
      assert.deepEqual(resumed.owner.snapshot(), live.owner.snapshot());
      assert.deepEqual(resumed.owner.view(), live.owner.view());
    } finally {
      close(live);
      close(resumed);
    }
  });
}

test('projection overflow rejects the entire condition update and preserves ticket for retry', () => {
  const definition: ConditionDefinition = {
    id: 'cancellation',
    slots: ['a', 'b', 'c'],
    bagCapacity: 3,
    base: {value: 0},
    equipped: ['a', 'b', 'c'],
    items: ['a', 'b', 'c'].map((id, i) => ({
      item: {id, definition: id, slots: [id], functional: true},
      initial: 1,
      maximum: 1,
      enabledAbove: 0,
      modifiers: [{stat: 'value', add: i === 1 ? -1e308 : 1e308, multiply: 1}],
    })),
  };
  const lab = open(definition);
  try {
    const before = lab.owner.snapshot(),
      values = lab.owner.view().values,
      writes = lab.disk.writes;
    const ticket = lab.owner.prepare('b')!;
    assert.throws(() => lab.owner.update(ticket, 0), /overflow/);
    assert.deepEqual(lab.owner.snapshot(), before);
    assert.deepEqual(lab.owner.view().values, values);
    assert.equal(lab.disk.writes, writes);
    assert.throws(() => lab.owner.equip('b', 0, false), /overflow/);
    assert.deepEqual(lab.owner.snapshot(), before);
    assert.equal(lab.disk.writes, writes);
    assert.equal(lab.owner.update(ticket, 1), 'unchanged');
    assert.equal(lab.owner.update(ticket, 0), 'stale');
  } finally {
    close(lab);
  }
});

test('invalid condition and equipment capacity refusal leave both projections and pending authority intact', () => {
  const definition = structuredClone(wearDefinition);
  definition.bagCapacity = 1;
  const lab = open(definition);
  try {
    const before = lab.owner.snapshot(),
      ticket = lab.owner.prepare('coat')!;
    for (const value of [-1, 4, NaN, Infinity, 0.5]) assert.equal(lab.owner.update(ticket, value), 'refused');
    assert.equal(lab.owner.equip('coat', 0, false), 'capacity');
    assert.deepEqual(lab.owner.snapshot(), before);
    assert.equal(lab.owner.update(ticket, 0), 'saved');
  } finally {
    close(lab);
  }
});

test('equipment change invalidates prepared condition and old arrangement revisions', () => {
  const lab = open(wearDefinition);
  try {
    const ticket = lab.owner.prepare('coat')!;
    assert.equal(lab.owner.prepare('trim'), null);
    assert.equal(lab.owner.equip('trim', 0), 'saved');
    assert.equal(lab.owner.update(ticket, 0), 'stale');
    assert.equal(lab.owner.equip('coat', 0), 'stale');
    assert.equal(set(lab, 'coat', 0), 'saved');
    assert.equal(lab.owner.equip('coat', 2), 'saved');
    assert.deepEqual(lab.owner.view().values, {guard: 1});
  } finally {
    close(lab);
  }
});

test('copied/foreign tickets, abort, player switch and external rewind never revive old authority', () => {
  const lab = open(chargeDefinition);
  try {
    const ticket = lab.owner.prepare('lamp')!;
    assert.equal(lab.owner.update({...ticket}, 0), 'stale');
    lab.store.section(lab.fixture.section).replace(lab.fixture.section.initial());
    lab.store.flush();
    assert.equal(lab.owner.update(ticket, 0), 'stale');
    const fresh = lab.fixture.owner(lab.store, new AbortController().signal);
    assert.equal(fresh.update(ticket, 0), 'stale');
    const active = fresh.prepare('lamp')!;
    const first = lab.store.activePlayer();
    lab.store.setActivePlayer(lab.store.addPlayer('Other'));
    lab.store.setActivePlayer(first);
    assert.equal(fresh.update(active, 0), 'stale');
    fresh.dispose();
    const abort = new AbortController(),
      last = lab.fixture.owner(lab.store, abort.signal),
      pending = last.prepare('lamp')!;
    abort.abort();
    assert.equal(last.update(pending, 0), 'stale');
    assert.equal(last.prepare('lamp'), null);
    last.dispose();
    assert.equal(lab.owner.snapshot().revision, 0);
  } finally {
    close(lab);
  }
});

test('restore validates missing/duplicate/oversized state and actual SaveStore quarantine blocks fallback work', () => {
  const lab = open(wearDefinition);
  set(lab, 'coat', 0);
  try {
    const state = lab.owner.snapshot(),
      missing = {...state} as Partial<ConditionSnapshot>;
    delete missing.equipment;
    assert.throws(() => lab.fixture.parse(missing), /missing/);
    assert.throws(() => lab.fixture.parse({...state, conditions: Array(9).fill(state.conditions[0])}), /bound/);
    assert.throws(
      () => lab.fixture.parse({...state, conditions: [state.conditions[0], state.conditions[0]]}),
      /saved condition/,
    );
    const swapped = structuredClone(state);
    swapped.equipment.items[0]!.functional = false;
    assert.throws(() => lab.fixture.parse(swapped), /custody definition/);
    const disk = copy(lab),
      key = [...disk.data.keys()].find(key => key.endsWith(lab.fixture.section.id))!;
    const bytes = JSON.parse(disk.data.get(key)!);
    delete bytes.data.conditions;
    disk.data.set(key, JSON.stringify(bytes));
    const resumed = open(wearDefinition, disk);
    try {
      assert.equal(resumed.owner.view().status, 'quarantined');
      assert.equal(resumed.owner.prepare('coat'), null);
      assert.equal(resumed.owner.checkpoint(), 'blocked');
      assert.ok(resumed.store.quarantine().length);
    } finally {
      close(resumed);
    }
  } finally {
    close(lab);
  }
});

test('exhausted revision and detached creator definition cannot partially publish a change', () => {
  const definition = structuredClone(chargeDefinition),
    lab = open(definition);
  try {
    definition.items[0]!.maximum = 100;
    definition.items[0]!.modifiers[0]!.add = 999;
    assert.deepEqual(lab.owner.view().values, {light: 5});
    const state = lab.owner.snapshot();
    state.revision = Number.MAX_SAFE_INTEGER;
    lab.store.section(lab.fixture.section).replace(state);
    lab.store.flush();
    const fresh = lab.fixture.owner(lab.store, new AbortController().signal),
      ticket = fresh.prepare('lamp')!,
      before = fresh.snapshot();
    assert.throws(() => fresh.update(ticket, 0), /exhausted/);
    assert.deepEqual(fresh.snapshot(), before);
    fresh.dispose();
  } finally {
    close(lab);
  }
});
