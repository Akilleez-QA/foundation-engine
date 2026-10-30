import test from 'node:test';
import assert from 'node:assert/strict';
import {authorSaveHandle} from './save-handle';
import {defineSaveSection, defineScene} from './defs';
import {testScene} from './testing';
import {createSaveStore} from '../core/save/store';
import {MemoryBackend} from '../core/save/storage-port';
const definition = defineSaveSection({id: 'author.document', scope: 'device', initial: {json: 'old'}});
const key = 'author-test|device|author.document';
const sceneDefinition = defineScene({id: 'save-test', title: 'Save test'});
function store(backend: MemoryBackend, tab = 0) {
  return createSaveStore({
    local: backend.port(tab),
    session: new MemoryBackend().port(tab, 'session'),
    namespace: 'author-test',
    build: 'test',
    timers: {set: () => 0, clear: () => {}, now: () => 0},
  });
}

test('runtime adapter and injected testScene report quota failure, preserve old bytes, and retry for fresh reload', async () => {
  for (const headless of [false, true]) {
    const backend = new MemoryBackend(),
      save = store(backend);
    const scene = headless ? await testScene(sceneDefinition, {services: {save}}) : null;
    const handle = scene ? scene.ctx.save(definition) : authorSaveHandle(save, definition);
    if (scene) assert.equal(scene.ctx.service('save'), save);
    assert.equal(
      handle.update(
        draft => {
          draft.json = 'seed';
        },
        {now: true},
      ),
      'saved',
    );
    const previous = backend.data.get(key);
    assert.equal(JSON.parse(previous!).data.json, 'seed');
    backend.failSet = () => true;
    assert.equal(
      handle.update(
        draft => {
          draft.json = 'new';
        },
        {now: true},
      ),
      'session',
    );
    assert.equal(handle.status(), 'session');
    assert.equal(handle.get().json, 'new');
    assert.equal(backend.data.get(key), previous);
    const beforeRetry = store(backend, 1);
    assert.equal(beforeRetry.section(definition.section).get().json, 'seed');
    beforeRetry.dispose();
    backend.failSet = () => false;
    assert.equal(
      handle.update(() => {}, {now: true}),
      'saved',
    );
    assert.equal(handle.status(), 'saved');
    assert.equal(JSON.parse(backend.data.get(key)!).data.json, 'new');
    const reloaded = store(backend, 2);
    assert.equal(reloaded.section(definition.section).get().json, 'new');
    reloaded.dispose();
    scene?.dispose();
    assert.equal(save.section(definition.section).get().json, 'new', 'injected store stays caller-owned');
    save.dispose();
  }
});

test('subscriber throws after memory publication; author handle reports actual dirty state without rollback', async () => {
  const backend = new MemoryBackend(),
    save = store(backend),
    scene = await testScene(sceneDefinition, {services: {save}});
  const handle = scene.ctx.save(definition);
  handle.update(
    draft => {
      draft.json = 'seed';
    },
    {now: true},
  );
  const previous = backend.data.get(key);
  const unsubscribe = save.section(definition.section).subscribe(() => {
    throw Error('subscriber failed');
  });
  assert.throws(
    () =>
      handle.update(
        draft => {
          draft.json = 'new';
        },
        {now: true},
      ),
    /subscriber failed/,
  );
  assert.equal(handle.get().json, 'new');
  assert.equal(handle.status(), 'dirty');
  assert.equal(backend.data.get(key), previous);
  unsubscribe();
  assert.equal(
    handle.update(() => {}, {now: true}),
    'saved',
  );
  scene.dispose();
  save.dispose();
});

test('default testScene uses real save parsing, freezing, statuses and explicit flush without real timers', async () => {
  let exited = 0;
  const scene = await testScene(
    defineScene({
      id: 'default-save',
      title: 'Default save',
      exit() {
        exited++;
      },
    }),
  );
  const handle = scene.ctx.save(definition),
    save = scene.ctx.service('save');
  assert.equal(handle.status(), 'saved'); // Fresh defaults: not a durable-save receipt.
  assert.ok(Object.isFrozen(handle.get()));
  assert.equal(
    handle.update(draft => {
      draft.json = 'new';
    }),
    'dirty',
  );
  assert.equal(handle.status(), 'dirty');
  assert.ok(save.flush('test').written.length > 0);
  assert.equal(handle.status(), 'saved');
  const before = handle.get();
  assert.throws(() =>
    handle.update(draft => {
      (draft as unknown as {json: number}).json = 8;
    }),
  );
  assert.equal(handle.get(), before);
  assert.equal(
    handle.update(() => ({json: 'ignored-return'}), {now: true}),
    'saved',
  );
  assert.equal(handle.get().json, 'new', 'author callbacks remain mutation-only');
  scene.dispose();
  scene.dispose();
  assert.equal(exited, 1);
  assert.throws(() => handle.get(), /disposed/i);
  assert.throws(() => scene.run(1), /disposed/);
});

test('fresh defaults are not an envelope and unreadable/newer data retain distinct statuses', () => {
  const backend = new MemoryBackend(),
    save = store(backend),
    handle = authorSaveHandle(save, definition);
  assert.equal(handle.status(), 'saved');
  assert.equal(backend.data.has(key), false);
  save.dispose();
  backend.data.set(key, JSON.stringify({v: 99, by: 'future', data: {json: 'future'}}));
  const newer = store(backend);
  assert.equal(authorSaveHandle(newer, definition).status(), 'newer');
  newer.dispose();
  backend.failGet = k => k === key;
  const denied = store(backend);
  assert.equal(authorSaveHandle(denied, definition).status(), 'unavailable');
  denied.dispose();
});
test('headless eager updates schedule no real timers and failing lifecycle hooks dispose owned saves', async () => {
  const scene = await testScene(sceneDefinition);
  const original = globalThis.setTimeout;
  try {
    globalThis.setTimeout = (() => {
      throw Error('real timer scheduled');
    }) as unknown as typeof setTimeout;
    assert.equal(
      scene.ctx.save(definition).update(draft => {
        draft.json = 'queued';
      }),
      'dirty',
    );
  } finally {
    globalThis.setTimeout = original;
    scene.dispose();
  }
  let leaked: ReturnType<typeof authorSaveHandle<{json: string}>> | undefined;
  await assert.rejects(
    testScene(
      defineScene({
        id: 'enter-failure',
        title: 'Failure',
        enter(ctx) {
          leaked = ctx.save(definition);
          throw Error('enter failed');
        },
      }),
    ),
    /enter failed/,
  );
  assert.throws(() => leaked!.status(), /disposed/i);
  const exitFailure = await testScene(
    defineScene({
      id: 'exit-failure',
      title: 'Failure',
      exit() {
        throw Error('exit failed');
      },
    }),
  );
  const retained = exitFailure.ctx.save(definition);
  assert.throws(() => exitFailure.dispose(), /exit failed/);
  assert.throws(() => retained.status(), /disposed/i);
  exitFailure.dispose();
});
