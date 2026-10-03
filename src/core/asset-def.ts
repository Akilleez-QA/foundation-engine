// core/asset-def.ts: the asset definition TYPES (ADR 0023; STD-REN-30). Types only.
//
// They live in core, beside the tier types they use, because asset packs are data and may import types only from core
// and domain (STD-LAY-1; the `content-is-data` layer rule). `platform/assets/manifest.ts` re-exports them and owns the
// validation.

import type { QualityPreset } from './tiers.ts';

export type AssetKind =
  | 'texture'
  | 'model'
  | 'audio'
  | 'music'
  | 'narration'
  | 'json'
  | 'font'
  | 'tileset'
  /** Human-readable files shipped beside assets: attribution, licence and provenance texts, the brand pack. */
  | 'document'
  /** Third-party runtime code served from `public/` (a decoder or transcoder; the engine ships none). */
  | 'code';

export type AssetFormat =
  | 'jpg'
  | 'png'
  | 'webp'
  | 'ktx2'
  | 'glb'
  | 'mp3'
  | 'm4a'
  | 'ogg'
  | 'json'
  | 'md'
  /** Plain text; also a file with no extension (`LICENSE`). */
  | 'txt'
  | 'html'
  | 'zip'
  | 'js'
  | 'wasm';

/**
 * A licence identifier. SPDX ids where one exists; named terms cover licences that have no SPDX id:
 * - `owner-licensed`: the project owner holds a licence to use and distribute the work;
 * - `original`: made for this game by its owner;
 * - `other:<name>`: named third-party terms (a game documents them in the pack's notice).
 * `unknown` is never valid in a def: it exists so a generator report can say so.
 */
export type LicenceId =
  | 'CC0-1.0'
  | 'CC-BY-4.0'
  | 'CC-BY-SA-4.0'
  | 'MIT'
  | 'Apache-2.0'
  | 'BSD-3-Clause'
  | 'public-domain'
  | 'owner-licensed'
  | 'original'
  | `other:${string}`
  | 'unknown';

/** Where an asset came from and what was done to it (feeds the generated third-party notices). */
export interface AssetProvenance {
  readonly author?: string;
  /** Text shown in notices and credits. */
  readonly credit?: string;
  readonly source?: { readonly url: string; readonly page?: string; readonly retrieved?: string };
  /** Edits made after retrieval (crop, re-encode, LOD). */
  readonly changes?: string;
  /** The script that produced the shipped files, if any. */
  readonly generatedBy?: string;
  /** The sha256 of the upstream source file, when it is not itself shipped. */
  readonly sourceSha256?: string;
}

/** One file of an asset at one resolution, format, locale or voice. */
export interface AssetVariant {
  /** Path relative to `public/`, without a leading slash, e.g. `textures/stone/wall-2048.jpg`. */
  readonly path: string;
  readonly format: AssetFormat;
  /** Pixel width (textures) used for variant choice by on-screen size. */
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  /**
   * The best tier this variant may serve. A lossy port variant (ETC1S for `low`) sets `maxTier: 'low'` and is never
   * chosen on a better tier. Omitted means every tier.
   */
  readonly maxTier?: QualityPreset;
  readonly locale?: string;
  readonly voice?: string;
  /** Filled from the generated lock. */
  readonly bytes?: number;
  /** Lower-case hex sha256 of the file; filled from the generated lock. */
  readonly sha256?: string;
}

export interface AssetDef {
  /** `asset.<kind>.<name>`, e.g. `asset.texture.stone-wall`. */
  readonly id: string;
  readonly kind: AssetKind;
  readonly title: string;
  readonly licence: LicenceId;
  readonly provenance: AssetProvenance;
  readonly colorSpace?: 'srgb' | 'linear';
  readonly budget?: { readonly triangles?: number; readonly draws?: number; readonly textureMiB?: number };
  readonly variants: readonly AssetVariant[];
}

/**
 * One `<owner folder>/assets/<id>.assets.ts` file (its default export). A pack whose defs are not all `original` has
 * a `<id>.notice.md` beside it; the game's asset script joins the notices in `noticeOrder` into its third-party
 * notices.
 */
export interface AssetPack {
  /** The file name without `.assets.ts`. */
  readonly id: string;
  readonly title: string;
  /** Position of this pack's notice in THIRD_PARTY_NOTICES.md; required when the pack has a notice. */
  readonly noticeOrder?: number;
  readonly defs: readonly AssetDef[];
}
