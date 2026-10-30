/**
 * The three.js (0.186) runtime fields the platform reads or writes that @types/three does not declare. Every such
 * access goes through this module, so an engine upgrade has one module to re-verify (change-tracker.test.ts pins the
 * revision and exercises each one). Accessors are plain property reads: no allocation, safe on render hot paths.
 */
import type * as T from 'three';

/** The private BatchedMesh draw-state fields the change trackers observe. Each may be absent if three renames it. */
export interface BatchedMeshInternals {
  readonly _matricesTexture?: T.DataTexture | null;
  readonly _colorsTexture?: T.DataTexture | null;
  readonly _instanceInfo?: readonly {
    readonly active: boolean;
    readonly visible: boolean;
    readonly geometryIndex: number;
  }[];
  readonly _geometryInfo?: readonly {
    readonly active: boolean;
    readonly vertexStart: number;
    readonly vertexCount: number;
    readonly indexStart: number;
    readonly indexCount: number;
    readonly start: number;
    readonly count: number;
  }[];
}
/** A batch's private draw-state fields (see `BatchedMeshInternals`). */
export const batchedMeshInternals = (b: T.BatchedMesh): BatchedMeshInternals =>
  b as T.BatchedMesh & BatchedMeshInternals;

/** A material's numeric id: three assigns it at construction (as it does `Object3D.id`), but the types omit it. */
export const materialId = (m: T.Material): number => (m as T.Material & {readonly id: number}).id;

/** A material's own enumerable fields, by key (the generic readers read `Object.keys` of it). */
export type MaterialRecord = Record<string, unknown>;
/** A material viewed as its key/value record. */
// lint:allow-unknown-cast a class instance has no index signature; the change trackers read every own key of it by name
export const materialRecord = (m: T.Material): MaterialRecord => m as unknown as MaterialRecord;

/** Marks a render target as a presented (XR-style) target, so three applies tone mapping and the output colour space. */
export function markPresentedTarget(target: T.WebGLRenderTarget): void {
  (target as T.WebGLRenderTarget & {isXRRenderTarget: boolean}).isXRRenderTarget = true;
}
