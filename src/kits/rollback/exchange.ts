/**
 * Optional message exchange for a rollback session over a lossy, unordered transport. Each message carries every
 * input the destination has not acknowledged (redundant resend), an acknowledgement vector, recent checksums,
 * departure reports, the sender's frame advantage and a round-trip echo. The caller moves the plain-object messages
 * over its own transport and passes its own clock value; there are no timers or sockets.
 */
import type {
  RollbackChecksum,
  RollbackDelayChange,
  RollbackSession,
  RollbackSnapshot,
  RollbackWireInput,
} from './types';

export interface RollbackExchangeLimits {
  /** Inputs per message, [1, 4096]. Oldest unacknowledged first, the local player's before relayed ones. */
  readonly maxInputsPerMessage: number;
  /** Recent confirmed checksums repeated per message, [0, 64]. */
  readonly maxChecksumsPerMessage: number;
  /** Round-trip samples kept per peer, [1, 64]; the reported round trip is the largest kept sample. */
  readonly roundTripSamples: number;
}
export interface RollbackExchangeOptions {
  readonly session: RollbackSession;
  readonly limits: RollbackExchangeLimits;
  /** Pacing threshold in frames, [0, 60] (default 1): `read().pacing.skip` is true above it. */
  readonly pacingThreshold?: number;
  /** Silence, in caller time units, after which `expire` starts a departure, [1, 2^31] (absent: never). */
  readonly timeout?: number;
}
export type RollbackDepartureReport = Readonly<{
  player: number;
  reports: readonly (readonly [number, number])[];
  decided: number | null;
  /** Final departures only: the fixed input after `decided` (spectators that joined later need it). */
  input?: string;
}>;
/** One exchange message. Plain data: serialize it with any codec that round-trips numbers and strings. */
export interface RollbackMessage {
  readonly from: number;
  readonly sentAt: number;
  /** The newest `sentAt` this sender received from the destination, or null. */
  readonly echo: number | null;
  /** How long the sender held `echo` before this message, in its own time units. */
  readonly echoAge: number;
  /** The sender's `frameAdvantage` toward the destination (0 toward a spectator). */
  readonly advantage: number;
  /** The sender's `confirmedInputs`: what it already holds of each player. */
  readonly ack: readonly number[];
  readonly inputs: readonly RollbackWireInput[];
  readonly checksums: readonly RollbackChecksum[];
  readonly departures: readonly RollbackDepartureReport[];
}
export type RollbackReceiveResult =
  | Readonly<{status: 'applied'; accepted: number; duplicates: number; ignored: number; gaps: number}>
  | Readonly<{status: 'rejected'; reason: string}>
  | Readonly<{status: 'ignored'}>
  | Readonly<{status: 'stopped'; reason: string | null}>;
