/**
 * A seeded, caller-driven lossy network for tests: loss, duplication, reordering, latency with jitter and a bandwidth
 * cap per directed link. No timers or sockets: the caller says what time it is. Importable by any kit's tests.
 */
import {createRng} from '../../core/rng';

export interface LossyLinkOptions {
  readonly seed: number;
  /** Probability in [0, 1] that a message is dropped. */
  readonly loss: number;
  /** Probability in [0, 1] that a delivered message is also delivered a second time (with its own latency). */
  readonly duplicate: number;
  /** Probability in [0, 1] that a message is held back past later messages (extra latency up to `latency[1] + 1`). */
  readonly reorder: number;
  /** One-way latency in caller time units, drawn uniformly from [min, max] per message (the jitter), [0, 100000]. */
  readonly latency: readonly [number, number];
  /** Bytes per directed link per time unit; a send over the cap is dropped. Default: unlimited. */
  readonly bandwidth?: number;
  /** Messages in flight across all links, [1, 1000000]; a send over it is dropped. Default 100000. */
  readonly maxInFlight?: number;
}
export type LossyLinkStats = Readonly<{
  sent: number;
  lost: number;
  duplicated: number;
  reordered: number;
  overBandwidth: number;
  overflow: number;
  delivered: number;
  inFlight: number;
}>;
export interface LossyLink<T> {
  /** Offer a message; `bytes` counts against the bandwidth cap. Returns whether it entered the network. */
  send(from: number | string, to: number | string, message: T, now: number, bytes?: number): 'sent' | 'dropped';
  /** Messages for `to` whose delivery time is at or before `now`, in delivery order. */
  receive(to: number | string, now: number): T[];
  /** Drop everything in flight to and from an endpoint (a disconnect). */
  cut(endpoint: number | string): void;
  read(): LossyLinkStats;
}

const probability = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const whole = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;

export function createLossyLink<T>(options: LossyLinkOptions): LossyLink<T> {
  if (options === null || typeof options !== 'object') throw Error('lossy link: invalid options');
  const {seed, loss, duplicate, reorder, latency} = options;
  const bandwidth = options.bandwidth ?? Infinity,
    maxInFlight = options.maxInFlight ?? 100000;
  if (
    !Number.isSafeInteger(seed) ||
    !probability(loss) ||
    !probability(duplicate) ||
    !probability(reorder) ||
    !Array.isArray(latency) ||
    latency.length !== 2 ||
    !whole(latency[0], 0, 100000) ||
    !whole(latency[1], latency[0], 100000) ||
    !(bandwidth === Infinity || whole(bandwidth, 1, 2 ** 31)) ||
    !whole(maxInFlight, 1, 1000000)
  )
    throw Error('lossy link: invalid options');
  const [minLatency, maxLatency] = latency;
  const rng = createRng(seed);
  type Flight = {to: string; at: number; seq: number; from: string; message: T};
  let flights: Flight[] = [],
    seq = 0;
  const used = new Map<string, {at: number; bytes: number}>();
  const stats = {sent: 0, lost: 0, duplicated: 0, reordered: 0, overBandwidth: 0, overflow: 0, delivered: 0};
  const draw = () => {
    let delay = rng.int(minLatency, maxLatency);
    if (reorder > 0 && rng.next() < reorder) {
      delay += rng.int(1, maxLatency + 1);
      stats.reordered++;
    }
    return delay;
  };
  const link: LossyLink<T> = {
    send(from, to, message, now, bytes = 0) {
      if (!Number.isFinite(now) || !Number.isFinite(bytes) || bytes < 0) throw Error('lossy link: invalid send');
      stats.sent++;
      const key = `${from}>${to}`,
        slot = used.get(key);
      const spent = slot && slot.at === now ? slot.bytes : 0;
      if (spent + bytes > bandwidth) {
        stats.overBandwidth++;
        return 'dropped';
      }
      used.set(key, {at: now, bytes: spent + bytes});
      if (rng.next() < loss) {
        stats.lost++;
        return 'dropped';
      }
      const copies = rng.next() < duplicate ? 2 : 1;
      if (flights.length + copies > maxInFlight) {
        stats.overflow++;
        return 'dropped';
      }
      if (copies === 2) stats.duplicated++;
      for (let c = 0; c < copies; c++)
        flights.push({to: String(to), from: String(from), at: now + draw(), seq: seq++, message});
      return 'sent';
    },
    receive(to, now) {
      const id = String(to),
        due: Flight[] = [],
        rest: Flight[] = [];
      for (const f of flights) (f.to === id && f.at <= now ? due : rest).push(f);
      flights = rest;
      due.sort((a, b) => a.at - b.at || a.seq - b.seq);
      stats.delivered += due.length;
      return due.map(f => f.message);
    },
    cut(endpoint) {
      const id = String(endpoint);
      flights = flights.filter(f => f.to !== id && f.from !== id);
    },
    read() {
      return Object.freeze({...stats, inFlight: flights.length});
    },
  };
  return Object.freeze(link);
}
