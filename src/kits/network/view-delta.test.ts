import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  createViewDeltaDecoder,
  createViewDeltaEncoder,
  createViewPublisher,
  createViewReceiver,
  type ViewLimits,
} from './index';

const limits: ViewLimits = {maxBytes: 65536, maxNodes: 4096, maxDepth: 8, maxEntities: 64, maxIdentityLength: 64};
const session = 's1';
type Entity = {id: string; incarnation: number; fields: {x: number; y: number; label: string}};

/** One host connection and one client: publisher -> encoder -> wire -> decoder -> receiver, with acknowledgments. */
function link(initial: Entity[]) {
  let world = initial.map(e => ({...e, fields: {...e.fields}}));
  let revision = 0;
  const wire: string[] = [];
  const publisher = createViewPublisher({
    session,
    limits,
    ports: {
      current: () => true,
      project: () => JSON.stringify({worldRevision: revision, entities: world}),
      send: json => {
        wire.push(encoder.encode(json));
        return true;
      },
      retire: () => {},
    },
  });
  const encoder = createViewDeltaEncoder({session, limits});
  const decoder = createViewDeltaDecoder({session, limits});
  const receiver = createViewReceiver({session, limits});
  const published: string[] = [];
  return {
    encoder,
    decoder,
    receiver,
    publisher,
    wire,
    published,
    set(next: Entity[]) {
      world = next.map(e => ({...e, fields: {...e.fields}}));
      revision++;
      publisher.markDirty();
    },
    /** Pumps one frame across, delivers it, adopts and acknowledges. Returns the decode status. */
    step(deliver = (frame: string) => frame) {
      const pumped = publisher.pump();
      assert.equal(pumped.status, 'sent');
      const frame = deliver(wire.at(-1)!);
      const decoded = decoder.decode(frame);
      if (decoded.status === 'complete' || decoded.status === 'reconstructed') {
        assert.equal(receiver.receive(decoded.json).status, 'accepted');
        decoder.adopt(decoded.sequence);
        encoder.ack(session, decoded.sequence, true);
        publisher.ack(session, decoded.sequence);
      } else if (decoded.status === 'baseline-missing') {
        receiver.invalidate();
        encoder.ack(session, decoded.sequence, false);
        publisher.ack(session, decoded.sequence);
        publisher.markDirty();
      }
      return decoded.status;
    },
  };
}

const crowd = (n: number, t = 0): Entity[] =>
  Array.from({length: n}, (_, i) => ({
    id: `e${i}`,
    incarnation: 1,
    fields: {x: i, y: i === 0 ? t : 0, label: `n${i}`},
  }));

test('a delta rebuilds the exact complete bytes the publisher produced and is much smaller', () => {
  const l = link(crowd(40));
  assert.equal(l.step(), 'complete');
  for (let t = 1; t <= 5; t++) {
    l.set(crowd(40, t));
    assert.equal(l.step(), 'reconstructed');
  }
  // The receiver holds exactly what a complete-only link would hold.
  const reference = createViewReceiver({session, limits});
  assert.deepEqual(l.receiver.read().view?.entities, JSON.parse(JSON.stringify(crowd(40, 5))));
  assert.equal(reference.read().state, 'waiting');
  const s = l.encoder.read();
  assert.equal(s.completeFrames, 1);
  assert.equal(s.deltaFrames, 5);
  const deltaBytes = l.wire.slice(1).reduce((n, w) => n + w.length, 0);
  const completeBytes = s.publishedLength - l.wire[0]!.length;
  assert.ok(deltaBytes * 10 < completeBytes, `${deltaBytes} vs ${completeBytes}`);
});

test('adds, removes, incarnation changes and reordering survive', () => {
  const l = link(crowd(5));
  l.step();
  const next = crowd(5);
  next.splice(1, 1); // remove e1
  next[0] = {...next[0]!, incarnation: 2}; // same id, new life
  next.push({id: 'new', incarnation: 1, fields: {x: 9, y: 9, label: 'n'}});
  l.set(next);
  assert.equal(l.step(), 'reconstructed');
  assert.deepEqual(
    l.receiver.read().view?.entities.map(e => e.id),
    ['e0', 'e2', 'e3', 'e4', 'new'],
  );
  l.set([...next].reverse());
  assert.equal(l.step(), 'reconstructed');
  assert.deepEqual(
    l.receiver.read().view?.entities.map(e => e.id),
    ['new', 'e4', 'e3', 'e2', 'e0'],
  );
  assert.ok(l.wire.at(-1)!.includes('"order"'));
  l.set([]);
  l.step();
  assert.deepEqual(l.receiver.read().view?.entities, []);
});

test('a delta that would not be smaller is sent complete', () => {
  const l = link(crowd(1));
  l.step();
  l.set([{id: 'other', incarnation: 1, fields: {x: 1, y: 1, label: 'q'}}]);
  assert.equal(l.step(), 'complete');
  assert.equal(l.encoder.read().deltaFrames, 0);
});

test('an unadopted frame forces a complete frame; the link recovers', () => {
  const l = link(crowd(10));
  l.step();
  l.decoder.invalidate(); // e.g. the consumer's projection failed and it cleared its replica
  l.set(crowd(10, 1));
  assert.equal(l.step(), 'baseline-missing');
  assert.equal(l.encoder.read().baseline, null);
  assert.equal(l.receiver.read().state, 'unavailable');
  assert.equal(l.step(), 'complete');
  l.set(crowd(10, 2));
  assert.equal(l.step(), 'reconstructed');
  assert.equal(
    l.receiver.read().view?.entities[0]?.fields && (l.receiver.read().view!.entities[0]!.fields as {y: number}).y,
    2,
  );
});

