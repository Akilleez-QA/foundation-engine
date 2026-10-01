/**
 * Texture helpers over the app's library (`appAssets()`, app-assets.ts) for code that has no `Services` yet. Only
 * scene chunks import this file, so the library's implementation never weighs on the first-load bundle.
 */
import type * as T from 'three';
import { dressTexture, type TextureOptions } from './textures';
import { appAssets } from './app-assets';

export { keepWidth } from './textures';

/** `dressTexture` on the app library: `apply` runs once the leased texture arrives, never after `o.signal` aborts. */
export const dressAsset = (id: string, o: TextureOptions, apply: (texture: T.Texture) => void, onError?: (error: unknown) => void) =>
  dressTexture(appAssets(), id, o, apply, onError);
