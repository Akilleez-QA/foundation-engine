/**
 * core/router/router.ts: the hash router (ADR 0022; STD-RUN-11: navigation goes through the router, redirects are data
 * rows, no module-level pending state and no direct address writes outside the router).
 *
 * The router owns every write to the address (`location.hash` assignment for a navigation, `history.replaceState` for a
 * redirect). Parameters travel in the address itself (`#scene/level?n=3`), so a reload, a shared link and Back all
 * reach the same scene with the same parameters. The shell reads the resolution in its route listener (`arrive()`) and
 * hands it to the scene's dispatch row through the ADR 0045 handover (core/router/handover.ts).
 */
import { resolveRoute, routesOf, splitQuery, withQuery, type SceneId, type Resolved } from './resolve';
import type { RouteTables } from './scenes';

/** The parts of `window` the router uses (a fake stands in for it in node tests). */
export interface RouterWindow {
  location: { hash: string };
  history: { replaceState(data: unknown, unused: string, url?: string | URL | null): void };
  addEventListener(type: 'hashchange', listener: () => void): void;
}

export interface GoOptions {
  /** Parameters for the scene, written into the address as its query. */
  params?: Record<string, string>;
  /** Rewrite the current history entry instead of adding one, and run the route listeners now. */
  replace?: boolean;
  /** When the address is already `to`: 'reenter' runs the route listeners again (restart a level); 'ignore' (the
   *  default) does nothing, as assigning the same hash never did. */
  again?: 'reenter' | 'ignore';
}

export interface HashRouter {
  /** Resolve an address (default: the current one) against the tables. */
  resolve(hash?: string): Resolved;
  /** The address of a scene: its canonical route plus `params` as the query. */
  href(to: SceneId, params?: Record<string, string>): string;
  go(to: SceneId, o?: GoOptions): Promise<void>;
  /** Follow a link carried as data: the address becomes `hash` exactly, and a redirect row applies on resolution. */
  follow(hash: string, o?: Omit<GoOptions, 'params'>): void;
  /** Enter the current address again for a reason that is not a navigation (the player changed, an import replaced the
   *  player's data, a GPU context had to be made again). The route listeners run once; the address is not written. */
  reenter(reason: 'player-changed' | 'import' | 'graphics'): Promise<void>;
  /** Run `fn` on every route change: a `hashchange`, a replace and a reentry. Listeners run in registration order. */
  listen(fn: () => void): () => void;
  /** For the route listener, once per route change: apply a rewriting redirect to the address (replaceState, keeping
   *  the query) and return the resolution. */
  arrive(): { resolved: Resolved };
}

/** An explicit fallback uses that scene’s canonical route; omission retains first-route resolution. */
export function createHashRouter(tables: RouteTables, win: RouterWindow, fallbackScene?: SceneId): HashRouter {
  const fallback = fallbackScene === undefined ? undefined : tables.scenes.get(fallbackScene).routes[0]?.hash;
  if (fallbackScene !== undefined && fallback === undefined) throw Error(`router fallback ${fallbackScene} has no route`);
  const listeners: (() => void)[] = [];
  let attached = false;
  const notify = () => { for (const fn of [...listeners]) fn(); };
  const resolve = (hash = win.location.hash) => resolveRoute(hash, routesOf(tables.scenes.all()), tables.redirects.all(), fallback);
  const href = (to: SceneId, params?: Record<string, string>) => {
    const scene = tables.scenes.get(to);
    const keys = params ? Object.keys(params) : [];
    // A route whose fixed params are all given is used as is; the rest of `params` goes into the query.
    const route = keys.length ? scene.routes.find(r => r.params && Object.keys(r.params).every(k => params![k] === r.params![k])) : undefined;
    const rest = Object.fromEntries(keys.filter(k => route?.params?.[k] === undefined).map(k => [k, params![k]]));
    return withQuery((route ?? scene.routes[0]).hash, rest);
  };
  const follow = (hash: string, o: Omit<GoOptions, 'params'> = {}) => {
    if (o.replace) { win.history.replaceState(null, '', hash); notify(); return; }
    if (win.location.hash === hash) { if (o.again === 'reenter') notify(); return; }
    win.location.hash = hash;
  };
  return {
    resolve,
    href,
    go(to, o = {}) { follow(href(to, o.params), o); return Promise.resolve(); },
    follow,
    reenter() { notify(); return Promise.resolve(); },
    listen(fn) {
      if (!attached) { attached = true; win.addEventListener('hashchange', notify); }
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    arrive() {
      const from = win.location.hash;
      const resolved = resolve(from);
      const rows = (resolved.via ?? []).map(id => tables.redirects.get(id));
      if (rows.length && rows.every(r => r.address !== 'keep')) {
        const to = withQuery(resolved.hash, splitQuery(from)[1]);
        if (to !== from) win.history.replaceState(null, '', to);
      }
      return { resolved };
    },
  };
}
