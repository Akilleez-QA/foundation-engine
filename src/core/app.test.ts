import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { adminOf, lazy, type Lazy, type Registry } from './registry';
import { BootValidationError, createApp, nextEvent } from './app';
import { defineModule, type EngineModule } from './module';
import { patch } from './patch';
import { must } from '../testing/must';

interface SceneDef { id: string; title: string; load: Lazy<{ enter(): string }> }
interface StationDef { id: string; scene: string; runsIn?: string }
interface ToolDef { id: string; impl: Lazy<(n: number) => number> }
interface SectionDef { id: string; version: number }
declare module './registry' {
  interface Registries {
    ktaScenes: Registry<SceneDef>;
    ktaStations: Registry<StationDef>;
    ktaTools: Registry<ToolDef>;
    ktaSections: Registry<SectionDef>;
  }
}
declare module './services' {
  interface Services {
    ktaAudio: { play(id: string): string };
    ktaStore: { write(key: string, value: string): void };
  }
}
declare module './events' {
  interface EngineEvents { 'kta.pinged': { n: number }; 'kta.saved': { key: string } }
}
declare module './probe' {
  interface EngineProbes { 'kta-lap': { lap: number } }
}

const quiet = { log() {} };
const statusOf = (r: { modules: { id: string; status: string }[] }, id: string) => r.modules.find(m => m.id === id)?.status;
const reasonOf = (r: { modules: { id: string; reason?: string }[] }, id: string) => r.modules.find(m => m.id === id)?.reason ?? '';
const mod = (id: string, extra: Partial<EngineModule> = {}): EngineModule => ({ id, version: '1.0.0', ...extra });
const sceneRow = (id: string, onLoad?: () => void): SceneDef => ({ id, title: id, load: lazy(async () => { onLoad?.(); return { enter: () => id }; }) });

test('boot runs discover → register → patch → freeze → validate → install → start, in that order', async () => {
  const seen: string[] = [];
  const owner = mod('core.kta-scenes', {
    defines: { ktaScenes: { validate: () => { seen.push('validate'); return []; } } },
    register(r) { seen.push('register'); r.ktaScenes.add(sceneRow('home'), 'core.kta-scenes'); },
    patches: [patch('ktaScenes', { id: 'p', target: 'home', op: { kind: 'edit', edit: d => { seen.push('patch'); d.title = 'Home'; } } })],
    install(s) {
      seen.push(`install:frozen=${adminOf(s.registries.ktaScenes).frozen}`);
      assert.throws(() => s.availability.forEntry('ktaScenes', 'home'), /published when install settles/);
      s.events.on('app.started', () => seen.push('start'));
    },
  });
  const app = createApp([owner], { mode: 'test', ...quiet });
  const report = await app.boot();
  assert.deepEqual(report.phases, ['discover', 'register', 'patch', 'freeze', 'validate', 'install', 'start']);
  assert.deepEqual(seen, ['register', 'patch', 'validate', 'install:frozen=true', 'start']);
  await assert.rejects(app.boot(), /boots once/);
  app.dispose();
});

test('discover orders by requires/optional, honours versions and conflicts, and cascades missing dependencies', async () => {
  const modules = [
    mod('feature.kta-rally', { requires: ['domain.kta-sim@^2', 'platform.kta-render'], optional: ['feature.kta-map'] }),
    mod('feature.kta-map', { requires: ['domain.kta-sim'] }),
    mod('domain.kta-sim', { version: '2.3.0', requires: ['platform.kta-render'] }),
    mod('platform.kta-render'),
    mod('feature.kta-old', { requires: ['domain.kta-sim@^1'] }),
    mod('feature.kta-orphan', { requires: ['domain.kta-missing'] }),
    mod('feature.kta-orphan-child', { requires: ['feature.kta-orphan'] }),
    mod('pack.kta-b', { conflicts: ['pack.kta-a'] }),
    mod('pack.kta-a'),
    mod('feature.kta-virtual-user', { requires: ['kta-sound'] }),
    mod('platform.kta-audio', { provides: ['kta-sound'] }),
    mod('core.kta-zeta'), mod('core.kta-alpha'),
  ];
  const report = await createApp(modules, { mode: 'test', ...quiet }).boot();
  assert.deepEqual(report.order, [
    'core.kta-alpha', 'core.kta-zeta', 'platform.kta-audio', 'platform.kta-render', 'domain.kta-sim',
    'feature.kta-map', 'feature.kta-rally', 'feature.kta-virtual-user', 'pack.kta-a',
  ]);
  assert.equal(statusOf(report, 'feature.kta-old'), 'disabled');
  assert.match(reasonOf(report, 'feature.kta-old'), /requires domain\.kta-sim@\^1, found domain\.kta-sim@2\.3\.0/);
  assert.match(reasonOf(report, 'feature.kta-orphan'), /requires domain\.kta-missing, which is missing/);
  assert.match(reasonOf(report, 'feature.kta-orphan-child'), /requires feature\.kta-orphan, which is disabled/);
  assert.match(reasonOf(report, 'pack.kta-b'), /conflicts with pack\.kta-a/, 'the later module in boot order is disabled');

  // The order does not depend on list position.
  const reversed = await createApp([...modules].reverse(), { mode: 'test', ...quiet }).boot();
  assert.deepEqual(reversed.order, report.order);
  assert.deepEqual(reversed.modules.map(m => `${m.id}:${m.status}`).sort(), report.modules.map(m => `${m.id}:${m.status}`).sort());
});

