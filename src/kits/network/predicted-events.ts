import type {DocumentValue} from '../authoring/document';
import type {PredictionSnapshot} from './prediction-types';

/** Hard ceilings checked at construction. */
export const MAX_PREDICTED_EVENT_ENTRIES = 65_536;
export const MAX_PREDICTED_EVENT_KEY_LENGTH = 256;

export interface PredictedEventIdentity {
  /** Creator event key, unique within its tick (for example `"hit:door-3"`). */
  readonly key: string;
  /** Creator tick or input sequence; a non-negative safe integer. */
  readonly tick: number;
}
export interface PredictedEventsLimits {
  /** Identities retained (predicted and confirmed) before overload handling. */
  readonly maxEntries: number;
  readonly maxKeyLength: number;
  /** Largest event list accepted from one `eventsOf` call in `observe`. */
  readonly maxEventsPerObserve: number;
}
export interface PredictedEventsOptions {
  readonly limits: PredictedEventsLimits;
  /** Optional, for `observe`: synchronous pure creator extraction of the events a state records. */
  readonly eventsOf?: (state: DocumentValue) => readonly PredictedEventIdentity[];
}
export type PredictedEventDrop = 'capacity' | 'late' | 'forgotten';
export type PredictedEventRefusal = Readonly<{status: 'busy' | 'retired' | 'invalid'}>;
export type PredictedEventResult =
  | Readonly<{status: 'emit'; origin: 'predicted' | 'authority'}>
  | Readonly<{status: 'suppressed'; reason: 'duplicate' | 'confirmed' | 'predicted'}>
  | Readonly<{status: 'dropped'; reason: PredictedEventDrop}>
  | PredictedEventRefusal;
export type PredictedEventCancellation =
  Readonly<{status: 'resolved'; cancelled: readonly PredictedEventIdentity[]}> | PredictedEventRefusal;
export interface PredictedEventsUpdate {
  readonly status: 'observed' | 'discontinuity' | 'unchanged' | 'events-invalid';
  readonly emitted: readonly Readonly<PredictedEventIdentity & {origin: 'predicted' | 'authority'}>[];
  readonly cancelled: readonly PredictedEventIdentity[];
  readonly dropped: number;
}
export interface PredictedEventsState {
  readonly status: 'ready' | 'retired';
  readonly entries: number;
  readonly predicted: number;
  readonly replaying: boolean;
  readonly settledThrough: number;
  /** Ticks at or below this were confirmed while full and not recorded; unknown identities there drop. */
  readonly forgottenThrough: number;
  readonly emitted: number;
  readonly cancelled: number;
  readonly suppressed: number;
  /** Authority events emitted while full and therefore not recorded (overload). */
  readonly unrecorded: number;
  readonly dropped: Readonly<Record<PredictedEventDrop, number>>;
}
export interface PredictedEvents {
  /** A prediction (or re-simulation) produced this event. */
  predict(key: string, tick: number): PredictedEventResult;
  /** The authority reports that this event happened. Order across ticks does not matter. */
  confirm(key: string, tick: number): PredictedEventResult;
  /** Start re-simulating ticks >= fromTick; predicted entries there must be produced again. */
  beginReplay(fromTick: number): Readonly<{status: 'replaying'}> | PredictedEventRefusal;
  /** Cancel, once, every unconfirmed prediction in the replay range that was not produced again. */
  endReplay(): PredictedEventCancellation;
  /** The authority has reported every event through `through`: cancel the rest there and expire it. */
  settle(through: number): PredictedEventCancellation;
  /** Prediction became unavailable: cancel every unconfirmed prediction once. */
  cancelPending(): PredictedEventCancellation;
  /** Compose with `createPrediction`: compare `read()` snapshots taken around one push or reconcile. */
  observe(before: PredictionSnapshot, after: PredictionSnapshot): PredictedEventsUpdate | PredictedEventRefusal;
  read(): PredictedEventsState;
  dispose(): void;
}

interface Entry {
  readonly key: string;
  readonly tick: number;
  confirmed: boolean;
  seen: boolean;
}
const counter = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const bounded = (n: unknown, max: number) => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= max;
const none: readonly never[] = Object.freeze([]);

/**
 * Optional exactly-once presentation event ledger over re-simulated prediction. Owns no effect, sound,
 * clock, transport or prediction state; the caller performs the returned emit/cancel decisions.
 */