test('requireComplete forces the next frame complete, then deltas resume', () => {
  const l = link(crowd(10));
  l.step();
  l.encoder.requireComplete();
  l.set(crowd(10, 1));
  assert.equal(l.step(), 'complete');
  l.set(crowd(10, 2));
  assert.equal(l.step(), 'reconstructed');
});

test('stale, duplicate, foreign and hostile delta frames never corrupt the replica', () => {
  const l = link(crowd(10));
  l.step();
  l.set(crowd(10, 1));
  l.step();
  const oldDelta = l.wire.at(-1)!;
  l.set(crowd(10, 2));
  l.step();
  const before = l.receiver.read();
  assert.equal(l.decoder.decode(oldDelta).status, 'obsolete');
  const d = JSON.parse(l.wire.at(-1)!);
  const hostile = [
    {...d, session: 'other'},
    {...d, sequence: d.sequence + 1, baseSequence: d.sequence - 1},
    {...d, sequence: d.sequence + 1, baseSequence: d.sequence, removes: ['missing']},
    {...d, sequence: d.sequence + 1, baseSequence: d.sequence, upserts: [d.upserts[0], d.upserts[0]]},
    {...d, sequence: d.sequence + 1, baseSequence: d.sequence, order: ['e0']},
    {...d, sequence: d.sequence + 1, baseSequence: d.sequence, extra: 1},
    {...d, sequence: d.sequence + 1, baseSequence: d.sequence + 1},
    {
      ...d,
      sequence: d.sequence + 1,
      baseSequence: d.sequence,
      upserts: Array.from({length: 60}, (_, i) => ({id: `x${i}`, incarnation: 0, fields: 0})),
    },
  ];
  const statuses = hostile.map(h => l.decoder.decode(JSON.stringify(h)).status);
  assert.deepEqual(statuses, [
    'foreign',
    'baseline-missing',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
  ]);
  assert.equal(l.decoder.decode('{"type":"view-delta"').status, 'invalid');
  assert.equal(l.decoder.decode('x'.repeat(70000) + '"view-delta"').status, 'invalid');
  assert.deepEqual(l.receiver.read(), before);
  assert.equal(l.decoder.read().baseline, d.sequence);
});

test('acknowledgments only promote the exact pending frame of this session', () => {
  const l = link(crowd(10));
  l.publisher.pump();
  const seq = 1;
  assert.equal(l.encoder.ack('other', seq), false);
  assert.equal(l.encoder.ack(session, seq + 1), false);
  assert.equal(l.encoder.read().baseline, null);
  assert.equal(l.encoder.ack(session, seq), true);
  assert.equal(l.encoder.ack(session, seq), false);
  assert.equal(l.encoder.read().baseline, seq);
  assert.equal(l.decoder.adopt(seq), false); // nothing decoded yet
});

test('disposal is terminal and passes frames through untouched', () => {
  const enc = createViewDeltaEncoder({session, limits});
  const dec = createViewDeltaDecoder({session, limits});
  enc.dispose();
  dec.dispose();
  assert.equal(enc.encode('anything'), 'anything');
  assert.equal(dec.decode('{}').status, 'retired');
  assert.equal(enc.read().state, 'retired');
  assert.throws(() => createViewDeltaEncoder({session: '', limits}));
  assert.throws(() => createViewDeltaDecoder({session, limits: {...limits, maxBytes: 0}}));
});

test('an unavailable frame passes through and its adoption clears the baseline', () => {
  const enc = createViewDeltaEncoder({session, limits});
  const dec = createViewDeltaDecoder({session, limits});
  const full = (sequence: number, y: number) =>
    JSON.stringify({v: 1, type: 'view', session, sequence, worldRevision: sequence, entities: crowd(10, y)});
  const first = enc.encode(full(1, 0));
  assert.equal(dec.decode(first).status, 'complete');
  dec.adopt(1);
  enc.ack(session, 1);
  const gone = JSON.stringify({v: 1, type: 'view-unavailable', session, sequence: 2, reason: 'projection-failed'});
  assert.equal(enc.encode(gone), gone);
  const decoded = dec.decode(gone);
  assert.equal(decoded.status, 'complete');
  assert.equal(dec.adopt(2), true);
  assert.equal(enc.ack(session, 2), true);
  assert.equal(enc.read().baseline, null);
  assert.equal(dec.read().baseline, null);
  const third = enc.encode(full(3, 1));
  assert.equal(third, full(3, 1));
});

test('redelivering a delta before adoption reproduces identical bytes (receiver sees a duplicate)', () => {
  const l = link(crowd(10));
  l.step();
  l.set(crowd(10, 1));
  l.publisher.pump();
  const frame = l.wire.at(-1)!;
  const a = l.decoder.decode(frame);
  const b = l.decoder.decode(frame);
  assert.equal(a.status, 'reconstructed');
  assert.deepEqual(a, b);
  if (a.status !== 'reconstructed' || b.status !== 'reconstructed') return;
  assert.equal(l.receiver.receive(a.json).status, 'accepted');
  assert.equal(l.receiver.receive(b.json).status, 'duplicate');
});
