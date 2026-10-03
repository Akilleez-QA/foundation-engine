/**
 * platform/render/backends/webgl/backend.ts: the WebGL2 render backend, the default (ADR 0078; STD-REN-1).
 *
 * Everything here is what the renderer pool did inline before the seam, moved without change: the same renderer and
 * context attributes, the same create/delete tracking for the leak sweep, the same loss entry points and the same
 * program and frame readiness. WebGL output is byte-identical by construction.
 */
import * as T from 'three';
import type {PoolRenderer} from '../../renderer-pool-types';
import type {ContextObjects, RenderBackend} from '../../render-backend';
import {createFrameReadiness} from '../../frame-readiness';
import {installProgramValidation} from '../../program-validation';
import {waitForPrograms} from '../../program-readiness';
import {glDelete} from '../../gl-interop';

type GL = WebGL2RenderingContext;

const GL_KINDS = [
  ['createTexture', 'deleteTexture'],
  ['createBuffer', 'deleteBuffer'],
  ['createFramebuffer', 'deleteFramebuffer'],
  ['createRenderbuffer', 'deleteRenderbuffer'],
  ['createVertexArray', 'deleteVertexArray'],
  ['createProgram', 'deleteProgram'],
  ['createShader', 'deleteShader'],
  ['createQuery', 'deleteQuery'],
  ['createSampler', 'deleteSampler'],
] as const;

/**
 * Wraps the pooled context's own create/delete calls (instance properties; the prototype is untouched) so a release
 * can delete what its lease left behind. The context's own startup objects (made before the wrap) are never deleted.
 */
export function trackGlObjects(gl: GL): ContextObjects {
  const live = new Map<object, string>();
  const g: Record<(typeof GL_KINDS)[number][number], unknown> = gl;
  for (const [create, del] of GL_KINDS) {
    const c = g[create],
      d = g[del];
    if (typeof c !== 'function' || typeof d !== 'function') continue;
    g[create] = function (this: unknown, ...a: unknown[]) {
      const o: unknown = c.apply(gl, a);
      if (o && typeof o === 'object') live.set(o, del);
      return o;
    };
    g[del] = function (this: unknown, o: unknown) {
      if (o && typeof o === 'object') live.delete(o);
      return d.call(gl, o);
    };
  }
  return {live, validation: installProgramValidation(gl)};
}

/** The WebGL2 backend: three's `WebGLRenderer` on pooled WebGL2 contexts. */
export const webglBackend: RenderBackend<GL, PoolRenderer> = {
  id: 'webgl2',
  capabilities: {multiCanvas: true, syncReadback: true, programIntrospection: true, multiDraw: true},
  lostEvent: 'webglcontextlost',
  restoredEvent: 'webglcontextrestored',
  createRenderer: (canvas, context) =>
    new T.WebGLRenderer(canvas ? {canvas, context, antialias: true} : {antialias: true}),
  contextOf: r => r.getContext() as GL,
  createStageContext(antialias, doc) {
    const canvas = doc.createElement('canvas');
    // three's own context attributes (it always asks for an alpha channel), with this stage's antialias.
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      depth: true,
      stencil: false,
      antialias,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    });
    if (!gl) throw Error('WebGL2 unavailable');
    return {canvas, gl};
  },
  track: trackGlObjects,
  deleteObject: glDelete,
  isLost: gl => !!gl.isContextLost?.(),
  lose(gl) {
    (gl.getExtension?.('WEBGL_lose_context') as WEBGL_lose_context | null)?.loseContext();
  },
  programsReady: (gl, objects, signal) =>
    waitForPrograms(gl, objects.live, signal, {validate: objects.validation.validate}),
  frameReadiness: createFrameReadiness,
};
