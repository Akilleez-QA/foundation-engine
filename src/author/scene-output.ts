/**
 * author/scene-output.ts: how a scene's lit picture becomes display colour (tone mapping and exposure). Plain data and
 * validation only: nothing here imports three.js, so `defineScene` and node tests stay cheap. The renderer side
 * (three's tone-mapping constants on the leased renderer) lives in platform/render/backends/webgl/output.ts.
 *
 * Opt-in per scene: `defineScene({ view: { output: { toneMapping: 'aces', exposure: 0.9 } } })`. Without `output` a
 * scene draws exactly as before (`toneMapping: 'none'`, exposure 1: three's defaults for a fresh renderer).
 * `ctx.view.output` is mutable at run time: replace it (`ctx.view.output = { ...ctx.view.output, exposure: 1.2 }`) and
 * the next frame draws once with the new output, then the scene is still again.
 */

import type {RenderOutput, ToneMappingName} from '../platform/render/render-backend';
export type {ToneMappingName};

/** `'none'` keeps linear colour clipped at 1 (the default). The others compress bright light (emissive, strong
 *  lamps) into the display range: `'aces'` (filmic, warm, contrasty), `'agx'` (desaturates highlights more
 *  gracefully), `'neutral'` (keeps hues closest to the authored colours). */
export const TONE_MAPPINGS: readonly ToneMappingName[] = ['none', 'aces', 'agx', 'neutral'];

/** `exposure` multiplies the picture's light before tone mapping: 1 is neutral; (0, 16]. Under `'none'` it has no
 *  effect. */
export type SceneOutput = RenderOutput;
/** What a scene without `view.output` draws with: today's picture, byte for byte. */
export const OUTPUT_DEFAULTS: Readonly<SceneOutput> = Object.freeze({toneMapping: 'none', exposure: 1});
export const OUTPUT_LIMITS = Object.freeze({exposure: {above: 0, max: 16}});

/** The complete output for `input` (defaults filled in), or a thrown error naming the field. */
export function validateSceneOutput(input: unknown, where = 'view.output'): SceneOutput {
  if (input === undefined) return {...OUTPUT_DEFAULTS};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw Error(`${where} must be an object`);
  const o = input as Record<string, unknown>;
  for (const key of Object.keys(o))
    if (key !== 'toneMapping' && key !== 'exposure')
      throw Error(`${where}.${key} is unknown: expected toneMapping or exposure`);
  const toneMapping = o.toneMapping ?? OUTPUT_DEFAULTS.toneMapping;
  if (typeof toneMapping !== 'string' || !(TONE_MAPPINGS as readonly string[]).includes(toneMapping))
    throw Error(`${where}.toneMapping must be one of ${TONE_MAPPINGS.join(', ')} (got ${JSON.stringify(toneMapping)})`);
  const exposure = o.exposure ?? OUTPUT_DEFAULTS.exposure;
  if (
    typeof exposure !== 'number' ||
    !Number.isFinite(exposure) ||
    exposure <= OUTPUT_LIMITS.exposure.above ||
    exposure > OUTPUT_LIMITS.exposure.max
  )
    throw Error(`${where}.exposure must be a number in (0, ${OUTPUT_LIMITS.exposure.max}] (got ${String(exposure)})`);
  return {toneMapping: toneMapping as ToneMappingName, exposure};
}

/** A stable key for change detection (one string compare per frame; no allocation when unchanged). */
export const outputKey = (o: Readonly<SceneOutput>): string => `${o.toneMapping}:${o.exposure}`;
