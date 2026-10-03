/**
 * core/router/module.ts: the router as a kernel module (ADR 0022, STD-SYS-10, STD-RUN-10 to STD-RUN-13).
 *
 * `core.router` owns the `scenes` and `redirects` registries. Modules add rows in `register`; in `install` each scene
 * module adds its dispatch row (`s.router.scene(entry)`), and the scene shell reads them once.
 */
import {defineModule, type EngineModule} from '../module';
import {sceneRegistryOptions, redirectRegistryOptions, type RouteTables} from './scenes';
import {routesOf, redirectProblems, type SceneId, type RedirectDef} from './resolve';
import {createHashRouter, type RouterWindow} from './router';
import {createRouterService} from './service';

declare module '../probe' {
  interface EngineProbes {
    router: {hash: string; scene: string; routes: number};
  }
}

export interface RouterModuleOptions {
  /** The window the router reads and writes (default: the page's). */
  win?: () => RouterWindow;
  /** Empty/unresolved addresses use this scene’s canonical route. Omit to retain first-route behavior. */
  fallbackScene?: SceneId;
}

export function routerModule(o: RouterModuleOptions = {}): EngineModule {
  return defineModule({
    id: 'core.router',
    version: '1.0.0',
    serviceKeys: ['router'],
    defines: {
      scenes: sceneRegistryOptions,
      redirects: {...redirectRegistryOptions, idForm: /^redirect\.[a-z0-9]+(?:-[a-z0-9]+)*$/},
    },
    install(s) {
      const tables: RouteTables = {scenes: s.registries.scenes, redirects: s.registries.redirects};
      for (const problem of redirectProblems(routesOf(tables.scenes.all()), tables.redirects.all()))
        s.log.warn(problem);
      const win: RouterWindow | undefined = o.win?.() ?? (globalThis as {window?: Window}).window;
      if (!win) throw Error('core.router needs a window (pass `win` in tests)');
      const router = createRouterService(createHashRouter(tables, win, o.fallbackScene));
      s.provide('router', router);
      s.probes.register(
        'router',
        () => {
          const r = router.resolve();
          return {hash: win.location.hash, scene: r.sceneId, routes: routesOf(tables.scenes.all()).length};
        },
        s.signal,
      );
    },
  });
}
