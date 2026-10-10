import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createInterestResult, createInterestSets, createSpatialGrid} from '../spatial';
import {createReplica, createReplicationSchedule, defineFieldSchema, type ReplicationSchedule} from './index';

const schema = defineFieldSchema([
  {name: 'x', min: -1000, max: 1000, step: 0.01},
  {name: 'z', min: -1000, max: 1000, step: 0.01},
  {name: 'heading', min: 0, max: 360, step: 1},
  {name: 'state', min: 0, max: 15, step: 1},
]);
const limits = {maxEntities: 256, maxRecipients: 4, maxRelevant: 64, maxInFlight: 8, maxItems: 64};
const replicaLimits = {maxEntities: 64, maxTombstones: 64, maxBytes: 65536, maxNodes: 8192};

function built(s: ReplicationSchedule, r: number, now: number, bytes = 4096) {
  const b = s.build(r, now, bytes);
  assert.equal(b.status, 'built');
  return b;
}

test('schema quantizes, clamps and refuses bad specs', () => {
  const q = new Int32Array(4);
  schema.quantize([1.234, -2000, 359.6, 3], q);
  assert.deepEqual([...q], [100123, 0, 360, 3]);
  assert.ok(Math.abs(schema.dequantize(0, q[0]!) - 1.23) < 1e-9);
  assert.throws(() => schema.quantize([1, 2, 3], q), TypeError);
  assert.throws(() => schema.quantize([1, 2, 3, Number.NaN], q), TypeError);
  assert.throws(() => defineFieldSchema([]), RangeError);
  assert.throws(() => defineFieldSchema([{name: 'a', min: 0, max: 1, step: 0}]), RangeError);
  assert.throws(() => defineFieldSchema([{name: 'a', min: 0, max: 2 ** 31, step: 1}]), RangeError);
  assert.throws(() =>
    defineFieldSchema([
      {name: 'a', min: 0, max: 1, step: 1},
      {name: 'a', min: 0, max: 1, step: 1},
    ]),
  );
});

test('creations carry every field, updates only changed quantized fields, sub-step noise sends nothing', () => {
  const s = createReplicationSchedule({schema, limits});
  const rep = createReplica({schema, limits: replicaLimits});
  s.addRecipient(1);
  s.set(7, [1, 2, 90, 1]);
  s.relevant(1, 7);
  let b = built(s, 1, 0);
  assert.equal(b.creates, 1);
  assert.deepEqual(rep.apply(b.json!).created, [7]);
  s.ack(1, b.sequence!);
  s.set(7, [1.001, 2, 91, 1]); // x moves less than half a step
  b = built(s, 1, 1);
  assert.deepEqual(JSON.parse(b.json!).u, [[7, 4, 91]]);
  assert.deepEqual(rep.apply(b.json!).updated, [7]);
  assert.equal(s.build(1, 2, 4096).status, 'idle');
  const out = new Float64Array(4);
  rep.read(7, out);
  assert.deepEqual([...out], [1, 2, 91, 1]);
});

test('a packet never exceeds the byte budget; passed-over entries gain priority and are not starved', () => {
  const s = createReplicationSchedule({schema, limits});
  s.addRecipient(1);
  for (let id = 0; id < 20; id++) {
    s.set(id, [id, id, 0, 0]);
    s.relevant(1, id, {weight: id === 0 ? 50 : 1}); // one entry is far more important
  }
  let b = built(s, 1, 0, 100000);
  s.ack(1, b.sequence!);
  const sentAt = new Map<number, number[]>();
  for (let t = 1; t <= 60; t++) {
    for (let id = 0; id < 20; id++) s.set(id, [id + t, id, 0, 0]); // everything changes every step
    b = s.build(1, t, 90); // room for about three updates
    assert.equal(b.status, 'built');
    assert.ok(b.bytes! <= 90 && b.json!.length === b.bytes);
    s.ack(1, b.sequence!);
    for (const [id] of JSON.parse(b.json!).u as number[][]) sentAt.set(id!, [...(sentAt.get(id!) ?? []), t]);
  }
  // Every entry was sent repeatedly; the heavy entry far more often; no gap longer than the fair share bound.
  for (let id = 0; id < 20; id++) assert.ok((sentAt.get(id)?.length ?? 0) >= 2, `entry ${id} starved`);
  assert.ok(sentAt.get(0)!.length > 3 * sentAt.get(5)!.length);
  for (let id = 1; id < 20; id++) {
    const times = [0, ...sentAt.get(id)!];
    const gap = Math.max(...times.slice(1).map((t, i) => t - times[i]!));
    assert.ok(gap <= 20, `entry ${id} waited ${gap} builds`);
  }
});

