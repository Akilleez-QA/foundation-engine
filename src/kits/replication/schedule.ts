/**
 * kits/replication/schedule.ts: per-recipient replication under a byte budget.
 *
 * The authority sets each entity's current numeric fields once per step (quantized by a shared schema). Each
 * recipient tracks which entities it should know (for example from `@kits/spatial` interest sets) and, for each,
 * what it was last sent. `build(recipient, now, maxBytes)` writes one packet that fits the byte budget: removals,
 * then creations and field updates ranked by an accumulated priority, so an entry passed over keeps gaining
 * priority until it is sent (no starvation while its entry fits the budget). Updates carry only fields whose
 * quantized value differs from what that recipient was sent, as a bit mask. An optional per-entry minimum interval
 * caps update cadence. Packets are acknowledged or declared lost by the creator's protocol; loss puts creations,
 * removals and the lost fields back in line. Pure: no clock, timer, socket or ECS reflection.
 */
import {type FieldSchema} from './schema';

export interface ReplicationLimits {
  readonly maxEntities: number;
  readonly maxRecipients: number;
  /** Entries per recipient, including entries whose removal is not yet acknowledged. */
  readonly maxRelevant: number;
  /** Unacknowledged packets per recipient; building beyond it declares the oldest lost. */
  readonly maxInFlight: number;
  /** Items per packet. */
  readonly maxItems: number;
}

export interface ReplicationOptions {
  readonly schema: FieldSchema;
  readonly limits: ReplicationLimits;
  /**
   * Epochs start above this nonnegative safe integer (default 0). A schedule recreated for the same clients (a host
   * restart) must pass a value above every epoch the previous one issued (for example a persisted boot counter times
   * 2^20), or clients must discard their replicas.
   */
  readonly epochBase?: number;
}

export type ReplicationEntityId = number;

export interface RelevantOptions {
  /** Priority gained per unit of time while this entry has something to send (default 1). */
  readonly weight?: number;
  /** Least time between two updates of this entry (default 0). Creations and removals ignore it. */
  readonly minInterval?: number;
}

export type BuildStatus = 'built' | 'idle' | 'held' | 'starved' | 'absent' | 'retired';

export interface BuildResult {
  readonly status: BuildStatus;
  /** Packet JSON when built. */
  readonly json?: string;
  readonly sequence?: number;
  /** The recipient's epoch carried by the packet. */
  readonly epoch?: number;
  readonly bytes?: number;
  readonly creates: number;
  readonly updates: number;
  readonly removes: number;
  /** Items that had something to send but did not fit, or were held by their minimum interval. */
  readonly deferred: number;
  /** Items larger than the whole budget (they can never be sent at this budget). */
  readonly oversize: number;
  /** Oldest unacknowledged packets declared lost because `maxInFlight` was reached. */
  readonly expired: number;
}

export interface ReplicationStats {
  readonly entities: number;
  readonly recipients: number;
  readonly entries: number;
  readonly inFlight: number;
  readonly lost: number;
  readonly expired: number;
}

export interface ReplicationSchedule {
  readonly schema: FieldSchema;
  readonly limits: ReplicationLimits;
  /** Sets an entity's current authoritative values. */
  set(entity: ReplicationEntityId, values: ArrayLike<number>): 'stored' | 'saturated' | 'retired';
  /** Deletes an entity; every recipient that knows it will be sent a removal. */
  delete(entity: ReplicationEntityId): boolean;
  addRecipient(recipient: number): 'added' | 'duplicate' | 'saturated' | 'retired';
  /** Forgets a recipient and everything in flight to it. */
  removeRecipient(recipient: number): boolean;
  /** The recipient should know `entity` (creates it if new; updates weight and interval otherwise). */
  relevant(
    recipient: number,
    entity: ReplicationEntityId,
    options?: RelevantOptions,
  ): 'tracked' | 'updated' | 'unknown-entity' | 'saturated' | 'absent' | 'retired';
  /** The recipient should forget `entity`. */
  irrelevant(recipient: number, entity: ReplicationEntityId): boolean;
  /** Builds the next packet for a recipient within `maxBytes` UTF-16 code units. `now` must not decrease. */
  build(recipient: number, now: number, maxBytes: number): BuildResult;
  ack(recipient: number, sequence: number): boolean;
  lost(recipient: number, sequence: number): boolean;
  stats(): ReplicationStats;
  dispose(): void;
}

