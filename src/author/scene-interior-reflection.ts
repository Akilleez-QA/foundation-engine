/**
 * author/scene-interior-reflection.ts: the three.js side of an interior reflection (lazy chunk). One half-float equirectangular
 * `DataTexture` built once from the interior's data; the renderer prefilters it (PMREM) once when a material first needs
 * it and frees that result when the texture is disposed. No render target, no per-frame work.
 */
import * as T from 'three';
import type {Lease} from '../platform/assets/lease-cache';
import {interiorReflectionKey, interiorReflectionPixels, type InteriorReflection} from './interior-reflection';

export function leaseInteriorReflection(interior: InteriorReflection): Lease<T.Texture> {
  const {width, height, data} = interiorReflectionPixels(interior);
  const halves = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) halves[i] = T.DataUtils.toHalfFloat(data[i]!);
  const texture = new T.DataTexture(halves, width, height, T.RGBAFormat, T.HalfFloatType);
  texture.mapping = T.EquirectangularReflectionMapping;
  texture.colorSpace = T.LinearSRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.name = 'interior-reflection';
  texture.needsUpdate = true;
  let released = false;
  return {
    value: texture,
    key: interiorReflectionKey(interior),
    release() {
      if (released) return;
      released = true;
      texture.dispose();
    },
  };
}
