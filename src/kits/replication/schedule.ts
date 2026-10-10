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
}

export type ReplicationEntityId = number;

export interface RelevantOptions {
  /** Priority gained per unit of time while this entry has something to send (default 1). */
  readonly weight?: number;
  /** Least time between two updates of this entry (default 0). Creations and removals ignore it. */
  readonly minInterval?: number;
}

export type BuildStatus = 'built' | 'idle' | 'starved' | 'absent' | 'retired';

export interface BuildResult {
  readonly status: BuildStatus;
  /** Packet JSON when built. */
  readonly json?: string;
  readonly sequence?: number;
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
  nextSeq: number;
  lastNow: number | null;
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
  const frozenLimits = Object.freeze({maxEntities, maxRecipients, maxRelevant, maxInFlight, maxItems});
  const width = schema.count;
  const all = (1 << width) - 1;
  const entities = new Map<number, Int32Array>();
  const recipients = new Map<number, Recipient>();
  const scratch = new Int32Array(width);
  let disposed = false,
    lostCount = 0,
    expiredCount = 0;

  function forget(r: Recipient, id: number) {
    const e = r.entries.get(id);
    if (!e) return false;
    // Never sent to the client: drop at once. Otherwise the client must be told.
    if (e.state === 'create') r.entries.delete(id);
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
    for (const it of items) {
      if (r.entries.get(it.id) !== it.entry) continue; // replaced or dropped since
      const e = it.entry;
      if (it.kind === 'create' && e.state === 'creating' && e.lifecycleSeq === seq) {
        e.state = 'create';
        e.lifecycleSeq = 0;
      } else if (it.kind === 'remove' && e.state === 'removing' && e.lifecycleSeq === seq) {
        e.state = 'remove';
        e.lifecycleSeq = 0;
      } else if (it.kind === 'update' && (e.state === 'live' || e.state === 'creating')) e.forced |= it.mask;
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
      recipients.set(recipient, {entries: new Map(), flights: new Map(), nextSeq: 1, lastNow: null});
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
      let expired = 0;
      while (r.flights.size >= maxInFlight) {
        const oldest = r.flights.keys().next().value as number;
        settleLost(r, oldest);
        expired++;
        expiredCount++;
      }
      const seq = r.nextSeq;
      // Candidates: everything with something to send. Priority accumulates only while waiting.
      const removes: number[] = [];
      const ranked: {id: number; e: Entry; mask: number}[] = [];
      for (const [id, e] of r.entries) {
        if (e.state === 'remove') removes.push(id);
        else if (e.state === 'create') {
          e.acc += e.weight * elapsed;
          ranked.push({id, e, mask: all});
        } else if (e.state === 'live' || e.state === 'creating') {
          const q = entities.get(id);
          if (!q) continue;
          const mask = dirtyMask(e, q);
          if (mask === 0) continue;
          e.acc += e.weight * elapsed;
          ranked.push({id, e, mask});
        }
      }
      removes.sort((a, b) => a - b);
      // Creations before updates, then accumulated priority, then id: deterministic.
      ranked.sort(
        (a, b) => Number(b.e.state === 'create') - Number(a.e.state === 'create') || b.e.acc - a.e.acc || a.id - b.id,
      );
      const base = JSON.stringify({v: 1, type: 'replica', seq, c: [], u: [], r: []}).length;
      if (base > maxBytes) return empty('starved', {deferred: removes.length + ranked.length, expired});
      let bytes = base;
      const c: number[][] = [],
        u: number[][] = [],
        rm: number[] = [],
        flight: FlightItem[] = [];
      let deferred = 0,
        oversize = 0,
        items = 0;
      const fits = (len: number, list: unknown[]) => bytes + len + (list.length ? 1 : 0) <= maxBytes;
      for (const id of removes) {
        const len = String(id).length;
        if (items >= maxItems || !fits(len, rm)) {
          deferred++;
          if (base + len > maxBytes) oversize++;
          continue;
        }
        bytes += len + (rm.length ? 1 : 0);
        rm.push(id);
        items++;
        const e = r.entries.get(id)!;
        e.state = 'removing';
        e.lifecycleSeq = seq;
        flight.push({id, entry: e, kind: 'remove', mask: 0});
      }
      for (const {id, e, mask} of ranked) {
        const q = entities.get(id);
        if (!q) continue;
        const creating = e.state === 'create';
        if (!creating && now - e.lastSent < e.minInterval) {
          deferred++;
          continue;
        }
        const item: number[] = creating ? [id, ...q] : [id, mask];
        if (!creating) for (let f = 0; f < width; f++) if (mask & (1 << f)) item.push(q[f]!);
        const len = JSON.stringify(item).length;
        const list = creating ? c : u;
        if (items >= maxItems || !fits(len, list)) {
          deferred++;
          if (base + len > maxBytes) oversize++;
          continue;
        }
        bytes += len + (list.length ? 1 : 0);
        list.push(item);
        items++;
        e.sent.set(q);
        e.forced = 0;
        e.acc = 0;
        e.lastSent = now;
        if (creating) {
          e.state = 'creating';
          e.lifecycleSeq = seq;
        }
        flight.push({id, entry: e, kind: creating ? 'create' : 'update', mask: creating ? all : mask});
      }
      if (!flight.length) return empty(deferred ? 'starved' : 'idle', {deferred, oversize, expired});
      r.nextSeq++;
      r.flights.set(seq, flight);
      const json = JSON.stringify({v: 1, type: 'replica', seq, c, u, r: rm});
      return Object.freeze({
        status: 'built',
        json,
        sequence: seq,
        bytes: json.length,
        creates: c.length,
        updates: u.length,
        removes: rm.length,
        deferred,
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
