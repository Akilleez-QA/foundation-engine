import type { LifetimeRouteRequest, RouteOwner } from './lifetimes';

export interface RouteScope { readonly id: string; readonly incarnation: number; readonly revision: number; readonly ready: boolean }
export interface DependencyTicket { readonly id: string }
export type DependencyStatus = 'valid' | 'stale' | 'unavailable' | 'retired';
/** Optional accepted-world dependency adapter. The supplied route owner is exclusively borrowed. */
export function createRouteDependencies(owner: RouteOwner, options: {
  maxScopes: number; maxRoutes: number; maxDependencies: number; maxIdentityLength: number;
}) {
  const limits = { ...options };
  if (![limits.maxScopes, limits.maxRoutes, limits.maxDependencies, limits.maxIdentityLength].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('navigation: invalid dependency limits');
  const scopes = new Map<string, RouteScope>();
  type Entry = { ticket: DependencyTicket; dependencies: readonly RouteScope[]; status: DependencyStatus };
  const routes = new Map<string, Entry>(), tickets = new WeakMap<DependencyTicket, Entry>();
  let closed = false, busy = false, dependencies = 0, generation: number | undefined;
  const identity = (id: string) => { if (typeof id !== 'string' || !id || id.length > limits.maxIdentityLength) throw Error('navigation: invalid dependency identity'); return id; };
  const copyScope = (input: RouteScope): RouteScope => {
    const { id, incarnation, revision, ready } = input;
    identity(id);
    if (![incarnation, revision].every(n => Number.isSafeInteger(n) && n >= 0) || typeof ready !== 'boolean') throw Error('navigation: invalid dependency scope');
    return Object.freeze({ id, incarnation, revision, ready });
  };
  const remove = (entry: Entry, status: DependencyStatus) => {
    entry.status = status; owner.release(entry.ticket.id); routes.delete(entry.ticket.id); dependencies -= entry.dependencies.length;
  };
  const drain = () => { if (closed) { for (const entry of [...routes.values()]) remove(entry, 'retired'); scopes.clear(); } };
  const run = <T>(operation: () => T): T => {
    if (busy) throw Error('navigation: reentrant dependency operation');
    busy = true; try { return operation(); } finally { busy = false; drain(); }
  };
  return {
    /** Call only after the creator has accepted/published the change, never on preparation. */
    acceptScope(input: RouteScope): { status: 'accepted' | 'unchanged' | 'stale' | 'conflict' | 'saturated' | 'retired'; affected: readonly string[] } {
      return run(() => {
        if (closed) return { status: 'retired', affected: [] };
        const next = copyScope(input); if (closed) return { status: 'retired', affected: [] };
        const old = scopes.get(next.id);
        if (old) {
          if (next.incarnation < old.incarnation || (next.incarnation === old.incarnation && next.revision < old.revision)) return { status: 'stale', affected: [] };
          if (next.incarnation === old.incarnation && next.revision === old.revision) return { status: next.ready === old.ready ? 'unchanged' : 'conflict', affected: [] };
        } else if (scopes.size >= limits.maxScopes) return { status: 'saturated', affected: [] };
        scopes.set(next.id, next);
        const affected: string[] = [];
        for (const entry of [...routes.values()]) if (entry.dependencies.some(d => d.id === next.id)) {
          affected.push(entry.ticket.id); remove(entry, next.ready ? 'stale' : 'unavailable');
        }
        return { status: 'accepted', affected: Object.freeze(affected) };
      });
    },
    offer(input: LifetimeRouteRequest, expected: readonly RouteScope[]) {
      return run(() => {
        if (closed) return { status: 'retired' as const };
        const { id: rawId, generation: requestedGeneration, graph, start, goal } = input, id = identity(rawId);
        if (closed) return { status: 'retired' as const };
        if (!Array.isArray(expected)) throw Error('navigation: invalid route dependencies');
        const length = expected.length;
        if (!Number.isSafeInteger(length) || length < 0) throw Error('navigation: invalid dependency count');
        if (routes.size >= limits.maxRoutes || length > limits.maxDependencies - dependencies) return { status: 'saturated' as const };
        const refs: RouteScope[] = [];
        for (let i = 0; i < length; i++) {
          refs.push(copyScope(expected[i]!));
          if (closed) return { status: 'retired' as const };
        }
        if (closed) return { status: 'retired' as const };
        if (routes.has(id)) return { status: 'conflict' as const };
        if (new Set(refs.map(d => d.id)).size !== refs.length) throw Error('navigation: duplicate route dependency');
        for (const ref of refs) {
          const current = scopes.get(ref.id);
          if (!current || !current.ready) return { status: 'unavailable' as const };
          if (!ref.ready || current.incarnation !== ref.incarnation || current.revision !== ref.revision) return { status: 'stale' as const };
        }
        const status = owner.offer({ id, generation: requestedGeneration, graph, start, goal });
        if (status !== 'accepted') return { status };
        if (generation !== undefined && requestedGeneration > generation) for (const previous of [...routes.values()]) remove(previous, 'stale');
        generation = requestedGeneration;
        const ticket = Object.freeze({ id });
        const entry: Entry = { ticket, dependencies: Object.freeze(refs), status: 'valid' };
        tickets.set(ticket, entry); routes.set(id, entry); dependencies += refs.length;
        return closed ? { status: 'retired' as const } : { status: 'accepted' as const, ticket };
      });
    },
    check(ticket: DependencyTicket): DependencyStatus {
      if (closed) return 'retired';
      const entry = tickets.get(ticket);
      if (!entry) return 'stale';
      if (entry.status !== 'valid') return entry.status;
      // External retirement/supersession of the borrowed owner cannot validate a route.
      return owner.result(entry.ticket.id) === null ? 'unavailable' : 'valid';
    },
    result(ticket: DependencyTicket) {
      const entry = tickets.get(ticket);
      return !closed && entry?.status === 'valid' ? owner.result(entry.ticket.id) : null;
    },
    release(ticket: DependencyTicket) { run(() => { const entry = tickets.get(ticket); if (entry?.status === 'valid') remove(entry, 'retired'); }); },
    dispose() { closed = true; if (!busy) drain(); },
    get stats() { return { scopes: scopes.size, routes: routes.size, dependencies, closed }; },
  };
}
