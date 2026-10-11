import test from 'node:test';
import assert from 'node:assert/strict';
import {createContactLayer, type ContactSnapshot, type ContactShape, type ContactEvent} from './contact';
import {createContactIndex} from './contact-index';

type SavedBody = ContactSnapshot['bodies'][number];
const span = (b: SavedBody, axis: number): [number, number] => {
  const s = b.shape,
    at = b.position[axis]!;
  if (s.kind === 'box') return [at - s.halfExtents[axis]!, at + s.halfExtents[axis]!];
  if (s.kind === 'cylinder' && axis === 1) return [at, at + s.height];
  return [at - s.radius, at + s.radius];
};
const gap = (point: number, range: readonly number[]) => Math.max(range[0]! - point, point - range[1]!, 0);
// Small independent materialize-all oracle. Not the production index or geometry helpers.
function intersects(a: SavedBody, b: SavedBody): boolean {
  if (a.shape.kind > b.shape.kind) return intersects(b, a);
  const x = b.position[0] - a.position[0],
    y = b.position[1] - a.position[1],
    z = b.position[2] - a.position[2];
  if (a.shape.kind === 'box') {
    if (b.shape.kind === 'box')
      return [0, 1, 2].every(
        k =>
          Math.abs(a.position[k]! - b.position[k]!) <
          (a.shape as Extract<ContactShape, {kind: 'box'}>).halfExtents[k]! +
            (b.shape as Extract<ContactShape, {kind: 'box'}>).halfExtents[k]!,
      );
    const dx = gap(b.position[0], span(a, 0)),
      dz = gap(b.position[2], span(a, 2));
    if (b.shape.kind === 'cylinder') {
      const ay = span(a, 1),
        by = span(b, 1);
      return by[0] < ay[1] && by[1] > ay[0] && dx * dx + dz * dz < b.shape.radius ** 2;
    }
    return dx * dx + gap(b.position[1], span(a, 1)) ** 2 + dz * dz < b.shape.radius ** 2;
  }
  if (a.shape.kind === 'cylinder' && b.shape.kind === 'sphere')
    return (
      Math.max(0, Math.hypot(x, z) - a.shape.radius) ** 2 + gap(b.position[1], span(a, 1)) ** 2 < b.shape.radius ** 2
    );
  if (a.shape.kind === 'cylinder' && b.shape.kind === 'cylinder') {
    const ay = span(a, 1),
      by = span(b, 1);
    return ay[0] < by[1] && by[0] < ay[1] && x * x + z * z < (a.shape.radius + b.shape.radius) ** 2;
  }
  return x * x + y * y + z * z < (a.shape.radius + (b.shape as {radius: number}).radius) ** 2;
}
const key = (p: ContactSnapshot['pairs'][number]) => [p.a, p.ai, p.b, p.bi].join(':');
const order = (a: {a: number; b: number}, b: {a: number; b: number}) => a.a - b.a || a.b - b.b;
function oracle(s: ContactSnapshot, maxPairs: number, degree: number) {
  const bodies = [...s.bodies].filter(b => b.enabled).sort((a, b) => a.id - b.id);
  const candidates: ContactSnapshot['pairs'][number][] = [];
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!,
        b = bodies[j]!,
        ax = span(a, 0),
        bx = span(b, 0);
      // The existing sweep orders tied minima by id (including rounded-away extents).
      if (!(ax[0] <= bx[0] ? bx[0] < ax[1] : ax[0] < bx[1])) continue;
      const aSenses = (a.mask & b.layer) !== 0,
        bSenses = (b.mask & a.layer) !== 0;
      if ((aSenses || bSenses) && intersects(a, b))
        candidates.push({a: a.id, b: b.id, ai: a.incarnation, bi: b.incarnation, aSenses, bSenses});
    }
  const old = new Set(s.pairs.map(key)),
    counts = new Map<number, number>(),
    next: typeof candidates = [];
  const ranked = [...candidates.filter(p => old.has(key(p))), ...candidates.filter(p => !old.has(key(p)))];
  for (const p of ranked) {
    if (next.length === maxPairs || (counts.get(p.a) ?? 0) === degree || (counts.get(p.b) ?? 0) === degree) continue;
    next.push(p);
    counts.set(p.a, (counts.get(p.a) ?? 0) + 1);
    counts.set(p.b, (counts.get(p.b) ?? 0) + 1);
  }
  const retained = new Set(next.map(key));
  const exits: ContactEvent[] = s.pairs
    .filter(p => !retained.has(key(p)))
    .map(p => {
      const a = bodies.find(b => b.id === p.a),
        b = bodies.find(b => b.id === p.b);
      return {
        kind: 'exit',
        a: p.a,
        b: p.b,
        aSenses: p.aSenses,
        bSenses: p.bSenses,
        removed: !a || !b || a.incarnation !== p.ai || b.incarnation !== p.bi,
      };
    });
  const events = next.map(p => ({
    kind: old.has(key(p)) ? ('stay' as const) : ('enter' as const),
    a: p.a,
    b: p.b,
    aSenses: p.aSenses,
    bSenses: p.bSenses,
  }));
  return {
    result: {
      events: [
        ...exits.sort(order),
        ...events.filter(e => e.kind === 'enter').sort(order),
        ...events.filter(e => e.kind === 'stay').sort(order),
      ],
      refused: candidates.length - next.length,
      pairs: next.length,
    },
    pairs: next.sort(order),
  };
}
const sphere = {kind: 'sphere', radius: 1} as const;
const check = (layer: ReturnType<typeof createContactLayer>, pairs: number, degree: number) => {
  const before = layer.snapshot(),
    expected = oracle(before, pairs, degree);
  assert.deepEqual(layer.update(), expected.result);
  assert.deepEqual(layer.snapshot(), {...before, pairs: expected.pairs});
};

