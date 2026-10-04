/**
 * platform/assets/texture-bytes.ts: the resident-byte estimate of one texture, shared by the texture and model
 * libraries (RES-01 residency budgets, `maxResidentBytes` admission and the `textures` / `models` probes).
 *
 * - An image texture (PNG, JPEG, WebP, a decoded bitmap) is uploaded as mipmapped RGBA8: width × height × 4 × 4/3.
 * - A compressed texture (KTX2 / Basis Universal, transcoded by `KTX2Loader`) is uploaded exactly as its mip levels
 *   hold it: the sum of each level's bytes. That is the GPU size of the transcoded format (BC7, ETC2, ASTC, …), and
 *   also the uncompressed RGBA8 size when the device supports no compressed format and the transcoder fell back to it.
 *
 * Estimates, not measured driver memory: a driver may pad or keep its own copy. Type-only three import; no runtime cost.
 */
import type * as T from 'three';

interface Level {
  data?: {byteLength: number} | null;
}

const levelBytes = (levels: readonly unknown[]): number =>
  levels.reduce<number>((n, level) => n + ((level as Level | null)?.data?.byteLength ?? 0), 0);

/** True for a texture whose mip levels hold GPU-ready (compressed or transcoded) data. */
export const isCompressedTexture = (texture: T.Texture): texture is T.CompressedTexture =>
  (texture as Partial<T.CompressedTexture>).isCompressedTexture === true;

/** Estimated resident bytes of one texture (see the module comment). */
export function textureBytes(texture: T.Texture): number {
  if (isCompressedTexture(texture)) {
    // A compressed cube texture keeps each face's levels on its image; a 2D or array texture keeps them on `mipmaps`.
    const faces = Array.isArray(texture.image) ? (texture.image as {mipmaps?: unknown[]}[]) : [];
    const cube = faces.reduce((n, face) => n + levelBytes(face?.mipmaps ?? []), 0);
    return cube || levelBytes((texture.mipmaps as unknown[] | undefined) ?? []);
  }
  const image = texture.image as {width?: number; height?: number} | null | undefined;
  return Math.round((image?.width ?? 0) * (image?.height ?? 0) * 4 * (4 / 3));
}
