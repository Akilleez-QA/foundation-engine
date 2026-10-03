import {hashSeed} from '../../core/rng';
import type {RollbackLimits} from './types';

/** Accepted range for each limit. These are engine safety ceilings, not recommended game values. */
export const ROLLBACK_LIMIT_RANGES: Readonly<Record<keyof RollbackLimits, readonly [number, number]>> = Object.freeze({
  players: [2, 8],
  maxPredictionFrames: [0, 60],
  inputDelay: [0, 30],
  maxInputBytes: [1, 4096],
  maxStateBytes: [1, 16 * 1024 * 1024],
  checksumInterval: [1, 3600],
  maxChecksumHistory: [1, 4096],
  maxPendingChecksums: [1, 4096],
});
const KEYS = Object.keys(ROLLBACK_LIMIT_RANGES) as (keyof RollbackLimits)[];

/** Copy and freeze exactly the known limits; unknown, missing, fractional or out-of-range values throw. */
export function captureRollbackLimits(input: RollbackLimits): RollbackLimits {
  if (input === null || typeof input !== 'object') throw Error('rollback: invalid limits');
  const supplied = Object.keys(input);
  if (supplied.length !== KEYS.length || supplied.some(key => !(key in ROLLBACK_LIMIT_RANGES)))
    throw Error('rollback: invalid limits');
  const out = {} as Record<keyof RollbackLimits, number>;
  for (const key of KEYS) {
    const value = input[key],
      [min, max] = ROLLBACK_LIMIT_RANGES[key];
    if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`rollback: invalid limits (${key})`);
    out[key] = value;
  }
  return Object.freeze(out);
}

/** The exact UTF-8 length of `text` (lone surrogates count as U+FFFD), or Infinity once it exceeds `limit`. */
export function utf8BytesWithin(text: string, limit: number): number {
  if (text.length > limit) return Infinity;
  let size = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) size += 1;
    else if (unit < 0x800) size += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size += 4;
        i++;
      } else size += 3;
    } else size += 3;
    if (size > limit) return Infinity;
  }
  return size;
}

/**
 * The 32-bit desync checksum of a saved state text: the engine's FNV-1a (`hashSeed`) over UTF-16 code units.
 * It detects divergence; it is not a cryptographic digest and a collision can hide one (about 1 in 2^32 per pair).
 */
export const rollbackChecksum = (state: string): number => hashSeed(state);
