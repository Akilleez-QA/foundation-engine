/**
 * Coherent multi-key save generations over two alternating slots (ADR 0116).
 *
 * A generation is a complete set of named string payloads. Each commit writes the slot that does NOT hold the newest
 * valid generation, in a fixed order: remove that slot's commit record, write every key (each value prefixed with its
 * generation), then write the commit record last. The commit record lists every key with its length and CRC-32 and is
 * itself checksummed, so a slot is valid only when its record parses and every listed key is present and verifies.
 * Load picks the newest fully valid slot and otherwise the older one; it never returns keys from two generations.
 *
 * One owner object per port and save is the only writer: a commit while another operation is in flight is refused
 * (`busy`), never queued. Runs on any `get`/`set`/`remove` port, synchronous (the save store's `StoragePort`) or
 * asynchronous. Time and randomness are not used.
 */
import {crc32} from '../../core/save/chunk-store';
import {savePrefixes} from '../../core/save/prefixes';

/** The storage seam. `StoragePort` satisfies it as is; an asynchronous adapter may return promises. */
export interface GenerationPort {
  get(key: string): string | null | PromiseLike<string | null>;
  set(key: string, value: string): void | PromiseLike<void>;
  remove(key: string): void | PromiseLike<void>;
  /** Optional: lets load tell a torn slot from an absent one and lets commits sweep leftover keys. */
  keys?: (() => readonly string[] | PromiseLike<readonly string[]>) | undefined;
}

export type GenerationSlot = 'a' | 'b';
/**
 * `verified`: the record and every key check out. `unchecked`: the record parses but its keys were not read (an older
 * slot behind a verified newer one). `absent`: no record and no keys. `torn`: no record but keys left behind (an
 * interrupted commit; only detectable with `keys`). `invalid`: a record that fails its checks, or keys that do not.
 */
export type SlotState = 'verified' | 'unchecked' | 'absent' | 'torn' | 'invalid';
export interface SlotReport {
  readonly slot: GenerationSlot;
  readonly state: SlotState;
  /** The generation the record claims, when it parses. */
  readonly generation: number | null;
  readonly reason: string | null;
}
export interface GenerationSnapshot {
  readonly generation: number;
  readonly slot: GenerationSlot;
  /** Frozen, keys in ascending order. */
  readonly entries: Readonly<Record<string, string>>;
}
/**
 * `loaded`: newest valid generation, other slot older or absent. `recovered`: a valid generation, but the other slot is
 * torn or invalid (an interrupted commit or damage); only one generation is held until the next commit. `empty`: no
 * commit record in either slot (no save was ever committed, or both records were removed). `corrupt`: no valid slot and
 * at least one damaged one. `unavailable`: the port threw. `contended`: the chosen slot kept changing during the read
 * (another writer) for every attempt. `busy`: a commit of this owner is in flight. `closed`: owner closed.
 */
export type LoadStatus = 'loaded' | 'recovered' | 'empty' | 'corrupt' | 'unavailable' | 'contended' | 'busy' | 'closed';
export interface LoadResult {
  readonly status: LoadStatus;
  readonly snapshot: GenerationSnapshot | null;
  readonly slots: readonly SlotReport[];
  readonly reason: string | null;
}
/**
 * `committed`: the new generation is authoritative. Every other status leaves the previous authoritative generation
 * on disk unchanged: `busy` (another operation of this owner in flight), `not-loaded` (call `load` first),
 * `conflict` (the disk no longer holds the generation this owner last saw: another writer), `too-large` (a bound was
 * exceeded; nothing written), `exhausted` (the generation counter reached its ceiling), `cancelled` (the signal was
 * aborted before the commit record was written), `failed` (a write threw: quota, blocked storage), `unavailable`
 * (reading the current state threw), `closed`.
 */
export type CommitStatus =
  | 'committed'
  | 'busy'
  | 'not-loaded'
  | 'conflict'
  | 'too-large'
  | 'exhausted'
  | 'cancelled'
  | 'failed'
  | 'unavailable'
  | 'closed';
