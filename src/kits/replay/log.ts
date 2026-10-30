/**
 * kits/replay/log.ts: the tick-input replay log (STD-SIM-17: replays record the seed and tick inputs, not frame
 * samples). A recorder captures one canonical JSON input per fixed tick into a bounded, run-length encoded segment;
 * `encodeReplay` produces local text with a checksum; `openReplay` refuses unsupported versions, corrupted text and
 * logs whose build or configuration string differs, and returns a player addressed by tick.
 *
 * The log is a prefix: overflow stops recording and marks the log truncated at that tick (never a silent pass). It is
 * not a ring, because inputs without an initial state checkpoint cannot be replayed from the middle.
 */
import type {DocumentValue} from '../authoring/document';
import {captureJson, captureJsonLimits, type JsonLimits} from '../network/captured-json';
import {checkDigestSnapshot, identityOk, type DigestSnapshot} from './digest';
import {hashText} from './hash';

export const REPLAY_FORMAT = 'foundation.replay';
export const REPLAY_VERSION = 1;
/** Bytes charged for each run besides its input (count, brackets, separators). */
export const RUN_OVERHEAD_BYTES = 24;

export interface ReplayHeader {
  /** Caller-chosen build string, compared exactly (the scene helpers use `<game id>@<version>`, so changed code with an
   *  unchanged version is not detected). A log with a different string is refused. */
  readonly build: string;
  /** Caller-chosen configuration string, compared exactly (the scene helpers use the scene id and input signature; add a
   *  rules revision yourself if you need one). A log with a different string is refused. */
  readonly config: string;
  /** The run's random seed (an unsigned 32-bit integer; the `?seed=` value). */
  readonly seed: number;
  /** Seconds per fixed tick. Part of the simulation's definition (STD-SIM-10). */
  readonly step: number;
}
export interface ReplayLimits {
  /** Most ticks one log may hold. */
  readonly maxTicks: number;
  /** Most retained input bytes: each run's canonical input plus RUN_OVERHEAD_BYTES. */
  readonly maxBytes: number;
  /** Bounds of one tick's input JSON. */
  readonly input: JsonLimits;
}
export type RecordResult =
  | Readonly<{status: 'recorded'}>
  /** Full: nothing was stored, the log stays a replayable prefix ending before `truncatedAt`. */
  | Readonly<{status: 'truncated'; truncatedAt: number}>
  | Readonly<{status: 'failed'; reason: string}>;
export interface RecorderState {
  readonly status: 'recording' | 'truncated' | 'failed';
  readonly reason: string | null;
  readonly ticks: number;
  readonly runs: number;
  readonly bytes: number;
  readonly truncatedAt: number | null;
}
export interface ReplayRecorder {
  /** Record tick `tick`'s input. Ticks start at 0 and must be contiguous. */
  record(tick: number, inputJson: string): RecordResult;
  read(): RecorderState;
  /** The log text so far, with an optional digest trace. Local data: nothing is stored or sent. */
  export(digests?: DigestSnapshot | null): string;
}

const counter = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const utf8 = (s: string) => new TextEncoder().encode(s).length;

export function captureHeader(h: ReplayHeader): ReplayHeader {
  if (!h || !identityOk(h.build) || !identityOk(h.config))
    throw Error('replay: build and config must be non-empty strings of at most 512 characters');
  if (!Number.isSafeInteger(h.seed) || h.seed < 0 || h.seed > 0xffffffff)
    throw Error('replay: seed must be an unsigned 32-bit integer');
  if (typeof h.step !== 'number' || !Number.isFinite(h.step) || !(h.step > 0))
    throw Error('replay: step must be finite and positive');
  return Object.freeze({build: h.build, config: h.config, seed: h.seed, step: h.step});
}
export function captureReplayLimits(l: ReplayLimits): ReplayLimits {
  if (!l || !positive(l.maxTicks) || !positive(l.maxBytes))
    throw Error('replay: maxTicks and maxBytes must be positive safe integers');
  return Object.freeze({maxTicks: l.maxTicks, maxBytes: l.maxBytes, input: captureJsonLimits(l.input)});
}

type Run = [count: number, json: string];

