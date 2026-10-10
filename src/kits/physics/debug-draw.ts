/**
 * kits/physics/debug-draw: opt-in wireframe of the physics world (collider outlines, contacts) as one line draw.
 * Off unless a scene lists the extension: `extensions: [physicsDebugDraw(physics)]`. Owner: the scene visit. The line
 * buffers are allocated once at open with room for `maxVertices` (default: the world's `maxDebugVertices`); each
 * physics tick refreshes them from the library's debug renderer, copying at most that many vertices (the rest are
 * counted, in `stats()`, not drawn). Closed and disposed with the visit. Cost: one draw call; per refreshed frame one
 * library debug render and one bounded buffer upload.
 */
import * as THREE from 'three';
import {sceneExtension, type SceneExtension} from '../../author/scene-extension';
import {PHYSICS_LIMIT_RANGES} from './config';
import type {ScenePhysics} from './scene';

export interface PhysicsDebugDrawOptions {
  /** Vertex capacity (two per segment): [2, 1048576]. Default: the physics world's `maxDebugVertices`. */
  maxVertices?: number;
  /** Draw only while this returns true (a dev toggle). Default: always while listed. */
  enabled?: () => boolean;
}

export function physicsDebugDraw(physics: ScenePhysics, o: PhysicsDebugDrawOptions = {}): SceneExtension {
  const [lo, hi] = PHYSICS_LIMIT_RANGES.maxDebugVertices;
  if (o.maxVertices !== undefined && !(Number.isInteger(o.maxVertices) && o.maxVertices >= lo && o.maxVertices <= hi))
    throw new RangeError(`physicsDebugDraw: maxVertices must be an integer in [${lo}, ${hi}]`);
  return sceneExtension('physics-debug', x => {
    let capacity = o.maxVertices ?? 0;
    let geometry: THREE.BufferGeometry | null = null,
      lines: THREE.LineSegments | null = null,
      material: THREE.LineBasicMaterial | null = null;
    let lastTick = -1,
      drawn = 0,
      total = 0,
      truncated = 0,
      closed = false;
    const ensure = (limit: number) => {
      if (geometry) return;
      capacity = capacity || limit;
      capacity -= capacity % 2;
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 4), 4));
      geometry.setDrawRange(0, 0);
      material = new THREE.LineBasicMaterial({vertexColors: true, transparent: true, depthTest: false});
      lines = new THREE.LineSegments(geometry, material);
      lines.name = 'kits.physics.debug';
      lines.frustumCulled = false;
      lines.renderOrder = 1e6;
      x.scene.add(lines);
    };
    return {
      sync() {
        if (closed) return false;
        const w = physics.current({world: x.world}); // never creates the visit's world
        const on = !!w && (o.enabled?.() ?? true);
        if (!on) {
          if (lines?.visible) {
            lines.visible = false;
            return true;
          }
          return false;
        }
        ensure(w.config.limits.maxDebugVertices);
        const tick = w.status().tick;
        if (tick === lastTick && lines!.visible) return false;
        lastTick = tick;
        const out = w.debugLines();
        if (!out) return false;
        const n = Math.min(out.vertexCount, capacity);
        const pos = geometry!.getAttribute('position') as THREE.BufferAttribute,
          col = geometry!.getAttribute('color') as THREE.BufferAttribute;
        (pos.array as Float32Array).set(out.vertices.subarray(0, n * 3));
        (col.array as Float32Array).set(out.colors.subarray(0, n * 4));
        pos.needsUpdate = true;
        col.needsUpdate = true;
        geometry!.setDrawRange(0, n);
        lines!.visible = true;
        drawn = n;
        total = out.total;
        if (n < out.total) truncated++;
        return true;
      },
      busy: () => false,
      stats: () => ({capacity, drawn, total, truncatedFrames: truncated}),
      dispose() {
        if (closed) return;
        closed = true;
        if (lines) x.scene.remove(lines);
        geometry?.dispose();
        material?.dispose();
        geometry = null;
        material = null;
        lines = null;
      },
    };
  });
}