test('per-entry minimum interval caps update cadence but not creation or removal', () => {
  const s = createReplicationSchedule({schema, limits});
  s.addRecipient(1);
  s.set(1, [0, 0, 0, 0]);
  s.relevant(1, 1, {minInterval: 10});
  s.ack(1, built(s, 1, 0).sequence!);
  let sends = 0;
  for (let t = 1; t <= 50; t++) {
    s.set(1, [t, 0, 0, 0]);
    const b = s.build(1, t, 4096);
    if (b.status === 'built') {
      sends++;
      s.ack(1, b.sequence!);
    } else assert.equal(b.deferred, 1);
  }
  assert.equal(sends, 5);
  assert.equal(s.irrelevant(1, 1), true);
  assert.equal(built(s, 1, 51).removes, 1);
});

test('loss puts creations, removals and the lost fields back in line; in-flight is bounded', () => {
  const s = createReplicationSchedule({schema, limits: {...limits, maxInFlight: 2}});
  s.addRecipient(1);
  s.set(1, [0, 0, 0, 0]);
  s.relevant(1, 1);
  const create = built(s, 1, 0);
  assert.equal(s.lost(1, create.sequence!), true);
  assert.equal(built(s, 1, 1).creates, 1); // resent as a creation
  s.ack(1, 2);
  s.set(1, [5, 0, 0, 0]);
  const u = built(s, 1, 2);
  s.set(1, [5, 0, 7, 0]);
  const u2 = built(s, 1, 3);
  assert.deepEqual(JSON.parse(u2.json!).u, [[1, 4, 7]]);
  s.lost(1, u.sequence!);
  s.ack(1, u2.sequence!);
  assert.deepEqual(JSON.parse(built(s, 1, 4).json!).u, [[1, 1, 100500]]); // only x is resent
  s.irrelevant(1, 1);
  const rm = built(s, 1, 5);
  assert.equal(rm.expired, 0);
  s.lost(1, rm.sequence!);
  const rm2 = built(s, 1, 6);
  assert.equal(rm2.removes, 1);
  s.ack(1, rm2.sequence!);
  assert.equal(s.stats().entries, 0);
  assert.equal(s.ack(1, rm2.sequence!), false);
  // Two unacknowledged packets outstanding: the next build declares the oldest lost and requeues its creation.
  s.set(2, [0, 0, 0, 0]);
  s.set(3, [0, 0, 0, 0]);
  s.relevant(1, 1);
  const c1 = built(s, 1, 7);
  s.relevant(1, 2);
  built(s, 1, 8); // expires the earlier unacknowledged resend
  s.relevant(1, 3);
  const third = built(s, 1, 9);
  assert.equal(third.expired, 1);
  assert.equal(third.creates, 2); // entity 1 again, and entity 3
  assert.equal(s.ack(1, c1.sequence!), false);
  assert.equal(s.stats().expired, 2);
});

test('an entry larger than the budget is reported oversize, never sent partially', () => {
  const s = createReplicationSchedule({schema, limits});
  s.addRecipient(1);
  s.set(123456, [999.99, 999.99, 359, 15]);
  s.relevant(1, 123456);
  const first = s.build(1, 0, 70); // the epoch's first packet goes out even though the entry does not fit
  assert.equal(first.status, 'built');
  assert.equal(first.creates, 0);
  assert.equal(first.oversize, 1);
  s.ack(1, first.sequence!);
  const b = s.build(1, 1, 70);
  assert.equal(b.status, 'starved');
  assert.equal(b.oversize, 1);
  assert.equal(s.build(1, 2, 10).status, 'starved'); // smaller than the envelope itself
});