test('cycles: every member of a requires cycle is disabled, dependants cascade, bystanders boot; optional-only loops just lose their ordering edge', async () => {
  const report = await createApp([
    mod('feature.kta-a', { requires: ['feature.kta-b'] }),
    mod('feature.kta-b', { requires: ['feature.kta-c'] }),
    mod('feature.kta-c', { requires: ['feature.kta-a'] }),
    mod('feature.kta-leaf', { requires: ['feature.kta-a'] }),
    mod('feature.kta-bystander'),
    mod('feature.kta-x', { optional: ['feature.kta-y'] }),
    mod('feature.kta-y', { optional: ['feature.kta-x'] }),
  ], { mode: 'test', ...quiet }).boot();
  for (const id of ['feature.kta-a', 'feature.kta-b', 'feature.kta-c']) {
    assert.equal(statusOf(report, id), 'disabled');
    assert.match(reasonOf(report, id), /dependency cycle among feature\.kta-a, feature\.kta-b, feature\.kta-c/);
  }
  assert.equal(statusOf(report, 'feature.kta-leaf'), 'disabled');
  assert.match(reasonOf(report, 'feature.kta-leaf'), /requires feature\.kta-a, which is disabled/, 'a dependant is cascaded, not blamed for the cycle');
  assert.deepEqual(report.order, ['feature.kta-bystander', 'feature.kta-x', 'feature.kta-y']);
  assert.ok(report.warnings.some(w => /optional dependency .* closes a cycle/.test(w)));
});

test('a throwing module is isolated: its entries roll back, its services and listeners vanish, dependants are disabled, the rest boots', async () => {
  const owner = mod('core.kta-scenes', { defines: { ktaScenes: {} } });
  const badRegister = mod('feature.kta-bad-register', { requires: ['core.kta-scenes'], register(r) {
    r.ktaScenes.add(sceneRow('half-added'), 'feature.kta-bad-register');
    throw new Error('register exploded');
  } });
  let heard = 0;
  const badInstall = mod('platform.kta-audio', { serviceKeys: ['ktaAudio'], eventAreas: ['kta'], install(s) {
    s.provide('ktaAudio', { play: id => id });
    s.events.on('kta.pinged', () => heard++);
    throw new Error('no audio device');
  } });
  const dependant = mod('feature.kta-music', { requires: ['platform.kta-audio'], install() { assert.fail('must not install'); } });
  const healthy = mod('feature.kta-ok', { requires: ['core.kta-scenes'], eventAreas: ['kta-ok'], register(r) { r.ktaScenes.add(sceneRow('ok'), 'feature.kta-ok'); } });
  const pinger = mod('feature.kta-pinger', { eventAreas: [] });
  const app = createApp([badRegister, badInstall, dependant, healthy, owner, pinger], { mode: 'test', ...quiet });
  const failedEvents: string[] = [];
  app.events.on('app.module-failed', p => failedEvents.push(`${p.id}@${p.phase}`));
  const started = nextEvent(app.events, 'app.started');
  const report = await app.boot();
  await started;

  assert.equal(statusOf(report, 'feature.kta-bad-register'), 'failed');
  assert.deepEqual(app.registries.ktaScenes.all().map(p => p.id), ['ok'], 'the failed register rolled back');
  assert.equal(statusOf(report, 'platform.kta-audio'), 'failed');
  assert.equal(reasonOf(report, 'platform.kta-audio'), 'no audio device');
  assert.equal(statusOf(report, 'feature.kta-music'), 'disabled');
  assert.equal(statusOf(report, 'feature.kta-ok'), 'installed');
  assert.deepEqual(failedEvents, ['feature.kta-bad-register@register', 'platform.kta-audio@install']);
  assert.equal(app.services.ktaAudio, undefined, 'the withdrawn service is gone');
  assert.equal(app.events.listenerCount('kta.pinged'), 0, 'its listeners are gone');
  app.events.emit('kta.pinged', { n: 1 });
  assert.equal(heard, 0);
  assert.equal(app.services.app.has('platform.kta-audio'), false);
  assert.equal(app.services.app.has('feature.kta-ok'), true);
});