export function createReplayRecorder(o: {header: ReplayHeader; limits: ReplayLimits}): ReplayRecorder {
  const header = captureHeader(o.header),
    limits = captureReplayLimits(o.limits);
  const runs: Run[] = [];
  let ticks = 0,
    bytes = 0,
    truncatedAt: number | null = null;
  let status: RecorderState['status'] = 'recording',
    reason: string | null = null;
  const fail = (why: string): RecordResult => {
    status = 'failed';
    reason = why;
    return Object.freeze({status: 'failed', reason: why});
  };
  const truncate = (): RecordResult => {
    if (status === 'recording') {
      status = 'truncated';
      truncatedAt = ticks;
    }
    return Object.freeze({status: 'truncated', truncatedAt: truncatedAt!});
  };
  return {
    record(tick, inputJson) {
      if (status === 'failed') return Object.freeze({status: 'failed', reason: reason!});
      if (status === 'truncated') return truncate();
      if (tick !== ticks) return fail('tick-order');
      let json: string;
      try {
        json = captureJson(inputJson, limits.input).json;
      } catch {
        return fail('input');
      }
      if (ticks >= limits.maxTicks) return truncate();
      const last = runs[runs.length - 1];
      if (last && last[1] === json) {
        if (last[0] === Number.MAX_SAFE_INTEGER) return truncate();
        last[0]++;
      } else {
        const cost = utf8(json) + RUN_OVERHEAD_BYTES;
        if (bytes + cost > limits.maxBytes) return truncate();
        runs.push([1, json]);
        bytes += cost;
      }
      ticks++;
      return Object.freeze({status: 'recorded'});
    },
    read: () => Object.freeze({status, reason, ticks, runs: runs.length, bytes, truncatedAt}),
    export(digests = null) {
      if (status === 'failed') throw Error(`replay: cannot export a failed recording (${reason})`);
      return encodeReplay({header, ticks, truncatedAt, runs: runs.map(([n, j]) => [n, j] as Run), digests});
    },
  };
}

export interface ReplayLogData {
  readonly header: ReplayHeader;
  readonly ticks: number;
  readonly truncatedAt: number | null;
  readonly runs: readonly (readonly [count: number, json: string])[];
  readonly digests: DigestSnapshot | null;
}

const body = (d: ReplayLogData) => ({
  format: REPLAY_FORMAT,
  version: REPLAY_VERSION,
  header: d.header,
  ticks: d.ticks,
  truncatedAt: d.truncatedAt,
  runs: d.runs,
  digests: d.digests,
});
/** Canonical v1 (sorted keys) of the log body; the checksum covers exactly this text. */
const canonicalBody = (d: ReplayLogData) => {
  const text = JSON.stringify(body(d));
  return captureJson(text, {maxBytes: Math.max(1, utf8(text)), maxNodes: Number.MAX_SAFE_INTEGER, maxDepth: 16}).json;
};

/** Encode a log as local JSON text with a checksum over its canonical body. */
export function encodeReplay(d: ReplayLogData): string {
  const canonical = canonicalBody(d);
  return `{"checksum":${JSON.stringify(hashText(canonical))},${canonical.slice(1)}`;
}

export interface OpenLimits extends ReplayLimits {
  /** Bounds of the whole log text, checked before parsing. */
  readonly log: JsonLimits;
  /** Bounds of an embedded digest trace. */
  readonly digests?: Readonly<{maxEntries: number; maxDigestLength: number}>;
}
export interface ReplayExpectation {
  readonly build: string;
  readonly config: string;
  readonly step: number;
  /** When given, the log's seed must equal it (e.g. the page's `?seed=`). */
  readonly seed?: number | null;
}
export interface ReplayPlayer {
  readonly header: ReplayHeader;
  readonly ticks: number;
  readonly truncatedAt: number | null;
  readonly digests: DigestSnapshot | null;
  /** The frozen input of `tick`, or undefined past the end. Sequential reads are O(1); random reads O(log runs). */
  input(tick: number): DocumentValue | undefined;
  /** The canonical JSON of `tick`'s input, or undefined past the end. */
  json(tick: number): string | undefined;
}
export type OpenResult =
  | Readonly<{status: 'ready'; player: ReplayPlayer}>
  | Readonly<{status: 'unsupported-version'; version: unknown}>
  | Readonly<{status: 'corrupt'; reason: string}>
  | Readonly<{
      status: 'incompatible';
      field: 'build' | 'config' | 'step' | 'seed';
      expected: string | number;
      actual: string | number;
    }>;

/**
 * Decode and check a log, then return a tick-addressed player. Order: byte/structure limits, format, version,
 * checksum, structure, then the expectation. Nothing is partially accepted.
 */