test('the replica ignores stale, duplicate and resurrecting packets and refuses malformed ones', () => {
  const rep = createReplica({schema, limits: {...replicaLimits, maxEntities: 2}});
  const p = (seq: number, c: number[][], u: number[][], r: number[]) =>
    JSON.stringify({v: 1, type: 'replica', epoch: 1, seq, c, u, r});
  assert.deepEqual(rep.apply(p(1, [[1, 10, 10, 1, 1]], [], [])).created, [1]);
  assert.deepEqual(rep.apply(p(3, [], [[1, 1, 30]], [])).updated, [1]);
  assert.equal(rep.apply(p(2, [], [[1, 1, 20]], [])).stale, 1); // older update for the same field
  assert.equal(rep.apply(p(3, [], [[1, 1, 30]], [])).stale, 1); // duplicate
  assert.deepEqual(rep.apply(p(5, [], [], [1])).removed, [1]);
  assert.equal(rep.apply(p(4, [[1, 0, 0, 0, 0]], [], [])).stale, 1); // delayed creation cannot resurrect
  assert.deepEqual(rep.apply(p(6, [[1, 1, 1, 1, 1]], [], [])).created, [1]); // a newer life can
  assert.deepEqual(rep.apply(p(6, [[1, 1, 1, 1, 1]], [], [])).created, []); // a duplicate is not a new id
  assert.equal(
    rep.apply(
      p(
        7,
        [
          [2, 0, 0, 0, 0],
          [3, 0, 0, 0, 0],
        ],
        [],
        [],
      ),
    ).saturated,
    1,
  );
  for (const bad of [
    '{',
    p(0, [], [], []),
    p(8, [[1, 1, 1, 1]], [], []),
    p(8, [], [[1, 0]], []),
    p(8, [], [[1, 1]], []),
    p(8, [], [[1, 32, 1]], []),
    p(8, [[1, 1, 1, 999, 1]], [], []),
    JSON.stringify({v: 1, type: 'replica', epoch: 1, seq: 8, c: [], u: [], r: [], x: 1}),
  ])
    assert.equal(rep.apply(bad).status, 'invalid', bad);
  assert.deepEqual(rep.ids(), [1, 2]);
});

