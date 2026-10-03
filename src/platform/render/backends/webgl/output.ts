/**
 * platform/render/backends/webgl/output.ts: a scene's output (author/scene-output.ts) on three's WebGL renderer.
 *
 * The author data is backend-neutral names ('none', 'aces', 'agx', 'neutral') and an exposure; this module maps them to
 * three's tone-mapping constants for the lease profile and for a live change. A WebGPU backend maps the same names onto
 * its own renderer (ADR 0078). `'none'` with exposure 1 is three's default for a fresh renderer, so a scene without
 * `view.output` sets exactly what it had before.
 *
 * Cost: a tone-mapping change recompiles the lit materials once (three keys programs on it); an exposure change is a
 * uniform. Neither happens unless the scene changes its output.
 */
import * as T from 'three';
import type {RenderOutput as SceneOutput, ToneMappingName} from '../../render-backend';
import type {RenderProfile} from '../../renderer-pool-types';

const TONE_MAPPING: Readonly<Record<ToneMappingName, T.ToneMapping>> = {
  none: T.NoToneMapping,
  aces: T.ACESFilmicToneMapping,
  agx: T.AgXToneMapping,
  neutral: T.NeutralToneMapping,
};

/** The lease profile fields for `output`. */
export function outputProfile(
  output: Readonly<SceneOutput>,
): Pick<RenderProfile, 'toneMapping' | 'toneMappingExposure'> {
  return {toneMapping: TONE_MAPPING[output.toneMapping], toneMappingExposure: output.exposure};
}

/** Apply a changed output to a leased renderer (the scene draws the next frame with it). */
export function applyOutput(
  renderer: Pick<T.WebGLRenderer, 'toneMapping' | 'toneMappingExposure'>,
  output: Readonly<SceneOutput>,
): void {
  renderer.toneMapping = TONE_MAPPING[output.toneMapping];
  renderer.toneMappingExposure = output.exposure;
}
