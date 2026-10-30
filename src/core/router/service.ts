/**
 * core/router/service.ts: the `router` service. It is the
 * app's one hash router plus the scenes' dispatch rows (`SceneEntry`, handover.ts): each scene module adds its own
 * row in install (`s.router.scene(entry)`), and the shell reads them once (`entries()`), which closes the list.
 * The rows are session code (their loaders close over the app's services), so they live here rather than in the
 * frozen `scenes` registry, which holds only data.
 */
import type {SceneEntry} from './handover';
import type {HashRouter} from './router';

export interface RouterService extends HashRouter {
  /** Add a scene's dispatch row. Rows keep the order they are added in (idle rows are fetched in that order). */
  scene(entry: SceneEntry): void;
  /** Every dispatch row, in order. The first read closes the list: a row added later throws. */
  entries(): readonly SceneEntry[];
}

declare module '../services' {
  interface Services {
    router: RouterService;
  }
}

export function createRouterService(router: HashRouter): RouterService {
  const rows: SceneEntry[] = [];
  let closed = false;
  return {
    ...router,
    scene(entry) {
      if (closed) throw new Error(`[router] the scene row ${entry.id} was added after the shell read the rows`);
      if (rows.some(r => r.id === entry.id)) throw new Error(`[router] the scene row ${entry.id} was added twice`);
      rows.push(entry);
    },
    entries() {
      closed = true;
      return Object.freeze([...rows]);
    },
  };
}
