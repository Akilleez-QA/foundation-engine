import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadoutHud, type HudReadout } from './readout-hud';
import type { FormatText } from './format';

/** An element that counts its text writes. */
function el(initial = '') {
  let t = initial, writes = 0;
  return { get textContent() { return t; }, set textContent(v: string) { t = v; writes++; }, writes: () => writes } as unknown as Element & { writes(): number };
}
const text: FormatText = (key, vars) => key.replace('{value}', String(vars.value ?? ''));
type Ctx = { h: number; v: number };

function setup() {
  let computes = 0, contexts = 0;
  const row = (id: string, pick: (c: Ctx) => number, unit: string, key: string): HudReadout<Ctx> =>
    ({ id, unit, format: { standard: key, detailed: key }, compute: c => { computes++; return pick(c); } });
  const height = row('trip.height', c => c.h, 'length.km', 'Height {value}'), speed = row('trip.speed', c => c.v, 'speed.km-s-2', '{value}');
  const line = el(), fast = el();
  let lineTarget: Element = line, level: 'standard' | 'detailed' = 'detailed';
  const hud = createReadoutHud<Ctx>([
    { target: () => lineTarget, rows: [height, speed] },
    { target: () => fast, rows: [speed] },
  ], { text, level: () => level });
  const frame = (c: Ctx) => hud.update([c.h, c.v], () => { contexts++; return c; });
  return { hud, frame, line, fast, counts: () => ({ computes, contexts }), setTarget: (e: Element) => { lineTarget = e; }, setLevel: (l: typeof level) => { level = l; } };
}

test('the first frame computes once and writes every element', () => {
  const s = setup();
  assert.equal(s.frame({ h: 400_000, v: 7_670 }), 2);
  assert.equal(s.line.textContent, 'Height 400 km · 7.67 km/s');
  assert.equal(s.fast.textContent, '7.67 km/s');
  assert.deepEqual(s.counts(), { computes: 3, contexts: 1 });
});

test('an unchanged frame computes nothing and writes 0 nodes', () => {
  const s = setup();
  s.frame({ h: 400_000, v: 7_670 });
  const before = s.counts();
  for (let i = 0; i < 100; i++) assert.equal(s.frame({ h: 400_000, v: 7_670 }), 0);
  assert.deepEqual(s.counts(), before, 'no context built, no row computed');
  assert.equal(s.line.writes() + s.fast.writes(), 2, 'only the first frame wrote');
});

test('a changed value writes only the elements whose text changed', () => {
  const s = setup();
  s.frame({ h: 400_000, v: 7_670 });
  assert.equal(s.frame({ h: 400_200, v: 7_670 }), 0, 'recomputed, but 400.2 km still reads 400 km');
  assert.equal(s.frame({ h: 401_000, v: 7_670 }), 1, 'the height line changes; the speed element does not');
  assert.equal(s.fast.writes(), 1);
  assert.equal(s.frame({ h: 401_000, v: 7_700 }), 2);
});

test('a rebuilt element gets its text on the next frame; a level change recomputes', () => {
  const s = setup();
  s.frame({ h: 400_000, v: 7_670 });
  const fresh = el();
  s.setTarget(fresh);
  assert.equal(s.frame({ h: 400_000, v: 7_670 }), 1);
  assert.equal(fresh.textContent, 'Height 400 km · 7.67 km/s');
  assert.equal(s.frame({ h: 400_000, v: 7_670 }), 0);
  const { contexts } = s.counts();
  s.setLevel('standard');
  s.frame({ h: 400_000, v: 7_670 });
  assert.equal(s.counts().contexts, contexts + 1);
});

test('reset forgets the shown text, so the next frame compares the page again', () => {
  const s = setup();
  s.frame({ h: 400_000, v: 7_670 });
  (s.fast as { textContent: string }).textContent = 'someone else';
  assert.equal(s.frame({ h: 400_000, v: 7_670 }), 0, 'unchanged frames do not read the page');
  s.hud.reset();
  assert.equal(s.frame({ h: 400_000, v: 7_670 }), 1);
  assert.equal(s.fast.textContent, '7.67 km/s');
});
