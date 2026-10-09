/**
 * platform/assets/texture-bytes.ts: the resident-byte estimate of one texture, shared by the texture and model
 * libraries (RES-01 residency budgets, `maxResidentBytes` admission and the `textures` / `models` probes).
 *
 * - An ordinary 2D image is charged a complete RGBA8 mip chain, summing each level's integer dimensions down to 1×1.
 *   This remains a conservative full-chain policy when its sampler disables mipmaps, not a descriptor-exact forecast.
 * - A compressed texture (KTX2 / Basis Universal, transcoded by `KTX2Loader`) is uploaded exactly as its mip levels
 *   hold it: the sum of each level's bytes. That is the GPU size of the transcoded format (BC7, ETC2, ASTC, …), and
 *   also the uncompressed RGBA8 size when the device supports no compressed format and the transcoder fell back to it.
 *
 * Common scalar R/RG/RGBA byte, half-float and float textures also charge full chains, including six-face cubes,
 * fixed array layers and shrinking volume depth. Unsupported descriptors retain the ordinary image fallback.
 * Estimates, not measured driver memory: a driver may pad or keep its own copy.
 */
import type * as T from 'three';
import {RedFormat, RGFormat, RGBAFormat, UnsignedByteType, HalfFloatType, FloatType} from 'three';

interface Level {
  data?: {byteLength: number} | null;
}

const levelBytes = (levels: readonly unknown[]): number =>
  levels.reduce<number>((n, level) => n + ((level as Level | null)?.data?.byteLength ?? 0), 0);

interface Dimensions {
  width?: number;
  height?: number;
  depth?: number;
}

const validDimension = (n: number) => Number.isSafeInteger(n) && n >= 0;

function fullChain(width: number, height: number, depth: number, bytesPerTexel: number, volume = false): number {
  if (![width, height, depth].every(validDimension)) return NaN;
  if (width === 0 || height === 0 || depth === 0) return 0;
  let bytes = 0;
  // Safe integer dimensions require at most 53 levels. Arrays retain their layer count.
  for (;;) {
    bytes += width * height * depth * bytesPerTexel;
    if (width === 1 && height === 1 && (!volume || depth === 1)) return bytes;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    if (volume) depth = Math.max(1, Math.floor(depth / 2));
  }
}

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
  const image = texture.image as Dimensions | null | undefined,
    fallback = () => fullChain(image?.width ?? 0, image?.height ?? 0, 1, 4),
    components =
      texture.format === RedFormat ? 1 : texture.format === RGFormat ? 2 : texture.format === RGBAFormat ? 4 : 0,
    scalar =
      texture.type === UnsignedByteType ? 1 : texture.type === HalfFloatType ? 2 : texture.type === FloatType ? 4 : 0;
  // Preserve compatibility for creator descriptors outside this accounting domain. Their budget forecast remains
  // incomplete: source buffer lengths and arbitrary internalFormat overrides do not establish destination payload.
  if (
    texture.internalFormat != null ||
    texture.mipmaps?.length ||
    texture.isRenderTargetTexture ||
    !components ||
    !scalar
  )
    return fallback();
  const flags = texture as T.Texture & {
    isCubeTexture?: boolean;
    isDataArrayTexture?: boolean;
    isData3DTexture?: boolean;
  };
  if (flags.isCubeTexture) {
    const faces: unknown = texture.image;
    if (faces == null || (Array.isArray(faces) && faces.length === 0)) return 0;
    if (!Array.isArray(faces) || faces.length !== 6) return NaN;
    let size = 0;
    for (let i = 0; i < 6; i++) {
      const face = faces[i];
      const dimensions = (face?.isDataTexture ? face.image : face) as Dimensions | null | undefined,
        width = dimensions?.width ?? 0,
        height = dimensions?.height ?? 0;
      if (!validDimension(width) || !validDimension(height)) return NaN;
      // Valid cube allocations use six equal square faces; the parent descriptor supplies the format and type.
      if (!width || width !== height || (size && width !== size)) return NaN;
      size = width;
    }
    return fullChain(size, size, 6, components * scalar);
  }
  return fullChain(
    image?.width ?? 0,
    image?.height ?? 0,
    flags.isDataArrayTexture || flags.isData3DTexture ? (image?.depth ?? 0) : 1,
    components * scalar,
    flags.isData3DTexture === true,
  );
}