test('every five-body sensing graph matches bounded greedy admission and replay', () => {
  for (let graph = 0; graph < 1024; graph++)
    for (const degree of [1, 2, 4]) {
      const layer = createContactLayer({maxBodies: 5, maxPairs: 3, maxPerBody: degree});
      const masks = [0, 0, 0, 0, 0];
      let bit = 0;
      for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++, bit++) if (graph & (1 << bit)) masks[a]! |= 1 << b;
      for (const id of [4, 1, 3, 0, 2])
        layer.set(id, {shape: sphere, position: [0, 0, 0], layer: 1 << id, mask: masks[id]!});
      check(layer, 3, degree);
      check(layer, 3, degree);
    }
});

test('mixed-shape histories preserve continuing priority, stale identities and sensing', () => {
  let seed = 37;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const shapes: ContactShape[] = [
    sphere,
    {kind: 'cylinder', radius: 1, height: 2},
    {kind: 'box', halfExtents: [1, 1, 1]},
  ];
  for (const pairs of [1, 3, 12])
    for (const degree of [1, 2, 7]) {
      const layer = createContactLayer({maxBodies: 8, maxPairs: pairs, maxPerBody: degree});
      for (let step = 0; step < 160; step++) {
        const id = random(8);
        if (step % 7 === 0) layer.remove(id);
        else
          layer.set(id, {
            shape: shapes[random(3)]!,
            position: [random(9) / 2 - 2, random(7) / 2 - 1, random(7) / 2 - 1],
            layer: 1 << random(3),
            mask: random(8),
            enabled: random(5) !== 0,
          });
        // Restore before update, including snapshots with removed, disabled or replaced bodies.
        const copy = createContactLayer({maxBodies: 8, maxPairs: pairs, maxPerBody: degree});
        copy.restore(JSON.parse(JSON.stringify(layer.snapshot())));
        check(layer, pairs, degree);
        check(copy, pairs, degree);
        assert.deepEqual(copy.snapshot(), layer.snapshot());
      }
    }
});

test('a continuing high-id pair survives lower-id newcomers and id reuse becomes enter', () => {
  const layer = createContactLayer({maxBodies: 4, maxPairs: 1, maxPerBody: 1});
  for (const id of [8, 9]) layer.set(id, {shape: sphere, position: [0, 0, 0], layer: 1, mask: 1});
  check(layer, 1, 1);
  for (const id of [0, 1]) layer.set(id, {shape: sphere, position: [0, 0, 0], layer: 1, mask: 1});
  check(layer, 1, 1);
  assert.deepEqual(layer.touching(8), [9]);
  layer.remove(9);
  layer.set(9, {shape: sphere, position: [0, 0, 0], layer: 1, mask: 1});
  const restored = createContactLayer({maxBodies: 4, maxPairs: 1, maxPerBody: 1});
  restored.restore(JSON.parse(JSON.stringify(layer.snapshot())));
  check(restored, 1, 1);
  check(layer, 1, 1);
  assert.deepEqual(restored.snapshot(), layer.snapshot());
  assert.deepEqual(layer.touching(0), [1]);
});

