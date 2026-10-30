/**
 * tools/dmath-bench/workload.ts: the two workloads the deterministic-math evidence runs in Node and in Chromium.
 *   characterRun(math)  a seeded movement simulation through the character kit's pure modules (motion, facing,
 *                       collision with rotated boxes and polygons, camera-relative yaw) and authored root motion;
 *                       returns a digest of every tick's state as hex bits.
 *   timings(now)        nanoseconds per call of each function, dmath against the engine's Math.
 * Pure: no DOM, no Node APIs. Inputs come from a 32-bit LCG, so they are identical in every engine.
 */
import {dmath, platformMath, type ScalarMath} from '../../src/core/dmath';
import {toHex} from '../../src/core/dmath-vectors';
import {createMotion, followHeading, turnToward} from '../../src/kits/character/motion';
import {slide, type Area} from '../../src/kits/character/collide';
import {createRootMotion} from '../../src/kits/animation/root-motion';

const lcg = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/** FNV-1a over the hex of each sampled double: equal digests mean every sample was bit-identical. */
function digester() {
  let h = 0x811c9dc5;
  return {
    add(x: number) {
      const s = toHex(x);
      for (let i = 0; i < 16; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    },
    get value() {
      return h.toString(16).padStart(8, '0');
    },
  };
}

export interface CharacterRunResult {
  ticks: number;
  digest: string;
  final: string[];
}

export function characterRun(math: ScalarMath, ticks = 3000): CharacterRunResult {
  const mode = math === dmath ? 'deterministic' : 'platform';
  const r = lcg(77),
    d = digester(),
    dt = 1 / 60;
  const area: Area = {
    minX: -12,
    maxX: 12,
    minZ: -12,
    maxZ: 12,
    body: 0.35,
    math,
    solids: [
      {id: 'a', kind: 'box', x: 3, z: 2, halfX: 1, halfZ: 0.5, rotation: 0.7},
      {id: 'b', kind: 'polygon', x: -4, z: -3, inradius: 1.2, sides: 6, rotation: 0.3},
      {id: 'c', kind: 'circle', x: 0, z: 6, r: 1.5},
    ],
  };
  const motion = createMotion({speed: 4, math});
  const root = createRootMotion(
    {
      duration: 1,
      keys: [
        {at: 0, x: 0, z: 0, yaw: 0},
        {at: 0.5, x: 0.4, z: 0.1, yaw: 0.3},
        {at: 1, x: 1, z: 0, yaw: 0.6},
      ],
    },
    true,
    {math: mode},
  );
  let x = 0,
    z = 0,
    heading = 0,
    camYaw = 0,
    ix = 0,
    iz = 0,
    cam = {x: 0, z: 8};
  for (let t = 0; t < ticks; t++) {
    if (t % 45 === 0) {
      ix = Math.round(r() * 2 - 1);
      iz = Math.round(r() * 2 - 1);
      cam = {x: (r() - 0.5) * 20, z: (r() - 0.5) * 20};
    }
    const yaw = math.atan2(-cam.x + x, -(-cam.z + z)),
      cy = math.cos(yaw),
      sy = math.sin(yaw);
    const want = motion.step({x: ix * cy - iz * sy, z: ix * sy + iz * cy}, dt);
    const next = slide(area, {x, z}, want),
      moved = {x: next.x - x, z: next.z - z};
    motion.moved(want, moved, dt);
    x = next.x;
    z = next.z;
    heading = turnToward(heading, moved.x, moved.z, dt, undefined, math);
    camYaw = followHeading(camYaw, heading, dt, 6, math);
    const rm = root.advance(t * dt);
    for (const v of [
      x,
      z,
      heading,
      camYaw,
      motion.velocity.x,
      motion.velocity.z,
      rm.x,
      rm.z,
      rm.yaw,
      math.exp(-t * dt),
      math.log(1 + t),
      math.pow(1 + t * dt, 0.37),
    ])
      d.add(v);
  }
  return {ticks, digest: d.value, final: [x, z, heading, camYaw].map(toHex)};
}

export type Timing = {fn: string; dmathNs: number; mathNs: number; ratio: number};

/** ns per call over `n` calls after a warm-up, for each function; `now` is a millisecond clock. */
export function timings(now: () => number, n = 400000): Timing[] {
  const r = lcg(5),
    a = new Float64Array(n),
    b = new Float64Array(n);
  const cases: [keyof ScalarMath, (i: number) => void][] = [
    [
      'sin',
      i => {
        a[i] = (r() - 0.5) * 200;
      },
    ],
    [
      'cos',
      i => {
        a[i] = (r() - 0.5) * 200;
      },
    ],
    [
      'atan2',
      i => {
        a[i] = r() * 100 - 50;
        b[i] = r() * 100 - 50;
      },
    ],
    [
      'exp',
      i => {
        a[i] = r() * 100 - 50;
      },
    ],
    [
      'log',
      i => {
        a[i] = r() * 1000;
      },
    ],
    [
      'pow',
      i => {
        a[i] = r() * 50;
        b[i] = r() * 8 - 4;
      },
    ],
    [
      'hypot',
      i => {
        a[i] = r() * 2000 - 1000;
        b[i] = r() * 2000 - 1000;
      },
    ],
    [
      'sqrt',
      i => {
        a[i] = r() * 1000;
      },
    ],
  ];
  const out: Timing[] = [];
  let sink = 0;
  const time = (f: (x: number, y: number) => number) => {
    for (let i = 0; i < 20000; i++) sink += f(a[i]!, b[i]!);
    const t0 = now();
    for (let i = 0; i < n; i++) sink += f(a[i]!, b[i]!);
    return ((now() - t0) * 1e6) / n;
  };
  for (const [fn, fill] of cases) {
    for (let i = 0; i < n; i++) fill(i);
    const d = dmath[fn] as (x: number, y: number) => number,
      m = platformMath[fn] as (x: number, y: number) => number;
    // Alternate three rounds and keep each side's best, to damp JIT and scheduling noise.
    let dn = Infinity,
      mn = Infinity;
    for (let k = 0; k < 3; k++) {
      mn = Math.min(mn, time(m));
      dn = Math.min(dn, time(d));
    }
    out.push({fn, dmathNs: +dn.toFixed(2), mathNs: +mn.toFixed(2), ratio: +(dn / mn).toFixed(2)});
  }
  if (sink === 42) out.push({fn: 'sink', dmathNs: 0, mathNs: 0, ratio: 0});
  return out;
}
