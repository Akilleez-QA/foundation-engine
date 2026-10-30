import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore} from '../../src/core/save/store.ts';
import {MemoryBackend} from '../../src/core/save/storage-port.ts';
import {authorSaveHandle} from '../../src/author/save-handle.ts';
import {
  captureRecipe,
  initialRecipe,
  initialStock,
  evaluateRecipe,
  recipeSectionDefinition,
  recipeStorageKey,
  createRecipeStoragePort,
} from './recipe.mjs';
import {createEditorController} from './editor-controller.mjs';
function fixture(backend = new MemoryBackend()) {
  const raw = backend.port(0),
    port = createRecipeStoragePort(raw),
    store = createSaveStore({
      namespace: 'crafting-workbench',
      build: 'test',
      local: port,
      session: new MemoryBackend().port(0, 'session'),
      timers: {now: () => 0, set: () => 0, clear: () => {}},
    }),
    handle = authorSaveHandle(store, {section: recipeSectionDefinition}),
    c = createEditorController({
      saveHandle: handle,
      readPersisted: () => port.get(recipeStorageKey),
      saveBuild: 'test',
    });
  return {
    raw,
    store,
    c,
    close() {
      c.dispose();
      store.dispose();
    },
  };
}
const changed = () => {
  const r = structuredClone(initialRecipe());
  r.attributes[0].initialPermille = 750;
  return r;
};
test('canonical recipe is detached, same labels permit distinct facts, real evaluator preserves source stock', () => {
  const r = changed(),
    captured = captureRecipe(r),
    stock = initialStock(),
    before = JSON.stringify(stock);
  r.attributes[0].weights[0].weight = 9;
  assert.equal(captured.attributes[0].weights[0].weight, 1);
  assert.ok(Object.isFrozen(captured.output.massMg));
  assert.equal(captured.version, initialRecipe().version);
  assert.equal(evaluateRecipe(captured, undefined, stock).values[0].value, 450);
  assert.equal(JSON.stringify(stock), before);
});
test('schema admission rejects bounds and bad references before preview; raw UTF8 cannot hide behind duplicate fields', () => {
  const r = changed();
  r.attributes[0].weights[0].slot = 'missing';
  assert.throws(() => captureRecipe(r));
  r.attributes[0].weights[0].slot = 'feed';
  r.attributes[0].effectPermille = 1001;
  assert.throws(() => captureRecipe(r));
  assert.throws(
    () => captureRecipe('{"discard":"' + '界'.repeat(50000) + '",' + JSON.stringify(initialRecipe()).slice(1)),
    /byte/,
  );
});
test('editor preview is isolated; invalid edit clears candidate, valid incompatible recipe remains editable', () => {
  const f = fixture();
  try {
    assert.equal(f.c.read().durable, false);
    assert.equal(f.c.preview(changed()).status, 'prepared');
    assert.equal(f.c.read().recipe.attributes[0].initialPermille, 500);
    assert.equal(f.c.read().evaluation.values[0].value, 450);
    assert.equal(f.c.preview('{broken').status, 'rejected');
    assert.equal(f.c.read().candidate, null);
    const r = changed();
    r.slots[0].materials = ['other'];
    assert.equal(f.c.preview(r).status, 'prepared');
    assert.equal(f.c.read().evaluation.status, 'incompatible');
    assert.equal(f.c.commit().status, 'accepted');
  } finally {
    f.close();
  }
});
test('author adapter save, undo/redo and reload preserve committed same-version recipe truthfully', () => {
  const backend = new MemoryBackend(),
    f = fixture(backend);
  f.c.preview(changed());
  f.c.commit();
  assert.equal(f.c.save().status, 'saved');
  assert.equal(JSON.parse(f.raw.get(recipeStorageKey)).data.attributes[0].initialPermille, 750);
  f.c.undo();
  assert.equal(f.c.read().durable, false);
  assert.doesNotMatch(f.c.read().message, /saved/);
  f.c.redo();
  assert.equal(f.c.read().durable, true);
  f.close();
  const restored = fixture(backend);
  try {
    assert.equal(restored.c.read().recipe.attributes[0].initialPermille, 750);
    assert.equal(restored.c.read().blocked, null);
  } finally {
    restored.close();
  }
});
test('newer and corrupt bytes block recovery without silently accepting initial economy', () => {
  for (const raw of ['broken', JSON.stringify({v: 99, by: 'new', data: initialRecipe()})]) {
    const backend = new MemoryBackend();
    backend.port(0).set(recipeStorageKey, raw);
    const f = fixture(backend);
    try {
      assert.ok(f.c.read().blocked);
      assert.equal(f.c.preview(changed()).status, 'refused');
    } finally {
      f.close();
    }
  }
});
test('external bytes remain untouched through automatic flush and disposal', () => {
  const f = fixture();
  f.c.preview(changed());
  f.c.commit();
  const foreign = JSON.stringify({v: 1, by: 'other', data: initialRecipe()});
  f.raw.set(recipeStorageKey, foreign);
  assert.ok(f.c.read().blocked);
  f.store.flush();
  f.close();
  assert.equal(f.raw.get(recipeStorageKey), foreign);
});
test('retirement during semantic intake cannot publish a candidate or revive editor', () => {
  const f = fixture(),
    r = changed();
  Object.defineProperty(r, 'id', {
    get() {
      f.c.dispose();
      return 'late';
    },
  });
  assert.equal(f.c.preview(r).status, 'retired');
  assert.equal(f.c.read().retired, true);
  assert.equal(f.c.read().candidate, null);
  f.store.dispose();
});
test('failed save retains authored value; later external replacement defeats autonomous retry', () => {
  const backend = new MemoryBackend(),
    f = fixture(backend);
  f.c.preview(changed());
  f.c.commit();
  backend.failSet = () => true;
  assert.equal(f.c.save().status, 'unsaved');
  assert.equal(f.c.read().recipe.attributes[0].initialPermille, 750);
  backend.failSet = () => false;
  const foreign = JSON.stringify({
    v: 1,
    by: 'external',
    data: initialRecipe(),
  });
  f.raw.set(recipeStorageKey, foreign);
  assert.ok(f.c.read().blocked);
  f.store.flush();
  f.close();
  assert.equal(f.raw.get(recipeStorageKey), foreign);
});
test('failed save retries exact authored definition without touching preview material', () => {
  const backend = new MemoryBackend(),
    f = fixture(backend);
  try {
    f.c.preview(changed());
    f.c.commit();
    backend.failSet = () => true;
    assert.equal(f.c.save().status, 'unsaved');
    backend.failSet = () => false;
    assert.equal(f.c.save().status, 'saved');
    assert.equal(f.c.read().durable, true);
  } finally {
    f.close();
  }
});
test('observed external conflict remains latched when bytes return to previously absent state', () => {
  const backend = new MemoryBackend(),
    f = fixture(backend);
  f.c.preview(changed());
  f.c.commit();
  backend.failSet = () => true;
  assert.equal(f.c.save().status, 'unsaved');
  backend.failSet = () => false;
  f.raw.set(recipeStorageKey, JSON.stringify({v: 1, by: 'external', data: initialRecipe()}));
  assert.ok(f.c.read().blocked);
  f.raw.remove(recipeStorageKey);
  f.store.flush();
  assert.equal(f.raw.get(recipeStorageKey), null);
  f.close();
  assert.equal(f.raw.get(recipeStorageKey), null);
});
test('raw restored envelope UTF8 bound precedes canonical field discard', () => {
  const backend = new MemoryBackend(),
    raw = JSON.stringify({
      v: 1,
      by: 'test',
      data: {...initialRecipe(), ignored: '界'.repeat(50000)},
    });
  assert.ok(raw.length < 131072);
  backend.port(0).set(recipeStorageKey, raw);
  const f = fixture(backend);
  try {
    assert.ok(f.c.read().blocked);
    assert.equal(f.c.read().durable, false);
    assert.equal(f.c.preview(changed()).status, 'refused');
  } finally {
    f.close();
  }
});
test('synthetic admission preserves prototype-named property facts accepted by real evaluator', () => {
  const recipe = structuredClone(initialRecipe()),
    stock = initialStock();
  recipe.attributes[0].weights[0].property = '__proto__';
  for (const batch of stock.batches) batch.properties = JSON.parse('{"__proto__":500}');
  const captured = captureRecipe(recipe);
  assert.equal(captured.attributes[0].weights[0].property, '__proto__');
  assert.deepEqual(evaluateRecipe(captured, undefined, stock).values, [{id: 'quality', ceiling: 500, value: 250}]);
});
test('storage port refuses oversized raw envelopes before SaveStore invokes recipe parser and remains latched', () => {
  for (const ignored of ['界'.repeat(50000), 'x'.repeat(140000)]) {
    const backend = new MemoryBackend(),
      raw = backend.port(0);
    raw.set(
      recipeStorageKey,
      JSON.stringify({
        v: 1,
        by: 'test',
        data: {...initialRecipe(), ignored},
      }),
    );
    const port = createRecipeStoragePort(raw);
    let parses = 0;
    const section = {
        ...recipeSectionDefinition,
        parse: value => {
          parses++;
          return captureRecipe(value);
        },
      },
      store = createSaveStore({
        namespace: 'crafting-workbench',
        build: 'test',
        local: port,
        session: new MemoryBackend().port(0, 'session'),
        timers: {now: () => 0, set: () => 0, clear: () => {}},
      }),
      handle = authorSaveHandle(store, {section});
    assert.equal(handle.status(), 'unavailable');
    assert.equal(parses, 0);
    raw.remove(recipeStorageKey);
    assert.throws(() => port.get(recipeStorageKey), /external-conflict/);
    assert.equal(handle.status(), 'unavailable');
    assert.equal(parses, 0);
    store.dispose();
    assert.equal(raw.get(recipeStorageKey), null);
  }
});
