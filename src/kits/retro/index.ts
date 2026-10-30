/**
 * kits/retro: an optional retro software-raster look (low resolution, wide "column" pixels, palette or per-channel
 * quantisation, ordered dither) as a render mode through `@kits/three`. Requires the `three` kit.
 * Cost: one extra full-screen triangle per drawn frame; the scene is shaded at the low resolution.
 */
import {defineKit, type KitDefinition, type SceneExtension} from '../../author';
import {sceneThree, type SceneThreeOptions} from '../three/index';
import {installRetro, type RetroController} from './pass';
import {resolveRetroLook, type RetroLookInput} from './look';

export {
  bayerMatrix,
  buildPaletteLut,
  ditherThreshold,
  nearestPaletteIndex,
  paletteSpread,
  resolveRetroLook,
  retroReference,
  retroTargetSize,
  RETRO_LIMITS,
  type RetroDither,
  type RetroLook,
  type RetroLookInput,
} from './look';
export {
  installRetro,
  type RetroController,
  type RetroFrame,
  type RetroHost,
  type RetroRenderer,
  type RetroStats,
} from './pass';

/** The kit: `defineGame({ kits: [three(), retro()] })`. */
export function retro(): KitDefinition {
  return defineKit({id: 'retro', requires: ['three']});
}

/**
 * A scene extension that draws the scene with the retro look: `extensions: [sceneRetro({ width: 320 })]`. The look
 * replaces the scene's draw (including built-in `view.post`). `onReady` receives the controller to change it later.
 */
export function sceneRetro(
  look: RetroLookInput = {},
  options: SceneThreeOptions & {onReady?(controller: RetroController): void} = {},
): SceneExtension {
  resolveRetroLook(look); // a data error at definition time
  const {onReady, setup, ...rest} = options;
  return sceneThree({
    ...rest,
    setup(three) {
      setup?.(three);
      const controller = installRetro(three, look);
      onReady?.(controller);
    },
  });
}