test('services: typed, one provider per key, a clear error when unprovided, and a warning for an undeclared dependency', async () => {
  const log: string[] = [];
  const audio = mod('platform.kta-audio', { serviceKeys: ['ktaAudio'], install(s) {
    s.provide('ktaAudio', { play: id => `playing ${id}` });
    assert.throws(() => s.provide('ktaAudio', { play: () => '' }), /already provided by platform\.kta-audio/);
    assert.throws(() => s.provide('ktaStore', { write() {} }), /without claiming it in serviceKeys/);
    // @ts-expect-error: the wrong implementation type is a compile error
    assert.throws(() => s.provide('ktaAudio', { play: 1 }));
  } });
  const declared = mod('feature.kta-declared', { requires: ['platform.kta-audio'], install(s) { log.push(s.ktaAudio.play('a')); } });
  const sneaky = mod('feature.kta-sneaky', { install(s) { log.push(s.ktaAudio.play('b')); } });
  const lost = mod('feature.kta-lost', { install(s) { s.ktaStore.write('k', 'v'); } });
  const report = await createApp([audio, declared, sneaky, lost], { mode: 'test', ...quiet }).boot();
  assert.deepEqual(log, ['playing a', 'playing b']);
  assert.ok(report.warnings.includes("feature.kta-sneaky uses service 'ktaAudio' from platform.kta-audio without requiring it"));
  assert.equal(statusOf(report, 'feature.kta-lost'), 'failed');
  assert.match(reasonOf(report, 'feature.kta-lost'), /service 'ktaStore' is not provided \(is its owner installed, and does feature\.kta-lost require it\?\)/);
});

test('duplicate owners: a second claim on a service key, an event area or a registry is rejected before install; kernel keys and areas are reserved', async () => {
  const emitted: string[] = [];
  const app = createApp([
    mod('platform.kta-audio', { serviceKeys: ['ktaAudio'], eventAreas: ['kta'], install(s) {
      s.provide('ktaAudio', { play: id => id });
      s.events.on('kta.pinged', p => emitted.push(`pinged ${p.n}`));
      s.events.emit('kta.pinged', { n: 1 });
      // @ts-expect-error: app.* is declared, but a module may still only emit in its own areas (runtime check)
      assert.throws(() => s.events.emit('app.started', { ms: 'x' }));
      assert.throws(() => s.events.emit('app.started', { ms: 0 }), /does not claim event area 'app' \(owned by core\)/);
    } }),
    mod('platform.kta-audio-two', { serviceKeys: ['ktaAudio'] }),
    mod('feature.kta-area-thief', { eventAreas: ['kta'] }),
    mod('feature.kta-area-thief-child', { requires: ['feature.kta-area-thief'] }),
    mod('feature.kta-kernel-key', { serviceKeys: ['events'] }),
    mod('feature.kta-kernel-area', { eventAreas: ['app'] }),
    mod('feature.kta-bad-area', { eventAreas: ['kta.pinged'] }),
    mod('feature.kta-emitter', { install(s) { assert.throws(() => s.events.emit('kta.pinged', { n: 2 }), /does not claim event area 'kta' \(owned by platform\.kta-audio\)/); } }),
    mod('core.kta-scenes', { defines: { ktaScenes: {} } }),
    mod('core.kta-scenes-two', { defines: { ktaScenes: {} } }),
  ], { mode: 'test', ...quiet });
  const report = await app.boot();
  assert.match(reasonOf(report, 'platform.kta-audio-two'), /claims service 'ktaAudio', already claimed by platform\.kta-audio/);
  assert.match(reasonOf(report, 'feature.kta-area-thief'), /claims event area 'kta', already claimed by platform\.kta-audio/);
  assert.equal(statusOf(report, 'feature.kta-area-thief-child'), 'disabled');
  assert.match(reasonOf(report, 'feature.kta-kernel-key'), /claims service 'events', which is reserved by the kernel/);
  assert.match(reasonOf(report, 'feature.kta-kernel-area'), /claims event area 'app', which is reserved by the kernel/);
  assert.match(reasonOf(report, 'feature.kta-bad-area'), /not one lowercase kebab-case segment/);
  assert.equal(statusOf(report, 'feature.kta-emitter'), 'installed');
  assert.equal(statusOf(report, 'platform.kta-audio'), 'installed');
  assert.match(reasonOf(report, 'core.kta-scenes-two'), /defines registry 'ktaScenes', already defined by core\.kta-scenes/);
  assert.deepEqual(emitted, ['pinged 1']);
});