export function createPredictedEvents(options: PredictedEventsOptions): PredictedEvents {
  const supplied = options?.limits;
  const maxEntries = supplied?.maxEntries,
    maxKeyLength = supplied?.maxKeyLength,
    maxEventsPerObserve = supplied?.maxEventsPerObserve;
  if (
    !bounded(maxEntries, MAX_PREDICTED_EVENT_ENTRIES) ||
    !bounded(maxKeyLength, MAX_PREDICTED_EVENT_KEY_LENGTH) ||
    !bounded(maxEventsPerObserve, MAX_PREDICTED_EVENT_ENTRIES)
  )
    throw Error('predicted events: invalid limits');
  const eventsOf = options.eventsOf;
  if (eventsOf !== undefined && typeof eventsOf !== 'function') throw Error('predicted events: invalid eventsOf');

  const table = new Map<string, Entry>();
  let status: 'ready' | 'retired' = 'ready',
    busy = false;
  let replayFrom: number | null = null,
    settledThrough = -1,
    forgottenThrough = -1;
  let emitted = 0,
    cancelled = 0,
    suppressed = 0,
    unrecorded = 0;
  const dropped: Record<PredictedEventDrop, number> = {capacity: 0, late: 0, forgotten: 0};

  const id = (key: string, tick: number) => `${tick}:${key}`;
  const valid = (key: unknown, tick: unknown): key is string =>
    typeof key === 'string' && key.length > 0 && key.length <= maxKeyLength && counter(tick);
  const refuse = (): PredictedEventRefusal =>
    Object.freeze({status: status === 'retired' ? ('retired' as const) : ('busy' as const)});
  const invalid = (): PredictedEventRefusal => Object.freeze({status: 'invalid' as const});
  const drop = (reason: PredictedEventDrop): PredictedEventResult => {
    dropped[reason]++;
    return Object.freeze({status: 'dropped', reason});
  };
  const hide = (reason: 'duplicate' | 'confirmed' | 'predicted'): PredictedEventResult => {
    suppressed++;
    return Object.freeze({status: 'suppressed', reason});
  };
  const emit = (origin: 'predicted' | 'authority'): PredictedEventResult => {
    emitted++;
    return Object.freeze({status: 'emit', origin});
  };

  function predictNow(key: string, tick: number): PredictedEventResult {
    if (tick <= settledThrough) return drop('late');
    const found = table.get(id(key, tick));
    if (found) {
      if (replayFrom !== null && tick >= replayFrom) found.seen = true;
      return hide(found.confirmed ? 'confirmed' : 'duplicate');
    }
    if (tick <= forgottenThrough) return drop('forgotten');
    // Dropping an unrecorded prediction is safe: confirmation emits it later, never twice.
    if (table.size >= maxEntries) return drop('capacity');
    table.set(id(key, tick), {key, tick, confirmed: false, seen: true});
    return emit('predicted');
  }
  function confirmNow(key: string, tick: number): PredictedEventResult {
    if (tick <= settledThrough) return drop('late');
    const found = table.get(id(key, tick));
    if (found) {
      if (found.confirmed) return hide('duplicate');
      found.confirmed = true;
      return hide('predicted');
    }
    if (tick <= forgottenThrough) return drop('forgotten');
    if (table.size >= maxEntries) {
      // Emit once without recording; later unknown identities at or below this tick drop, not repeat.
      forgottenThrough = Math.max(forgottenThrough, tick);
      unrecorded++;
      return emit('authority');
    }
    table.set(id(key, tick), {key, tick, confirmed: true, seen: true});
    return emit('authority');
  }
  function cancelWhere(test: (entry: Entry) => boolean, expire: (entry: Entry) => boolean): PredictedEventIdentity[] {
    const out: PredictedEventIdentity[] = [];
    for (const [k, entry] of table) {
      if (!entry.confirmed && test(entry)) {
        table.delete(k);
        out.push(Object.freeze({key: entry.key, tick: entry.tick}));
      } else if (expire(entry)) table.delete(k);
    }
    cancelled += out.length;
    return out;
  }
  const resolved = (list: PredictedEventIdentity[]): PredictedEventCancellation =>
    Object.freeze({status: 'resolved', cancelled: Object.freeze(list)});
  function endReplayNow(): PredictedEventIdentity[] {
    if (replayFrom === null) return [];
    const from = replayFrom;
    replayFrom = null;
    return cancelWhere(
      e => e.tick >= from && !e.seen,
      () => false,
    );
  }
  function settleNow(through: number): PredictedEventIdentity[] {
    if (through <= settledThrough) return [];
    const list = cancelWhere(
      e => e.tick <= through,
      e => e.tick <= through,
    );
    settledThrough = through;
    return list;
  }
  function cancelPendingNow(): PredictedEventIdentity[] {
    replayFrom = null;
    return cancelWhere(
      () => true,
      () => false,
    );
  }
  function guarded<T>(work: () => T): T | PredictedEventRefusal {
    if (status !== 'ready' || busy) return refuse();
    busy = true;
    try {
      return work();
    } finally {
      busy = false;
    }
  }
  /** Calls creator code once per state; returns null for any invalid list. */
  function extract(state: DocumentValue): PredictedEventIdentity[] | null {
    let list: unknown;
    try {
      list = eventsOf!(state);
    } catch {
      return null;
    }
    if (!Array.isArray(list) || list.length > maxEventsPerObserve) return null;
    const out: PredictedEventIdentity[] = [];
    for (const item of list as unknown[]) {
      const key = (item as PredictedEventIdentity | null)?.key,
        tick = (item as PredictedEventIdentity | null)?.tick;
      if (!valid(key, tick)) return null;
      out.push({key, tick: tick as number});
    }
    return out;
  }

  return Object.freeze({
    predict(key: string, tick: number) {
      return guarded(() => (valid(key, tick) ? predictNow(key, tick) : invalid()));
    },
    confirm(key: string, tick: number) {
      return guarded(() => (valid(key, tick) ? confirmNow(key, tick) : invalid()));
    },
    beginReplay(fromTick: number) {
      return guarded(() => {
        if (!counter(fromTick) || replayFrom !== null) return invalid();
        replayFrom = fromTick;
        for (const entry of table.values()) if (entry.tick >= fromTick) entry.seen = false;
        return Object.freeze({status: 'replaying' as const});
      });
    },
    endReplay() {
      return guarded(() => resolved(endReplayNow()));
    },
    settle(through: number) {
      return guarded(() => (counter(through) ? resolved(settleNow(through)) : invalid()));
    },
    cancelPending() {
      return guarded(() => resolved(cancelPendingNow()));
    },
    observe(before: PredictionSnapshot, after: PredictionSnapshot) {
      return guarded((): PredictedEventsUpdate | PredictedEventRefusal => {
        if (!eventsOf || replayFrom !== null) return invalid();
        const out: Readonly<PredictedEventIdentity & {origin: 'predicted' | 'authority'}>[] = [];
        let drops = 0;
        const record = (event: PredictedEventIdentity, result: PredictedEventResult) => {
          if (result.status === 'emit') out.push(Object.freeze({...event, origin: result.origin}));
          if (result.status === 'dropped') drops++;
        };
        const update = (state: PredictedEventsUpdate['status'], cancel: readonly PredictedEventIdentity[]) =>
          Object.freeze({
            status: state,
            emitted: Object.freeze(out),
            cancelled: Object.freeze([...cancel]),
            dropped: drops,
          });
        if (after?.status !== 'ready' || !after.predicted || !after.confirmed || before?.epoch !== after.epoch)
          return update('discontinuity', cancelPendingNow());
        const floor = after.confirmed.processedThrough;
        const reconciled = after.correction !== null && after.correction !== before.correction;
        const predictedEvents = extract(after.predicted.value);
        const confirmedEvents = reconciled && predictedEvents ? extract(after.confirmed.state.value) : none;
        if (status !== 'ready') return refuse();
        if (!predictedEvents || !confirmedEvents) return update('events-invalid', cancelPendingNow());
        if (!reconciled) {
          for (const e of predictedEvents)
            if (e.tick > Math.max(floor, settledThrough)) record(e, predictNow(e.key, e.tick));
          return update(out.length || drops ? 'observed' : 'unchanged', none);
        }
        for (const e of confirmedEvents)
          if (e.tick > settledThrough && e.tick <= floor) record(e, confirmNow(e.key, e.tick));
        replayFrom = floor + 1;
        for (const entry of table.values()) if (entry.tick >= replayFrom) entry.seen = false;
        for (const e of predictedEvents) if (e.tick > floor) record(e, predictNow(e.key, e.tick));
        const cancel = [...endReplayNow(), ...settleNow(floor)];
        return update('observed', cancel);
      });
    },
    read() {
      let predicted = 0;
      for (const entry of table.values()) if (!entry.confirmed) predicted++;
      return Object.freeze({
        status,
        entries: table.size,
        predicted,
        replaying: replayFrom !== null,
        settledThrough,
        forgottenThrough,
        emitted,
        cancelled,
        suppressed,
        unrecorded,
        dropped: Object.freeze({...dropped}),
      });
    },
    dispose() {
      status = 'retired';
      table.clear();
      replayFrom = null;
    },
  });
}
