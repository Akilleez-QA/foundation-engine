import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore} from '../../src/core/save/store.ts';
import {MemoryBackend} from '../../src/core/save/storage-port.ts';
import {
  createWorkbenchController,
  createWorkbenchStoragePort,
  initialEnvelope,
  parseEnvelope,
  sectionDefinition,
  storageKey,
} from './controller.mjs';
function fixture(backend = new MemoryBackend(), tab = 0) {
  const port = createWorkbenchStoragePort(backend.port(tab)),
    pending = new Map();
  let timer = 0;
  const store = createSaveStore({
    namespace: 'progression-workbench',
    build: 'test',
    local: port,
    session: new MemoryBackend().port(0, 'session'),
    timers: {
      now: () => 0,
      set: fn => {
        pending.set(++timer, fn);
        return timer;
      },
      clear: id => pending.delete(id),
    },
  });
  const handle = store.section(sectionDefinition),
    controller = createWorkbenchController({
      saveHandle: handle,
      hasEnvelope: () => backend.data.has(storageKey),
      readPersisted: () => port.get(storageKey),
    });
  let id = 0;
  const command = (payload, name = String(++id)) => ({epoch: 'sample-epoch-v1', id: name, payload});
  const accept = (payload, name) => {
    const c = command(payload, name),
      preview = controller.preview(c);
    assert.equal(preview.status, 'prepared', JSON.stringify(preview));
    assert.equal(controller.commit(preview.candidate).status, 'accepted');
    return c;
  };
  return {
    backend,
    store,
    handle,
    controller,
    command,
    accept,
    flush() {
      for (const [id, fn] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
    close() {
      controller.dispose();
      store.dispose();
    },
  };
}
const learn = skill => ({kind: 'learn', skill}),
  surrender = skill => ({kind: 'surrender', skill});
test('coherent allocation: blocked awards, numeric trace, shared contributors and pure previews', () => {
  const f = fixture();
  try {
    const c = f.controller,
      before = c.read().envelope;
    assert.equal(c.read().durable, false);
    assert.equal(c.preview(f.command(learn('alpha'))).reason, 'capacity');
    assert.deepEqual(c.read().envelope, before);
    f.accept({kind: 'free'});
    f.accept(learn('alpha'));
    f.accept(learn('beta'));
    f.accept(learn('advanced'));
    const state = c.read();
    assert.equal(state.view.capacity, 30);
    assert.equal(state.view.trace.additive, 5);
    assert.equal(state.view.trace.multiplier, 2);
    assert.equal(state.view.trace.base, 10);
    assert.deepEqual(state.view.grants.find(g => g.id === 'access').sources, [
      'skill:alpha',
      'skill:beta',
      'external:tutorial',
    ]);
    assert.equal(state.envelope.resources.capacity.current, 8);
    assert.equal(c.preview(f.command(surrender('alpha'))).reason, 'dependent');
    assert.equal(c.preview(f.command(surrender('advanced'))).reason, 'insufficient');
    assert.deepEqual(c.read().envelope, state.envelope);
    f.accept({kind: 'voucher'});
    const candidate = c.preview(f.command(surrender('advanced')));
    assert.equal(candidate.status, 'prepared');
    assert.equal(candidate.view.capacity, 15);
    assert.equal(c.read().view.capacity, 30);
    f.accept({kind: 'earn', amount: 1});
    assert.equal(c.commit(candidate.candidate).status, 'stale');
    const fresh = c.preview(f.command(surrender('advanced')));
    c.cancel(fresh.candidate);
    assert.equal(c.commit(fresh.candidate).status, 'stale');
    f.accept(surrender('advanced'));
    f.accept({kind: 'voucher'});
    f.accept(surrender('alpha'));
    assert.deepEqual(c.read().view.grants[0].sources, ['skill:beta', 'external:tutorial']);
    f.accept({kind: 'voucher'});
    f.accept(surrender('beta'));
    assert.deepEqual(c.read().view.grants[0].sources, ['external:tutorial']);
    assert.equal(c.read().view.capacity, 10);
  } finally {
    f.close();
  }
});
test('resource quantities couple to capacity shrink without refill; fractional and discrete policies explicit', () => {
  const f = fixture();
  try {
    f.accept({kind: 'free'});
    f.accept(learn('alpha'));
    f.accept({kind: 'adjust', resource: 'capacity', delta: 4});
    assert.equal(f.controller.read().view.resources.capacity.current, 12);
    f.accept({kind: 'adjust', resource: 'continuous', delta: -0.125});
    assert.equal(f.controller.read().view.resources.continuous.current, 0.625);
    const before = f.controller.read().envelope;
    assert.equal(
      f.controller.preview(f.command({kind: 'adjust', resource: 'capacity', delta: 0.5})).reason,
      'precision',
    );
    assert.deepEqual(f.controller.read().envelope, before);
    f.accept({kind: 'voucher'});
    const p = f.controller.preview(f.command(surrender('alpha')));
    assert.equal(p.view.resources.capacity.current, 10);
    assert.equal(f.controller.read().view.resources.capacity.current, 12);
    f.controller.commit(p.candidate);
    assert.equal(f.controller.read().view.resources.capacity.current, 10);
    assert.deepEqual(parseEnvelope(f.handle.get()), f.handle.get());
  } finally {
    f.close();
  }
});
test('exact receipt retries survive reload; conflicts epoch full history and forged tickets refuse', () => {
  const f = fixture();
  try {
    const receipt = f.accept({kind: 'free'}, 'release');
    const restored = fixture(f.backend, 1);
    try {
      assert.equal(restored.controller.preview(receipt).status, 'duplicate');
      assert.equal(restored.controller.preview({...receipt, payload: {kind: 'voucher'}}).reason, 'conflict');
      assert.equal(restored.controller.preview({...receipt, epoch: 'old'}).reason, 'epoch');
      assert.equal(restored.controller.commit({}).status, 'stale');
    } finally {
      restored.close();
    }
    for (let i = 0; i < 23; i++) f.accept({kind: 'adjust', resource: 'continuous', delta: 0}, `noop${i}`);
    assert.equal(f.controller.read().envelope.receipts.length, 24);
    assert.equal(f.controller.preview(f.command({kind: 'voucher'}, 'full')).reason, 'history-full');
    assert.equal(f.controller.preview(receipt).status, 'duplicate');
    const p = f.controller.read().envelope;
    const bad = structuredClone(p);
    bad.inventory = initialEnvelope().inventory;
    assert.throws(() => parseEnvelope(bad));
    const extra = structuredClone(p);
    extra.resources.continuous.extra = true;
    assert.throws(() => parseEnvelope(extra));
  } finally {
    f.close();
  }
});
test('failed writes retain accepted memory; retry and automatic retry write latest only', () => {
  const f = fixture();
  try {
    f.accept({kind: 'free'});
    const prior = f.backend.data.get(storageKey);
    f.backend.failSet = k => k === storageKey;
    const receipt = f.accept(learn('alpha'), 'alpha');
    assert.equal(f.controller.read().durable, false);
    assert.equal(f.controller.read().saveStatus, 'session');
    assert.equal(f.backend.data.get(storageKey), prior);
    f.accept(learn('beta'), 'beta');
    assert.equal(f.controller.preview(receipt).status, 'duplicate');
    assert.equal(f.backend.data.get(storageKey), prior);
    f.backend.failSet = () => false;
    f.flush();
    assert.equal(f.controller.read().durable, true);
    assert.deepEqual(JSON.parse(f.backend.data.get(storageKey)).data.progression.learned, ['alpha', 'beta']);
    const reload = fixture(f.backend, 1);
    try {
      assert.deepEqual(reload.controller.read().envelope.progression.learned, ['alpha', 'beta']);
      assert.equal(reload.controller.preview(receipt).status, 'duplicate');
    } finally {
      reload.close();
    }
  } finally {
    f.close();
  }
});
test('failed teardown reloads old durable state; explicit retry later has no duplicate consequence', () => {
  const f = fixture();
  f.accept({kind: 'free'});
  f.backend.failSet = k => k === storageKey;
  const receipt = f.accept(learn('alpha'), 'alpha');
  const candidate = f.controller.preview(f.command(learn('beta'))).candidate;
  f.close();
  assert.equal(f.controller.commit(candidate).reason, 'retired');
  const reload = fixture(f.backend, 1);
  try {
    assert.deepEqual(reload.controller.read().envelope.progression.learned, []);
    reload.backend.failSet = () => false;
    const p = reload.controller.preview(receipt);
    assert.equal(p.status, 'prepared');
    reload.controller.commit(p.candidate);
    reload.controller.save();
    assert.equal(reload.controller.read().durable, true);
  } finally {
    reload.close();
  }
});
test('corruption and read failure block fallback edits; coherent replay rejects independently tampered facts', () => {
  const backend = new MemoryBackend();
  backend.data.set(storageKey, JSON.stringify({v: 1, by: 'test', data: {...initialEnvelope(), resources: {}}}));
  const f = fixture(backend);
  try {
    assert.ok(f.controller.read().blocked);
    assert.equal(f.controller.preview(f.command({kind: 'free'})).status, 'refused');
    assert.ok(f.store.quarantine().length);
    assert.equal(f.controller.save().status, 'refused');
  } finally {
    f.close();
  }
  const badRead = new MemoryBackend();
  badRead.failGet = k => k === storageKey;
  const g = fixture(badRead);
  try {
    assert.ok(g.controller.read().blocked);
    assert.equal(g.controller.preview(g.command({kind: 'free'})).status, 'refused');
  } finally {
    g.close();
  }
  const h = fixture();
  try {
    h.accept({kind: 'free'});
    h.accept(learn('alpha'));
    const value = h.controller.read().envelope;
    for (const key of ['progression', 'inventory', 'resources', 'external']) {
      const bad = structuredClone(value);
      bad[key] = key === 'external' ? [] : initialEnvelope()[key];
      assert.throws(() => parseEnvelope(bad));
    }
    assert.throws(() => parseEnvelope({...value, unknown: 1}));
  } finally {
    h.close();
  }
});
test('command getters cannot reenter mutation or change captured identity; candidate is owner-local', () => {
  const f = fixture();
  try {
    let nested;
    const input = {
      epoch: 'sample-epoch-v1',
      id: 'release',
      get payload() {
        nested = f.controller.preview(f.command({kind: 'voucher'}));
        return {kind: 'free'};
      },
    };
    const p = f.controller.preview(input);
    assert.equal(p.status, 'prepared');
    assert.equal(nested.reason, 'busy');
    f.controller.commit(p.candidate);
    const g = fixture();
    try {
      assert.equal(g.controller.commit(p.candidate).status, 'stale');
    } finally {
      g.close();
    }
  } finally {
    f.close();
  }
});
test('valid external writer conflict is preserved during automatic retry, and blocks further controller edits', () => {
  const backend = new MemoryBackend(),
    a = fixture(backend, 0);
  a.accept({kind: 'free'}, 'release');
  const b = fixture(backend, 1);
  try {
    backend.failSet = k => k === storageKey;
    a.accept(learn('alpha'), 'alpha');
    backend.failSet = () => false;
    b.accept(learn('beta'), 'beta');
    const theirs = backend.data.get(storageKey);
    a.flush();
    assert.equal(backend.data.get(storageKey), theirs);
    assert.equal(a.controller.read().blocked, 'external-conflict');
    assert.equal(a.controller.save().status, 'refused');
    assert.deepEqual(a.controller.read().envelope.progression.learned, ['alpha']);
  } finally {
    a.close();
    b.close();
  }
});
test('observed external deletion refuses recreating storage; seed command collision is atomic', () => {
  const f = fixture();
  try {
    f.accept({kind: 'free'});
    const before = f.controller.read().envelope;
    assert.equal(f.controller.preview(f.command(learn('alpha'), 'seed')).reason, 'conflict');
    assert.deepEqual(f.controller.read().envelope, before);
    f.backend.data.delete(storageKey);
    assert.equal(f.controller.read().blocked, 'external-conflict');
    assert.equal(f.controller.save().status, 'refused');
    assert.equal(f.controller.preview(f.command(learn('alpha'))).status, 'refused');
    assert.equal(f.backend.data.has(storageKey), false);
  } finally {
    f.close();
  }
});
test('explicit retry writes exact latest candidate once; corrupt storage remains blocked across reload', () => {
  const f = fixture();
  try {
    f.accept({kind: 'free'});
    f.backend.failSet = k => k === storageKey;
    const receipt = f.accept(learn('alpha'));
    const accepted = f.controller.read().envelope;
    f.backend.failSet = () => false;
    assert.equal(f.controller.save().durable, true);
    assert.deepEqual(JSON.parse(f.backend.data.get(storageKey)).data, accepted);
    const reload = fixture(f.backend, 1);
    try {
      assert.equal(reload.controller.preview(receipt).status, 'duplicate');
      assert.deepEqual(reload.controller.read().envelope, accepted);
    } finally {
      reload.close();
    }
  } finally {
    f.close();
  }
  const backend = new MemoryBackend();
  backend.data.set(storageKey, 'broken');
  const first = fixture(backend);
  first.close();
  const second = fixture(backend);
  try {
    assert.ok(second.controller.read().blocked);
    assert.equal(second.controller.preview(second.command({kind: 'free'})).status, 'refused');
    assert.equal(backend.data.get(storageKey), 'broken');
  } finally {
    second.close();
  }
});
test('sample port preserves deletion and malformed external writes during autosave and teardown races', () => {
  for (const changed of [null, 'malformed-external'])
    for (const teardown of [false, true]) {
      const f = fixture();
      f.accept({kind: 'free'});
      f.backend.failSet = k => k === storageKey;
      f.accept(learn('alpha'));
      assert.equal(f.controller.read().blocked, null);
      // Change bytes after the last controller check and before an autonomous flush.
      f.backend.failSet = () => false;
      if (changed === null) f.backend.data.delete(storageKey);
      else f.backend.data.set(storageKey, changed);
      if (teardown) f.close();
      else {
        f.flush();
        f.close();
      }
      assert.equal(f.backend.data.get(storageKey) ?? null, changed);
    }
});
test('idle reads share immutable accepted projections; preview, publication and durability refresh independently', () => {
  const f = fixture();
  try {
    const initial = f.controller.read();
    assert.strictEqual(f.controller.read().view, initial.view);
    const preview = f.controller.preview(f.command({kind: 'free'}));
    assert.equal(preview.view.blockers, 0);
    assert.strictEqual(f.controller.read().view, initial.view);
    assert.equal(initial.view.blockers, 3);
    f.controller.commit(preview.candidate);
    const freed = f.controller.read();
    assert.notStrictEqual(freed.view, initial.view);
    assert.equal(freed.view.blockers, 0);
    assert.strictEqual(f.controller.read().view, freed.view);
    f.backend.failSet = k => k === storageKey;
    f.accept(learn('alpha'));
    const unsaved = f.controller.read();
    assert.equal(unsaved.durable, false);
    assert.equal(unsaved.saveStatus, 'session');
    assert.equal(unsaved.view.capacity, 12);
    f.backend.failSet = () => false;
    f.flush();
    const durable = f.controller.read();
    assert.equal(durable.durable, true);
    assert.equal(durable.saveStatus, 'saved');
    assert.strictEqual(durable.view, unsaved.view);
    const discarded = f.controller.preview(f.command(learn('beta')));
    f.controller.cancel(discarded.candidate);
    assert.strictEqual(f.controller.read().view, durable.view);
    assert.equal(f.controller.read().message, 'Candidate cancelled.');
    f.close();
    assert.equal(f.controller.read().retired, true);
    assert.strictEqual(f.controller.read().view, durable.view);
  } finally {
    f.close();
  }
});
test('cached save observations still detect corrupt, deleted and valid changed bytes', () => {
  for (const change of ['corrupt', 'delete', 'valid']) {
    const f = fixture();
    try {
      f.accept({kind: 'free'});
      const accepted = f.controller.read();
      assert.equal(f.controller.read().durable, true);
      if (change === 'corrupt') f.backend.data.set(storageKey, 'broken');
      else if (change === 'delete') f.backend.data.delete(storageKey);
      else f.backend.data.set(storageKey, JSON.stringify({v: 1, by: 'other', data: initialEnvelope()}));
      const changed = f.controller.read();
      assert.ok(changed.blocked);
      assert.equal(changed.durable, false);
      assert.strictEqual(changed.view, accepted.view);
      assert.equal(f.controller.save().status, 'refused');
    } finally {
      f.close();
    }
  }
});
