import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepper, EventWorkspace, integrate, integrateFixed, integrateAdaptive, stepWithEvents, illinois, type OdeEvent, type Rhs } from './ode';

const oscillator: Rhs = (_t, y, d) => { d[0] = y[1]; d[1] = -y[0]; };
const twoBody = (mu: number): Rhs => (_t, s, d) => {
  const r2 = s[0] * s[0] + s[1] * s[1] + s[2] * s[2], k = -mu / (r2 * Math.sqrt(r2));
  d[0] = s[3]; d[1] = s[4]; d[2] = s[5]; d[3] = k * s[0]; d[4] = k * s[1]; d[5] = k * s[2];
};
const dist3 = (y: Float64Array, r: readonly number[]) => Math.sqrt((y[0] - r[0]) ** 2 + (y[1] - r[1]) ** 2 + (y[2] - r[2]) ** 2);

test('RK4 is 4th order: halving the step divides the error by ~16', () => {
  const err = (h: number) => { const y = new Float64Array([1, 0]); integrateFixed(new FixedStepper(2, oscillator, 'rk4'), 0, y, 10, h); return Math.abs(y[0] - Math.cos(10)); };
  const ratio = err(0.1) / err(0.05);
  assert.ok(ratio > 14 && ratio < 18, `ratio ${ratio}`);
});

test('symplectic Euler is bit-identical to the plain game-loop update (v += a·dt; x += v·dt)', () => {
  const g: Rhs = (_t, y, d) => { const r = Math.sqrt(y[0] * y[0] + y[1] * y[1]), r3 = r * r * r; d[0] = y[2]; d[1] = y[3]; d[2] = -y[0] / r3; d[3] = -y[1] / r3; };
  const s = new FixedStepper(4, g, 'symplectic-euler', 2), y = new Float64Array([1, 0, 0, 1.1]);
  let x = 1, yy = 0, vx = 0, vy = 1.1;
  for (let i = 0; i < 5000; i++) {
    s.step(i * 0.01, y, 0.01, y);
    const r = Math.sqrt(x * x + yy * yy), r3 = r * r * r, ax = -x / r3, ay = -yy / r3;
    vx += ax * 0.01; vy += ay * 0.01; x += vx * 0.01; yy += vy * 0.01;
  }
  assert.deepEqual([...y], [x, yy, vx, vy]);
  assert.throws(() => new FixedStepper(4, g, 'symplectic-euler'), /half/);
});

test('fixed-step events: a dropped ball hits the ground at sqrt(2h/g); direction filters work; non-terminal events report', () => {
  const g = 1.62, h0 = 100;
  const rhs: Rhs = (_t, y, d) => { d[0] = y[1]; d[1] = -g; };
  const ground: OdeEvent = { id: 'ground', g: (_t, y) => y[0], direction: -1, terminal: true };
  const rising: OdeEvent = { id: 'rising-through-50', g: (_t, y) => y[0] - 50, direction: 1, terminal: true };
  const half: OdeEvent = { id: 'half', g: (_t, y) => y[0] - 50, direction: -1, terminal: false };
  const y = new Float64Array([h0, 0]);
  const r = integrate(rhs, 0, y, 60, { method: 'rk4', h: 0.25, events: [rising, half, ground] });
  assert.equal(r.stoppedBy, 'ground');
  assert.ok(Math.abs(r.t - Math.sqrt((2 * h0) / g)) < 1e-9, `impact t ${r.t}`);
  assert.ok(Math.abs(y[0]) < 1e-9);
  assert.equal(r.hits.length, 2);
  assert.equal(r.hits[0].id, 'half');
  assert.ok(Math.abs(r.hits[0].t - Math.sqrt((2 * 50) / g)) < 1e-9, 'non-terminal half-height event');
});

test('fixed-step integration lands exactly on t1 and rejects backward spans', () => {
  const y = new Float64Array([1, 0]);
  const r = integrateFixed(new FixedStepper(2, oscillator), 0, y, 1, 0.3);
  assert.equal(r.t, 1);
  assert.equal(r.steps, 4);
  assert.ok(Math.abs(y[0] - Math.cos(1)) < 1e-4);
  assert.throws(() => integrateFixed(new FixedStepper(2, oscillator), 1, y, 0, 0.1));
});

