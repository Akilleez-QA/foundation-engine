/**
 * author/material.ts: how a `Shape` surface looks beyond its colour. Plain data; the author renderer maps it to a
 * three.js physically based material (`author/scene-materials.ts`). Without a `Material` component a shape keeps its
 * original matte look, unchanged.
 *
 *   [Transform(), Shape({ kind: 'box', color: 0xffffff }), defineMaterial({ texture: 'crate', repeat: [2, 2], roughness: .7 })]
 *
 * `texture` names a `defineAsset({ type: 'texture' })` row. The texture is leased from the shared texture library (one
 * decode and one upload per context however many entities use it), tinted by `Shape.color` (white keeps its own
 * colours), and drawn untextured until it arrives or if it fails to load.
 */
import {defineComponent, type ComponentInit} from './defs';

export type MaterialWrap = 'repeat' | 'clamp' | 'mirror';
export interface MaterialData {
  /** A texture asset id; '' draws no texture. */
  texture: string;
  /** How often the texture repeats across each face, [u, v]. */
  repeat: [u: number, v: number];
  /** What lies beyond the texture's edge: tile it, stretch its edge, or tile it mirrored. */
  wrap: MaterialWrap;
  /** 0 is mirror-smooth, 1 fully rough (matte). */
  roughness: number;
  /** 0 is non-metal, 1 metal. */
  metalness: number;
  /** Light the surface gives off itself (24-bit RGB), scaled by `emissiveIntensity`; 0 is none. */
  emissive: number;
  emissiveIntensity: number;
  /** 0…1; below 1 needs `transparent: true` to show. */
  opacity: number;
  /** Blend with what is behind the shape (opacity and the texture's alpha). Costs sorting; use sparingly. */
  transparent: boolean;
}

/** Validation bounds: data errors, not performance allowances (the scene's budgets still apply). */
export const MATERIAL_LIMITS = {repeat: 1024, emissiveIntensity: 16, textureId: 64} as const;

export const MATERIAL_DEFAULTS: Readonly<MaterialData> = Object.freeze({
  texture: '',
  repeat: [1, 1],
  wrap: 'repeat',
  roughness: 1,
  metalness: 0,
  emissive: 0,
  emissiveIntensity: 1,
  opacity: 1,
  transparent: false,
} as MaterialData);

export const Material = defineComponent<MaterialData>('material', {...MATERIAL_DEFAULTS, repeat: [1, 1]});

const unit = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/** Throws on data the renderer would not draw as written. */
export function validateMaterial(data: MaterialData): void {
  const fail = (reason: string): never => {
    throw new Error(`material: ${reason}`);
  };
  if (
    typeof data.texture !== 'string' ||
    data.texture.length > MATERIAL_LIMITS.textureId ||
    (data.texture !== '' && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(data.texture))
  )
    fail("texture must be '' or a kebab-case texture asset id");
  if (
    !Array.isArray(data.repeat) ||
    data.repeat.length !== 2 ||
    data.repeat.some(r => typeof r !== 'number' || !Number.isFinite(r) || r <= 0 || r > MATERIAL_LIMITS.repeat)
  )
    fail(`repeat must be [u, v], each in (0, ${MATERIAL_LIMITS.repeat}]`);
  if (!['repeat', 'clamp', 'mirror'].includes(data.wrap)) fail('wrap must be repeat, clamp or mirror');
  if (!unit(data.roughness)) fail('roughness must be in [0, 1]');
  if (!unit(data.metalness)) fail('metalness must be in [0, 1]');
  if (!Number.isInteger(data.emissive) || data.emissive < 0 || data.emissive > 0xffffff)
    fail('emissive must be a 24-bit RGB integer');
  if (
    typeof data.emissiveIntensity !== 'number' ||
    !Number.isFinite(data.emissiveIntensity) ||
    data.emissiveIntensity < 0 ||
    data.emissiveIntensity > MATERIAL_LIMITS.emissiveIntensity
  )
    fail(`emissiveIntensity must be in [0, ${MATERIAL_LIMITS.emissiveIntensity}]`);
  if (!unit(data.opacity)) fail('opacity must be in [0, 1]');
  if (typeof data.transparent !== 'boolean') fail('transparent must be boolean');
}

/** A checked `Material` initialiser; omitted fields take {@link MATERIAL_DEFAULTS}. */
export function defineMaterial(input: Partial<MaterialData>): ComponentInit<MaterialData> {
  const data: MaterialData = {
    ...MATERIAL_DEFAULTS,
    ...input,
    repeat: [...(input.repeat ?? MATERIAL_DEFAULTS.repeat)] as [number, number],
  };
  validateMaterial(data);
  return Material(data);
}

/** A stable signature of the drawn look; changes when any field does. */
export const materialKey = (m: MaterialData): string =>
  `${m.texture}|${m.repeat}|${m.wrap}|${m.roughness}|${m.metalness}|${m.emissive}|${m.emissiveIntensity}|${m.opacity}|${m.transparent}`;