test('composition: interest sets drive two recipients over a lossy, reordering link; replicas converge', () => {
  let seed = 5;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const grid = createSpatialGrid({
    cellSize: 16,
    minX: 0,
    minY: 0,
    maxX: 512,
    maxY: 512,
    maxEntries: 512,
    maxCells: 1024,
    maxCellsPerQuery: 128,
  });
  const il = {
    enterRadius: 60,
    exitRadius: 70,
    holdUpdates: 1,
    maxObservers: 4,
    maxRelevant: 40,
    maxCandidates: 256,
    maxPrioritized: 4,
  };
  const interest = createInterestSets(grid, il);
  const result = createInterestResult(il);
  const s = createReplicationSchedule({schema, limits: {...limits, maxRelevant: 48, maxInFlight: 16}});
  const pos = new Map<number, [number, number, number]>();
  for (let id = 0; id < 200; id++) {
    const p: [number, number, number] = [rand() * 512, rand() * 512, Math.floor(rand() * 360)];
    pos.set(id, p);
    grid.insert(id, p[0], p[1]);
    s.set(id, [p[0], p[1], p[2], id % 4]);
  }
  const observers = [
    {id: 1, x: 150, y: 150},
    {id: 2, x: 350, y: 300},
  ];
  const replicas = new Map(observers.map(o => [o.id, createReplica({schema, limits: replicaLimits})]));
  for (const o of observers) {
    interest.addObserver(o.id, o.x, o.y);
    s.addRecipient(o.id);
  }
  type Packet = {to: number; seq: number; json: string; arrive: number};
  let wire: Packet[] = [];
  let replicaBytes = 0;
  let completeBytes = 0;
  const step = (t: number, lossy: boolean, moving = true) => {
    for (const [id, p] of pos) {
      if (moving && id % 3 === 0) {
        p[0] = Math.min(511, Math.max(0, p[0] + (rand() - 0.5) * 4));
        p[1] = Math.min(511, Math.max(0, p[1] + (rand() - 0.5) * 4));
        grid.move(id, p[0], p[1]);
      }
      s.set(id, [p[0], p[1], p[2], id % 4]);
    }
    for (const o of observers) {
      o.x = Math.min(500, Math.max(10, o.x + (lossy ? 1 : 0)));
      interest.moveObserver(o.id, o.x, o.y);
      const r = interest.update(o.id, result);
      for (let i = 0; i < r.enteredCount; i++) s.relevant(o.id, result.entered[i]!);
      for (let i = 0; i < r.leftCount; i++) s.irrelevant(o.id, result.left[i]!);
      const b = s.build(o.id, t, 600);
      if (b.status === 'built') {
        replicaBytes += b.bytes!;
        if (!lossy || rand() > 0.2)
          wire.push({to: o.id, seq: b.sequence!, json: b.json!, arrive: t + 1 + Math.floor(rand() * (lossy ? 4 : 1))});
        if (lossy && rand() < 0.05) wire.push({to: o.id, seq: b.sequence!, json: b.json!, arrive: t + 6}); // duplicate
      }
      // A complete view of the same relevant set, for comparison.
      const view = [];
      for (let i = 0; i < r.relevantCount; i++) {
        const id = result.relevant[i]!;
        const p = pos.get(id)!;
        view.push({
          id: String(id),
          incarnation: 0,
          fields: {x: Math.round(p[0] * 100) / 100, z: Math.round(p[1] * 100) / 100, heading: p[2], state: id % 4},
        });
      }
      completeBytes += JSON.stringify({
        v: 1,
        type: 'view',
        session: 's',
        sequence: t,
        worldRevision: t,
        entities: view,
      }).length;
    }
    const due = wire.filter(p => p.arrive <= t);
    wire = wire.filter(p => p.arrive > t);
    due.sort(() => rand() - 0.5); // reorder
    for (const p of due) {
      assert.equal(replicas.get(p.to)!.apply(p.json).status, 'applied');
      s.ack(p.to, p.seq);
    }
  };
  let t = 0;
  for (; t < 300; t++) step(t, true);
  // Declare everything still unacknowledged lost, then let a clean link settle.
  for (let k = 0; k < 40; k++, t++) {
    if (k === 0) for (const o of observers) for (let seq = 1; seq < 5000; seq++) s.lost(o.id, seq);
    step(t, false, k < 30);
  }
  for (const o of observers) {
    const rep = replicas.get(o.id)!;
    const r = interest.update(o.id, result);
    const relevant = Array.from(result.relevant.subarray(0, r.relevantCount)).sort((a, b) => a - b);
    assert.deepEqual(rep.ids(), relevant, `observer ${o.id} ids`);
    const out = new Float64Array(4);
    const q = new Int32Array(4);
    for (const id of relevant) {
      rep.read(id, out);
      const p = pos.get(id)!;
      schema.quantize([p[0], p[1], p[2], id % 4], q);
      assert.deepEqual(
        [...out],
        [0, 1, 2, 3].map(f => schema.dequantize(f, q[f]!)),
        `entity ${id}`,
      );
    }
  }
  assert.ok(replicaBytes * 3 < completeBytes, `${replicaBytes} vs ${completeBytes}`);
});

