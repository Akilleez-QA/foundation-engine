/**
 * core/router/resolve.ts: hash → scene + params, with redirects as data rows (ADR 0022; STD-RUN-10, STD-RUN-11). Pure:
 * no DOM, no storage, no clock. Old routes are redirect rows, never helper functions.
 *
 * A route is `#scene/<id>` (a scene may declare more hashes); anything after `?` is query parameters
 * (`#scene/level?n=3&mode=hard`), merged over the route's fixed params. Parameters are how a navigation carries
 * where to start, which level, or any other data a scene needs on entry.
 */

export type SceneId = `scene.${string}`;

/** One hash a scene answers to. `params` are that route's fixed parameters. */
export interface SceneRoute { hash: string; params?: Readonly<Record<string, string>> }

/** A scene's route, flattened for the resolver. */
export interface RouteDef { sceneId: SceneId; hash: string; params?: Readonly<Record<string, string>> }

export interface RedirectDef {
  id: string;
  /** Exact hash or pattern. A pattern's groups are passed to `params` and substituted for $1, $2 in `to`. */
  from: string | RegExp;
  to: string;
  params?: Readonly<Record<string, string>> | ((groups: string[]) => Record<string, string>);
  /** Why it exists: which change retired the old route. Shown in the redirect audit. */
  note: string;
  /**
   * What happens to the address bar. 'replace' (the default): the router rewrites it to `to` with
   * `history.replaceState`, so Back does not bounce into the old route. 'keep': the row only tells the resolver
   * where the hash leads; the address is left as it is.
   */
  address?: 'replace' | 'keep';
}

export interface Resolved {
  /** '' only when the fallback itself is not a route (a broken table; `redirectProblems` reports it). */
  sceneId: SceneId | '';
  /** The route hash the resolution ends at (without its query). */
  hash: string;
  params: Record<string, string>;
  /** The hashes passed through on the way (redirect sources, then an unresolved hash that fell back). */
  redirectedFrom?: string[];
  /** The ids of the redirect rows applied, in order. */
  via?: string[];
}

export const MAX_REDIRECT_HOPS = 4;

/** `#scene/a?x=1&y=2` → `['#scene/a', {x: '1', y: '2'}]`. */
export function splitQuery(hash: string): [string, Record<string, string>] {
  const at = hash.indexOf('?');
  if (at < 0) return [hash, {}];
  return [hash.slice(0, at), Object.fromEntries(new URLSearchParams(hash.slice(at + 1)))];
}

/** A route hash with parameters as its query, keys sorted so one set of params always writes one address. */
export function withQuery(hash: string, params: Readonly<Record<string, string>> = {}): string {
  const keys = Object.keys(params).sort();
  return keys.length ? `${hash}?${new URLSearchParams(keys.map(k => [k, params[k]])).toString()}` : hash;
}

/** Every route of every scene, canonical route first. */
export function routesOf(scenes: readonly { id: SceneId; routes: readonly SceneRoute[] }[]): RouteDef[] {
  return scenes.flatMap(p => p.routes.map(r => ({ sceneId: p.id, hash: r.hash, ...(r.params ? { params: r.params } : {}) })));
}

function matches(r: RedirectDef, hash: string): boolean {
  if (typeof r.from === 'string') return r.from === hash;
  r.from.lastIndex = 0;
  return r.from.test(hash);
}

/**
 * Resolve `hash` to a route: an exact route wins; otherwise the first matching redirect row is applied (at most
 * `MAX_REDIRECT_HOPS`), merging its params. A hash that reaches no route resolves to `fallback`.
 */
export function resolveRoute(address: string, routes: readonly RouteDef[], redirects: readonly RedirectDef[], fallback = routes[0]?.hash ?? '#'): Resolved {
  const trail: string[] = [], via: string[] = [];
  let [hash, params] = splitQuery(address);
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const exact = routes.find(r => r.hash === hash);
    if (exact) return { sceneId: exact.sceneId, hash, params: { ...exact.params, ...params }, ...(trail.length ? { redirectedFrom: trail, via } : {}) };
    if (hop === MAX_REDIRECT_HOPS) break;
    const r = redirects.find(r => matches(r, hash));
    if (!r) break;
    const groups = typeof r.from === 'string' ? [] : (r.from.exec(hash) ?? []).slice(1);
    trail.push(hash); via.push(r.id);
    params = { ...(typeof r.params === 'function' ? r.params(groups) : r.params), ...params };
    [hash] = splitQuery(r.to.replace(/\$(\d)/g, (_, i: string) => groups[+i - 1] ?? ''));
  }
  const home = routes.find(r => r.hash === fallback);
  return { sceneId: home?.sceneId ?? '', hash: fallback, params: { ...home?.params }, redirectedFrom: [...trail, hash], via };
}

/**
 * Validate-phase checks: every redirect ends at a real route within the hop limit, no redirect shadows a live route,
 * no route or redirect id is claimed twice, no row cycles. Pattern rows are checked through their `to` when it has no
 * group substitution (a pattern may also match live routes: routes win, so catch-alls work).
 */
export function redirectProblems(routes: readonly RouteDef[], redirects: readonly RedirectDef[]): string[] {
  const out: string[] = [];
  const NONE = '\u0000none';
  const reaches = (from: string) => {
    const res = resolveRoute(from, routes, redirects, NONE);
    return res.hash !== NONE && routes.some(x => x.hash === res.hash) ? null : (res.redirectedFrom ?? [from]).join(' → ');
  };
  for (const r of redirects) {
    if (typeof r.from === 'string') {
      if (routes.some(x => x.hash === r.from)) out.push(`redirect ${r.id} shadows a live route ${r.from}`);
      const miss = reaches(r.from);
      if (miss !== null) out.push(`redirect ${r.id} does not reach a route (${miss})`);
    } else {
      if (!/\$\d/.test(r.to)) { const miss = reaches(r.to); if (miss !== null) out.push(`redirect ${r.id} does not reach a route (${r.to}: ${miss})`); }
    }
  }
  const seen = new Set<string>();
  for (const r of routes) { if (seen.has(r.hash)) out.push(`two scenes claim ${r.hash}`); seen.add(r.hash); }
  const ids = new Set<string>();
  for (const r of redirects) { if (ids.has(r.id)) out.push(`two redirects are called ${r.id}`); ids.add(r.id); }
  return out;
}
