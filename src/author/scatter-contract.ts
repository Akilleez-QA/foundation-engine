/** author/scatter-contract.ts: the scene-level scatter opt-in, shared by scene definitions and the scatter module
 * without an import cycle (defs.ts → scatter.ts → defs.ts). */
export interface SceneScatterLimits {
  /** Scatters drawn at once in a visit. */
  max: number;
  /** Copies drawn at once across the visit's scatters (after quality thinning). */
  instances: number;
}

/** A scene's opt-in to scatters, with its bounds. */
export interface SceneScatter {
  readonly kind: 'scene-scatter';
  readonly limits: Readonly<SceneScatterLimits>;
}
