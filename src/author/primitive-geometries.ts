import * as T from 'three';
import type {createSceneResources} from './scene-resources';

export interface PrimitiveGeometryLease {
  readonly key: string;
  readonly geometry: T.BufferGeometry;
  release(): void;
}

/** Visit-local primitive sharing: retain only geometry referenced by live meshes. */
export function createPrimitiveGeometries(resources: ReturnType<typeof createSceneResources>) {
  const entries = new Map<string, {geometry: T.BufferGeometry; references: number}>();
  let closed = false;
  return {
    acquire(kind: string, [w, h, d]: readonly [number, number, number]): PrimitiveGeometryLease {
      if (closed) throw Error('primitive geometries already disposed');
      const key = `${kind}:${w},${h},${d}`;
      let entry = entries.get(key);
      if (!entry) {
        const geometry =
          kind === 'sphere'
            ? new T.SphereGeometry(w / 2, 24, 16)
            : kind === 'cylinder'
              ? new T.CylinderGeometry(w / 2, w / 2, h, 24)
              : kind === 'cone'
                ? new T.ConeGeometry(w / 2, h, 24)
                : kind === 'plane'
                  ? new T.PlaneGeometry(w, d).rotateX(-Math.PI / 2)
                  : kind === 'capsule'
                    ? new T.CapsuleGeometry(w / 2, Math.max(0.01, h - w), 6, 16)
                    : new T.BoxGeometry(w, h, d);
        entry = {geometry: resources.own(geometry), references: 0};
        entries.set(key, entry);
      }
      entry.references++;
      const owned = entry;
      let released = false;
      return {
        key,
        geometry: owned.geometry,
        release() {
          if (released) return;
          released = true;
          if (--owned.references !== 0 || entries.get(key) !== owned) return;
          entries.delete(key); // Retire identity before external disposal listeners run.
          resources.release(owned.geometry);
        },
      };
    },
    dispose() {
      if (closed) return;
      closed = true;
      const live = [...entries.values()];
      entries.clear();
      const errors: unknown[] = [];
      for (const entry of live) {
        try {
          resources.release(entry.geometry);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'primitive geometry disposal failed');
    },
  };
}
