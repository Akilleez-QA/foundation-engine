import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStore } from '../../src/core/save/store.ts';
import { authorSaveHandle } from '../../src/author/save-handle.ts';
import { MemoryBackend } from '../../src/core/save/storage-port.ts';
import { initialRecipe, initialSelections } from './recipe.mjs';
import {
  createRuntimeController,
  createRuntimeStoragePort,
  runtimeSectionDefinition,
  runtimeStorageKey,
  parseRuntimeEnvelope,
  initialRuntimeEnvelope,
} from './runtime-controller.mjs';
function fixture(backend = new MemoryBackend(), tab = 0) {
  const port = createRuntimeStoragePort(backend.port(tab)),
    timers = new Map();
  let serial = 0,
    sequence = 0;
  const store = createSaveStore({
      namespace: 'crafting-workbench',
      build: 'craft@test',
      local: port,
      session: new MemoryBackend().port(0, 'session'),
      timers: {
        now: () => 0,
        set: (fn) => {
          timers.set(++serial, fn);
          return serial;
        },
        clear: (id) => timers.delete(id),
      },
    }),
    handle = authorSaveHandle(store, {
      kind: 'save-section',
      id: runtimeSectionDefinition.id,
      section: runtimeSectionDefinition,
    }),
    controller = createRuntimeController({
      saveBuild: 'craft@test',
      saveHandle: handle,
      readPersisted: () => port.get(runtimeStorageKey),
    });
  const preview = (payload, id = `cmd${++sequence}`) => {
    const request = { id, payload },
      p = controller.preview(request);
    assert.equal(p.status, 'prepared', JSON.stringify(p));
    return { ...p, request };
  };
  const accept = (payload, id) => {
    const p = preview(payload, id);
    assert.equal(controller.commit(p.candidate).status, 'pending');
    assert.equal(
      controller.acknowledge().status,
      'accepted',
      JSON.stringify(controller.read()),
    );
    return p;
  };
  return {
    backend,
    port,
    store,
    handle,
    controller,
    preview,
    accept,
    flush() {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
    close() {
      controller.dispose();
      store.dispose();
    },
  };
}
const begin = (recipe = initialRecipe(), selections = initialSelections()) => ({
  kind: 'begin',
  recipe,
  selections,
  pointBudget: recipe.pointLimit,
});
const qty = (f, container, batch) =>
  f.controller
    .read()
    .view.stock.positions.find(
      (p) => p.container === container && p.batch === batch,
    )?.quantity ?? 0;
const mass = (stock) =>
  stock.positions.reduce(
    (total, p) =>
      total +
      BigInt(p.quantity) *
        BigInt(stock.batches.find((b) => b.id === p.batch).massMg),
    0n,
  );
const lock = (f, session = 'session-1') => f.accept({ kind: 'lock', session });
const assign = (f, session = 'session-1', machine = 'm-a') =>
  f.accept({ kind: 'assign', session, machine });
const step = (f, session = 'session-1') =>
  f.accept({ kind: 'step', session, ticks: 10, power: 10 });
test('pre-transfer selection retains original provenance; holding prevents overbooking and two sessions cancel independently', () => {
  const f = fixture();
  try {
    f.accept(begin());
    const s = f.controller.read().view.sessions[0];
    assert.equal(s.phase, 'reserved');
    assert.deepEqual(
      s.experiment.selections.map((s) => s.container),
      ['source-a', 'source-b'],
    );
    assert.deepEqual(s.values, [{ id: 'quality', ceiling: 600, value: 300 }]);
    assert.equal(qty(f, 'source-a', 'input-a'), 3);
    assert.equal(qty(f, s.holding, 'input-a'), 1);
    const before = f.controller.read().envelope;
    assert.equal(
      f.controller.preview({
        id: 'steal',
        payload: {
          kind: 'transfer',
          from: s.holding,
          to: 'buffer',
          batch: 'input-a',
          quantity: 1,
        },
      }).reason,
      'claimed-custody',
    );
    assert.equal(f.controller.read().envelope, before);
    f.accept(begin());
    assert.equal(
      f.controller.preview({ id: 'third', payload: begin() }).reason,
      'live-session-capacity',
    );
    f.accept({ kind: 'cancel-session', session: 'session-1' });
    assert.equal(qty(f, 'source-a', 'input-a'), 3);
    assert.equal(qty(f, 'holding-2', 'input-a'), 1);
    assert.deepEqual(
      parseRuntimeEnvelope(f.controller.read().envelope),
      f.controller.read().envelope,
    );
  } finally {
    f.close();
  }
});
test('same batch selected across two original sources aggregates holding but returns exact provenance', () => {
  const f = fixture();
  try {
    f.accept({
      kind: 'transfer',
      from: 'source-b',
      to: 'buffer',
      batch: 'input-b',
      quantity: 1,
    });
    f.accept({
      kind: 'transfer',
      from: 'source-a',
      to: 'source-b',
      batch: 'input-a',
      quantity: 1,
    });
    f.accept(
      begin(initialRecipe(), [
        { slot: 'feed', container: 'source-a', batch: 'input-a', quantity: 1 },
        { slot: 'feed', container: 'source-b', batch: 'input-a', quantity: 1 },
      ]),
    );
    assert.equal(qty(f, 'holding-1', 'input-a'), 2);
    f.accept({ kind: 'cancel-session', session: 'session-1' });
    assert.equal(qty(f, 'source-a', 'input-a'), 3);
    assert.equal(qty(f, 'source-b', 'input-a'), 1);
  } finally {
    f.close();
  }
});
test('return capacity refusal preserves exact custody both before and after assignment', () => {
  for (const assigned of [false, true]) {
    const f = fixture();
    try {
      f.accept(begin());
      if (assigned) {
        lock(f);
        assign(f);
      }
      f.accept({
        kind: 'harvest',
        spawn: 'field',
        incarnation: 0,
        container: 'source-a',
        quantity: 1,
      });
      const before = f.controller.read().envelope;
      assert.equal(
        f.controller.preview({
          id: 'cancel',
          payload: { kind: 'cancel-session', session: 'session-1' },
        }).reason,
        'capacity',
      );
      assert.equal(f.controller.read().envelope, before);
      f.accept({
        kind: 'transfer',
        from: 'source-a',
        to: 'buffer',
        batch: 'input-a',
        quantity: 1,
      });
      f.accept({ kind: 'cancel-session', session: 'session-1' });
      assert.equal(qty(f, 'source-a', 'input-a'), 4);
    } finally {
      f.close();
    }
  }
});
test('machine input claimed before powered work; competing assignment and unrelated transfer refuse atomically', () => {
  const f = fixture();
  try {
    f.accept(begin());
    f.accept(begin());
    lock(f);
    lock(f, 'session-2');
    assign(f);
    const before = f.controller.read().envelope;
    assert.equal(
      f.controller.preview({
        id: 'claim',
        payload: { kind: 'assign', session: 'session-2', machine: 'm-a' },
      }).reason,
      'machine-claimed',
    );
    assert.equal(
      f.controller.preview({
        id: 'steal',
        payload: {
          kind: 'transfer',
          from: 'm-a.input',
          to: 'buffer',
          batch: 'input-a',
          quantity: 1,
        },
      }).reason,
      'claimed-custody',
    );
    assert.equal(f.controller.read().envelope, before);
    f.accept({ kind: 'step', session: 'session-1', ticks: 1, power: 10 });
    assert.equal(f.controller.read().view.sessions[0].phase, 'working');
    assert.equal(qty(f, 'm-a.work', 'input-a'), 1);
    f.accept({ kind: 'cancel-session', session: 'session-1' });
    assert.equal(qty(f, 'm-a.work', 'input-a'), 0);
    assign(f, 'session-2');
  } finally {
    f.close();
  }
});
test('pinned same-version recipes preserve different numeric outcomes; conservation and completed output blockage recover once', () => {
  const f = fixture();
  try {
    const original = initialRecipe(),
      changed = structuredClone(original);
    changed.attributes[0].initialPermille = 1000;
    f.accept(begin(original));
    f.accept({
      kind: 'experiment',
      session: 'session-1',
      attribute: 'quality',
      points: 1,
      effectPermille: 1000,
    });
    assert.equal(f.controller.read().view.sessions[0].values[0].value, 450);
    lock(f);
    assign(f);
    const beforeMass = mass(f.controller.read().view.stock);
    step(f);
    assert.equal(f.controller.read().view.sessions[0].phase, 'completed');
    assert.equal(qty(f, 'm-a.output', 'crafted-1'), 1);
    assert.equal(
      f.controller.read().view.stock.batches.find((b) => b.id === 'crafted-1')
        .properties.grade,
      450,
    );
    assert.equal(mass(f.controller.read().view.stock), beforeMass);
    assert.equal(
      f.controller.preview({
        id: 'cancel-done',
        payload: { kind: 'cancel-session', session: 'session-1' },
      }).reason,
      'phase',
    );
    f.accept(begin(changed));
    lock(f, 'session-2');
    assign(f, 'session-2');
    step(f, 'session-2');
    assert.equal(f.controller.read().view.sessions[1].phase, 'working');
    assert.equal(qty(f, 'm-a.work', 'input-a'), 1);
    assert.equal(f.controller.read().view.machines[0].completed, 1);
    f.accept({
      kind: 'transfer',
      from: 'm-a.output',
      to: 'buffer',
      batch: 'crafted-1',
      quantity: 1,
    });
    f.accept({
      kind: 'transfer',
      from: 'm-a.output',
      to: 'buffer',
      batch: 'scrap-1',
      quantity: 2,
    });
    const command = step(f, 'session-2');
    assert.equal(f.controller.read().view.machines[0].completed, 2);
    assert.equal(
      f.controller.read().view.stock.batches.find((b) => b.id === 'crafted-2')
        .properties.grade,
      600,
    );
    assert.equal(f.controller.preview(command.request).status, 'duplicate');
    assert.equal(qty(f, 'm-a.output', 'crafted-2'), 1);
    const reload = fixture(f.backend, 1);
    try {
      assert.deepEqual(
        reload.controller.read().envelope,
        f.controller.read().envelope,
      );
    } finally {
      reload.close();
    }
  } finally {
    f.close();
  }
});
test('spawn replacement retains historical harvested facts and uses one dimensional remaining counter', () => {
  const f = fixture();
  try {
    f.accept(begin());
    lock(f);
    f.accept({
      kind: 'replace-spawn',
      spawn: 'field',
      seed: 2,
      cellSize: 2,
      expiresAt: 20,
      reserve: 3,
      grade: 900,
    });
    assert.equal(f.controller.read().view.spawns[0].remaining, 3);
    assert.equal(
      f.controller.read().view.stock.batches.find((b) => b.id === 'input-a')
        .properties.grade,
      400,
    );
    assert.equal(
      f.controller.preview({
        id: 'old',
        payload: {
          kind: 'harvest',
          spawn: 'field',
          incarnation: 0,
          container: 'buffer',
          quantity: 1,
        },
      }).reason,
      'stale-spawn',
    );
    f.accept({
      kind: 'harvest',
      spawn: 'field',
      incarnation: 1,
      container: 'buffer',
      quantity: 2,
    });
    assert.equal(f.controller.read().view.spawns[0].remaining, 1);
    assert.equal(qty(f, 'buffer', 'harvest-1'), 2);
    f.accept({ kind: 'advance', time: 20 });
    assert.equal(
      f.controller.preview({
        id: 'expired',
        payload: {
          kind: 'harvest',
          spawn: 'field',
          incarnation: 1,
          container: 'buffer',
          quantity: 1,
        },
      }).reason,
      'expired-spawn',
    );
    assert.deepEqual(
      parseRuntimeEnvelope(f.controller.read().envelope),
      f.controller.read().envelope,
    );
  } finally {
    f.close();
  }
});
test('failed actual author-adapter save keeps old stock until exact retry readback and acknowledgement', () => {
  const f = fixture();
  try {
    assert.equal(f.controller.read().durable, false);
    const before = f.controller.read().envelope,
      p = f.preview(begin(), 'begin');
    f.backend.failSet = (k) => k === runtimeStorageKey;
    f.controller.commit(p.candidate);
    assert.equal(f.controller.read().pending, true);
    assert.equal(f.controller.read().envelope, before);
    assert.equal(f.controller.acknowledge().reason, 'not-durable');
    assert.equal(
      f.controller.preview({ id: 'other', payload: begin() }).reason,
      'pending',
    );
    f.backend.failSet = () => false;
    f.controller.retry();
    assert.equal(f.controller.read().envelope, before);
    f.controller.acknowledge();
    assert.equal(qty(f, 'holding-1', 'input-a'), 1);
    assert.equal(f.controller.preview(p.request).status, 'duplicate');
    const reload = fixture(f.backend, 1);
    try {
      assert.deepEqual(
        reload.controller.read().envelope,
        f.controller.read().envelope,
      );
    } finally {
      reload.close();
    }
  } finally {
    f.close();
  }
});
test('corrupt newer and externally removed storage never fabricate a fresh accepted economy', () => {
  for (const raw of ['{broken', JSON.stringify({ v: 99, data: {} })]) {
    const backend = new MemoryBackend();
    backend.port(0).set(runtimeStorageKey, raw);
    const f = fixture(backend);
    try {
      assert.ok(f.controller.read().blocked);
      assert.equal(
        f.controller.preview({ id: 'begin', payload: begin() }).status,
        'refused',
      );
    } finally {
      f.close();
    }
  }
  const f = fixture();
  try {
    f.accept(begin());
    const bytes = f.backend.port(1).get(runtimeStorageKey);
    f.backend.port(1).remove(runtimeStorageKey);
    assert.ok(f.controller.read().blocked);
    f.flush();
    assert.equal(f.backend.port(1).get(runtimeStorageKey), null);
    assert.ok(bytes);
  } finally {
    f.close();
  }
});
test('restore replay rejects changed facts, quantity, phase or recipe while exact cancelled candidates stay retired', () => {
  const f = fixture();
  try {
    f.accept(begin());
    const original = f.controller.read().envelope;
    for (const mutate of [
      (s) => s.industry.stock.positions[0].quantity++,
      (s) => s.sessions[0].recipe.attributes[0].initialPermille++,
      (s) => (s.sessions[0].phase = 'completed'),
      (s) => s.spawns[0].deposit.batch.properties.grade++,
    ]) {
      const bad = structuredClone(original);
      mutate(bad);
      assert.throws(() => parseRuntimeEnvelope(bad));
    }
    const proposal = f.preview({ kind: 'advance', time: 1 });
    f.controller.cancel(proposal.candidate);
    assert.equal(f.controller.commit(proposal.candidate).status, 'stale');
    const late = f.preview({ kind: 'advance', time: 2 });
    f.controller.dispose();
    assert.equal(f.controller.commit(late.candidate).reason, 'retired');
  } finally {
    f.close();
  }
});
test('joint batch saturation rejects lock without losing reserved custody or cancellation', () => {
  const f = fixture();
  try {
    f.accept(begin());
    for (let n = 0; n < 14; n++)
      f.accept({
        kind: 'replace-spawn',
        spawn: 'field',
        seed: n,
        cellSize: 1,
        expiresAt: 100,
        reserve: 1,
        grade: n,
      });
    const before = f.controller.read().envelope;
    assert.equal(f.controller.read().view.stock.batches.length, 16);
    assert.equal(
      f.controller.preview({
        id: 'lock',
        payload: { kind: 'lock', session: 'session-1' },
      }).reason,
      'crafting: limit',
    );
    assert.equal(f.controller.read().envelope, before);
    f.accept({ kind: 'cancel-session', session: 'session-1' });
    assert.equal(qty(f, 'source-a', 'input-a'), 4);
  } finally {
    f.close();
  }
});
test('explicit pinned-manifest repeat requires new exact batch facts and conserves paid stock each cycle', () => {
  const f = fixture();
  try {
    f.accept(begin());
    f.accept({
      kind: 'experiment',
      session: 'session-1',
      attribute: 'quality',
      points: 1,
      effectPermille: 1000,
    });
    lock(f);
    assign(f);
    step(f);
    const old = f.controller.read().envelope;
    assert.equal(
      f.controller.preview({
        id: 'wrong',
        payload: {
          kind: 'repeat',
          session: 'session-1',
          selections: [
            {
              slot: 'feed',
              container: 'source-b',
              batch: 'input-b',
              quantity: 2,
            },
          ],
        },
      }).reason,
      'repeat-facts',
    );
    assert.equal(f.controller.read().envelope, old);
    f.accept({
      kind: 'repeat',
      session: 'session-1',
      selections: initialSelections(),
    });
    assert.equal(qty(f, 'holding-2', 'input-a'), 1);
    assert.equal(f.controller.read().view.sessions[1].manifest.id, 'plan-1');
    assert.equal(f.controller.read().view.sessions[1].values[0].value, 450);
    assign(f, 'session-2', 'm-b');
    step(f, 'session-2');
    assert.equal(qty(f, 'm-b.output', 'crafted-1'), 1);
    assert.equal(qty(f, 'source-a', 'input-a'), 2);
    assert.equal(f.controller.read().envelope.industry.plans.length, 1);
  } finally {
    f.close();
  }
});
test('capture reentry retires pending authority and bounded arrays reject before reading entries', () => {
  const f = fixture();
  try {
    const bad = new Array(65);
    Object.defineProperty(bad, 0, {
      get() {
        throw Error('entry touched');
      },
    });
    assert.equal(
      f.controller.preview({
        id: 'oversize',
        payload: {
          kind: 'begin',
          recipe: initialRecipe(),
          selections: bad,
          pointBudget: 1,
        },
      }).reason,
      'integer',
    );
    const recipe = structuredClone(initialRecipe());
    Object.defineProperty(recipe, 'id', {
      get() {
        f.controller.dispose();
        return 'sample';
      },
    });
    assert.equal(
      f.controller.preview({ id: 'retire', payload: begin(recipe) }).reason,
      'retired',
    );
    assert.equal(f.controller.read().envelope.sessions.length, 0);
  } finally {
    f.close();
  }
});
test('receipt bound rejects admission without mutating accepted values and exact duplicate stays available', () => {
  const f = fixture();
  try {
    let last;
    for (let i = 0; i < 64; i++)
      last = f.accept({ kind: 'advance', time: i }, `clock-${i}`);
    assert.equal(
      f.controller.preview({
        id: 'over',
        payload: { kind: 'advance', time: 64 },
      }).reason,
      'receipt-capacity',
    );
    assert.equal(f.controller.preview(last.request).status, 'duplicate');
    assert.equal(f.controller.read().envelope.receipts.length, 64);
  } finally {
    f.close();
  }
});
test('joint document UTF8 admission refuses before transferring stock or starting a permanent pending write', () => {
  const f = fixture();
  try {
    const recipe = structuredClone(initialRecipe());
    recipe.attributes = Array.from({ length: 4 }, (_, i) => ({
      id: `${i}${'Ω'.repeat(90)}`,
      weights: Array.from({ length: 16 }, () => ({
        slot: 'feed',
        property: 'grade',
        weight: 1,
      })),
      initialPermille: 500,
      gainPermille: 250,
      effectPermille: 1000,
    }));
    recipe.output.properties = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `${i}${'Ψ'.repeat(90)}`,
        {
          base: 0,
          terms: recipe.attributes.map((a) => ({
            attribute: a.id,
            coefficient: 1,
          })),
        },
      ]),
    );
    let refused = false;
    for (let i = 0; i < 16; i++) {
      const before = f.controller.read().envelope,
        request = { id: `large-${i}`, payload: begin(recipe) },
        candidate = f.controller.preview(request);
      if (candidate.status !== 'prepared') {
        assert.ok(['refused', 'rejected'].includes(candidate.status));
        assert.equal(f.controller.read().pending, false);
        assert.equal(f.controller.read().envelope, before);
        refused = true;
        break;
      }
      f.controller.commit(candidate.candidate);
      assert.equal(f.controller.read().canAcknowledge, true);
      f.controller.acknowledge();
      const raw = f.port.get(runtimeStorageKey);
      assert.ok(raw.length <= 262144);
      assert.ok(
        new TextEncoder().encode(JSON.stringify(f.controller.read().envelope))
          .length <= 262144,
      );
      f.accept(
        { kind: 'cancel-session', session: `session-${i + 1}` },
        `cancel-large-${i}`,
      );
    }
    assert.equal(refused, true);
    assert.equal(qty(f, 'source-a', 'input-a'), 4);
  } finally {
    f.close();
  }
});
test('observed storage conflict remains latched through ABA and blocks autonomous disposal writes', () => {
  const f = fixture();
  try {
    const p = f.preview(begin());
    f.backend.failSet = (k) => k === runtimeStorageKey;
    f.controller.commit(p.candidate);
    f.backend.failSet = () => false;
    f.backend.port(1).set(runtimeStorageKey, 'foreign');
    assert.throws(() => f.port.get(runtimeStorageKey), /external-conflict/);
    f.backend.port(1).remove(runtimeStorageKey);
    f.flush();
    assert.equal(f.backend.port(1).get(runtimeStorageKey), null);
    f.store.dispose();
    assert.equal(f.backend.port(1).get(runtimeStorageKey), null);
  } finally {
    f.close();
  }
});
test('raw UTF8 wrapper bytes are bounded before ignored metadata or canonical data can discard them', () => {
  const backend = new MemoryBackend();
  const raw = JSON.stringify({
    v: 1,
    by: 'Ω'.repeat(140000),
    data: initialRuntimeEnvelope(),
  });
  assert.ok(raw.length < 262144);
  assert.ok(new TextEncoder().encode(raw).length > 262144);
  backend.port(0).set(runtimeStorageKey, raw);
  const f = fixture(backend);
  try {
    assert.ok(f.controller.read().blocked);
    assert.equal(
      f.controller.preview({ id: 'begin', payload: begin() }).status,
      'refused',
    );
  } finally {
    f.close();
  }
});
test('storage guard rejects oversized UTF8 bytes before SaveStore calls the section parser', () => {
  const backend = new MemoryBackend(),
    data = initialRuntimeEnvelope();
  data.version = 999;
  backend
    .port(0)
    .set(
      runtimeStorageKey,
      JSON.stringify({ v: 1, by: 'Ω'.repeat(140000), data }),
    );
  const parse = runtimeSectionDefinition.parse;
  let entered = 0;
  runtimeSectionDefinition.parse = (value) => {
    if (value?.version === 999) entered++;
    return parse(value);
  };
  let f;
  try {
    f = fixture(backend);
    assert.equal(entered, 0);
    assert.ok(f.controller.read().blocked);
  } finally {
    f?.close();
    runtimeSectionDefinition.parse = parse;
  }
});
test('receipt saturation reserves exact cancellation and source-capacity restoration commands', () => {
  for (const blockedReturn of [false, true]) {
    const f = fixture();
    try {
      f.accept(begin());
      if (blockedReturn)
        f.accept({
          kind: 'harvest',
          spawn: 'field',
          incarnation: 0,
          container: 'source-a',
          quantity: 1,
        });
      let refusal;
      for (let i = 0; i < 64; i++) {
        const p = f.controller.preview({
          id: `fill-${i}`,
          payload: { kind: 'advance', time: i },
        });
        if (p.status !== 'prepared') {
          refusal = p;
          break;
        }
        f.controller.commit(p.candidate);
        f.controller.acknowledge();
      }
      assert.match(refusal.reason, /recovery-capacity/);
      assert.equal(f.controller.read().view.sessions[0].phase, 'reserved');
      if (blockedReturn) {
        assert.equal(
          f.controller.preview({
            id: 'blocked-cancel',
            payload: { kind: 'cancel-session', session: 'session-1' },
          }).reason,
          'capacity',
        );
        f.accept(
          { kind: 'resize', container: 'source-a', mass: 50, volume: 25 },
          'recovery-resize'.padEnd(96, '\u0000'),
        );
      }
      f.accept(
        { kind: 'cancel-session', session: 'session-1' },
        'recovery-cancel'.padEnd(96, '\u0000'),
      );
      assert.equal(qty(f, 'holding-1', 'input-a'), 0);
      assert.equal(f.controller.read().view.sessions[0].phase, 'cancelled');
      assert.ok(f.controller.read().envelope.receipts.length <= 64);
      const reload = fixture(f.backend, 1);
      try {
        assert.equal(
          reload.controller.read().view.sessions[0].phase,
          'cancelled',
        );
      } finally {
        reload.close();
      }
    } finally {
      f.close();
    }
  }
});
test('joint byte saturation retains source resize and cancellation admission for a live session', () => {
  const f = fixture();
  try {
    const recipe = structuredClone(initialRecipe());
    recipe.attributes = Array.from({ length: 4 }, (_, i) => ({
      id: `${i}${'Ω'.repeat(90)}`,
      weights: Array.from({ length: 16 }, () => ({
        slot: 'feed',
        property: 'grade',
        weight: 1,
      })),
      initialPermille: 500,
      gainPermille: 250,
      effectPermille: 1000,
    }));
    recipe.output.properties = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `${i}${'Ψ'.repeat(90)}`,
        {
          base: 0,
          terms: recipe.attributes.map((a) => ({
            attribute: a.id,
            coefficient: 1,
          })),
        },
      ]),
    );
    for (let i = 0; i < 16; i++) {
      const p = f.controller.preview({
        id: `fat-${i}`,
        payload: begin(recipe),
      });
      if (p.status !== 'prepared') break;
      f.controller.commit(p.candidate);
      f.controller.acknowledge();
      f.accept(
        { kind: 'cancel-session', session: `session-${i + 1}` },
        `cancel-fat-${i}`,
      );
    }
    const p = f.preview(begin(), 'small-final');
    f.controller.commit(p.candidate);
    f.controller.acknowledge();
    const session = f.controller.read().view.sessions.at(-1).id;
    f.accept(
      {
        kind: 'harvest',
        spawn: 'field',
        incarnation: 0,
        container: 'source-a',
        quantity: 1,
      },
      'refill',
    );
    for (let i = 0; i < 64; i++) {
      const p = f.controller.preview({
        id: `tail-${i}`,
        payload: { kind: 'advance', time: i },
      });
      if (p.status !== 'prepared') break;
      f.controller.commit(p.candidate);
      f.controller.acknowledge();
    }
    f.accept(
      { kind: 'resize', container: 'source-a', mass: 50, volume: 25 },
      'resize-final',
    );
    f.accept({ kind: 'cancel-session', session }, 'cancel-final');
    assert.equal(f.controller.read().view.sessions.at(-1).phase, 'cancelled');
    assert.equal(f.controller.read().pending, false);
  } finally {
    f.close();
  }
});
test('retirement explicitly hands exact failed or saved-unacknowledged candidate to reentry without premature publication', () => {
  for (const flushBeforeResume of [false, true]) {
    const f = fixture();
    let resumed;
    try {
      const accepted = f.controller.read().envelope,
        p = f.preview(begin(), 'pending-begin');
      f.backend.failSet = (k) => k === runtimeStorageKey;
      f.controller.commit(p.candidate);
      const resume = f.controller.dispose();
      assert.equal(f.controller.dispose(), resume);
      f.backend.failSet = () => false;
      if (flushBeforeResume) f.flush();
      resumed = createRuntimeController({
        saveBuild: 'craft@test',
        saveHandle: f.handle,
        readPersisted: () => f.port.get(runtimeStorageKey),
        resume,
      });
      assert.equal(resumed.read().blocked, null);
      assert.deepEqual(resumed.read().envelope, accepted);
      assert.equal(resumed.read().pending, true);
      assert.equal(resumed.retry().status, 'pending');
      assert.deepEqual(resumed.read().envelope, accepted);
      assert.equal(resumed.acknowledge().status, 'accepted');
      assert.equal(resumed.read().view.sessions.length, 1);
      assert.equal(resumed.preview(p.request).status, 'duplicate');
      const reused = createRuntimeController({
        saveBuild: 'craft@test',
        saveHandle: f.handle,
        readPersisted: () => f.port.get(runtimeStorageKey),
        resume,
      });
      assert.equal(reused.read().blocked, 'invalid-continuation');
      reused.dispose();
    } finally {
      resumed?.dispose();
      f.close();
    }
  }
});
test('cold controller refuses dirty memory while displaying only physically accepted state', () => {
  const f = fixture();
  try {
    const p = f.preview(begin());
    f.backend.failSet = (k) => k === runtimeStorageKey;
    f.controller.commit(p.candidate);
    f.controller.dispose();
    const cold = createRuntimeController({
      saveBuild: 'craft@test',
      saveHandle: f.handle,
      readPersisted: () => f.port.get(runtimeStorageKey),
    });
    assert.equal(cold.read().blocked, 'unacknowledged-memory');
    assert.equal(cold.read().view.sessions.length, 0);
    cold.dispose();
  } finally {
    f.close();
  }
});
test('pinned repeat permits identical batches relocated into a different selection ordering', () => {
  const f = fixture();
  try {
    f.accept(begin());
    lock(f);
    assign(f);
    step(f);
    f.accept({
      kind: 'transfer',
      from: 'source-b',
      to: 'buffer',
      batch: 'input-b',
      quantity: 1,
    });
    f.accept({
      kind: 'repeat',
      session: 'session-1',
      selections: initialSelections().map((s) =>
        s.batch === 'input-b' ? { ...s, container: 'buffer' } : s,
      ),
    });
    assert.equal(f.controller.read().view.sessions[1].phase, 'locked');
    assert.equal(qty(f, 'holding-2', 'input-b'), 1);
    assign(f, 'session-2', 'm-b');
    step(f, 'session-2');
    assert.equal(qty(f, 'm-b.output', 'crafted-1'), 1);
  } finally {
    f.close();
  }
});
test('idle machine work capacity can recover after an accepted zero-capacity admission and cancellation', () => {
  const f = fixture();
  try {
    f.accept({ kind: 'resize', container: 'm-a.work', mass: 0, volume: 0 });
    f.accept(begin());
    lock(f);
    assign(f);
    step(f);
    assert.equal(f.controller.read().view.sessions[0].phase, 'assigned');
    assert.equal(
      f.controller.preview({
        id: 'active-resize',
        payload: {
          kind: 'resize',
          container: 'm-a.work',
          mass: 100,
          volume: 100,
        },
      }).reason,
      'claimed-custody',
    );
    f.accept({ kind: 'cancel-session', session: 'session-1' });
    f.accept({ kind: 'resize', container: 'm-a.work', mass: 100, volume: 100 });
    f.accept(begin());
    lock(f, 'session-2');
    assign(f, 'session-2');
    step(f, 'session-2');
    assert.equal(f.controller.read().view.sessions[1].phase, 'completed');
  } finally {
    f.close();
  }
});
test('continuation cannot clear a latched controller conflict or authorize a retired candidate', () => {
  const f = fixture();
  try {
    f.accept(begin());
    const candidate = f.preview({ kind: 'advance', time: 1 });
    const accepted = f.controller.read().envelope;
    f.handle.update(
      (d) => {
        Object.assign(d, structuredClone(candidate.candidate.value));
      },
      { now: false },
    );
    assert.equal(f.controller.read().blocked, 'external-conflict');
    const resume = f.controller.dispose();
    f.handle.update(
      (d) => {
        Object.assign(d, structuredClone(accepted));
      },
      { now: false },
    );
    const next = createRuntimeController({
      saveBuild: 'craft@test',
      saveHandle: f.handle,
      readPersisted: () => f.port.get(runtimeStorageKey),
      resume,
    });
    assert.equal(next.read().blocked, 'external-conflict');
    assert.equal(next.commit(candidate.candidate).status, 'refused');
    next.dispose();
  } finally {
    f.close();
  }
});