export type RollbackPacing = Readonly<{
  /** Largest halved difference `(mine - theirs) / 2` over peers that reported an advantage; 0 if none. */
  advantage: number;
  /** True when `advantage` exceeds the threshold: skip this tick (call neither `local` nor `advance`). */
  skip: boolean;
}>;
export interface RollbackExchange {
  /** The message for peer `to` now. */
  outgoing(to: number, now: number): RollbackMessage;
  /** The message for a spectator that acknowledged `ack` (every player's inputs it lacks), or `behind`. */
  toSpectator(ack: readonly number[], now: number): RollbackMessage | Readonly<{status: 'behind'; player: number}>;
  /** Apply a message from a peer. Malformed messages are rejected without touching the session. */
  receive(message: RollbackMessage, now: number): RollbackReceiveResult;
  /** Start a departure for every peer silent longer than `timeout`; returns those players. */
  expire(now: number): readonly number[];
  read(): Readonly<{
    roundTrip: readonly (number | null)[];
    remoteAdvantage: readonly (number | null)[];
    pacing: RollbackPacing;
    stats: Readonly<{sent: number; received: number; rejected: number; pruned: number}>;
  }>;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const whole = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const EMPTY: readonly never[] = Object.freeze([]);

export function createRollbackExchange(options: RollbackExchangeOptions): RollbackExchange {
  if (options === null || typeof options !== 'object') throw Error('rollback exchange: invalid options');
  const {session, limits} = options;
  if (session === null || typeof session !== 'object' || typeof session.history !== 'function')
    throw Error('rollback exchange: invalid session');
  if (
    limits === null ||
    typeof limits !== 'object' ||
    !whole(limits.maxInputsPerMessage, 1, 4096) ||
    !whole(limits.maxChecksumsPerMessage, 0, 64) ||
    !whole(limits.roundTripSamples, 1, 64)
  )
    throw Error('rollback exchange: invalid limits');
  const threshold = options.pacingThreshold ?? 1,
    timeout = options.timeout;
  if (!whole(threshold, 0, 60)) throw Error('rollback exchange: invalid pacingThreshold');
  if (timeout !== undefined && !whole(timeout, 1, 2 ** 31)) throw Error('rollback exchange: invalid timeout');
  const first = session.read();
  const players = first.confirmedInputs.length,
    local = first.local;

  // Per-peer arrays have length `players`; every index is a range-checked player. Create the exchange with the
  // session, before any input: until a peer acknowledges, it is assumed to hold nothing past the neutral frames.
  const floor = Math.min(...first.confirmedInputs);
  const peerAck = Array.from({length: players}, () => new Array<number>(players).fill(floor));
  const echoes = new Array<{sentAt: number; at: number} | null>(players).fill(null);
  const samples = Array.from({length: players}, () => [] as number[]);
  const remoteAdvantage = new Array<number | null>(players).fill(null);
  const heard = new Array<number | null>(players).fill(null);
  const stats = {sent: 0, received: 0, rejected: 0, pruned: 0};

  const departing = (snap: RollbackSnapshot) => new Set(snap.departures.map(d => d.player));
  /** Inputs of `player` from `from` (inclusive) appended to `out`, within the message budget. */
  const append = (out: RollbackWireInput[], player: number, from: number, budget: number): number | 'pruned' => {
    if (budget <= 0) return 0;
    const result = session.history(player, from, budget);
    if (result.status === 'pruned') {
      stats.pruned++;
      return 'pruned';
    }
    if (result.status !== 'ok') return 0;
    for (const entry of result.entries) out.push(entry);
    return result.entries.length;
  };
  const checksums = () =>
    limits.maxChecksumsPerMessage > 0 ? session.recentChecksums(limits.maxChecksumsPerMessage) : EMPTY;
  const departures = (snap: RollbackSnapshot, decidedOnly: boolean): readonly RollbackDepartureReport[] =>
    Object.freeze(
      snap.departures
        .filter(d => !decidedOnly || d.final)
        .map(d =>
          Object.freeze(
            d.input === null
              ? {player: d.player, reports: d.reports, decided: d.decided}
              : {player: d.player, reports: d.reports, decided: d.decided, input: d.input},
          ),
        ),
    );

  const exchange: RollbackExchange = {
    outgoing(to, now) {
      if (!whole(to, 0, players - 1) || to === local || !finite(now)) throw Error('rollback exchange: invalid peer');
      const snap = session.read(),
        gone = departing(snap);
      const out: RollbackWireInput[] = [];
      let budget = limits.maxInputsPerMessage;
      const sources = [local, ...[...gone].filter(p => p !== to)];
      for (const s of sources) {
        const n = append(out, s, peerAck[to]![s]! + 1, budget);
        if (typeof n === 'number') budget -= n;
      }
      const echo = echoes[to];
      stats.sent++;
      return Object.freeze({
        from: local,
        sentAt: now,
        echo: echo ? echo.sentAt : null,
        echoAge: echo ? now - echo.at : 0,
        advantage: snap.frameAdvantage[to]!,
        ack: snap.confirmedInputs,
        inputs: Object.freeze(out),
        checksums: checksums(),
        departures: departures(snap, false),
      });
    },

    toSpectator(ack, now) {
      if (!Array.isArray(ack) || ack.length !== players || !ack.every(a => Number.isSafeInteger(a)) || !finite(now))
        throw Error('rollback exchange: invalid spectator ack');
      const snap = session.read();
      const out: RollbackWireInput[] = [];
      let budget = limits.maxInputsPerMessage;
      // Round-robin in small slices so every player's stream advances even under a tight budget.
      const slice = Math.max(1, Math.floor(limits.maxInputsPerMessage / players));
      const next = ack.map(a => a + 1);
      let progress = true;
      while (budget > 0 && progress) {
        progress = false;
        for (let p = 0; p < players && budget > 0; p++) {
          const n = append(out, p, next[p]!, Math.min(slice, budget));
          if (n === 'pruned') return Object.freeze({status: 'behind' as const, player: p});
          if (n > 0) {
            progress = true;
            budget -= n;
            next[p]! += n;
          }
        }
      }
      stats.sent++;
      return Object.freeze({
        from: local,
        sentAt: now,
        echo: null,
        echoAge: 0,
        advantage: 0,
        ack: snap.confirmedInputs,
        inputs: Object.freeze(out),
        checksums: checksums(),
        departures: departures(snap, true),
      });
    },

    receive(message, now) {
      const reject = (reason: string) => {
        stats.rejected++;
        return Object.freeze({status: 'rejected' as const, reason});
      };
      if (!finite(now)) throw Error('rollback exchange: invalid time');
      const shape = validate(message, players, limits.maxInputsPerMessage);
      if (shape) return reject(shape);
      const m = message;
      if (m.from === local) return reject('from');
      const snap = session.read();
      if (snap.status !== 'running') return Object.freeze({status: 'stopped' as const, reason: snap.reason});
      if (departing(snap).has(m.from)) return Object.freeze({status: 'ignored' as const});
      stats.received++;
      heard[m.from] = now;
      const echo = echoes[m.from];
      if (!echo || m.sentAt > echo.sentAt) echoes[m.from] = {sentAt: m.sentAt, at: now};
      if (m.echo !== null) {
        const sample = now - m.echo - m.echoAge;
        if (sample >= 0) {
          const ring = samples[m.from]!;
          ring.push(sample);
          if (ring.length > limits.roundTripSamples) ring.shift();
        }
      }
      remoteAdvantage[m.from] = m.advantage;
      const acks = peerAck[m.from]!;
      for (let p = 0; p < players; p++) if (m.ack[p]! > acks[p]!) acks[p] = m.ack[p]!;
      const stopped = () => {
        const r = session.read();
        return r.status === 'running' ? null : Object.freeze({status: 'stopped' as const, reason: r.reason});
      };
      for (const d of m.departures) {
        const r = session.remoteDeparture(m.from, d.player, d.reports, d.decided);
        if (r.status === 'unsupported') break;
        if (r.status === 'ignored') return Object.freeze({status: 'ignored' as const});
        const halt = stopped();
        if (halt) return halt;
      }
      let accepted = 0,
        duplicates = 0,
        ignored = 0,
        gaps = 0;
      const through = [...session.read().confirmedInputs];
      const blocked = new Set<number>();
      for (const entry of m.inputs) {
        const p = entry.player;
        if (p === local || blocked.has(p)) continue;
        if (entry.frame <= through[p]!) {
          duplicates++;
          continue;
        }
        if (entry.frame !== through[p]! + 1) {
          gaps++;
          blocked.add(p);
          continue;
        }
        const r = session.remote(p, entry.frame, entry.input, entry.delay);
        if (r.status === 'accepted') {
          accepted++;
          through[p] = entry.frame;
        } else if (r.status === 'ignored') {
          ignored++;
          blocked.add(p);
        } else if (r.status === 'duplicate') duplicates++;
        else return Object.freeze({status: 'stopped' as const, reason: 'reason' in r ? r.reason : null});
      }
      for (const c of m.checksums) {
        const r = session.remoteChecksum(m.from, c.frame, c.checksum);
        if (r.status === 'failed' || r.status === 'retired' || r.status === 'busy')
          return Object.freeze({status: 'stopped' as const, reason: r.reason});
        if (r.status === 'desynced') break;
      }
      return Object.freeze({status: 'applied' as const, accepted, duplicates, ignored, gaps});
    },

    expire(now) {
      if (!finite(now)) throw Error('rollback exchange: invalid time');
      if (timeout === undefined) return EMPTY;
      const snap = session.read();
      if (snap.status !== 'running') return EMPTY;
      const gone = departing(snap),
        out: number[] = [];
      for (let p = 0; p < players; p++) {
        if (p === local || gone.has(p)) continue;
        if (heard[p] === null) heard[p] = now;
        else if (now - heard[p]! > timeout) {
          const r = session.disconnect(p);
          if (r.status === 'leaving' || r.status === 'departed') out.push(p);
        }
      }
      return Object.freeze(out);
    },

    read() {
      const snap = session.read(),
        gone = departing(snap);
      let advantage = 0;
      for (let p = 0; p < players; p++) {
        const theirs = remoteAdvantage[p];
        if (p === local || gone.has(p) || theirs === null || theirs === undefined) continue;
        const half = (snap.frameAdvantage[p]! - theirs) / 2;
        if (half > advantage) advantage = half;
      }
      return Object.freeze({
        roundTrip: Object.freeze(samples.map(ring => (ring.length ? Math.max(...ring) : null))),
        remoteAdvantage: Object.freeze([...remoteAdvantage]),
        pacing: Object.freeze({advantage, skip: advantage > threshold}),
        stats: Object.freeze({...stats}),
      });
    },
  };
  return Object.freeze(exchange);
}

/** Structural check of an incoming message; returns a reason, or null when well formed. */
export function validate(m: unknown, players: number, maxInputs: number): string | null {
  if (m === null || typeof m !== 'object') return 'shape';
  const x = m as Record<string, unknown>;
  if (!whole(x.from, 0, players - 1)) return 'from';
  if (!finite(x.sentAt) || !(x.echo === null || finite(x.echo)) || !finite(x.echoAge) || x.echoAge < 0) return 'clock';
  if (!whole(x.advantage, -(2 ** 31), 2 ** 31)) return 'advantage';
  if (!Array.isArray(x.ack) || x.ack.length !== players || !x.ack.every(a => whole(a, -1, 2 ** 53 - 1))) return 'ack';
  if (!Array.isArray(x.inputs) || x.inputs.length > maxInputs) return 'inputs';
  for (const e of x.inputs as unknown[]) {
    if (e === null || typeof e !== 'object') return 'inputs';
    const i = e as Record<string, unknown>;
    if (!whole(i.player, 0, players - 1) || !whole(i.frame, 0, 2 ** 53 - 1) || typeof i.input !== 'string')
      return 'inputs';
    if (i.delay !== undefined) {
      const d = i.delay as RollbackDelayChange | null;
      if (d === null || typeof d !== 'object' || !whole(d.delay, 0, 30) || !whole(d.from, 0, 2 ** 53 - 1))
        return 'inputs';
    }
  }
  if (!Array.isArray(x.checksums) || x.checksums.length > 64) return 'checksums';
  for (const c of x.checksums as unknown[]) {
    const k = c as Record<string, unknown> | null;
    if (k === null || typeof k !== 'object' || !whole(k.frame, 0, 2 ** 53 - 1) || !whole(k.checksum, 0, 0xffffffff))
      return 'checksums';
  }
  if (!Array.isArray(x.departures) || x.departures.length > players) return 'departures';
  for (const d of x.departures as unknown[]) {
    const k = d as Record<string, unknown> | null;
    if (k === null || typeof k !== 'object' || !whole(k.player, 0, players - 1) || !Array.isArray(k.reports))
      return 'departures';
    if (!(k.decided === null || whole(k.decided, -1, 2 ** 53 - 1))) return 'departures';
    if (k.input !== undefined && typeof k.input !== 'string') return 'departures';
  }
  return null;
}
