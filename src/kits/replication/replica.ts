/**
 * kits/replication/replica.ts: applying replication packets on the receiving side.
 *
 * Packets may arrive late, twice or out of order (an unordered transport, or retransmission after a declared loss).
 * Each entity remembers the sequence of its last creation or removal, and each field the sequence that last wrote
 * it, so an older packet never overwrites newer state and a duplicate is harmless. Removed ids keep a bounded
 * tombstone so a delayed older creation cannot resurrect them. Values are dequantized through the shared schema.
 */
import {createAuthoredDocument, type DocumentValue} from '../authoring/document';
import type {FieldSchema} from './schema';

export interface ReplicaLimits {
  readonly maxEntities: number;
  /** Removed ids remembered against delayed older creations (oldest forgotten first). */
  readonly maxTombstones: number;
  /** Packet admission bounds (UTF-8 bytes, JSON nodes, depth). */
  readonly maxBytes: number;
  readonly maxNodes: number;
}

export interface ReplicaApplyResult {
  /**
   * `applied`; `expired`: older than what bounded tombstones can still judge (do not acknowledge it; the sender's
   * loss path resends current state); `stale-epoch`: from an earlier session of this recipient (ignore it);
   * `invalid`; `retired`.
   */
  readonly status: 'applied' | 'expired' | 'stale-epoch' | 'invalid' | 'retired';
  readonly sequence?: number;
  /** The packet's epoch, when applied. */
  readonly epoch?: number;
  /** Ids this replica did not hold before. */
  readonly created: readonly number[];
  /** Ids whose values changed (including a re-sent creation of an id already held). */
  readonly updated: readonly number[];
  readonly removed: readonly number[];
  /** Items ignored because a newer packet already decided them, or the entity is unknown. */
  readonly stale: number;
  /** Creations refused because `maxEntities` was reached. */
  readonly saturated: number;
}

export interface Replica {
  /** Applies one packet JSON; never throws for packet content. */
  apply(json: string): ReplicaApplyResult;
  /** Writes an entity's dequantized values into `out`; false when unknown. */
  read(entity: number, out: Float64Array): boolean;
  ids(): readonly number[];
  clear(): void;
  dispose(): void;
}

interface Known {
  life: number;
  q: Int32Array;
  fieldSeq: Float64Array;
}

function isInt(v: unknown, min = 0): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
}