export function openReplay(text: string, limits: OpenLimits, expect: ReplayExpectation): OpenResult {
  const l = captureReplayLimits(limits),
    logLimits = captureJsonLimits(limits.log);
  const corrupt = (why: string): OpenResult => Object.freeze({status: 'corrupt', reason: why});
  let raw: Record<string, unknown>;
  try {
    const value = captureJson(text, logLimits).value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return corrupt('structure');
    raw = value as Record<string, unknown>;
  } catch {
    return corrupt('unreadable-or-over-limit');
  }
  if (raw.format !== REPLAY_FORMAT) return corrupt('format');
  if (raw.version !== REPLAY_VERSION) return Object.freeze({status: 'unsupported-version', version: raw.version});
  if (Object.keys(raw).sort().join() !== 'checksum,digests,format,header,runs,ticks,truncatedAt,version')
    return corrupt('fields');
  let data: ReplayLogData;
  try {
    const keys = (v: unknown) => (v && typeof v === 'object' ? Object.keys(v).sort().join() : '');
    if (keys(raw.header) !== 'build,config,seed,step') return corrupt('header');
    if (
      raw.digests !== null &&
      keys(raw.digests) !== 'detailTruncated,details,dropped,entries,every,firstTick,identity,lastTick,reason,status'
    )
      return corrupt('digests');
    const header = captureHeader(raw.header as ReplayHeader);
    const ticks = raw.ticks,
      truncatedAt = raw.truncatedAt;
    if (!counter(ticks) || ticks > l.maxTicks) return corrupt('ticks');
    if (!(truncatedAt === null || truncatedAt === ticks)) return corrupt('truncatedAt');
    if (!Array.isArray(raw.runs)) return corrupt('runs');
    const runs = (raw.runs as unknown[]).map(r => {
      if (!Array.isArray(r) || r.length !== 2 || !positive(r[0]) || typeof r[1] !== 'string') throw Error('run');
      return [r[0], r[1]] as Run;
    });
    const d = limits.digests;
    const digests =
      raw.digests === null
        ? null
        : checkDigestSnapshot(raw.digests, d?.maxEntries ?? l.maxTicks, d?.maxDigestLength ?? 512);
    data = {header, ticks, truncatedAt: truncatedAt as number | null, runs, digests};
  } catch {
    return corrupt('structure');
  }
  if (raw.checksum !== hashText(canonicalBody(data))) return corrupt('checksum');
  let total = 0,
    bytes = 0,
    previous: string | null = null;
  const values: DocumentValue[] = [],
    starts: number[] = [];
  for (const [count, json] of data.runs) {
    let captured;
    try {
      captured = captureJson(json, l.input);
    } catch {
      return corrupt('input');
    }
    if (captured.json !== json) return corrupt('non-canonical-input');
    if (json === previous) return corrupt('unmerged-run');
    previous = json;
    starts.push(total);
    values.push(captured.value);
    total += count;
    bytes += utf8(json) + RUN_OVERHEAD_BYTES;
    if (!Number.isSafeInteger(total)) return corrupt('ticks');
  }
  if (total !== data.ticks) return corrupt('tick-count');
  if (bytes > l.maxBytes) return corrupt('over-byte-limit');
  const h = data.header;
  const incompatible = (
    field: 'build' | 'config' | 'step' | 'seed',
    expected: string | number,
    actual: string | number,
  ): OpenResult => Object.freeze({status: 'incompatible', field, expected, actual});
  if (h.build !== expect.build) return incompatible('build', expect.build, h.build);
  if (h.config !== expect.config) return incompatible('config', expect.config, h.config);
  if (h.step !== expect.step) return incompatible('step', expect.step, h.step);
  if (expect.seed !== undefined && expect.seed !== null && h.seed !== expect.seed)
    return incompatible('seed', expect.seed, h.seed);
  let cursor = 0;
  // starts, values and data.runs are parallel (one entry per run); a tick below data.ticks means there is at least one
  // run, and cursor, lo, mid and hi stay run indices.
  const runAt = (tick: number): number => {
    if (!counter(tick) || tick >= data.ticks) return -1;
    const fits = (i: number) => tick >= starts[i]! && tick < starts[i]! + data.runs[i]![0];
    if (fits(cursor)) return cursor;
    if (cursor + 1 < starts.length && fits(cursor + 1)) return ++cursor;
    let lo = 0,
      hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= tick) lo = mid;
      else hi = mid - 1;
    }
    return (cursor = lo);
  };
  const player: ReplayPlayer = Object.freeze({
    header: h,
    ticks: data.ticks,
    truncatedAt: data.truncatedAt,
    digests: data.digests,
    input(tick: number) {
      const i = runAt(tick);
      return i < 0 ? undefined : values[i];
    },
    json(tick: number) {
      const i = runAt(tick);
      return i < 0 ? undefined : data.runs[i]![1];
    },
  });
  return Object.freeze({status: 'ready', player});
}