test('dense scratch is one body row; sparse index prunes even with shuffled ids', () => {
  for (const n of [16, 32, 64]) {
    const dense = Array.from({length: n}, (_, id) => ({id, minX: -1, maxX: 1}));
    const index = createContactIndex(dense),
      row: typeof dense = [];
    let count = 0,
      peak = 0;
    for (const body of dense) {
      index.row(body, row);
      count += row.length;
      peak = Math.max(peak, row.length);
    }
    assert.equal(count, (n * (n - 1)) / 2);
    assert.equal(peak, n - 1);
    assert.equal(index.slots, 2 * n);
    const layer = createContactLayer({maxBodies: n, maxPairs: 1, maxPerBody: 1});
    for (const b of dense) layer.set(b.id, {shape: sphere, position: [0, 0, 0], layer: 1, mask: 1});
    assert.equal(layer.update().refused, count - 1);
  }
  const n = 1024,
    sparse = Array.from({length: n}, (_, i) => ({id: (i * 73) % n, minX: i * 4, maxX: i * 4 + 1}));
  const index = createContactIndex(sparse),
    row: typeof sparse = [];
  let visits = 0;
  for (const b of sparse) {
    visits += index.row(b, row);
    assert.equal(row.length, 0);
  }
  assert.ok(visits <= n * 25, `logical tree visits ${visits}, not a wall-time assertion`);
});

test('rounded extents retain the previous sweep tie semantics', () => {
  const layer = createContactLayer({maxBodies: 3, maxPairs: 3});
  const box = (half: number): ContactShape => ({kind: 'box', halfExtents: [half, 1, 1]});
  const ulp = 2 ** -23;
  layer.set(0, {shape: box(ulp * 0.75), position: [1e9, 0, 0], layer: 1, mask: 1});
  layer.set(1, {shape: box(ulp * 0.49), position: [1e9 - ulp, 0, 0], layer: 1, mask: 1});
  check(layer, 3, 1024);
  assert.equal(layer.snapshot().pairs.length, 1, 'the sweep accepts this tied-minimum degenerate interval');
  layer.set(0, {shape: box(ulp * 0.49), position: [1e9 - ulp, 0, 0], layer: 1, mask: 1});
  check(layer, 3, 1024);
  assert.equal(layer.snapshot().pairs.length, 0);
});

test('failed input capture leaves published state intact and update recovers', () => {
  const layer = createContactLayer({maxBodies: 2, maxPairs: 1});
  for (const id of [0, 1]) layer.set(id, {shape: sphere, position: [0, 0, 0], layer: 1, mask: 1});
  layer.update();
  const before = layer.snapshot();
  assert.throws(
    () =>
      layer.set(0, {
        shape: sphere,
        get position() {
          layer.update();
          return [0, 0, 0] as const;
        },
        layer: 1,
        mask: 1,
      }),
    /reentrant/,
  );
  assert.deepEqual(layer.snapshot(), before);
  check(layer, 1, 1024);
});

test('unequal intervals match an independent sweep and stacked x does not imply contact', () => {
  const intervals = Array.from({length: 32}, (_, i) => ({
    id: (i * 13) % 32,
    minX: i - (i % 7 === 0 ? 100 : 0.25),
    maxX: i + (i % 11 === 0 ? 100 : 0.25),
  }));
  const index = createContactIndex(intervals),
    row: typeof intervals = [];
  for (const a of intervals) {
    index.row(a, row);
    const expected = intervals
      .filter(b => b.id > a.id && (a.minX <= b.minX ? b.minX < a.maxX : a.minX < b.maxX))
      .sort((a, b) => a.id - b.id);
    assert.deepEqual(row, expected);
  }
  const layer = createContactLayer({maxBodies: 32, maxPairs: 1});
  for (let id = 0; id < 32; id++) layer.set(id, {shape: sphere, position: [0, id * 4, 0], layer: 1, mask: 1});
  assert.deepEqual(layer.update(), {events: [], refused: 0, pairs: 0});
});