test('install-failure availability: failed and cascaded rows stay defined but not executable; app.has means installed (ADR 0063)', async () => {
  // The pass-5.2 fixture: a throwing feature, its required dependant, and a healthy sibling.
  const hasDuringInstall: Record<string, boolean> = {};
  const app = createApp([
    mod('core.kta-catalogue', { defines: { ktaScenes: {}, ktaStations: {
      executors: (s: StationDef) => s.runsIn ? [s.runsIn] : [],
      requiresRows: (s: StationDef) => [{ registry: 'ktaScenes', id: s.scene }],
    } } }),
    mod('feature.kta-broken', { requires: ['core.kta-catalogue'], register(r) { r.ktaScenes.add(sceneRow('broken'), 'feature.kta-broken'); }, install() { throw new Error('injected'); } }),
    mod('feature.kta-dependent', { requires: ['feature.kta-broken'], register(r) { r.ktaScenes.add(sceneRow('dependent'), 'feature.kta-dependent'); } }),
    mod('feature.kta-good', { requires: ['core.kta-catalogue'], optional: ['feature.kta-broken'],
      register(r) {
        r.ktaScenes.add(sceneRow('good'), 'feature.kta-good');
        r.ktaStations.add({ id: 'good-desk', scene: 'good' }, 'feature.kta-good');
        r.ktaStations.add({ id: 'good-desk-in-broken-scene', scene: 'broken' }, 'feature.kta-good');
        r.ktaStations.add({ id: 'good-desk-run-by-broken', scene: 'good', runsIn: 'feature.kta-broken' }, 'feature.kta-good');
      },
      install(s) { hasDuringInstall.broken = s.app.has('feature.kta-broken'); hasDuringInstall.self = s.app.has('feature.kta-good'); } }),
  ], { mode: 'test', ...quiet });
  const report = await app.boot();
  assert.equal(statusOf(report, 'feature.kta-broken'), 'failed');
  assert.equal(statusOf(report, 'feature.kta-dependent'), 'disabled');
  assert.equal(statusOf(report, 'feature.kta-good'), 'installed');
  assert.deepEqual(hasDuringInstall, { broken: false, self: false }, 'has() is installation, never discovery');

  // Definitions are retained...
  assert.deepEqual(app.registries.ktaScenes.all().map(p => p.id), ['broken', 'dependent', 'good']);
  // ...but only the healthy one is executable, each with a reason.
  const av = app.services.availability;
  assert.ok(av.published);
  assert.deepEqual(av.forEntry('ktaScenes', 'good'), { available: true });
  const broken = av.forEntry('ktaScenes', 'broken');
  assert.ok(!broken.available && /ktaScenes\[broken\] was added by feature\.kta-broken: feature\.kta-broken is failed: injected/.test(broken.reason));
  const dependent = av.forEntry('ktaScenes', 'dependent');
  assert.ok(!dependent.available && /feature\.kta-dependent is disabled: requires feature\.kta-broken, which is failed/.test(dependent.reason));
  assert.deepEqual(av.forEntry('ktaStations', 'good-desk'), { available: true });
  const viaRow = av.forEntry('ktaStations', 'good-desk-in-broken-scene');
  assert.ok(!viaRow.available && /requires ktaScenes\[broken\]/.test(viaRow.reason), 'required row references propagate');
  const viaExecutor = av.forEntry('ktaStations', 'good-desk-run-by-broken');
  assert.ok(!viaExecutor.available && /runs in feature\.kta-broken/.test(viaExecutor.reason));
  assert.deepEqual(av.forEntry('ktaScenes', 'nowhere'), { available: false, reason: "no 'nowhere' in ktaScenes" });
  assert.equal(av.forEntry('ktaNope' as 'ktaScenes', 'x').available, false);
  assert.deepEqual(av.forModule('feature.kta-good'), { available: true });
  assert.deepEqual(av.modules().map(m => `${m.id}:${m.status}`),
    ['core.kta-catalogue:installed', 'feature.kta-broken:failed', 'feature.kta-dependent:disabled', 'feature.kta-good:installed']);
  assert.ok(Object.isFrozen(av.modules()));
  assert.deepEqual(report.order, ['core.kta-catalogue', 'feature.kta-good']);
  assert.equal(report.recovery, undefined);
});

test('optional failure: an optional dependency that fails install is ordered first, answers has() = false, and its dependant still boots', async () => {
  const order: string[] = [];
  const report = await createApp([
    mod('feature.kta-map', { optional: ['feature.kta-flaky'], install(s) { order.push(`map:has-flaky=${s.app.has('feature.kta-flaky')}`); } }),
    mod('feature.kta-flaky', { install: async () => { order.push('flaky'); await Promise.resolve(); throw new Error('async install failure'); } }),
  ], { mode: 'test', ...quiet }).boot();
  assert.deepEqual(order, ['flaky', 'map:has-flaky=false']);
  assert.equal(statusOf(report, 'feature.kta-flaky'), 'failed');
  assert.equal(reasonOf(report, 'feature.kta-flaky'), 'async install failure');
  assert.equal(statusOf(report, 'feature.kta-map'), 'installed');
});

