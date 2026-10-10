/**
 * kits/playout/clock.ts: estimating a remote authority's clock from round-trip samples, applied without jumps.
 *
 * The creator's protocol carries pings: the client notes its local time when it sends one (`sent`), the authority
 * replies with its own time (`remote`), and the client notes when the reply arrives (`received`). The offset
 * estimate is `remote - (sent + received) / 2`, whose error is at most half the round trip, so the sample with the
 * smallest round trip in a bounded window is the most trustworthy. The applied offset moves toward the estimate at a
 * bounded rate (a remote clock that appears to step does not make presentation jump), unless the difference exceeds
 * a snap threshold. Pure: local time is caller-supplied and must not decrease.
 */

export interface ClockOffsetOptions {
  /** Round-trip samples retained; the minimum-round-trip sample among them wins. */
  readonly maxSamples: number;
  /** Samples with a longer round trip are refused (they carry too much uncertainty). */
  readonly maxRoundTrip: number;
  /** Largest change of the applied offset per unit of local time (e.g. 0.05 = 5 %). */
  readonly maxSlew: number;
  /** A difference between applied and estimated offset larger than this is applied at once. */
  readonly snapBeyond: number;
}

export type ClockSampleStatus = 'accepted' | 'refused' | 'retired';

export interface ClockEstimate {
  /** Offset to add to local time to get remote time, from the best retained sample. */
  readonly offset: number;
  /** Round trip of that sample; the estimate's error is at most half of it. */
  readonly roundTrip: number;
  readonly samples: number;
}

export interface ClockOffset {
  readonly options: ClockOffsetOptions;
  sample(input: {readonly sent: number; readonly remote: number; readonly received: number}): ClockSampleStatus;
  /** The best current estimate, or null before any accepted sample. */
  estimate(): ClockEstimate | null;
  /** Remote time now, using the slewed offset. Null before any accepted sample. `local` must not decrease. */
  remoteNow(local: number): number | null;
  /** Forgets all samples and the applied offset (e.g. after reconnecting to another authority). */
  reset(): void;
  dispose(): void;
}

const MAX_OFFSET = 2 ** 53;

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function createClockOffset(options: ClockOffsetOptions): ClockOffset {
  const {maxSamples, maxRoundTrip, maxSlew, snapBeyond} = options ?? ({} as ClockOffsetOptions);
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 1 || maxSamples > 1024)
    throw new RangeError('playout clock: maxSamples must be an integer 1..1024');
  if (!finite(maxRoundTrip) || maxRoundTrip <= 0) throw new RangeError('playout clock: maxRoundTrip must be > 0');
  if (!finite(maxSlew) || maxSlew < 0 || maxSlew >= 1) throw new RangeError('playout clock: maxSlew must be in [0, 1)');
  if (!finite(snapBeyond) || snapBeyond < 0) throw new RangeError('playout clock: snapBeyond must be >= 0');
  const frozen = Object.freeze({maxSamples, maxRoundTrip, maxSlew, snapBeyond});
  const offsets = new Float64Array(maxSamples);
  const trips = new Float64Array(maxSamples);
  let count = 0;
  let next = 0;
  let applied: number | null = null;
  let lastLocal: number | null = null;
  let disposed = false;

  function best(): ClockEstimate | null {
    if (count === 0) return null;
    let k = 0;
    for (let i = 1; i < count; i++) if (trips[i]! < trips[k]!) k = i;
    return Object.freeze({offset: offsets[k]!, roundTrip: trips[k]!, samples: count});
  }

  return Object.freeze({
    options: frozen,
    sample(input: {readonly sent: number; readonly remote: number; readonly received: number}): ClockSampleStatus {
      if (disposed) return 'retired';
      const {sent, remote, received} = input ?? ({} as {sent: number; remote: number; received: number});
      // Samples arrive from the network: malformed ones are refused, never thrown.
      if (!finite(sent) || !finite(remote) || !finite(received)) return 'refused';
      const trip = received - sent;
      if (!(trip >= 0) || trip > maxRoundTrip) return 'refused';
      const offset = remote - (sent + received) / 2;
      // Beyond 2^53 neither clock can be represented exactly: such a sample is not a clock.
      if (!finite(offset) || Math.abs(offset) > MAX_OFFSET) return 'refused';
      offsets[next] = offset;
      trips[next] = trip;
      next = (next + 1) % maxSamples;
      count = Math.min(count + 1, maxSamples);
      return 'accepted';
    },
    estimate: () => (disposed ? null : best()),
    remoteNow(local: number): number | null {
      if (!finite(local)) throw new TypeError('playout clock: local time must be finite');
      if (lastLocal !== null && local < lastLocal) throw new RangeError('playout clock: local time went backwards');
      const est = disposed ? null : best();
      const elapsed = lastLocal === null ? 0 : local - lastLocal;
      lastLocal = local;
      if (!est) return null;
      if (applied === null || Math.abs(est.offset - applied) > snapBeyond) applied = est.offset;
      else {
        const step = maxSlew * elapsed;
        const diff = est.offset - applied;
        applied += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
      }
      const now = local + applied;
      return finite(now) ? now : null;
    },
    reset() {
      count = 0;
      next = 0;
      applied = null;
    },
    dispose() {
      disposed = true;
      count = 0;
      applied = null;
    },
  });
}
