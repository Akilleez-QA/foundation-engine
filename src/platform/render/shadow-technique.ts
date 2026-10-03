/**
 * platform/render/shadow-technique.ts: which shadow technique a renderer's scenes get at `ultra`. The renderer
 * pool records it at the lease, synchronously and without loading the scheduler (`shadows.ts`, which holds the change
 * tracker and loads with the first scene's chunk); the scheduler reads it when it is installed.
 *
 * - `reference`: the Reference cascades (`shadow-cascades.ts`), for pooled scenes that are not staged;
 * - `authored`: the map each light authored (staged areas, ADR 0061; renderers the pool does not own yet).
 */
export type ShadowTechnique = 'reference' | 'authored';

const techniques = new WeakMap<object, ShadowTechnique>();
/** Record `renderer`'s technique (the pool, at the lease). */
export function setShadowTechnique(renderer: object, technique: ShadowTechnique): void {
  techniques.set(renderer, technique);
}
/** The technique recorded for `renderer`; `authored` when none was. */
export function recordedShadowTechnique(renderer: object): ShadowTechnique {
  return techniques.get(renderer) ?? 'authored';
}

/** Identity of lights built by the engine's pinned CSM/PCSS rig. Basic maps from arbitrary
 * callers are not implicitly approved as the Reference combination. */
const referenceLights = new WeakSet<object>();
export const markReferenceShadowLight = (light: object): void => {
  referenceLights.add(light);
};
export const isReferenceShadowLight = (light: object): boolean => referenceLights.has(light);
