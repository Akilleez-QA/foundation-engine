import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../core/app';
import { saveModule } from '../../core/save/module';
import { MemoryBackend } from '../../core/save/storage-port';
import { installFakeDom } from '../../testing/fake-dom';
import { inputModule } from './module';
import { controlsSettingsModule } from './controls-settings-module';
import { bindControlsSettings, controlsSettingsSection } from './controls-settings';
import { BACK } from './actions';

const timers = { set: () => 0, clear() {}, now: () => 0 };
const options = { id: 'preferences.controls', scope: 'player' as const };
function setup(doc: Document, disk = new MemoryBackend()) {
  const app = createApp([
    inputModule({ doc: () => doc }), controlsSettingsModule(options),
    saveModule({ namespace: 'controls-test', build: 'controls-test@1', timers,
      storage: () => ({ local: disk.port(), session: new MemoryBackend().port(0, 'session') }) }),
  ], { mode: 'test', log() {} });
  return { app, disk };
}

test('optional composed controls module persists overrides and follows player ownership', async () => {
  const fake = installFakeDom();
  const { app, disk } = setup(fake.document as unknown as Document);
  let next: ReturnType<typeof setup>['app'] | undefined;
  try {
    const result = await app.boot();
    assert.ok(result.modules.every(row => row.status === 'installed'));
    const defaults = app.services.input.effective(BACK);
    const controls = app.services.controlsSettings;
    const value = { [BACK]: { keys: ['q'] }, 'absent.action': { pad: ['x' as const] } };
    controls.set(value);
    value[BACK].keys[0] = 'z';
    assert.deepEqual(app.services.input.effective(BACK), { keys: ['q'], pad: defaults.pad });
    assert.ok(Object.isFrozen(controls.get()[BACK].keys));
    app.services.save.flush('test');
    const other = app.services.save.addPlayer('Other');
    app.services.save.setActivePlayer(other);
    assert.deepEqual(app.services.input.effective(BACK), defaults);
    controls.set({ [BACK]: { keys: [] } });
    assert.deepEqual(app.services.input.effective(BACK).keys, []);
    app.services.save.setActivePlayer('1');
    assert.deepEqual(app.services.input.effective(BACK).keys, ['q']);
    app.dispose();
    next = setup(fake.document as unknown as Document, disk).app;
    await next.boot();
    assert.deepEqual(next.services.input.effective(BACK).keys, ['q']);
    assert.deepEqual(next.services.controlsSettings.get()['absent.action'].pad, ['x']);
    next.services.controlsSettings.reset();
    assert.deepEqual(next.services.input.effective(BACK), defaults);
  } finally { next?.dispose(); app.dispose(); fake.restore(); }
});

test('saved controls reject malformed or oversized bindings and detach nested values', () => {
  const section = controlsSettingsSection({ ...options, maxChars: 100 });
  for (const raw of [null, [], { a: null }, { a: { keys: [null] } }, { a: { keys: Array(1) } },
    { a: { pad: ['unknown'] } }, { a: { keys: ['white space'] } }, { a: { other: [] } },
    { a: { keys: ['x'.repeat(101)] } }]) {
    assert.throws(() => section.parse(raw));
  }
  for (const maxChars of [0, Infinity, NaN, 3.5]) assert.throws(() => controlsSettingsSection({ ...options, maxChars }));
  const source = { a: { keys: ['code:KeyW'], pad: [] } };
  const snapshot = section.parse(source);
  source.a.keys.push('q');
  assert.deepEqual(snapshot.a.keys, ['code:KeyW']);
  assert.deepEqual(snapshot.a.pad, []);
});

test('reentrant saved remaps keep the newest value and disposal stops subscriptions', async () => {
  const fake = installFakeDom();
  const { app } = setup(fake.document as unknown as Document);
  try {
    await app.boot();
    const controls = app.services.controlsSettings;
    let cancels = 0;
    const off = app.services.input.onCancel(reason => {
      if (reason === 'remap') { cancels++; controls.set({ [BACK]: { keys: ['n'] } }); }
    });
    controls.set({ [BACK]: { keys: ['o'] } });
    assert.equal(cancels, 1, 'nested remapping does not recurse through cancellation listeners');
    assert.deepEqual(app.services.input.effective(BACK).keys, ['n']);
    assert.deepEqual(controls.get()[BACK].keys, ['n']);
    off();
    controls.dispose();
    app.services.save.section(app.registries.saveSections.get(options.id)).replace({ [BACK]: { keys: ['d'] } });
    assert.deepEqual(app.services.input.effective(BACK).keys, ['n']);
    assert.throws(() => controls.reset(), /disposed/);
  } finally { app.dispose(); fake.restore(); }
});

test('corrupt persisted overrides quarantine and write failures remain visible without losing session remaps', async () => {
  const fake = installFakeDom();
  const { app, disk } = setup(fake.document as unknown as Document);
  let next: ReturnType<typeof setup>['app'] | undefined;
  try {
    await app.boot();
    app.services.controlsSettings.set({ [BACK]: { keys: ['q'] } });
    app.services.save.flush('test');
    const key = [...disk.data.keys()].find(key => key.endsWith(options.id))!;
    assert.ok(key);
    const envelope = JSON.parse(disk.data.get(key)!);
    app.dispose();
    envelope.data = { [BACK]: { pad: ['not-a-pad-input'] } };
    disk.data.set(key, JSON.stringify(envelope));
    next = setup(fake.document as unknown as Document, disk).app;
    await next.boot();
    assert.equal(next.services.controlsSettings.status(), 'quarantined');
    assert.notDeepEqual(next.services.input.effective(BACK).keys, ['q']);
    assert.ok(next.services.save.quarantine().length > 0);
    disk.failSet = () => true;
    next.services.controlsSettings.set({ [BACK]: { keys: ['r'] } });
    next.services.save.flush('test');
    assert.equal(next.services.controlsSettings.status(), 'session');
    assert.deepEqual(next.services.input.effective(BACK).keys, ['r']);
  } finally { next?.dispose(); app.dispose(); fake.restore(); }
});


test('binding lifetime handles abort before or inside subscription, reading and initial application', async () => {
  const fake = installFakeDom();
  const { app } = setup(fake.document as unknown as Document);
  try {
    await app.boot();
    const section = app.registries.saveSections.get(options.id);
    const handle = app.services.save.section(section);
    for (const at of ['before', 'subscribe', 'get', 'apply']) {
      const owner = new AbortController();
      let subscriptions = 0, removals = 0, reads = 0, applications = 0;
      if (at === 'before') owner.abort();
      const wrapped = {
        ...handle,
        subscribe() {
          subscriptions++;
          if (at === 'subscribe') owner.abort();
          return () => { removals++; };
        },
        get() { reads++; if (at === 'get') owner.abort(); return handle.get(); },
      };
      const controls = bindControlsSettings(wrapped, {
        setOverrides() { applications++; if (at === 'apply') owner.abort(); },
      }, section, owner.signal);
      assert.equal(removals, subscriptions, at);
      assert.equal(applications, at === 'apply' ? 1 : 0, at);
      if (at === 'before' || at === 'subscribe') assert.equal(reads, 0, at);
      assert.throws(() => controls.set({}), /disposed/);
      controls.dispose();
      assert.equal(removals, subscriptions, 'cleanup is idempotent');
    }
  } finally { app.dispose(); fake.restore(); }
});
