/**
 * author/scene-particles.ts: the visit-owned drawing of particle emitters (FX-01).
 *
 * Each admitted emitter is ONE instanced draw: a unit quad (2 triangles) instanced once per live particle, billboarded
 * to the camera in the vertex shader. Per-particle data (centre, size, linear colour and opacity) lives in the
 * emitter's pool (particle-sim.ts), allocated once; each frame with live particles uploads only the live prefix of
 * those arrays in place (STD-REN-36). An emitter with no live particles is hidden, so it costs no draw; a scene with
 * no emitters creates nothing at all.
 *
 * Textures go through the shared texture library like `Material` textures (STD-REN-33): a lease per emitter under the
 * visit's signal (one decode and upload per context however many emitters use it; RES-01 residency applies). Until it
 * arrives, or if it fails (reported once), the emitter draws a soft round dot. Releasing the emitter or leaving the
 * visit aborts a pending load and releases the lease; the leased texture is never disposed here.
 *
 * Limitations: no depth sorting (additive needs none; 'normal' blending is unsorted within an emitter), no frustum
 * culling (an emitter's bounds move every step; an idle emitter is hidden instead), no lighting or soft particles.
 */
import * as T from 'three';
import type { TextureLibrary } from '../platform/assets/textures';
import { isAbortError, type AssetLease } from '../platform/assets/lease-cache';
import type { EmitterSlot, ParticleRenderer } from './particle-contract';

/** On-screen size a particle texture is chosen for: sprites are small. */
const SPRITE_PX = 256;

const VERTEX = /* glsl */`
attribute vec3 offset;
attribute float size;
attribute vec4 tint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vUv = uv;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(offset, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}`;
const FRAGMENT = /* glsl */`
uniform sampler2D map;
uniform float useMap;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 c = vTint;
  if (useMap > 0.5) c *= texture2D(map, vUv);
  else { vec2 q = vUv * 2.0 - 1.0; float d = clamp(1.0 - dot(q, q), 0.0, 1.0); c.a *= d * d; }
  if (c.a < 0.004) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;

export interface SceneParticleOptions {
  scene: T.Scene;
  /** The texture library, or null when the game has none (textures then never load). */
  library: Pick<TextureLibrary, 'texture'> | null;
  /** The visit's lifetime. */
  signal: AbortSignal;
  /** A texture arrived: draw again. */
  changed(): void;
  report(error: unknown): void;
}

export interface ParticleDrawing extends ParticleRenderer {
  /** Emitters bound now; draw calls the last frame would issue (visible emitters); texture loads and failures. */
  readonly stats: { readonly bound: number; readonly visible: number; readonly leased: number; readonly applied: number; readonly failed: number };
  dispose(): void;
}

interface View {
  mesh: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  attrs: T.InstancedBufferAttribute[];
  life: AbortController;
  lease?: AssetLease<T.Texture>;
}

export function createSceneParticles(o: SceneParticleOptions): ParticleDrawing {
  const stats = { bound: 0, visible: 0, leased: 0, applied: 0, failed: 0 };
  const views = new Set<View>();
  const report = (error: unknown) => { try { o.report(error); } catch { /* Diagnostics cannot strand cleanup. */ } };
  let disposed = false;

  const retire = (view: View) => {
    if (!views.delete(view)) return;
    stats.bound = views.size;
    if (view.mesh.visible) stats.visible--;
    view.life.abort();
    const errors: unknown[] = [];
    try { o.scene.remove(view.mesh); } catch (error) { errors.push(error); }
    try { view.mesh.material.uniforms.map.value = null; view.mesh.material.dispose(); } catch (error) { errors.push(error); }
    try { view.mesh.geometry.dispose(); } catch (error) { errors.push(error); }
    try { view.lease?.release(); } catch (error) { errors.push(error); }
    view.lease = undefined;
    if (errors.length) throw new AggregateError(errors, 'particle emitter cleanup failed');
  };

  return {
    stats,
    bind(slot: EmitterSlot) {
      if (disposed || o.signal.aborted) throw Error('particles: the visit has ended');
      const p = slot.pool;
      const geometry = new T.InstancedBufferGeometry();
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.setAttribute('position', new T.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
      geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      const attrs = [new T.InstancedBufferAttribute(p.offset, 3), new T.InstancedBufferAttribute(p.size, 1), new T.InstancedBufferAttribute(p.tint, 4)];
      ['offset', 'size', 'tint'].forEach((name, i) => { attrs[i].setUsage(T.DynamicDrawUsage); geometry.setAttribute(name, attrs[i]); });
      geometry.instanceCount = 0;
      const material = new T.ShaderMaterial({
        vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, toneMapped: false,
        blending: slot.blending === 'additive' ? T.AdditiveBlending : T.NormalBlending,
        uniforms: { map: { value: null }, useMap: { value: 0 } },
      });
      const mesh = new T.Mesh(geometry, material);
      mesh.name = `particles:e${slot.entity}`;
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false;
      const view: View = { mesh, attrs, life: new AbortController() };
      views.add(view); stats.bound = views.size;
      o.scene.add(mesh);
      slot.view = view;
      if (slot.texture && o.library) {
        stats.leased++;
        const life = view.life;
        o.library.texture(slot.texture, { screenPx: SPRITE_PX, signal: life.signal, colorSpace: 'srgb' }).then(lease => {
          if (life.signal.aborted || !views.has(view)) { lease.release(); return; }
          view.lease = lease;
          material.uniforms.map.value = lease.value; material.uniforms.useMap.value = 1;
          stats.applied++;
          o.changed();
        }, error => {
          if (life.signal.aborted || isAbortError(error)) return;
          stats.failed++; report(error);
        }).catch(report);
      }
    },
    draw(slot, count) {
      const view = slot.view as View | undefined;
      if (!view || !views.has(view)) return;
      const visible = count > 0;
      if (view.mesh.visible !== visible) { view.mesh.visible = visible; stats.visible += visible ? 1 : -1; }
      view.mesh.geometry.instanceCount = count;
      if (!visible) return;
      for (const attr of view.attrs) {
        attr.clearUpdateRanges(); attr.addUpdateRange(0, count * attr.itemSize); attr.needsUpdate = true;
      }
    },
    release(slot) {
      const view = slot.view as View | undefined;
      slot.view = undefined;
      if (view) retire(view);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const view of [...views]) try { retire(view); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'particle cleanup failed');
    },
  };
}
