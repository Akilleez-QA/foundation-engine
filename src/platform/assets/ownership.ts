/**
 * platform/assets/ownership.ts: the `owns()` half of the asset library (`AssetLibrary.owns`; ADR 0040;
 *).
 *
 * A consumer holds a lease on a shared resource, never its lifetime. Tree-disposal and batching helpers ask `owns(x)`
 * and skip anything the library answers for. Two kinds of owner answer:
 * - lease caches (the texture library, later the model library), which dispose a resource when its last lease goes;
 * - `residents()`: page-lifetime resources held by a module cache for the whole session (craft-kit finishes, the
 *   shared geometry caches, glow sprites). They are adopted once and never disposed by a consumer.
 */

/** Anything that can say whether it holds a resource. */
export interface ResourceOwner {
  owns(resource: unknown): boolean;
}

/** Page-lifetime resources. Identity-based: a clone is not adopted, so its owner disposes it. */
export interface Residents extends ResourceOwner {
  /** Adopts `resource` for the session and returns it. */
  adopt<R extends object>(resource: R): R;
  /** Gives `resource` back to a single owner (which then disposes it). */
  release(resource: object): void;
}

export function residents(): Residents {
  const held = new WeakSet<object>();
  return {
    adopt: resource => (held.add(resource), resource),
    release: resource => void held.delete(resource),
    owns: resource => typeof resource === 'object' && resource !== null && held.has(resource),
  };
}

/** The union of several owners: `owns(x)` is true when any registered owner holds `x`. */
export interface Ownership extends ResourceOwner {
  /** Adds an owner (a lease cache or library). Returns its removal. */
  register(owner: ResourceOwner): () => void;
}

export function ownership(...initial: ResourceOwner[]): Ownership {
  const owners = new Set<ResourceOwner>(initial);
  return {
    register: owner => (owners.add(owner), () => void owners.delete(owner)),
    owns(resource) {
      if (typeof resource !== 'object' || resource === null) return false;
      for (const owner of owners) if (owner.owns(resource)) return true;
      return false;
    },
  };
}