test('a failed install keeps definitions, save-section schemas and saved bytes; a foundational failure opens recovery', async () => {
  const bytes = new Map([['game-kta-garden', '{"v":1,"beds":[3,1,4]}'], ['game-kta-other', 'x']]);
  const before = new Map(bytes);
  const app = createApp([
    mod('core.kta-save', { defines: { ktaSections: {} }, serviceKeys: ['ktaStore'],
      install(s) { s.provide('ktaStore', { write: (k, v) => { bytes.set(k, v); } }); } }),
    mod('core.kta-foundation', { install() { throw new Error('storage port unavailable'); } }),
    mod('feature.kta-garden', { requires: ['core.kta-save'],
      register(r) { r.ktaSections.add({ id: 'kta-garden', version: 1 }, 'feature.kta-garden'); },
      install(s) {
        // A failing install must not reset or default its section.
        s.signal.addEventListener('abort', () => { /* cleanup only: nothing written */ });
        throw new Error('garden art missing');
      } }),
  ], { mode: 'test', ...quiet });
  const report = await app.boot();
  assert.equal(statusOf(report, 'feature.kta-garden'), 'failed');
  assert.deepEqual(app.registries.ktaSections.all(), [{ id: 'kta-garden', version: 1 }], 'the schema stays inspectable');
  assert.equal(app.services.availability.forEntry('ktaSections', 'kta-garden').available, false);
  assert.deepEqual(bytes, before, 'saved bytes are untouched');
  assert.deepEqual(report.recovery?.modules, ['core.kta-foundation']);
  assert.match(report.recovery!.reason, /storage port unavailable/);
});

test('an unavailable direct route opens recovery with Back and Retry and never calls its loader', async () => {
  const loads: string[] = [];
  const app = createApp([
    mod('core.kta-router', { defines: { ktaScenes: {} } }),
    mod('feature.kta-lab', { requires: ['core.kta-router'], register(r) { r.ktaScenes.add(sceneRow('lab', () => loads.push('lab')), 'feature.kta-lab'); }, install() { throw new Error('lab failed'); } }),
    mod('feature.kta-park', { requires: ['core.kta-router'], register(r) { r.ktaScenes.add(sceneRow('park', () => loads.push('park')), 'feature.kta-park'); } }),
  ], { mode: 'test', ...quiet });
  await app.boot();
  // The router's resolve step in miniature: one shared availability check before any loader runs.
  type Opened = { recovery: { reason: string; actions: string[] } } | { entered: string };
  const open = async (id: string): Promise<Opened> => {
    const a = app.services.availability.forEntry('ktaScenes', id);
    if (!a.available) return { recovery: { reason: a.reason, actions: ['back', 'retry'] } };
    return { entered: (await app.registries.ktaScenes.get(id).load.load()).enter() };
  };
  const lab = await open('lab');
  assert.ok('recovery' in lab);
  assert.match(lab.recovery.reason, /lab failed/);
  assert.deepEqual(lab.recovery.actions, ['back', 'retry']);
  assert.deepEqual(await open('park'), { entered: 'park' });
  assert.deepEqual(loads, ['park'], 'the unavailable scene never loaded');
  assert.equal(app.registries.ktaScenes.get('lab').title, 'lab', 'its definition is still inspectable');
});

