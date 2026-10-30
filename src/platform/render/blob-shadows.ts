/**
 * platform/render/blob-shadows.ts: the blob (contact) shadow layer (VIS-10): soft dark ground ellipses, every one of a
 * scene in ONE instanced draw. The author side (author/scene-blob-shadows.ts) decides which blobs to draw and where;
 * this layer owns the GPU resources and writes them in place.
 *
 * A blob is a unit ground quad, instanced up to a fixed capacity, drawn by a shared procedural soft-ellipse shader (no
 * texture): its alpha is a smooth radial falloff times a per-instance alpha. Scene fog fades it like everything else,
 * and an optional camera `distance` fades it with view depth (from 75 % of it). The instance buffers (matrices and
 * alphas) are allocated once at capacity (STD-REN-36); `write` updates them in place and marks them for upload only
 * when a value actually changed, so a still scene uploads nothing and reports no change (render on change). With no
 * blob the instance count is 0, so three issues and counts no draw call, but the mesh stays in the scene so its
 * program is compiled with the scene's before activation (STD-REN-37).
 *
 * The mesh casts and receives no shadow, so it never enters a shadow pass or the `shadowCasters` count: it adds at most
 * 1 draw and 2 triangles per drawn blob. Dynamic instances do not fit the batching layer's static primitives
 * (ADR 0055 is about merging static art); like particles, this is a self-contained instanced effect. WebGL only, like
 * the author scene runtime that uses it.
 */
import * as T from 'three';

/** Height above the surface (metres), with a polygon offset, so a blob never fights the ground for depth. */
export const BLOB_LIFT = 0.01;

const VERTEX = /* glsl */ `
attribute float blobAlpha;
uniform float fadeFar;
varying vec2 vUv;
varying float vAlpha;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  float depth = -mvPosition.z;
  vAlpha = fadeFar > 0.0 ? blobAlpha * (1.0 - smoothstep(0.75 * fadeFar, fadeFar, depth)) : blobAlpha;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float a = (1.0 - smoothstep(0.1, 1.0, dot(d, d))) * vAlpha;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    a *= 1.0 - fogFactor;
  #endif
  if (a < 0.002) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

/** One blob in world terms. */
export interface BlobInstance {
  x: number;
  /** The surface height the blob lies on (it is drawn `BLOB_LIFT` above it). */
  y: number;
  z: number;
  /** Yaw in radians. */
  yaw: number;
  /** Ellipse size in metres across x and along z (before yaw). */
  width: number;
  depth: number;
  /** Darkness at the centre, 0…1. */
  alpha: number;
}

export interface BlobShadowLayer {
  /** The one instanced mesh (for tests and diagnostics). */
  readonly mesh: T.InstancedMesh;
  readonly capacity: number;
  /** Instance uploads requested since creation. */
  readonly uploads: number;
  /** Draw these blobs (at most `capacity`; extra ones are ignored: the caller bounds them). True when anything the
   *  picture reads changed. */
  write(blobs: readonly BlobInstance[]): boolean;
  dispose(): void;
}

const m = new T.Matrix4(),
  q = new T.Quaternion(),
  p = new T.Vector3(),
  s = new T.Vector3(),
  UP = new T.Vector3(0, 1, 0);

export function createBlobShadowLayer(
  scene: T.Object3D,
  o: {capacity: number; distance: number | null},
): BlobShadowLayer {
  const capacity = o.capacity;
  if (!Number.isInteger(capacity) || capacity < 1) throw Error('blob shadows: capacity must be a positive integer');
  const geometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const alphas = new Float32Array(capacity);
  const alpha = new T.InstancedBufferAttribute(alphas, 1);
  alpha.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('blobAlpha', alpha);
  const material = new T.ShaderMaterial({
    name: 'blob-shadows',
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, {fadeFar: {value: o.distance ?? 0}}]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new T.InstancedMesh(geometry, material, capacity);
  mesh.name = 'blob-shadows';
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Instances follow entities anywhere in the scene: bounds are not worth keeping.
  mesh.frustumCulled = false;
  // Before other transparent effects at the default order (it lies on opaque ground).
  mesh.renderOrder = -1;
  mesh.count = 0;
  scene.add(mesh);
  const matrices = mesh.instanceMatrix.array as Float32Array;
  let uploads = 0,
    disposed = false;
  return {
    mesh,
    capacity,
    get uploads() {
      return uploads;
    },
    write(blobs) {
      if (disposed) return false;
      const n = Math.min(blobs.length, capacity);
      let changed = false;
      for (let i = 0; i < n; i++) {
        const b = blobs[i]!;
        q.setFromAxisAngle(UP, b.yaw);
        m.compose(p.set(b.x, b.y + BLOB_LIFT, b.z), q, s.set(b.width, 1, b.depth));
        const el = m.elements,
          at = i * 16;
        for (let k = 0; k < 16; k++)
          if (matrices[at + k] !== Math.fround(el[k]!)) {
            matrices.set(el, at);
            changed = true;
            break;
          }
        if (alphas[i] !== Math.fround(b.alpha)) {
          alphas[i] = b.alpha;
          changed = true;
        }
      }
      if (mesh.count !== n) {
        mesh.count = n;
        changed = true;
      }
      if (!changed) return false;
      mesh.instanceMatrix.needsUpdate = true;
      alpha.needsUpdate = true;
      uploads++;
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
