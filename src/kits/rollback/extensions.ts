/** Validation of the optional session extensions, and evidence chunking. Pure; no transport, clock or timer. */
import {rollbackChecksum, utf8BytesWithin} from './limits';
import type {
  RollbackDelayPolicy,
  RollbackDeparturePolicy,
  RollbackEvidence,
  RollbackEvidenceChunk,
  RollbackEvidencePolicy,
  RollbackLimits,
  RollbackOptions,
  RollbackStart,
} from './types';

const int = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

/** Accepted ranges of the optional extensions. Engine safety ceilings, not recommended game values. */
export const ROLLBACK_EXTENSION_RANGES = Object.freeze({
  delay: Object.freeze({delay: [0, 30], maxStep: [1, 30], minSpacing: [2, 3600]}),
  retainInputFrames: [0, 3600],
  startFrame: [0, 2 ** 31 - 1],
  evidence: Object.freeze({frames: [1, 64], maxBytes: [64, 1 << 20], chunkBytes: [64, 65536]}),
} as const);

export interface CapturedExtensions {
  readonly delay: RollbackDelayPolicy | null;
  readonly departure: RollbackDeparturePolicy | null;
  readonly retainInputFrames: number;
  readonly start: RollbackStart | null;
  readonly evidence: RollbackEvidencePolicy | null;
  /** Appended to `read().config` only for the extensions that change shared semantics. */
  readonly configSuffix: string;
}

/** Copy, validate and freeze the optional extensions of a session. Throws on any invalid value. */
export function captureExtensions(options: RollbackOptions, limits: RollbackLimits): CapturedExtensions {
  let suffix = '';
  let delay: RollbackDelayPolicy | null = null;
  if (options.adaptiveDelay !== undefined) {
    const d = options.adaptiveDelay as unknown;
    if (!object(d)) throw Error('rollback: invalid adaptive delay');
    const {minDelay, maxDelay, maxStep, minSpacing, authority} = d;
    if (
      !int(minDelay, 0, 30) ||
      !int(maxDelay, minDelay, 30) ||
      limits.inputDelay < minDelay ||
      limits.inputDelay > maxDelay ||
      !int(maxStep, 1, 30) ||
      !int(minSpacing, maxStep + 1, 3600) ||
      !int(authority, 0, limits.players - 1)
    )
      throw Error('rollback: invalid adaptive delay');
    delay = Object.freeze({minDelay, maxDelay, maxStep, minSpacing, authority});
    suffix += `:delay=${minDelay},${maxDelay},${maxStep},${minSpacing},${authority}`;
  }
  let departure: RollbackDeparturePolicy | null = null;
  if (options.departure !== undefined) {
    const d = options.departure as unknown;
    if (!object(d) || (d.input !== 'neutral' && d.input !== 'repeat')) throw Error('rollback: invalid departure');
    const quorum = d.quorum ?? Math.floor(limits.players / 2) + 1;
    if (!int(quorum, 1, limits.players)) throw Error('rollback: invalid departure');
    departure = Object.freeze({input: d.input, quorum});
    suffix += `:departure=${d.input},${quorum}`;
  }
  const retain = options.retainInputFrames ?? 0;
  if (!int(retain, 0, 3600)) throw Error('rollback: invalid retainInputFrames');
  let start: RollbackStart | null = null;
  if (options.start !== undefined) {
    const s = options.start as unknown;
    if (!object(s) || !int(s.frame, 0, 2 ** 31 - 1) || typeof s.state !== 'string')
      throw Error('rollback: invalid start');
    if (utf8BytesWithin(s.state, limits.maxStateBytes) === Infinity)
      throw Error('rollback: invalid start (state-bytes)');
    if (s.checksum !== rollbackChecksum(s.state)) throw Error('rollback: start checksum mismatch');
    start = Object.freeze({frame: s.frame, state: s.state, checksum: s.checksum});
    suffix += `:start=${s.frame},${s.checksum}`;
  }
  let evidence: RollbackEvidencePolicy | null = null;
  if (options.evidence !== undefined) {
    const e = options.evidence as unknown;
    if (
      !object(e) ||
      !int(e.frames, 1, 64) ||
      !int(e.maxBytes, 64, 1 << 20) ||
      !int(e.chunkBytes, 64, 65536) ||
      (e.describe !== undefined && typeof e.describe !== 'function')
    )
      throw Error('rollback: invalid evidence');
    const describe = e.describe as RollbackEvidencePolicy['describe'];
    const base = {frames: e.frames, maxBytes: e.maxBytes, chunkBytes: e.chunkBytes};
    evidence = Object.freeze(describe ? {...base, describe} : base);
  }
  return Object.freeze({delay, departure, retainInputFrames: retain, start, evidence, configSuffix: suffix});
}

/** The longest prefix of `text` within `limit` UTF-8 bytes that does not split a surrogate pair. */
function prefixWithin(text: string, limit: number): string {
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (utf8BytesWithin(text.slice(0, mid), limit) === Infinity) hi = mid - 1;
    else lo = mid;
  }
  const code = text.charCodeAt(lo - 1);
  if (lo > 0 && code >= 0xd800 && code <= 0xdbff) lo--;
  return text.slice(0, lo);
}

/** Describe a retained state, cap it to `maxBytes` and cut it into chunks of at most `chunkBytes`. Never throws. */
export function chunkEvidence(
  policy: RollbackEvidencePolicy,
  frame: number,
  checksum: number,
  state: string,
): RollbackEvidence {
  let text: unknown = state;
  if (policy.describe) {
    try {
      text = policy.describe(state, frame);
    } catch {
      text = undefined;
    }
  }
  if (typeof text !== 'string')
    return Object.freeze({status: 'unavailable' as const, frame, reason: 'describe-failed' as const});
  const truncated = utf8BytesWithin(text, policy.maxBytes) === Infinity;
  let rest = truncated ? prefixWithin(text, policy.maxBytes) : text;
  const pieces: string[] = [];
  while (rest.length > 0) {
    const piece = prefixWithin(rest, policy.chunkBytes);
    pieces.push(piece);
    rest = rest.slice(piece.length);
  }
  if (pieces.length === 0) pieces.push('');
  const chunks: RollbackEvidenceChunk[] = pieces.map((piece, index) =>
    Object.freeze({frame, checksum, index, count: pieces.length, truncated, text: piece}),
  );
  return Object.freeze({status: 'ready' as const, frame, checksum, truncated, chunks: Object.freeze(chunks)});
}
