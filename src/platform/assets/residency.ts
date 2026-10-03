/**
 * platform/assets/residency.ts: the creator's optional asset residency policy (RES-01; docs/guides/asset-residency.md).
 *
 * Pure: no three.js, no DOM. A game sets `defineGame({ residency })`; the texture and model modules resolve the row for
 * the current quality preset and apply it to their library's existing `LeaseCache` (`setResidency`). This file holds
 * the shape, its validation and the per-preset resolution, so the boot chunk carries only these few lines.
 */
import type {PortPreset, Ported, QualityPreset} from '../../core/tiers';
import type {LeaseResidency, ResidencyPressure} from './lease-cache';

/** Estimated bytes, per library. Omitted fields: no ceiling (`residentBytes`), nothing kept unpinned (`warmBytes`). */
export interface AssetResidencyBudget {
  /** Ceiling on live, pinned and retained bytes; unpinned retained assets are evicted least recently used first. */
  residentBytes?: number;
  /** Unpinned released bytes kept for a quick return. Default 0. */
  warmBytes?: number;
}

export type AssetResidencyKind = 'textures' | 'models';

export interface AssetResidencyPressure extends ResidencyPressure {
  readonly kind: AssetResidencyKind;
  readonly preset: QualityPreset;
}

export interface AssetResidencyInput {
  /** Flat values are the reference preset; `ports` override them for lighter presets. */
  textures?: Ported<AssetResidencyBudget>;
  models?: Ported<AssetResidencyBudget>;
  /** Registered asset ids kept after their last lease and never evicted for a budget. */
  pinned?: readonly string[];
  /** Called once each time live and pinned assets alone exceed a library's `residentBytes`. Must not throw. */
  onPressure?(report: AssetResidencyPressure): void;
}

/** What a library applies: its warm budget plus the cache policy. */
export interface AssetResidencyPolicy extends LeaseResidency {
  readonly warmBytes: number;
}

const KINDS: readonly AssetResidencyKind[] = ['textures', 'models'];
const PORTS: readonly PortPreset[] = ['high', 'medium', 'low'];

function checkBudget(where: string, b: unknown): void {
  if (b === null || typeof b !== 'object') throw Error(`residency: ${where} must be an object`);
  for (const [k, v] of Object.entries(b)) {
    if (k === 'ports' && !where.includes('.ports.')) continue;
    if (k !== 'residentBytes' && k !== 'warmBytes') throw Error(`residency: ${where}.${k} is not a budget field`);
    if (!Number.isSafeInteger(v) || (v as number) < 0)
      throw Error(`residency: ${where}.${k} must be a nonnegative safe integer of bytes`);
  }
}

/** Throws a readable error for an invalid policy; returns it unchanged otherwise. */
export function validateResidency(input: AssetResidencyInput): AssetResidencyInput {
  if (input === null || typeof input !== 'object') throw Error('residency: expected an object');
  for (const k of Object.keys(input)) {
    if (!['textures', 'models', 'pinned', 'onPressure'].includes(k)) throw Error(`residency: unknown field ${k}`);
  }
  for (const kind of KINDS) {
    const row = input[kind];
    if (row === undefined) continue;
    checkBudget(kind, row);
    if (row.ports === undefined) continue;
    if (row.ports === null || typeof row.ports !== 'object') throw Error(`residency: ${kind}.ports must be an object`);
    for (const [preset, port] of Object.entries(row.ports)) {
      if (!(PORTS as readonly string[]).includes(preset))
        throw Error(`residency: ${kind}.ports.${preset} is not a lighter preset`);
      checkBudget(`${kind}.ports.${preset}`, port);
    }
  }
  if (input.pinned !== undefined) {
    if (!Array.isArray(input.pinned) || input.pinned.some(id => typeof id !== 'string' || !id || id.includes('|'))) {
      throw Error('residency: pinned must be a list of asset ids');
    }
    if (new Set(input.pinned).size !== input.pinned.length) throw Error('residency: an asset id is pinned twice');
  }
  if (input.onPressure !== undefined && typeof input.onPressure !== 'function')
    throw Error('residency: onPressure must be a function');
  return input;
}

/** The budget row for `preset`: reference values with the preset's port applied. */
export function residencyBudget(
  input: AssetResidencyInput,
  kind: AssetResidencyKind,
  preset: QualityPreset,
): AssetResidencyBudget {
  const row = input[kind];
  if (!row) return {};
  const {ports, ...reference} = row;
  return preset === 'reference' ? reference : {...reference, ...ports?.[preset]};
}

/** Cache keys start with the asset id (`id|variant…`), so a pin covers every variant of that asset. */
export const assetIdOfKey = (key: string): string => {
  const bar = key.indexOf('|');
  return bar < 0 ? key : key.slice(0, bar);
};

export interface ResidencyBinding {
  readonly kind: AssetResidencyKind;
  readonly input: AssetResidencyInput;
  /** The current preset's source; omitted (no quality service): the reference row. */
  quality?: {readonly preset: QualityPreset; subscribe(fn: () => void, signal?: AbortSignal): () => void};
  signal: AbortSignal;
  log: {warn(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void};
  /** Applies the resolved policy to the library (now, and after each preset change). */
  apply(policy: AssetResidencyPolicy): void;
}

/** Applies the creator's row for the current preset now and on every preset change until `signal` aborts. */
export function bindResidency(b: ResidencyBinding): void {
  const pins = new Set(b.input.pinned ?? []);
  let applied: QualityPreset | undefined;
  const update = () => {
    const preset = b.quality?.preset ?? 'reference';
    if (preset === applied || b.signal.aborted) return;
    applied = preset;
    const budget = residencyBudget(b.input, b.kind, preset);
    b.apply({
      warmBytes: budget.warmBytes ?? 0,
      residentBytes: budget.residentBytes,
      pinned: pins.size ? key => pins.has(assetIdOfKey(key)) : undefined,
      onPressure: report => {
        const full: AssetResidencyPressure = {...report, kind: b.kind, preset};
        b.log.warn(`residency: ${b.kind} over budget with every remaining asset in use or pinned`, full);
        try {
          b.input.onPressure?.(full);
        } catch (error) {
          b.log.error('residency: onPressure failed', error);
        }
      },
      onCleanupError: error => b.log.error(`residency: ${b.kind} eviction cleanup failed`, error),
    });
  };
  update();
  b.quality?.subscribe(update, b.signal);
}
