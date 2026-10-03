import copyCatalog from './strings/shell/en.json';
import {appI18n as copyI18n, t as copyText} from '../../core/i18n/app-i18n';
copyI18n.addCatalog('en', copyCatalog);
/**
 * platform/ui/shell-module.ts: `platform.shell`, the page around the scenes (ADR 0020, ADR 0041; STD-RUN-10 to 16).
 *
 * It owns the `scene` event area and, after every module installed (`app.started`, so every scene module has added
 * its dispatch row), starts the scene shell over the router's rows in the page's mount (`#app`). It also:
 *  - puts the settings menu's sound toggle in the header (the menu is the shell's own row, created on first use);
 *  - registers the `scene` and `render.pool` probes the test API and the bench read;
 *  - re-enters the current scene when the active player changes.
 */
import {defineModule, type EngineModule} from '../../core/module';
import type {SceneId} from '../../core/router/resolve';
import type {} from '../../core/router/module';
import type {} from '../../core/save/module';
import type {} from '../../core/settings/module';
import {settleAppRendererPool, rendererPoolStats} from '../render/app-renderer-pool';
import type {PoolStats} from '../render/renderer-pool-types';
import {appActivities, appLoop, appLayers} from './runtime';
import {appShell} from './shell';
import {createSceneShell, type SceneShell, type SceneState} from './scene-shell';
import type {ActivityHost} from '../../core/activity/activity';

declare module '../../core/services' {
  interface Services {
    /** The page around the scenes: the mount element and the activity host scenes run on. */
    readonly shell: {
      readonly mount: HTMLElement;
      readonly activities: ActivityHost;
      state(): ReturnType<SceneShell['state']>;
    };
  }
}
declare module '../../core/probe' {
  interface EngineProbes {
    scene: {scene: SceneId | null; state: SceneState | null; epoch: number; hash: string};
  }
}

export const SHELL_MODULE_ID = 'platform.shell';

export interface ShellModuleOptions {
  /** The home scene: where "Go back" leads and an unknown address falls back to. */
  home: SceneId;
  /** The mount element's selector (default '#app'). */
  mount?: string;
  /** Optional bounded touch-friendly menu; no device or viewport inference. */
  menuPresentation?: 'expanded' | 'compact';
}

export function shellModule(o: ShellModuleOptions): EngineModule {
  return defineModule({
    id: SHELL_MODULE_ID,
    version: '1.0.0',
    requires: [
      'core.router',
      'core.save',
      'core.settings',
      ...(o.menuPresentation === 'compact' ? ['platform.input'] : []),
    ],
    serviceKeys: ['shell'],
    eventAreas: ['scene'],
    install(s) {
      const install = (factory?: typeof import('./compact-shell').configureCompactShell) => {
        s.signal.throwIfAborted();
        const doc = document,
          mount = doc.querySelector<HTMLElement>(o.mount ?? '#app');
        if (!mount) throw Error(`platform.shell: no mount element ${o.mount ?? '#app'}`);
        const activities = appActivities(doc);
        let shell: SceneShell | null = null;
        const compact = factory
          ? factory(appShell(doc), {
              layers: appLayers(doc),
              signal: s.signal,
              closeLabel: copyText('engine.shell.close'),
              cancelInput: () => s.input.cancel('overlay'),
            })
          : null;
        s.events.on('scene.entering', () => compact?.close(), s.signal);
        s.provide('shell', {mount, activities, state: () => shell?.state() ?? {scene: null, state: null, epoch: 0}});

        // The settings menu's sound toggle.
        const sound = doc.createElement('button');
        sound.type = 'button';
        sound.id = 'shell-sound';
        const label = () => {
          sound.textContent = copyText(
            s.settings.get('sound.muted') ? 'engine.shell.sound-off' : 'engine.shell.sound-on',
          );
        };
        sound.addEventListener('click', () => s.settings.set('sound.muted', !s.settings.get('sound.muted')), {
          signal: s.signal,
        });
        s.settings.subscribe('sound.muted', label, s.signal);
        label();
        const row = appShell(doc).add({id: 'shell.sound', zone: 'menu', order: 10, element: sound});

        s.events.on(
          'app.started',
          () => {
            shell = createSceneShell({
              router: s.router,
              mount,
              doc,
              events: s.events,
              home: o.home,
              loop: appLoop(),
              player: () => s.save.activePlayer(),
              onEntered: settleAppRendererPool,
              report: (m, e) => s.log.error(m, e),
            });
            shell.start();
          },
          s.signal,
        );
        s.events.on(
          'player.changed',
          () => {
            void s.router.reenter('player-changed');
          },
          s.signal,
        );
        s.probes.register(
          'scene',
          () => ({
            ...(shell?.state() ?? {scene: null, state: null, epoch: 0}),
            hash: doc.defaultView?.location.hash ?? '',
          }),
          s.signal,
        );
        s.probes.register('render.pool', () => rendererPoolStats() ?? ({} as PoolStats), s.signal);
        return {
          dispose: () => {
            compact?.dispose();
            shell?.dispose();
            row.remove();
          },
        };
      };
      return o.menuPresentation === 'compact'
        ? import('./compact-shell').then(({configureCompactShell}) => install(configureCompactShell))
        : install();
    },
  });
}
