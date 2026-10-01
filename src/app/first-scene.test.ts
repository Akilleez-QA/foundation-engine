import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../core/app';
import { defineModule } from '../core/module';
import { createEventBus } from '../core/events';
import type { RouterWindow } from '../core/router/router';
import { defineBuild } from '../author/build';
import { defineGame, defineScene } from '../author/defs';
import { compileGame } from '../author/compile';
import { createSceneShell } from '../platform/ui/scene-shell';
import { layerModules } from './layer-modules';

const brief = defineBuild({ goal: 'Enter the authored first scene', pitch: 'Respect creator routing', genre: 'custom',
  coreLoop: ['Navigate'], devices: { targets: ['desktop'], minimum: 'desktop', input: ['keyboard'] },
  success: [{ id: 'S1', check: 'The selected scene enters', how: 'manual' }] });
const game = defineGame({ id: 'route-test', title: 'Routes', version: '1.0.0', firstScene: 'sample' });

test('stock layer assembly enters declared firstScene for empty and unknown hashes, preserving deep links and redirects', { timeout: 5000 }, async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    for (const [hash, expected, params] of [
      ['', 'scene.sample', {}], ['#', 'scene.sample', {}], ['#missing', 'scene.sample', {}],
      ['#scene/sample', 'scene.sample', {}], ['#scene/retired?n=3', 'scene.retired', { n: '3' }],
      ['#old?seed=2', 'scene.retired', { seed: '2' }],
    ] as const) {
      const writes: string[] = [];
      const win: RouterWindow = { location: { hash }, addEventListener() {}, history: {
        replaceState(_data, _unused, url) { writes.push(String(url)); win.location.hash = String(url); },
      } };
      Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
      const compiled = compileGame({ game, brief, defs: [
        defineScene({ id: 'sample', title: 'Sample' }), defineScene({ id: 'retired', title: 'Retired' }),
      ] });
      const redirect = defineModule({ id: 'feature.old-route', version: '1.0.0', requires: ['core.router'],
        register(r) { r.redirects.add({ id: 'redirect.old', from: '#old', to: '#scene/retired', note: 'Preserved link' }, 'feature.old-route'); } });
      // Retain real registration and router installation; omit browser service allocation.
      const modules = [...layerModules(game, brief), ...compiled.modules, redirect]
        .map(m => m.id === 'core.router' ? m : { ...m, install: undefined });
      const app = createApp(modules, { mode: 'test', log() {} });
      const report = await app.boot();
      assert.ok(report.modules.every(m => m.status === 'installed'));
      assert.deepEqual(app.registries.scenes.all().map(s => s.id), ['scene.retired', 'scene.sample']);
      const entered: string[] = [];
      for (const row of app.registries.scenes.all()) app.services.router.scene({ id: row.id, label: row.id,
        load: () => null, enter(_module, visit) { entered.push(visit.scene); assert.deepEqual(visit.params, params); return { leave() {} }; } });
      const mount = { setAttribute() {}, removeAttribute() {} } as unknown as HTMLElement;
      let finish!: () => void;
      const active = new Promise<void>(resolve => { finish = resolve; });
      const shell = createSceneShell({ router: app.services.router, mount, doc: {} as Document,
        events: createEventBus(), player: () => 'test', home: compiled.first, firstRender() {}, onEntered: finish });
      try {
        shell.start(); await active;
        assert.deepEqual(entered, [expected]);
        assert.equal(shell.state().scene, expected);
        assert.equal(shell.state().state, 'active');
        assert.deepEqual(writes, hash.startsWith('#old') ? ['#scene/retired?seed=2'] : []);
      } finally { shell.dispose(); app.dispose(); }
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