test('stepWithEvents: the first of two crossings in one step wins, and a resumed run does not re-fire it', () => {
  const rhs: Rhs = (_t, y, d) => { d[0] = 1; };
  const a: OdeEvent = { id: 'at-0.7', g: (_t, y) => y[0] - 0.7, direction: 0, terminal: true };
  const b: OdeEvent = { id: 'at-0.3', g: (_t, y) => y[0] - 0.3, direction: 0, terminal: true };
  const s = new FixedStepper(1, rhs), ws = new EventWorkspace(1, 2), y = new Float64Array([0]);
  assert.equal(stepWithEvents(s, ws, 0, y, 1, [a, b], 1e-12), 'at-0.3');
  assert.ok(Math.abs(ws.hitT - 0.3) < 1e-12 && Math.abs(y[0] - 0.3) < 1e-12);
  assert.equal(stepWithEvents(s, ws, ws.hitT, y, 1, [a, b], 1e-12), 'at-0.7');
  assert.ok(Math.abs(ws.hitT - 0.7) < 1e-12);
});

test('illinois converges on a smooth root', () => {
  const root = illinois(x => Math.cos(x) - x, 1, 1, Math.cos(1) - 1, 1e-14);
  assert.ok(Math.abs(root - 0.7390851332151607) < 1e-12);
});

test('DP5 adaptive: 3/4 of a circular orbit lands on the analytic point; a rising r·v event finds periapsis passage', () => {
  const mu = 4.9e12, R = 1_837_400, vc = Math.sqrt(mu / R), P = 2 * Math.PI * Math.sqrt(R ** 3 / mu);
  const rhs = twoBody(mu);
  const y = new Float64Array([R, 0, 0, 0, vc, 0]);
  const res = integrateAdaptive(rhs, 0, y, P * 0.75, { rtol: 1e-11, atol: 1e-4 });
  assert.ok(dist3(y, [0, -R, 0]) < 1e-2, 'within 1 cm after 3/4 orbit');
  assert.ok(res.steps < 400, `steps ${res.steps}`);
  assert.equal(res.t, P * 0.75);
  // Start at apoapsis (slower than circular): periapsis passages are at P/2 + kP.
  const va = 1500, a = 1 / (2 / R - va * va / mu), e = R / a - 1, Pe = 2 * Math.PI * Math.sqrt(a ** 3 / mu), rp = a * (1 - e);
  const y2 = new Float64Array([R, 0, 0, 0, va, 0]);
  const peri: OdeEvent = { id: 'periapsis', g: (_t, st) => st[0] * st[3] + st[1] * st[4] + st[2] * st[5], direction: 1, terminal: true };
  const r2 = integrate(rhs, 0, y2, 2 * Pe, { rtol: 1e-11, atol: 1e-4, events: [peri] });
  assert.equal(r2.stoppedBy, 'periapsis');
  assert.ok(Math.abs(r2.t - 0.5 * Pe) < 1e-3, `periapsis at ${r2.t} vs ${0.5 * Pe}`);
  assert.ok(Math.abs(Math.sqrt(y2[0] ** 2 + y2[1] ** 2 + y2[2] ** 2) - rp) < 1e-3, 'radius at the event is the periapsis radius');
});

test('DP5 error control: tighter tolerance gives a smaller error; onStep sees monotone time', () => {
  const run = (rtol: number) => { const y = new Float64Array([1, 0]); const r = integrateAdaptive(oscillator, 0, y, 20, { rtol, atol: rtol }); return { err: Math.abs(y[0] - Math.cos(20)), steps: r.steps }; };
  const loose = run(1e-6), tight = run(1e-11);
  assert.ok(tight.err < loose.err && tight.err < 1e-9, `${tight.err} vs ${loose.err}`);
  assert.ok(tight.steps > loose.steps);
  let last = -1, count = 0;
  integrateAdaptive(oscillator, 0, new Float64Array([1, 0]), 5, { onStep: t => { assert.ok(t > last); last = t; count++; } });
  assert.equal(last, 5);
  assert.ok(count > 3);
});

test('integrate() defaults to DP5 and supports symplectic Euler through the same entry point', () => {
  const y = new Float64Array([1, 0]);
  const r = integrate(oscillator, 0, y, Math.PI);
  assert.ok(Math.abs(y[0] + 1) < 1e-8 && r.t === Math.PI);
  const ys = new Float64Array([1, 0]);
  integrate(oscillator, 0, ys, 100, { method: 'symplectic-euler', h: 0.01, half: 1 });
  const energy = ys[0] * ys[0] + ys[1] * ys[1];
  assert.ok(Math.abs(energy - 1) < 0.02, `symplectic energy stays bounded ${energy}`);
});
