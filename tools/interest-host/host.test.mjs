// SC-02 reference composition: interest sets drive NW-02 complete scoped views, checked by real view receivers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewReceiver } from '../../src/kits/network/index.ts';
import { createInterestHost, demoConfig } from './host.mjs';

function client(host, session, x, y, self) {
  const receiver = createViewReceiver({ session, limits: demoConfig.view }), sent = [];
  const c = host.connect(session, x, y, json => { sent.push(json); assert.equal(receiver.receive(json).status, 'accepted'); return true; }, self);
  assert.equal(c.status, 'connected');
  return {
    sent, receiver,
    ids: () => (receiver.read().view?.entities ?? []).map(e => Number(e.id)),
    ack() { const v = receiver.read().view; if (v) host.ack(session, v.sequence); },
  };
}
const tick = (host, ...clients) => { const r = host.tick(); for (const c of clients) c.ack(); return r; };

test('SC02 host: each connection sees only entities in its own interest set, nearest first', () => {
  const host = createInterestHost(demoConfig);
  host.spawn(1, 100, 110); host.spawn(2, 100, 130); host.spawn(3, 400, 400); host.spawn(4, 405, 400); host.spawn(5, 100, 100);
  const a = client(host, 'alpha', 100, 100, 5), b = client(host, 'beta', 400, 400);
  tick(host, a, b);
  assert.deepEqual(a.ids(), [1, 2], 'own avatar (5) excluded; nearest first');
  assert.deepEqual(b.ids(), [3, 4]);
  const fields = a.receiver.read().view.entities[0];
  assert.deepEqual(fields, { id: '1', incarnation: 0, fields: { x: 100, y: 110, kind: 'unit' } });
  host.close();
});

test('SC02 host: hidden activity sends no frame; entering, hysteresis and leaving replace the view', () => {
  const host = createInterestHost(demoConfig);
  host.spawn(1, 100, 110); host.spawn(9, 300, 300);
  const a = client(host, 'alpha', 100, 100);
  tick(host, a); assert.equal(a.sent.length, 1);
  for (let i = 0; i < 5; i++) { host.move(9, 300 + i, 300); tick(host, a); }
  assert.equal(a.sent.length, 1, 'movement outside the set causes no frame');
  assert.equal(a.receiver.read().view.worldRevision, 1, 'the per-connection revision does not count hidden changes');
  host.move(9, 139, 100); tick(host, a); // 39 < enterRadius 40
  assert.deepEqual(a.ids(), [1, 9]);
  host.move(9, 147, 100); tick(host, a); // in the band (<= exitRadius 48): stays
  assert.deepEqual(a.ids(), [1, 9]);
  host.move(9, 160, 100); tick(host, a); // beyond exit, held for holdUpdates = 1
  assert.deepEqual(a.ids(), [1, 9]);
  tick(host, a);
  assert.deepEqual(a.ids(), [1], 'left after the hold');
  host.close();
});

test('SC02 host: application credit coalesces changes; the next frame after ack carries current state', () => {
  const host = createInterestHost(demoConfig);
  host.spawn(1, 100, 110);
  const a = client(host, 'alpha', 100, 100);
  host.tick(); // sent, credit outstanding (no ack)
  host.spawn(2, 100, 120); host.tick(); host.move(2, 100, 125); host.tick();
  assert.equal(a.sent.length, 1, 'withheld credit: nothing queued behind it');
  a.ack(); host.tick();
  assert.equal(a.sent.length, 2); assert.deepEqual(a.ids(), [1, 2]);
  assert.equal(a.receiver.read().view.entities[1].fields.y, 125);
  host.close();
});

test('SC02 host: the send budget caps the view; despawn and out-of-bounds moves leave at once', () => {
  const host = createInterestHost(demoConfig);
  for (let i = 0; i < 30; i++) host.spawn(100 + i, 100 + (i % 6), 100 + Math.floor(i / 6));
  const a = client(host, 'alpha', 100, 100);
  const [report] = tick(host, a);
  assert.equal(report.status, 'over-budget'); assert.equal(report.dropped, 14);
  assert.equal(a.ids().length, demoConfig.interest.maxRelevant);
  assert.equal(a.ids()[0], 100, 'the coincident entity ranks first');
  host.despawn(100); assert.equal(host.move(101, 10_000, 0), 'out-of-bounds');
  tick(host, a);
  assert.ok(!a.ids().includes(100) && !a.ids().includes(101));
  assert.equal(a.ids().length, demoConfig.interest.maxRelevant, 'freed budget is refilled from the dropped ones');
  host.close();
});

test('SC02 host: disconnect frees the observer; maxRelevant must fit the view protocol', () => {
  const host = createInterestHost(demoConfig);
  client(host, 'alpha', 0, 0);
  assert.equal(host.read().interest.observers, 1);
  assert.equal(host.disconnect('alpha'), 'disconnected'); assert.equal(host.disconnect('alpha'), 'absent');
  assert.equal(host.read().interest.observers, 0);
  host.close();
  assert.throws(() => createInterestHost({ ...demoConfig, interest: { ...demoConfig.interest, maxRelevant: 65 } }), RangeError);
});