export function createReplica(options: {schema: FieldSchema; limits: ReplicaLimits}): Replica {
  const {schema, limits} = options ?? ({} as {schema: FieldSchema; limits: ReplicaLimits});
  if (!schema || typeof schema.dequantize !== 'function') throw new TypeError('replica: schema required');
  const {maxEntities, maxTombstones, maxBytes, maxNodes} = limits ?? ({} as ReplicaLimits);
  if (![maxEntities, maxTombstones, maxBytes, maxNodes].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 1 << 24))
    throw new RangeError('replica: limits must be integers 1..2^24');
  if (maxEntities * schema.count > 1 << 24) throw new RangeError('replica: maxEntities * fields exceeds 2^24');
  const width = schema.count;
  const known = new Map<number, Known>();
  const tombstones = new Map<number, number>(); // id -> removal sequence, insertion order = age
  let disposed = false,
    epoch = 0,
    floor = 0; // highest sequence of an evicted tombstone: older packets can no longer be judged

  function validItem(v: DocumentValue, kind: 'c' | 'u'): boolean {
    if (!Array.isArray(v) || !isInt(v[0])) return false;
    if (kind === 'c') {
      if (v.length !== width + 1) return false;
      for (let f = 0; f < width; f++) if (!isInt(v[f + 1]) || (v[f + 1] as number) > schema.steps(f)) return false;
      return true;
    }
    const mask = v[1];
    if (!isInt(mask, 1) || mask >= 2 ** width) return false;
    let k = 2;
    for (let f = 0; f < width; f++)
      if (mask & (1 << f)) {
        const q = v[k++];
        if (!isInt(q) || q > schema.steps(f)) return false;
      }
    return k === v.length;
  }

  function valid(v: DocumentValue): boolean {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const keys = Object.keys(v);
    if (keys.length !== 7 || !['v', 'type', 'epoch', 'seq', 'c', 'u', 'r'].every(k => Object.hasOwn(v, k)))
      return false;
    const p = v as {[k: string]: DocumentValue};
    if (p.v !== 1 || p.type !== 'replica' || !isInt(p.seq, 1) || !isInt(p.epoch, 1)) return false;
    const {c, u, r} = p;
    return (
      Array.isArray(c) &&
      Array.isArray(u) &&
      Array.isArray(r) &&
      c.every(i => validItem(i, 'c')) &&
      u.every(i => validItem(i, 'u')) &&
      r.every(i => isInt(i))
    );
  }

  function tomb(id: number, seq: number) {
    tombstones.delete(id);
    tombstones.set(id, seq);
  }
  /** Evicts oldest tombstones after a whole packet, so a packet never evicts a tombstone it still needs to consult. */
  function evict() {
    while (tombstones.size > maxTombstones) {
      const oldest = tombstones.keys().next().value as number;
      floor = Math.max(floor, tombstones.get(oldest)!);
      tombstones.delete(oldest);
    }
  }

  const done = (r: Omit<ReplicaApplyResult, 'stale' | 'saturated'> & Partial<ReplicaApplyResult>) =>
    Object.freeze({stale: 0, saturated: 0, ...r});

  return Object.freeze({
    apply(json: string): ReplicaApplyResult {
      const none = {created: [], updated: [], removed: []};
      if (disposed) return done({status: 'retired', ...none});
      let packet: {epoch: number; seq: number; c: number[][]; u: number[][]; r: number[]};
      try {
        const doc = createAuthoredDocument({
          id: 'replica-packet',
          json,
          limits: {maxBytes, maxNodes, maxDepth: 3},
          validate: (v): v is DocumentValue => valid(v),
        });
        packet = doc.read().value as unknown as typeof packet; // lint:allow-unknown-cast valid() checked the shape
        doc.dispose();
      } catch {
        return done({status: 'invalid', ...none});
      }
      if (packet.epoch < epoch) return done({status: 'stale-epoch', ...none});
      if (packet.epoch > epoch) {
        // A new session of this recipient: everything from the old one is void.
        known.clear();
        tombstones.clear();
        floor = 0;
        epoch = packet.epoch;
      }
      const seq = packet.seq;
      if (seq <= floor) return done({status: 'expired', ...none});
      const created: number[] = [],
        updated: number[] = [],
        removed: number[] = [];
      let stale = 0,
        saturated = 0;
      for (const id of packet.r) {
        const k = known.get(id);
        if (k && seq >= k.life) {
          known.delete(id);
          removed.push(id);
          tomb(id, seq);
        } else {
          stale++;
          if (!k && (tombstones.get(id) ?? 0) < seq) tomb(id, seq);
        }
      }
      for (const item of packet.c) {
        const id = item[0]!;
        const k = known.get(id);
        if ((k && k.life > seq) || (tombstones.get(id) ?? 0) > seq) {
          stale++;
          continue;
        }
        let target = k;
        const fresh = !target;
        if (!target) {
          if (known.size >= maxEntities) {
            saturated++;
            continue;
          }
          target = {life: seq, q: new Int32Array(width), fieldSeq: new Float64Array(width)};
          known.set(id, target);
          tombstones.delete(id);
        }
        target.life = Math.max(target.life, seq);
        for (let f = 0; f < width; f++)
          if (target.fieldSeq[f]! <= seq) {
            target.q[f] = item[f + 1]!;
            target.fieldSeq[f] = seq;
          }
        (fresh ? created : updated).push(id);
      }
      for (const item of packet.u) {
        const id = item[0]!;
        const mask = item[1]!;
        const k = known.get(id);
        if (!k || k.life > seq) {
          stale++;
          continue;
        }
        let i = 2,
          wrote = false;
        for (let f = 0; f < width; f++)
          if (mask & (1 << f)) {
            const q = item[i++]!;
            if (k.fieldSeq[f]! < seq) {
              k.q[f] = q;
              k.fieldSeq[f] = seq;
              wrote = true;
            }
          }
        if (wrote) updated.push(id);
        else stale++;
      }
      evict();
      return done({status: 'applied', epoch: packet.epoch, sequence: seq, created, updated, removed, stale, saturated});
    },
    read(entity: number, out: Float64Array) {
      const k = known.get(entity);
      if (!k || disposed) return false;
      if (!(out instanceof Float64Array) || out.length < width) throw new TypeError('replica: out too short');
      for (let f = 0; f < width; f++) out[f] = schema.dequantize(f, k.q[f]!);
      return true;
    },
    ids: () => Object.freeze([...known.keys()].sort((a, b) => a - b)),
    clear() {
      known.clear();
      tombstones.clear();
      floor = 0;
      epoch = 0;
    },
    dispose() {
      disposed = true;
      known.clear();
      tombstones.clear();
    },
  });
}