export interface CommitResult {
  readonly status: CommitStatus;
  /** The authoritative generation after this call, as far as this owner knows. */
  readonly snapshot: GenerationSnapshot | null;
  /** Port writes and removals issued by this call. */
  readonly writes: number;
  /** Stale keys of the overwritten slot that could not be removed after the commit (harmless; swept later). */
  readonly leftovers: number;
  readonly reason: string | null;
}
export interface GenerationLimits {
  /** Keys per generation (default 16, 1-256). */
  readonly maxKeys?: number;
  /** Characters per payload (default 262,144, at most 2,000,000). */
  readonly maxKeyChars?: number;
  /** Characters of all payloads of one generation (default 1,048,576, at most 4,000,000). Two slots hold twice this. */
  readonly maxTotalChars?: number;
  /** Read passes before load reports `contended` (default 3, 1-8). */
  readonly maxLoadAttempts?: number;
}
export interface SaveGenerationsOptions extends GenerationLimits {
  readonly port: GenerationPort;
  /** The save store namespace: keys sit under `<namespace>-gen|`, inside the store's reset prefixes (default 'game'). */
  readonly namespace?: string;
  /** This save's name, lower kebab-case, at most 32 characters. */
  readonly name: string;
}
export interface CommitOptions {
  /** Checked before every write; an `AbortSignal` works. */
  readonly signal?: {readonly aborted: boolean} | undefined;
}
export interface SaveGenerations {
  /** Scans both slots and adopts the newest fully valid generation. Required once before the first commit. */
  load(): Promise<LoadResult>;
  /** Writes a complete new generation (every key; keys left out are not part of it). */
  commit(entries: Readonly<Record<string, string>>, options?: CommitOptions): Promise<CommitResult>;
  /** The generation this owner last loaded or committed: one coherent snapshot, never a mix. */
  current(): GenerationSnapshot | null;
  busy(): boolean;
  /** Releases the writer claim. Idempotent; an in-flight commit stops before its next write. */
  close(): void;
  readonly limits: Readonly<Required<GenerationLimits>>;
  /** The key prefix of this save, for diagnostics. */
  readonly prefix: string;
}

export const GENERATION_CEILING = Number.MAX_SAFE_INTEGER;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const KEY = /^[a-z0-9][a-z0-9._-]{0,47}$/;
const SLOTS: readonly GenerationSlot[] = ['a', 'b'];
const encoder = new TextEncoder();
const checksum = (s: string) => crc32(encoder.encode(s));
const hex = (n: number) => n.toString(16).padStart(8, '0');

