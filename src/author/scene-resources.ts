/** Visit-local resources have one owner, including resources shared by several representations. */
export function createSceneResources() {
  const owned = new Set<{dispose(): void}>();
  const released = new WeakSet<{dispose(): void}>();
  let closed = false;
  const destroy = (resource: {dispose(): void}) => {
    if (released.has(resource)) return;
    released.add(resource);
    resource.dispose();
  };
  return {
    own<T extends {dispose(): void}>(resource: T): T {
      if (released.has(resource)) throw Error('resource already disposed');
      if (closed) {
        destroy(resource);
        throw Error('scene resources already disposed');
      }
      owned.add(resource);
      return resource;
    },
    release(resource: {dispose(): void}): void {
      if (owned.delete(resource)) destroy(resource);
    },
    dispose(): void {
      if (closed) return;
      closed = true;
      const resources = [...owned];
      owned.clear();
      const errors: unknown[] = [];
      for (const resource of resources) {
        try {
          destroy(resource);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'scene resource disposal failed');
    },
  };
}