test('Services.bind: lazy behaviour bound by id at an async boundary; missing, unavailable and failing ids bind to reported placeholders', async () => {
  let doubleLoads = 0;
  const tools = mod('domain.kta-tools', { defines: { ktaTools: {} }, register(r) {
    r.ktaTools.add({ id: 'double', impl: lazy(async () => { doubleLoads++; return { default: (n: number) => n * 2 }; }) }, 'domain.kta-tools');
    r.ktaTools.add({ id: 'explodes', impl: lazy(async () => { throw new Error('chunk 404'); }) }, 'domain.kta-tools');
  } });
  const pack = mod('pack.kta-extra-tools', { requires: ['domain.kta-tools'], register(r) {
    r.ktaTools.add({ id: 'triple', impl: lazy(async () => (n: number) => n * 3) }, 'pack.kta-extra-tools');
  }, install() { throw new Error('pack install failed'); } });
  let boundInInstall: unknown;
  const user = mod('feature.kta-user', { requires: ['domain.kta-tools'], install(s) { boundInInstall = s.bind; } });
  const app = createApp([tools, pack, user], { mode: 'test', ...quiet });
  const report = await app.boot();
  assert.equal(typeof boundInInstall, 'function');

  const ctl = new AbortController();
  const set = await app.services.bind('ktaTools', ['double', 'triple', 'explodes', 'ghost', 'double'], ctl.signal);
  assert.equal(set.valid, false);
  const d = set.get('double');
  assert.ok(d.valid && d.impl(21) === 42);
  const t = set.get('triple');
  assert.ok(!t.valid && t.status === 'placeholder' && /pack\.kta-extra-tools is failed/.test(t.reason));
  const e = set.get('explodes');
  assert.ok(!e.valid && e.status === 'failed' && e.reason === 'chunk 404');
  const g = set.get('ghost');
  assert.ok(!g.valid && g.status === 'placeholder' && /isn't installed/.test(g.reason));
  const never = set.get('never-requested');
  assert.ok(!never.valid && /bind it at an async boundary first/.test(never.reason), 'get never throws');
  assert.equal(set.bindings.length, 4, 'ids are de-duplicated');

  // Memoised: binding again does not reload.
  const again = await app.services.bind('ktaTools', ['double'], ctl.signal);
  assert.ok(again.valid);
  assert.equal(doubleLoads, 1);
  assert.deepEqual(report.bindings, [], 'nothing was bound during boot');
  assert.deepEqual(app.services.app.report().bindings.map(b => `${b.id}:${b.status}`).sort(), ['double:bound', 'explodes:failed', 'ghost:placeholder', 'triple:placeholder'],
    'the boot report shows the bindings view');

  // An aborted boundary rejects instead of returning stale bindings.
  const late = new AbortController();
  const pending = app.services.bind('ktaTools', ['double'], late.signal);
  late.abort(new Error('navigated away'));
  await assert.rejects(pending, /navigated away/);
  await assert.rejects(app.services.bind('ktaTools', ['double'], late.signal), /navigated away/);
});

test('a pack\'s validation problems disable that pack and roll back its rows and edits in every mode; the same problem from a feature throws in DEV', async () => {
  const owner = mod('domain.kta-catalogue', { defines: { ktaScenes: {
    validate: (p: SceneDef) => p.title.length ? [] : ['has no title'],
    problems: (all: readonly SceneDef[]) => all.filter(p => p.title.startsWith('see:') && !all.some(o => o.id === p.title.slice(4))).map(p => ({ id: p.id, problem: `points at missing ${p.title.slice(4)}` })),
  } }, register(r) { r.ktaScenes.add(sceneRow('home'), 'domain.kta-catalogue'); } });
  const badPack = mod('pack.kta-bad', { requires: ['domain.kta-catalogue'],
    register(r) { r.ktaScenes.add({ ...sceneRow('pack-scene'), title: '' }, 'pack.kta-bad'); r.ktaScenes.add({ ...sceneRow('pack-link'), title: 'see:nowhere' }, 'pack.kta-bad'); },
    patches: [patch('ktaScenes', { id: 'rename-home', target: 'home', op: { kind: 'merge', merge: { title: 'Pack Home' } } })] });
  const packChild = mod('pack.kta-bad-child', { requires: ['pack.kta-bad'], register(r) { r.ktaScenes.add(sceneRow('child-scene'), 'pack.kta-bad-child'); } });
  const breaker = mod('pack.kta-breaker', { requires: ['domain.kta-catalogue'],
    patches: [patch('ktaScenes', { id: 'blank-home', target: 'home', pass: 'final', op: { kind: 'edit', edit: d => { d.title = ''; } } })] });

  for (const mode of ['dev', 'prod'] as const) {
    const app = createApp([owner, badPack, packChild, breaker], { mode, ...quiet });
    const report = await app.boot();
    assert.equal(statusOf(report, 'pack.kta-bad'), 'disabled', mode);
    assert.match(reasonOf(report, 'pack.kta-bad'), /pack-scene.*has no title.*pack-link.*points at missing nowhere/);
    assert.equal(statusOf(report, 'pack.kta-bad-child'), 'disabled');
    assert.equal(statusOf(report, 'pack.kta-breaker'), 'disabled', 'a pack that breaks a row it patched is blamed');
    assert.deepEqual(app.registries.ktaScenes.all().map(p => `${p.id}:${p.title}`), ['home:home'], 'rows rolled back and edits undone');
    assert.ok(report.problems.every(p => p.resolution === 'pack-disabled'));
    assert.equal(statusOf(report, 'domain.kta-catalogue'), 'installed');
  }

  // The same bad row from a feature fails DEV boot.
  const badFeature = mod('feature.kta-bad', { requires: ['domain.kta-catalogue'], register(r) { r.ktaScenes.add({ ...sceneRow('feature-scene'), title: '' }, 'feature.kta-bad'); } });
  await assert.rejects(createApp([owner, badFeature], { mode: 'dev', ...quiet }).boot(), (e: unknown) => e instanceof BootValidationError && /feature-scene/.test(e.message));
});

test('dispose releases every install in reverse order and aborts module signals', async () => {
  const log: string[] = [];
  const app = createApp([
    mod('core.kta-one', { install(s) { s.signal.addEventListener('abort', () => log.push('one aborted')); return { dispose: () => log.push('one disposed') }; } }),
    mod('core.kta-two', { requires: ['core.kta-one'], install: async () => ({ dispose: () => { log.push('two disposed'); throw new Error('ignored'); } }) }),
  ], { mode: 'test', ...quiet });
  await app.boot();
  app.dispose();
  assert.deepEqual(log, ['two disposed', 'one disposed', 'one aborted']);
  assert.ok(app.services.signal.aborted);
});

test('the kernel provides probes: modules register, the app reads on demand, prod records nothing, the key is reserved', async () => {
  let reads = 0;
  const racer = mod('feature.kta-racer', { install(s) { s.probes.register('kta-lap', () => { reads++; return { lap: 2 }; }, s.signal); } });
  const app = createApp([racer], { mode: 'test', ...quiet });
  await app.boot();
  assert.equal(reads, 0, 'registering computes nothing');
  assert.deepEqual(app.probes.read('kta-lap'), { lap: 2 });
  assert.deepEqual(app.probes.names(), ['kta-lap']);
  app.dispose();
  assert.equal(app.probes.read('kta-lap'), undefined, 'a probe dies with its module');

  const prod = createApp([racer], { mode: 'prod', ...quiet });
  await prod.boot();
  assert.equal(prod.probes.read('kta-lap'), undefined);
  const tested = createApp([racer], { mode: 'prod', probes: true, ...quiet });
  await tested.boot();
  assert.deepEqual(tested.probes.read('kta-lap'), { lap: 2 });

  const claimer = createApp([mod('feature.kta-probe-claim', { serviceKeys: ['probes'] })], { mode: 'test', ...quiet });
  const report = await claimer.boot();
  assert.match(reasonOf(report, 'feature.kta-probe-claim'), /claims service 'probes', which is reserved by the kernel/);
});

test('synchronous installs run back to back inside boot(), with no microtask between two boot steps', async () => {
  const seen: string[] = [];
  const app = createApp([
    defineModule({ id: 'feature.a', version: '1.0.0', install() { seen.push('a'); void Promise.resolve().then(() => seen.push('a:microtask')); } }),
    defineModule({ id: 'feature.b', version: '1.0.0', optional: ['feature.a'], install() { seen.push('b'); } }),
  ], { mode: 'test' });
  const booted = app.boot();
  assert.deepEqual(seen, ['a', 'b'], 'both installed before boot() returned; the microtask a queued has not run');
  const report = await booted;
  assert.deepEqual(report.modules.map(m => m.status), ['installed', 'installed']);
  assert.deepEqual(seen, ['a', 'b', 'a:microtask']);
});

// A shell step once reused `feature.home`, the home scene panels' manifest id; the kernel kept the first copy and the
// panels never registered, in production too. A duplicate module id now fails boot in every mode (STD-MOD-12,
// STD-REG-4, STD-PRI-11), before anything registers or installs, naming the id and both sources.
test('a duplicate module id fails boot in every mode with a BootValidationError naming the id and both sources', async () => {
  for (const mode of ['dev', 'test', 'prod'] as const) {
    const ran: string[] = [];
    const step = (tag: string): EngineModule => ({ id: 'feature.kta-twin', version: '1.0.0', register() { ran.push(`${tag} register`); }, install() { ran.push(`${tag} install`); } });
    const other: EngineModule = { id: 'feature.kta-other', version: '1.0.0', install() { ran.push('other install'); } };
    const list = [step('shell'), other, step('manifest')];
    const sources = ['src/app/shell-modules.ts', 'src/app/layer-modules.ts', 'src/features/home/index.ts'];
    const app = createApp(list, { mode, sourceOf: (_m, i) => sources[i], log: () => {} });
    await assert.rejects(app.boot(), (e: unknown) => {
      assert.ok(e instanceof BootValidationError, mode);
      assert.equal(e.problems.length, 1);
      assert.equal(must(e.problems[0], 'the problem').id, 'feature.kta-twin');
      assert.match(e.message, /modules\[feature\.kta-twin\]: module id declared twice, by src\/app\/shell-modules\.ts #0 and by src\/features\/home\/index\.ts #2; boot stops/);
      return true;
    }, mode);
    assert.deepEqual(ran, [], `${mode}: nothing registers or installs`);
    assert.deepEqual(app.services.app.report().problems.map(p => p.id), ['feature.kta-twin']);
  }
  // Without sourceOf the list entries still tell the two copies apart.
  const bare = createApp([{ id: 'domain.kta-dup', version: '1.0.0' }, { id: 'domain.kta-dup', version: '2.0.0' }], { mode: 'prod', log: () => {} });
  await assert.rejects(bare.boot(), /domain\.kta-dup\]: module id declared twice, by module list #0 and by module list #1/);
});

test('disposing pending installation aborts its owner and retires late results without starting dependants', async () => {
  let finish!: (value: { dispose(): void }) => void;
  let owner!: import('./services').Services;
  let lateDisposals = 0, dependent = 0, starts = 0;
  const app = createApp([
    defineModule({ id: 'core.pending', version: '1.0.0', serviceKeys: ['ktaAudio'], install(s) {
      owner = s;
      s.provide('ktaAudio', { play: id => id });
      return new Promise<{ dispose(): void }>(resolve => { finish = resolve; });
    } }),
    defineModule({ id: 'feature.dependent', version: '1.0.0', requires: ['core.pending'], install() { dependent++; } }),
  ], { mode: 'test', log() { throw Error('diagnostics unavailable'); } });
  app.events.on('app.started', () => { starts++; });
  const boot = app.boot();
  assert.ok(owner);
  app.dispose();
  assert.equal(owner.signal.aborted, true);
  assert.equal(app.services.ktaAudio, undefined);
  assert.throws(() => owner.provide('ktaAudio', { play: id => id }), { name: 'AbortError' });
  finish({ dispose() { lateDisposals++; throw Error('late cleanup failed'); } });
  await assert.rejects(boot, { name: 'AbortError' });
  app.dispose();
  assert.deepEqual([lateDisposals, dependent, starts], [1, 0, 0]);
});

test('synchronous reentrant disposal retires the installing result and earlier owners exactly once', async () => {
  const calls: string[] = [];
  const app = createApp([
    defineModule({ id: 'core.first', version: '1.0.0', install() {
      return { dispose() { calls.push('first'); app.dispose(); throw Error('cleanup failed'); } };
    } }),
    defineModule({ id: 'feature.disposer', version: '1.0.0', requires: ['core.first'], install(s) {
      app.dispose();
      assert.equal(s.signal.aborted, true);
      return { dispose() { calls.push('installing'); app.dispose(); } };
    } }),
  ], { mode: 'test', log() {} });
  await assert.rejects(app.boot(), { name: 'AbortError' });
  app.dispose();
  assert.deepEqual(calls, ['first', 'installing']);
});

test('late installation rejection after disposal does not publish failure or startup events', async () => {
  let reject!: (reason: unknown) => void;
  const app = createApp([defineModule({ id: 'core.pending', version: '1.0.0', install() {
    return new Promise<void>((_resolve, fail) => { reject = fail; });
  } })], { mode: 'test', log() {} });
  const events: string[] = [];
  app.events.tap(name => { events.push(name); });
  const boot = app.boot();
  app.dispose();
  reject(Error('late failure'));
  await assert.rejects(boot, { name: 'AbortError' });
  assert.deepEqual(events, []);
});

test('Services.bind releases abort listeners after repeated success, empty and failed bindings', async () => {
  let loads = 0;
  const tools = mod('domain.kta-tools', { defines: { ktaTools: {} }, register(r) {
    r.ktaTools.add({ id: 'double', impl: lazy(async () => {
      loads++;
      return (n: number) => n * 2;
    }) }, 'domain.kta-tools');
    r.ktaTools.add({ id: 'fails', impl: lazy(async () => { throw Error('unavailable'); }) }, 'domain.kta-tools');
  } });
  const app = createApp([tools], { mode: 'test', ...quiet });
  const owner = new AbortController();
  try {
    await app.boot();
    for (let i = 0; i < 30; i++) {
      const bound = await app.services.bind('ktaTools', ['double'], owner.signal);
      assert.equal(bound.valid, true);
      assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
    }
    assert.equal(loads, 1, 'completed binds still share the memoized implementation');
    const empty = await app.services.bind('ktaTools', [], owner.signal);
    assert.equal(empty.bindings.length, 0);
    assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
    const failed = await app.services.bind('ktaTools', ['fails', 'missing'], owner.signal);
    assert.deepEqual(failed.bindings.map(binding => binding.status), ['failed', 'placeholder']);
    assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
    owner.abort();
    await assert.rejects(app.services.bind('ktaTools', ['double'], owner.signal), { name: 'AbortError' });
    assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
  } finally { app.dispose(); }
});

test('Services.bind cancellation removes only that waiter and preserves a shared pending lazy load', async () => {
  let resolve!: (impl: (n: number) => number) => void;
  const pending = new Promise<(n: number) => number>(done => { resolve = done; });
  let loads = 0;
  const tools = mod('domain.kta-tools', { defines: { ktaTools: {} }, register(r) {
    r.ktaTools.add({ id: 'shared', impl: lazy(() => { loads++; return pending; }) }, 'domain.kta-tools');
  } });
  const app = createApp([tools], { mode: 'test', ...quiet });
  const first = new AbortController(), second = new AbortController();
  try {
    await app.boot();
    const cancelled = app.services.bind('ktaTools', ['shared'], first.signal);
    const survivor = app.services.bind('ktaTools', ['shared'], second.signal);
    assert.equal(getEventListeners(first.signal, 'abort').length, 1);
    assert.equal(getEventListeners(second.signal, 'abort').length, 1);
    const reason = Error('owner left');
    first.abort(reason);
    await assert.rejects(cancelled, error => error === reason);
    assert.equal(getEventListeners(first.signal, 'abort').length, 0);
    assert.equal(getEventListeners(second.signal, 'abort').length, 1, 'other pending waiter remains cancellable');
    resolve(n => n * 3);
    const result = (await survivor).get('shared');
    assert.ok(result.valid);
    assert.equal(result.impl(7), 21);
    assert.equal(loads, 1);
    assert.equal(getEventListeners(second.signal, 'abort').length, 0);
  } finally { resolve(n => n); app.dispose(); }
});
