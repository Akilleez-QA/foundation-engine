/**
 * author/material.ts: how a surface looks beyond its colour, for a `Shape`, a `Mesh` (defineMesh) or a `Model`. Plain
 * data; the author renderer maps it to a three.js material (`author/scene-materials.ts`, `author/model-looks.ts`).
 * Without a `Material` component a shape or mesh keeps its original matte look and a model its own materials,
 * unchanged.
 *
 *   [Transform(), Shape({ kind: 'box', color: 0xffffff }), defineMaterial({ texture: 'crate', repeat: [2, 2], roughness: .7 })]
 *   [Transform(), Mesh(gem), defineMaterial({ shading: 'flat', emissive: 0xff6a10, emissiveIntensity: 3 })]
 *   [Transform(), Shape({ kind: 'cone' }), defineMaterial({ shading: 'toon', toonSteps: 3 })]
 *
 * Shading picks one of a fixed set of material classes ('standard' physically based, 'matte' Lambert, 'flat'
 * faceted physically based, 'toon' banded), so the number of shader programs a scene can need stays bounded: class x
 * side x cutout x vertex colours x texture x transparency, each two-valued except the class.
 *
 * `texture` names a `defineAsset({ type: 'texture' })` row. The texture is leased from the shared texture library (one
 * decode and one upload per context however many entities use it), tinted by `Shape.color` (white keeps its own
 * colours), and drawn untextured until it arrives or if it fails to load.
 */
import {defineComponent, type ComponentInit} from './defs';

export type MaterialWrap = 'repeat' | 'clamp' | 'mirror';
/** 'standard' physically based (the default), 'matte' Lambert, 'flat' faceted physically based, 'toon' banded. */
export type MaterialShading = 'standard' | 'matte' | 'flat' | 'toon';
/** Which faces draw: the outside only, or both (thin leaves, cloth, open shells). */
export type MaterialSide = 'front' | 'double';
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
  /** How light shades the surface; changing the class ('standard'/'flat', 'matte', 'toon') builds a new material once. */
  shading: MaterialShading;
  /** Light bands of 'toon' shading, 2…5 (ignored by the other shadings). */
  toonSteps: number;
  /** 'double' draws back faces too. */
  side: MaterialSide;
  /** 0 is off; above 0, pixels whose alpha (texture alpha x opacity) is below it are cut out, with no sorting cost. */
  alphaCutoff: number;
  /** Draw the geometry's vertex colours when it has them (a Mesh's `colors`, a model's own); a Shape has none. */
  vertexColors: boolean;
}

/** Validation bounds: data errors, not performance allowances (the scene's budgets still apply). */
export const MATERIAL_LIMITS = {repeat: 1024, emissiveIntensity: 16, textureId: 64, toonSteps: [2, 5]} as const;
export const MATERIAL_SHADINGS: readonly MaterialShading[] = Object.freeze(['standard', 'matte', 'flat', 'toon']);

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
  shading: 'standard',
  toonSteps: 3,
  side: 'front',
  alphaCutoff: 0,
  vertexColors: true,
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
  if (!MATERIAL_SHADINGS.includes(data.shading)) fail('shading must be standard, matte, flat or toon');
  const [fewest, most] = MATERIAL_LIMITS.toonSteps;
  if (!Number.isInteger(data.toonSteps) || data.toonSteps < fewest || data.toonSteps > most)
    fail(`toonSteps must be an integer in [${fewest}, ${most}]`);
  if (data.side !== 'front' && data.side !== 'double') fail('side must be front or double');
  if (!unit(data.alphaCutoff) || data.alphaCutoff === 1) fail('alphaCutoff must be in [0, 1)');
  if (typeof data.vertexColors !== 'boolean') fail('vertexColors must be boolean');
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
  `${m.texture}|${m.repeat}|${m.wrap}|${m.roughness}|${m.metalness}|${m.emissive}|${m.emissiveIntensity}|${m.opacity}|${m.transparent}|${m.shading}|${m.toonSteps}|${m.side}|${m.alphaCutoff}|${m.vertexColors}`;

/** The three.js material class a shading draws with: 'flat' is the standard class with faceted normals. */
export type SurfaceClass = 'lambert' | 'standard' | 'toon';
export const surfaceClassOf = (shading: MaterialShading): SurfaceClass =>
  shading === 'matte' ? 'lambert' : shading === 'toon' ? 'toon' : 'standard';