test('regressions: a possibly delivered creation is always removed; updates never overtake their creation', () => {
  const s = createReplicationSchedule({schema, limits});
  const rep = createReplica({schema, limits: replicaLimits});
  s.addRecipient(1);
  s.set(7, [1, 0, 0, 0]);
  s.relevant(1, 7);
  const b = built(s, 1, 0);
  rep.apply(b.json!);
  s.lost(1, b.sequence!); // the acknowledgment was lost, the packet was not
  s.irrelevant(1, 7);
  const rm = built(s, 1, 1);
  assert.equal(rm.removes, 1);
  rep.apply(rm.json!);
  assert.deepEqual(rep.ids(), []);
  // An update is only built once the creation is acknowledged.
  s.set(8, [1, 0, 0, 0]);
  s.relevant(1, 8);
  const c = built(s, 1, 2);
  s.set(8, [5, 0, 0, 0]);
  assert.equal(s.build(1, 3, 4096).status, 'idle');
  rep.apply(c.json!);
  s.ack(1, c.sequence!);
  const u = built(s, 1, 4);
  rep.apply(u.json!);
  const out = new Float64Array(4);
  rep.read(8, out);
  assert.equal(out[0], 5);
});

test('regressions: a re-added recipient starts a new epoch; expired tombstones refuse old packets', () => {
  const s = createReplicationSchedule({schema, limits});
  const rep = createReplica({schema, limits: {...replicaLimits, maxTombstones: 1}});
  s.addRecipient(1);
  s.set(1, [5, 0, 0, 0]);
  s.relevant(1, 1);
  const old = built(s, 1, 0);
  rep.apply(old.json!);
  s.removeRecipient(1);
  s.addRecipient(1);
  s.set(1, [9, 0, 0, 0]);
  s.relevant(1, 1);
  const fresh = built(s, 1, 1);
  assert.equal(fresh.sequence, 1);
  assert.deepEqual(rep.apply(fresh.json!).created, [1]); // the old session's state was discarded
  assert.equal(rep.apply(old.json!).status, 'stale-epoch');
  const out = new Float64Array(4);
  rep.read(1, out);
  assert.equal(out[0], 9);
  const p = (seq: number, c: number[][], r: number[]) =>
    JSON.stringify({v: 1, type: 'replica', epoch: 2, seq, c, u: [], r});
  rep.apply(p(5, [], [1]));
  rep.apply(p(6, [[2, 0, 0, 0, 0]], []));
  rep.apply(p(7, [], [2])); // evicts the tombstone for id 1 (seq 5)
  assert.equal(rep.apply(p(4, [[1, 0, 0, 0, 0]], [])).status, 'expired');
  assert.deepEqual(rep.ids(), []);
});

test('the top of a range stays reachable; minimum-interval waits report held, not starved', () => {
  const tenth = defineFieldSchema([{name: 'v', min: 0, max: 0.3, step: 0.1}]);
  const q = new Int32Array(1);
  tenth.quantize([0.3], q);
  assert.equal(tenth.dequantize(0, q[0]!), 0.3);
  const s = createReplicationSchedule({schema, limits});
  s.addRecipient(1);
  s.set(1, [0, 0, 0, 0]);
  s.relevant(1, 1, {minInterval: 100});
  s.ack(1, built(s, 1, 0).sequence!);
  s.set(1, [1, 0, 0, 0]);
  assert.equal(s.build(1, 1, 1_000_000).status, 'held');
});