type EntryState = 'create' | 'creating' | 'live' | 'remove' | 'removing';
interface Entry {
  state: EntryState;
  sent: Int32Array;
  forced: number;
  acc: number;
  weight: number;
  minInterval: number;
  lastSent: number;
  /** Sequence of the in-flight create or remove, 0 when none. */
  lifecycleSeq: number;
  /** The client may hold this id (a creation was built, or a removal was pending): forgetting must send a removal. */
  mayKnow: boolean;
}
interface FlightItem {
  id: number;
  entry: Entry;
  kind: 'create' | 'update' | 'remove';
  mask: number;
}
interface Recipient {
  entries: Map<number, Entry>;
  flights: Map<number, FlightItem[]>;
  lastNow: number | null;
  /** Distinguishes this recipient's session from an earlier one with the same id. */
  epoch: number;
  /** The new epoch must reach the client even if nothing is relevant: 0 pending, a sequence in flight, -1 done. */
  announce: number;
}

function positive(n: number, max = 1 << 24) {
  return Number.isSafeInteger(n) && n >= 1 && n <= max;
}
function checkId(id: number, what: string) {
  if (!Number.isSafeInteger(id) || id < 0)
    throw new TypeError(`replication: ${what} must be a nonnegative safe integer`);
}

export function createReplicationSchedule(options: ReplicationOptions): ReplicationSchedule {
  const {schema, limits} = options ?? ({} as ReplicationOptions);
  if (!schema || typeof schema.quantize !== 'function') throw new TypeError('replication: schema required');
  const {maxEntities, maxRecipients, maxRelevant, maxInFlight, maxItems} = limits ?? ({} as ReplicationLimits);
  if (![maxEntities, maxRecipients, maxRelevant, maxInFlight, maxItems].every(n => positive(n)))
    throw new RangeError('replication: limits must be positive integers');
  if (maxRecipients * maxRelevant * (schema.count + 1) > 1 << 24)
    throw new RangeError('replication: maxRecipients * maxRelevant * (fields + 1) exceeds 2^24');
  if (maxEntities * schema.count > 1 << 24) throw new RangeError('replication: maxEntities * fields exceeds 2^24');
  if (maxRecipients * maxInFlight * Math.min(maxItems, maxRelevant) > 1 << 24)
    throw new RangeError('replication: maxRecipients * maxInFlight * items exceeds 2^24');
  const epochBase = options.epochBase ?? 0;
  if (!Number.isSafeInteger(epochBase) || epochBase < 0 || epochBase > Number.MAX_SAFE_INTEGER - 2 ** 32)
    throw new RangeError('replication: epochBase must be an integer 0..2^53 - 2^33');
  const frozenLimits = Object.freeze({maxEntities, maxRecipients, maxRelevant, maxInFlight, maxItems});
  const width = schema.count;
  const all = (1 << width) - 1;
  const entities = new Map<number, Int32Array>();
  const recipients = new Map<number, Recipient>();
  const scratch = new Int32Array(width);
  let disposed = false,
    lostCount = 0,
    expiredCount = 0,
    epochs = options.epochBase ?? 0,
    // One sequence space for the whole schedule: a sequence is never reused, even by a re-added recipient, so a late
    // acknowledgment from an earlier session can never confirm a newer packet.
    nextSequence = 1;

  function forget(r: Recipient, id: number) {
    const e = r.entries.get(id);
    if (!e) return false;
    // Never possibly sent to the client: drop at once. Otherwise the client must be told.
    if (e.state === 'create' && !e.mayKnow) r.entries.delete(id);
    else if (e.state !== 'remove' && e.state !== 'removing') {
      e.state = 'remove';
      e.lifecycleSeq = 0;
    }
    return true;
  }

  function settleLost(r: Recipient, seq: number) {
    const items = r.flights.get(seq);
    if (!items) return false;
    r.flights.delete(seq);
    if (r.announce === seq) r.announce = 0;
    for (const it of items) {
      if (r.entries.get(it.id) !== it.entry) continue; // replaced or dropped since
      const e = it.entry;
      if (it.kind === 'create' && e.state === 'creating' && e.lifecycleSeq === seq) {
        e.state = 'create';
        e.lifecycleSeq = 0;
      } else if (it.kind === 'remove' && e.state === 'removing' && e.lifecycleSeq === seq) {
        e.state = 'remove';
        e.lifecycleSeq = 0;
      } else if (it.kind === 'update' && e.state === 'live') e.forced |= it.mask;
    }
    lostCount++;
    return true;
  }

  function dirtyMask(e: Entry, q: Int32Array) {
    let mask = e.forced;
    for (let f = 0; f < width; f++) if (q[f] !== e.sent[f]) mask |= 1 << f;
    return mask & all;
  }

  const api: ReplicationSchedule = {
    schema,
    limits: frozenLimits,
    set(entity, values) {
      checkId(entity, 'entity');
      schema.quantize(values, scratch);
      if (disposed) return 'retired';
      let q = entities.get(entity);
      if (!q) {
        if (entities.size >= maxEntities) return 'saturated';
        q = new Int32Array(width);
        entities.set(entity, q);
      }
      q.set(scratch);
      return 'stored';
    },
    delete(entity) {
      checkId(entity, 'entity');
      if (disposed || !entities.delete(entity)) return false;
      for (const r of recipients.values()) forget(r, entity);
      return true;
    },
    addRecipient(recipient) {
      checkId(recipient, 'recipient');
      if (disposed) return 'retired';
      if (recipients.has(recipient)) return 'duplicate';
      if (recipients.size >= maxRecipients) return 'saturated';
      // Epochs and sequences must stay exact; far beyond any practical session count, refuse instead of wrapping.
      if (epochs >= Number.MAX_SAFE_INTEGER - 1 || nextSequence >= Number.MAX_SAFE_INTEGER - 1) return 'saturated';
      recipients.set(recipient, {
        entries: new Map(),
        flights: new Map(),
        lastNow: null,
        epoch: ++epochs,
        announce: 0,
      });
      return 'added';
    },
    removeRecipient(recipient) {
      checkId(recipient, 'recipient');
      return recipients.delete(recipient);
    },
    relevant(recipient, entity, opts) {
      checkId(recipient, 'recipient');
      checkId(entity, 'entity');
      const weight = opts?.weight ?? 1;
      const minInterval = opts?.minInterval ?? 0;
      if (!Number.isFinite(weight) || weight <= 0) throw new RangeError('replication: weight must be > 0');
      if (!Number.isFinite(minInterval) || minInterval < 0)
        throw new RangeError('replication: minInterval must be >= 0');
      if (disposed) return 'retired';
      const r = recipients.get(recipient);
      if (!r) return 'absent';
      if (!entities.has(entity)) return 'unknown-entity';
      const e = r.entries.get(entity);
      if (e && e.state !== 'remove' && e.state !== 'removing') {
        e.weight = weight;
        e.minInterval = minInterval;
        return 'updated';
      }
      if (!e && r.entries.size >= maxRelevant) return 'saturated';
      // New, or re-entering while its removal is pending: a fresh creation supersedes it (a later sequence).
      r.entries.set(entity, {
        state: 'create',
        sent: new Int32Array(width),
        forced: 0,
        acc: 0,
        weight,
        minInterval,
        lastSent: Number.NEGATIVE_INFINITY,
        lifecycleSeq: 0,
        mayKnow: !!e, // replacing a pending removal: the client may still hold the old id
      });
      return 'tracked';
    },
    irrelevant(recipient, entity) {
      checkId(recipient, 'recipient');
      checkId(entity, 'entity');
      const r = recipients.get(recipient);
      return !!r && !disposed && forget(r, entity);
    },
    build(recipient, now, maxBytes): BuildResult {
      checkId(recipient, 'recipient');
      if (!Number.isFinite(now)) throw new TypeError('replication: now must be finite');
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('replication: maxBytes must be >= 1');
      const empty = (status: BuildStatus, extra: Partial<BuildResult> = {}): BuildResult =>
        Object.freeze({status, creates: 0, updates: 0, removes: 0, deferred: 0, oversize: 0, expired: 0, ...extra});
      if (disposed) return empty('retired');
      const r = recipients.get(recipient);
      if (!r) return empty('absent');
      if (r.lastNow !== null && now < r.lastNow) throw new RangeError('replication: now went backwards');
      const elapsed = r.lastNow === null ? 0 : now - r.lastNow;
      r.lastNow = now;
      type Candidate = {id: number; e: Entry; kind: 'create' | 'update' | 'remove'; mask: number; held: boolean};
      const collect = (gain: boolean): Candidate[] => {
        const list: Candidate[] = [];
        for (const [id, e] of r.entries) {
          let kind: Candidate['kind'] | null = null,
            mask = 0;
          if (e.state === 'remove') kind = 'remove';
          else if (e.state === 'create') {
            kind = 'create';
            mask = all;
          } else if (e.state === 'live') {
            // Updates wait until the creation is acknowledged, so an update can never overtake its creation.
            const q = entities.get(id);
            if (q) mask = dirtyMask(e, q);
            if (mask) kind = 'update';
          }
          if (!kind) continue;
          if (gain) e.acc = Math.min(Number.MAX_VALUE, e.acc + e.weight * elapsed);
          list.push({id, e, kind, mask, held: kind === 'update' && now - e.lastSent < e.minInterval});
        }
        return list;
      };
      let candidates = collect(true);
      if (!candidates.length && r.announce !== 0) return empty('idle');
      // Expire only when there is something to send, so an idle poll never declares a packet lost.
      let expired = 0;
      if (r.flights.size >= maxInFlight) {
        while (r.flights.size >= maxInFlight) {
          settleLost(r, r.flights.keys().next().value as number);
          expired++;
          expiredCount++;
        }
        candidates = collect(false);
      }
      if (nextSequence >= Number.MAX_SAFE_INTEGER) return empty('retired');
      const seq = nextSequence;
      // One queue: accumulated priority, then removals before creations before updates, then id. Deterministic, and
      // every kind gains priority while waiting, so sustained churn of one kind cannot starve another.
      const rank = {remove: 0, create: 1, update: 2};
      candidates.sort((a, b) =>
        a.e.acc !== b.e.acc ? (b.e.acc > a.e.acc ? 1 : -1) : rank[a.kind] - rank[b.kind] || a.id - b.id,
      );
      const base = JSON.stringify({v: 1, type: 'replica', epoch: r.epoch, seq, c: [], u: [], r: []}).length;
      if (base > maxBytes) return empty('starved', {deferred: candidates.length, expired});
      let bytes = base;
      const c: number[][] = [],
        u: number[][] = [],
        rm: number[] = [],
        flight: FlightItem[] = [];
      let deferred = 0,
        held = 0,
        oversize = 0,
        items = 0;
      for (const cand of candidates) {
        const {id, e, kind, mask} = cand;
        if (cand.held) {
          held++;
          continue;
        }
        const q = kind === 'remove' ? null : entities.get(id);
        if (kind !== 'remove' && !q) continue;
        let item: number | number[];
        if (kind === 'remove') item = id;
        else if (kind === 'create') item = [id, ...q!];
        else {
          item = [id, mask];
          for (let f = 0; f < width; f++) if (mask & (1 << f)) item.push(q![f]!);
        }
        const len = JSON.stringify(item).length;
        const list: unknown[] = kind === 'remove' ? rm : kind === 'create' ? c : u;
        if (base + len > maxBytes) oversize++;
        if (items >= maxItems || bytes + len + (list.length ? 1 : 0) > maxBytes) {
          deferred++;
          continue;
        }
        bytes += len + (list.length ? 1 : 0);
        items++;
        e.acc = 0;
        if (kind === 'remove') {
          rm.push(id);
          e.state = 'removing';
          e.lifecycleSeq = seq;
          flight.push({id, entry: e, kind, mask: 0});
          continue;
        }
        (kind === 'create' ? c : u).push(item as number[]);
        e.sent.set(q!);
        e.forced = 0;
        e.lastSent = now;
        if (kind === 'create') {
          e.state = 'creating';
          e.lifecycleSeq = seq;
          e.mayKnow = true;
        }
        flight.push({id, entry: e, kind, mask: kind === 'create' ? all : mask});
      }
      // The first packet of an epoch is sent even when empty, so a reused client discards the old session's state.
      if (!flight.length && r.announce !== 0)
        return empty(deferred ? 'starved' : held ? 'held' : 'idle', {deferred: deferred + held, oversize, expired});
      nextSequence++;
      r.flights.set(seq, flight);
      if (r.announce === 0) r.announce = seq;
      const json = JSON.stringify({v: 1, type: 'replica', epoch: r.epoch, seq, c, u, r: rm});
      return Object.freeze({
        status: 'built',
        json,
        sequence: seq,
        epoch: r.epoch,
        bytes: json.length,
        creates: c.length,
        updates: u.length,
        removes: rm.length,
        deferred: deferred + held,
        oversize,
        expired,
      });
    },
    ack(recipient, sequence) {
      checkId(recipient, 'recipient');
      const r = recipients.get(recipient);
      const items = r?.flights.get(sequence);
      if (!r || !items || disposed) return false;
      r.flights.delete(sequence);
      if (r.announce === sequence) r.announce = -1;
      for (const it of items) {
        if (r.entries.get(it.id) !== it.entry) continue;
        const e = it.entry;
        if (it.kind === 'create' && e.state === 'creating' && e.lifecycleSeq === sequence) {
          e.state = 'live';
          e.lifecycleSeq = 0;
        } else if (it.kind === 'remove' && e.state === 'removing' && e.lifecycleSeq === sequence) {
          r.entries.delete(it.id);
        }
      }
      return true;
    },
    lost(recipient, sequence) {
      checkId(recipient, 'recipient');
      const r = recipients.get(recipient);
      return !!r && !disposed && settleLost(r, sequence);
    },
    stats() {
      let entries = 0,
        inFlight = 0;
      for (const r of recipients.values()) {
        entries += r.entries.size;
        inFlight += r.flights.size;
      }
      return Object.freeze({
        entities: entities.size,
        recipients: recipients.size,
        entries,
        inFlight,
        lost: lostCount,
        expired: expiredCount,
      });
    },
    dispose() {
      disposed = true;
      entities.clear();
      recipients.clear();
    },
  };
  return Object.freeze(api);
}
