/**
 * Test-time disclosure check for scoped views (SEC-01). Information leaks are invisible to the host at runtime: a
 * client can display anything it receives. Creator tests call `findDisclosureLeaks`/`assertDisclosure` on a
 * projection (`{worldRevision, entities:[{id, incarnation, fields}]}`, the `project()` output of a view publisher)
 * with a predicate stating what one observer may see. Pure; no runtime cost unless a test calls it.
 */

export interface DisclosureLeak {
  readonly id: string;
  /** Dotted field path (`''` for the entity itself; array items by index). */
  readonly path: string;
}
/** `allowed(id, '')` decides whether the entity may appear at all; `allowed(id, path)` each leaf field. */
export type DisclosurePredicate = (id: string, path: string) => boolean;
export const MAX_DISCLOSURE_LEAKS = 64;

/** Returns at most 64 leaks, in projection order. Throws for a projection that is not the view shape. */
export function findDisclosureLeaks(projectJson: string, allowed: DisclosurePredicate): readonly DisclosureLeak[] {
  const projection = JSON.parse(projectJson) as unknown;
  const entities = (projection as { entities?: unknown } | null)?.entities;
  if (!Array.isArray(entities) || typeof allowed !== 'function') throw Error('disclosure: not a view projection');
  const leaks: DisclosureLeak[] = [];
  const leak = (id: string, path: string) => {
    if (leaks.length < MAX_DISCLOSURE_LEAKS) leaks.push(Object.freeze({ id, path }));
  };
  for (const entity of entities) {
    const id = (entity as { id?: unknown })?.id;
    if (typeof id !== 'string') throw Error('disclosure: entity without id');
    if (!allowed(id, '')) { leak(id, ''); continue; }
    // Iterative walk over leaves, so deep data cannot exhaust the call stack.
    const pending: [unknown, string][] = [[(entity as { fields?: unknown }).fields, '']];
    while (pending.length) {
      const [value, path] = pending.pop()!;
      if (value !== null && typeof value === 'object') {
        const keys = Array.isArray(value) ? value.map((_, i) => String(i)) : Object.keys(value);
        if (keys.length === 0 && path && !allowed(id, path)) leak(id, path);
        for (let i = keys.length - 1; i >= 0; i--)
          pending.push([(value as Record<string, unknown>)[keys[i]!], path ? `${path}.${keys[i]}` : keys[i]!]);
      } else if (path && !allowed(id, path)) leak(id, path);
    }
  }
  return Object.freeze(leaks);
}

/** Throws an Error listing leaked `id:path` entries when the projection discloses anything not allowed. */
export function assertDisclosure(projectJson: string, allowed: DisclosurePredicate): void {
  const leaks = findDisclosureLeaks(projectJson, allowed);
  if (leaks.length) throw Error(`disclosure: ${leaks.length} leak(s): ${leaks.map(l => `${l.id}:${l.path || '(entity)'}`).join(', ')}`);
}