test('S-REPL convergence: randomized operations, loss, duplication, reordering and late delivery converge', () => {
  const small = defineFieldSchema([
    {name: 'a', min: 0, max: 10, step: 1},
    {name: 'b', min: -5, max: 5, step: 0.5},
    {name: 'c', min: 0, max: 3, step: 1},
  ]);
  for (let seed = 1; seed <= 40; seed++) {
    let x = seed;
    const rand = () => {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      return x / 4294967296;
    };
    const ri = (n: number) => Math.floor(rand() * n);
    const s = createReplicationSchedule({
      schema: small,
      limits: {maxEntities: 64, maxRecipients: 4, maxRelevant: 64, maxInFlight: 3, maxItems: 64},
    });
    const reps = new Map<number, ReturnType<typeof createReplica>>();
    const wants = new Map<number, Set<number>>();
    const auth = new Map<number, number[]>();
    const pending = new Map<number, Set<number>>();
    let wire: {to: number; seq: number; json: string}[] = [];
    const add = (r: number) => {
      s.addRecipient(r);
      if (!reps.has(r) || rand() < 0.5)
        reps.set(
          r,
          createReplica({
            schema: small,
            limits: {maxEntities: 64, maxTombstones: 8, maxBytes: 1 << 20, maxNodes: 1 << 20},
          }),
        );
      wants.set(r, new Set());
      pending.set(r, new Set());
    };
    for (const r of [1, 2, 3]) add(r);
    const deliver = (p: {to: number; seq: number; json: string}, ack: boolean) => {
      const a = reps.get(p.to)!.apply(p.json);
      assert.notEqual(a.status, 'invalid');
      if (ack && a.status === 'applied' && s.ack(p.to, p.seq)) pending.get(p.to)!.delete(p.seq);
    };
    let now = 0;
    for (let i = 0; i < 1500; i++) {
      const id = ri(8),
        r = 1 + ri(3);
      switch (ri(12)) {
        case 0:
        case 1: {
          const v = [rand() * 12 - 1, rand() * 12 - 6, ri(4)];
          s.set(id, v);
          auth.set(id, v);
          break;
        }
        case 2:
          if (s.delete(id)) {
            auth.delete(id);
            for (const w of wants.values()) w.delete(id);
          }
          break;
        case 3: {
          const res = s.relevant(r, id, {weight: 1 + ri(3), minInterval: ri(3)});
          if (res === 'tracked' || res === 'updated') wants.get(r)!.add(id);
          break;
        }
        case 4:
          s.irrelevant(r, id);
          wants.get(r)!.delete(id);
          break;
        case 5:
        case 6: {
          now += ri(3);
          const b = s.build(r, now, 20 + ri(200));
          if (b.status === 'built') {
            assert.ok(b.bytes === b.json!.length && b.bytes! <= 220);
            wire.push({to: r, seq: b.sequence!, json: b.json!});
            pending.get(r)!.add(b.sequence!);
          }
          break;
        }
        case 7:
        case 8: {
          if (!wire.length) break;
          const k = ri(wire.length);
          const p = wire[k]!;
          if (rand() < 0.8) wire.splice(k, 1); // otherwise it may be delivered again
          deliver(p, rand() < 0.9);
          break;
        }
        case 9: {
          const o = [...pending.get(r)!];
          if (o.length) {
            const q = o[ri(o.length)]!;
            s.lost(r, q); // the packet itself may still arrive late
            pending.get(r)!.delete(q);
          }
          break;
        }
        case 10:
          if (rand() < 0.05) {
            s.removeRecipient(r);
            wire = wire.filter(p => p.to !== r || rand() < 0.3); // some old-session packets stay in flight
            add(r);
          }
          break;
        default:
          break;
      }
    }
    for (const r of [1, 2, 3]) {
      for (const q of pending.get(r)!) s.lost(r, q);
      pending.get(r)!.clear();
    }
    for (let k = 0; k < 500; k++) {
      now++;
      if (wire.length) deliver(wire.pop()!, false);
      let busy = !!wire.length;
      for (const r of [1, 2, 3]) {
        const b = s.build(r, now, 100000);
        if (b.status !== 'idle') busy = true;
        if (b.status === 'built') deliver({to: r, seq: b.sequence!, json: b.json!}, true);
      }
      if (!busy) break;
    }
    const q = new Int32Array(3),
      out = new Float64Array(3);
    for (const r of [1, 2, 3]) {
      const rep = reps.get(r)!;
      const want = [...wants.get(r)!].sort((a, b) => a - b);
      assert.deepEqual(rep.ids(), want, `seed ${seed} recipient ${r}`);
      for (const id of want) {
        rep.read(id, out);
        small.quantize(auth.get(id)!, q);
        assert.deepEqual(
          [...out],
          [0, 1, 2].map(f => small.dequantize(f, q[f]!)),
          `seed ${seed} id ${id}`,
        );
      }
    }
  }
});