function fail(message: string): never {
  throw new RangeError(`save generations: ${message}`);
}
function bounded(value: number | undefined, fallback: number, min: number, max: number, what: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${what} must be an integer in [${min}, ${max}]`);
  return n;
}
const errorText = (e: unknown) => String((e as Error)?.message ?? e);

/** Writers claimed per port object: a second owner of one save over one port is a contract break. */
const claims = new WeakMap<object, Set<string>>();

interface Manifest {
  readonly generation: number;
  readonly keys: readonly (readonly [string, number, number])[];
}
interface SlotRead {
  readonly slot: GenerationSlot;
  readonly raw: string | null;
  readonly manifest: Manifest | null;
  report: SlotReport;
}
interface Known {
  readonly snapshot: GenerationSnapshot;
  readonly record: string;
}

export function createSaveGenerations(options: SaveGenerationsOptions): SaveGenerations {
  const port = options.port,
    name = options.name,
    namespace = options.namespace ?? 'game';
  if (!port || typeof port.get !== 'function' || typeof port.set !== 'function' || typeof port.remove !== 'function')
    fail('port must have get, set and remove');
  if (typeof name !== 'string' || !NAME.test(name)) fail('name must be lower kebab-case, at most 32 characters');
  try {
    savePrefixes(namespace);
  } catch (e) {
    fail(errorText(e));
  }
  const maxKeys = bounded(options.maxKeys, 16, 1, 256, 'maxKeys'),
    maxKeyChars = bounded(options.maxKeyChars, 262_144, 1, 2_000_000, 'maxKeyChars'),
    maxTotalChars = bounded(options.maxTotalChars, 1_048_576, 1, 4_000_000, 'maxTotalChars'),
    maxLoadAttempts = bounded(options.maxLoadAttempts, 3, 1, 8, 'maxLoadAttempts');
  const prefix = `${namespace}-gen|${name}|`;
  const slotPrefix = (s: GenerationSlot) => `${prefix}${s}|`;
  const recordKey = (s: GenerationSlot) => `${prefix}${s}#commit`;
  const dataKey = (s: GenerationSlot, key: string) => slotPrefix(s) + key;
  let claimed = claims.get(port);
  if (!claimed) claims.set(port, (claimed = new Set()));
  if (claimed.has(prefix)) fail(`save '${name}' in namespace '${namespace}' already has a writer on this port`);
  claimed.add(prefix);

  let closed = false,
    inFlight = false,
    known: Known | null = null,
    loaded = false;

  const report = (slot: GenerationSlot, state: SlotState, generation: number | null, reason: string | null) =>
    Object.freeze({slot, state, generation, reason});

  /** Parses `<crc>|<json>` and checks every field against this save, this slot and the limits. */
  function parseRecord(slot: GenerationSlot, raw: string): Manifest | string {
    const bar = raw.indexOf('|');
    if (bar !== 8) return 'record has no checksum';
    const body = raw.slice(9);
    if (raw.slice(0, 8) !== hex(checksum(body))) return 'record checksum mismatch';
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return 'record does not parse';
    }
    const r = json as {f?: unknown; n?: unknown; s?: unknown; g?: unknown; k?: unknown};
    if (r === null || typeof r !== 'object' || r.f !== 1) return 'record format unknown';
    if (r.n !== name || r.s !== slot) return 'record belongs to another save or slot';
    const g = r.g;
    if (typeof g !== 'number' || !Number.isSafeInteger(g) || g < 1) return 'record generation invalid';
    if (!Array.isArray(r.k) || r.k.length > maxKeys) return 'record key list invalid';
    const keys: (readonly [string, number, number])[] = [];
    let total = 0,
      previous = '';
    for (const entry of r.k as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 3) return 'record key entry invalid';
      const [k, len, crc] = entry as unknown[];
      if (typeof k !== 'string' || !KEY.test(k) || k <= previous) return 'record key names invalid';
      if (typeof len !== 'number' || !Number.isSafeInteger(len) || len < 0) return 'record key length invalid';
      if (typeof crc !== 'number' || !Number.isSafeInteger(crc) || crc < 0 || crc > 0xffffffff)
        return 'record key checksum invalid';
      const payload = len - String(g).length - 1;
      if (payload < 0 || payload > maxKeyChars) return 'record key length out of bounds';
      total += payload;
      previous = k;
      keys.push(Object.freeze([k, len, crc] as const));
    }
    if (total > maxTotalChars) return 'record total out of bounds';
    return {generation: g, keys};
  }

  async function residue(slot: GenerationSlot): Promise<string[] | null> {
    if (!port.keys) return null;
    const p = slotPrefix(slot);
    return [...(await port.keys())].filter(k => k.startsWith(p));
  }

  async function readSlot(slot: GenerationSlot): Promise<SlotRead> {
    const raw = await port.get(recordKey(slot));
    if (raw === null) {
      const left = await residue(slot);
      return {slot, raw, manifest: null, report: report(slot, left?.length ? 'torn' : 'absent', null, null)};
    }
    const parsed = parseRecord(slot, raw);
    if (typeof parsed === 'string') return {slot, raw, manifest: null, report: report(slot, 'invalid', null, parsed)};
    return {slot, raw, manifest: parsed, report: report(slot, 'unchecked', parsed.generation, null)};
  }

  /** Reads every listed key; returns the frozen entries or why the slot is invalid. */
  async function verify(read: SlotRead): Promise<Readonly<Record<string, string>> | string> {
    const m = read.manifest!,
      head = `${m.generation}|`,
      out: Record<string, string> = {};
    for (const [k, len, crc] of m.keys) {
      const value = await port.get(dataKey(read.slot, k));
      if (value === null) return `key '${k}' missing`;
      if (value.length !== len || !value.startsWith(head)) return `key '${k}' from another generation`;
      if (checksum(value) !== crc) return `key '${k}' checksum mismatch`;
      out[k] = value.slice(head.length);
    }
    return Object.freeze(out);
  }

  interface Scan {
    readonly status: Exclude<LoadStatus, 'busy' | 'closed' | 'unavailable'>;
    readonly chosen: Known | null;
    readonly reads: readonly SlotRead[];
  }

  /** Newest fully valid slot; re-reads the commit records it relied on and retries if they changed meanwhile. */
  async function scan(): Promise<Scan> {
    let reads: SlotRead[] = [];
    for (let attempt = 0; attempt < maxLoadAttempts; attempt++) {
      reads = [await readSlot('a'), await readSlot('b')];
      const candidates = reads
        .filter(r => r.manifest)
        .sort((x, y) => y.manifest!.generation - x.manifest!.generation || (x.slot < y.slot ? -1 : 1));
      let chosen: Known | null = null;
      for (const c of candidates) {
        const result = await verify(c);
        if (typeof result === 'string') {
          c.report = report(c.slot, 'invalid', c.manifest!.generation, result);
          continue;
        }
        c.report = report(c.slot, 'verified', c.manifest!.generation, null);
        chosen = {
          snapshot: Object.freeze({generation: c.manifest!.generation, slot: c.slot, entries: result}),
          record: c.raw!,
        };
        break;
      }
      const pick = chosen?.snapshot.slot;
      const relied = pick ? reads.filter(r => r.slot === pick) : reads;
      let stable = true;
      for (const r of relied) if ((await port.get(recordKey(r.slot))) !== r.raw) stable = false;
      if (!stable) continue;
      if (chosen) {
        const other = reads.find(r => r.slot !== pick)!.report.state;
        return {status: other === 'torn' || other === 'invalid' ? 'recovered' : 'loaded', chosen, reads};
      }
      return {status: reads.some(r => r.report.state === 'invalid') ? 'corrupt' : 'empty', chosen: null, reads};
    }
    return {status: 'contended', chosen: null, reads};
  }

  const slotReports = (reads: readonly SlotRead[]) => Object.freeze(reads.map(r => r.report));
  const loadResult = (
    status: LoadStatus,
    snapshot: GenerationSnapshot | null,
    slots: readonly SlotReport[],
    reason: string | null,
  ): LoadResult => Object.freeze({status, snapshot, slots, reason});
  const commitResult = (status: CommitStatus, writes: number, leftovers: number, reason: string | null): CommitResult =>
    Object.freeze({status, snapshot: known?.snapshot ?? null, writes, leftovers, reason});

  /** Contract checks on the caller's entries; size bounds are reported, not thrown. */
  function entriesOf(entries: Readonly<Record<string, string>>): [string, string][] | string {
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) fail('entries must be an object');
    const list = Object.keys(entries).sort();
    for (const k of list) {
      if (!KEY.test(k)) fail(`key '${k}' must match ${KEY}`);
      if (typeof entries[k] !== 'string') fail(`key '${k}' must hold a string`);
    }
    if (list.length > maxKeys) return `${list.length} keys exceed maxKeys ${maxKeys}`;
    let total = 0;
    for (const k of list) {
      const n = entries[k]!.length;
      if (n > maxKeyChars) return `key '${k}' has ${n} characters, above maxKeyChars ${maxKeyChars}`;
      total += n;
    }
    if (total > maxTotalChars) return `${total} characters exceed maxTotalChars ${maxTotalChars}`;
    return list.map(k => [k, entries[k]!]);
  }

  return {
    limits: Object.freeze({maxKeys, maxKeyChars, maxTotalChars, maxLoadAttempts}),
    prefix,
    current: () => known?.snapshot ?? null,
    busy: () => inFlight,
    close() {
      if (closed) return;
      closed = true;
      claimed.delete(prefix);
    },
    async load() {
      if (closed) return loadResult('closed', null, Object.freeze([]), null);
      if (inFlight) return loadResult('busy', known?.snapshot ?? null, Object.freeze([]), null);
      inFlight = true;
      try {
        const s = await scan();
        if (s.status !== 'contended') {
          known = s.chosen;
          loaded = true;
        }
        return loadResult(s.status, s.chosen?.snapshot ?? null, slotReports(s.reads), null);
      } catch (e) {
        return loadResult('unavailable', null, Object.freeze([]), errorText(e));
      } finally {
        inFlight = false;
      }
    },
    async commit(entries, commitOptions = {}) {
      if (closed) return commitResult('closed', 0, 0, null);
      const list = entriesOf(entries);
      const signal = commitOptions.signal;
      if (inFlight) return commitResult('busy', 0, 0, null);
      if (!loaded) return commitResult('not-loaded', 0, 0, null);
      if (typeof list === 'string') return commitResult('too-large', 0, 0, list);
      inFlight = true;
      let writes = 0;
      try {
        let s: Scan;
        try {
          s = await scan();
        } catch (e) {
          return commitResult('unavailable', 0, 0, errorText(e));
        }
        if (s.status === 'contended') return commitResult('conflict', 0, 0, 'commit records kept changing');
        if ((s.chosen?.record ?? null) !== (known?.record ?? null))
          return commitResult('conflict', 0, 0, 'the newest generation on disk is not the one this owner last saw');
        let highest = 0;
        for (const r of s.reads) if (r.manifest) highest = Math.max(highest, r.manifest.generation);
        if (highest >= GENERATION_CEILING) return commitResult('exhausted', 0, 0, null);
        const generation = highest + 1;
        const target: GenerationSlot = s.chosen
          ? s.chosen.snapshot.slot === 'a'
            ? 'b'
            : 'a'
          : (SLOTS.find(slot => s.reads.find(r => r.slot === slot)!.report.state !== 'invalid') ?? 'a');
        const previousKeys = new Set(s.reads.find(r => r.slot === target)!.manifest?.keys.map(k => k[0]) ?? []);
        const stop = () => closed || !!signal?.aborted;
        if (stop()) return commitResult(closed ? 'closed' : 'cancelled', 0, 0, null);
        const head = `${generation}|`,
          manifest: [string, number, number][] = [],
          out: Record<string, string> = {};
        try {
          // 1. The slot stops being a valid generation before any of its keys change.
          await port.remove(recordKey(target));
          writes++;
          for (const [k, payload] of list) {
            if (stop()) return commitResult(closed ? 'closed' : 'cancelled', writes, 0, 'stopped before the record');
            const value = head + payload;
            await port.set(dataKey(target, k), value);
            writes++;
            manifest.push([k, value.length, checksum(value)]);
            out[k] = payload;
          }
          if (stop()) return commitResult(closed ? 'closed' : 'cancelled', writes, 0, 'stopped before the record');
          // 2. The record goes last: only now is the new generation valid.
          const body = JSON.stringify({f: 1, n: name, s: target, g: generation, k: manifest});
          const record = `${hex(checksum(body))}|${body}`;
          await port.set(recordKey(target), record);
          writes++;
          known = {snapshot: Object.freeze({generation, slot: target, entries: Object.freeze(out)}), record};
        } catch (e) {
          return commitResult('failed', writes, 0, errorText(e));
        }
        // 3. Sweep keys of the overwritten generation that the new one does not list (failures are harmless).
        let leftovers = 0;
        const written = new Set(list.map(([k]) => dataKey(target, k)));
        const stale = new Set([...previousKeys].map(k => dataKey(target, k)).filter(k => !written.has(k)));
        try {
          for (const k of (await residue(target)) ?? []) if (!written.has(k)) stale.add(k);
        } catch {
          /* listing failed: sweep what the old record named */
        }
        for (const k of [...stale].sort()) {
          try {
            await port.remove(k);
            writes++;
          } catch {
            leftovers++;
          }
        }
        return commitResult('committed', writes, leftovers, null);
      } finally {
        inFlight = false;
      }
    },
  };
}
