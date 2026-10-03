import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createViewPublisher,
  createViewReceiver,
  type ViewLimits,
  type ViewPublisher,
  type ViewPublisherPorts,
} from './index';
const limits: ViewLimits = {maxBytes: 65536, maxNodes: 4096, maxDepth: 8, maxEntities: 64, maxIdentityLength: 256};
const entity = (id = 'a', incarnation = 0, fields: unknown = {x: 1, secret: 'private'}) => ({id, incarnation, fields});
const frame = (sequence = 1, entities: unknown[] = [entity()], extra = {}) =>
  JSON.stringify({
    v: 1,
    type: 'view',
    session: 's',
    sequence,
    worldRevision: 0,
    entities,
    ...extra,
  });
const unavailable = (sequence: number) =>
  JSON.stringify({v: 1, type: 'view-unavailable', session: 's', sequence, reason: 'hidden'});
const receiver = (bounds = limits) => createViewReceiver({session: 's', limits: bounds});
function publisher(ports: Partial<ViewPublisherPorts> = {}, bounds = limits) {
  const sent: string[] = [],
    retired: string[] = [];
  const owner = createViewPublisher({
    session: 's',
    limits: bounds,
    ports: {
      current: () => true,
      project: () => JSON.stringify({worldRevision: 0, entities: [entity()]}),
      send: json => {
        sent.push(json);
        return true;
      },
      retire: why => {
        retired.push(why);
      },
      ...ports,
    },
  });
  return {owner, sent, retired};
}
test('NW02: complete replacement removes omitted fields/entities at the same world revision', () => {
  const r = receiver();
  r.receive(frame(1, [entity(), entity('b')]));
  const old = r.read().view!;
  assert.equal(r.receive(frame(2, [entity('a', 1, {x: 2})])).status, 'accepted');
  assert.deepEqual(r.read().view?.entities, [entity('a', 1, {x: 2})]);
  assert.equal(r.read().view?.worldRevision, 0);
  assert.ok(Object.isFrozen(old.entities[0]!.fields));
  assert.equal(old.entities.length, 2); // Caller-owned old immutable values cannot be recalled.
});
test('NW02: session is constructor-bound and valid foreign views cannot reset order', () => {
  const r = receiver();
  r.receive(frame(4));
  assert.equal(r.receive(frame(900, [], {session: 'other'})).status, 'foreign');
  assert.equal(r.read().sequence, 4);
  assert.equal(r.receive(frame(3)).status, 'obsolete');
  assert.equal(r.receive(frame(4)).status, 'duplicate');
  assert.equal(r.receive(frame(4) + ' ').status, 'retired');
  assert.equal(r.read().view, null);
  assert.equal(r.receive(frame(5)).status, 'retired');
});
test('NW02: trusted unavailable advances floor, local failure retains floor, newer view recovers', () => {
  const r = receiver();
  r.receive(frame());
  assert.equal(r.receive(unavailable(2)).status, 'unavailable');
  assert.equal(r.read().view, null);
  assert.equal(r.read().reason, 'hidden');
  assert.equal(r.receive(frame()).status, 'obsolete');
  assert.equal(r.receive(unavailable(2)).status, 'duplicate');
  r.receive(frame(3));
  r.invalidate();
  assert.equal(r.read().state, 'unavailable');
  assert.equal(r.read().view, null);
  assert.equal(r.receive(frame(3)).status, 'obsolete');
  assert.equal(r.receive(frame(4)).status, 'accepted');
  r.dispose();
  assert.equal(r.read().view, null);
  assert.equal(r.receive(frame(5)).status, 'retired');
});
test('NW02: invalid schema and malformed input clear prior data without trusting sequence', () => {
  const invalid = [
    '{',
    frame(0),
    frame(-1),
    frame(1.5),
    frame(Number.MAX_SAFE_INTEGER + 1),
    frame(2, [], {extra: true}),
    frame(2, [], {worldRevision: -1}),
    frame(2, [], {session: ''}),
    frame(2, [entity(), entity()]),
    frame(2, [entity('a', -1)]),
    frame(2, [entity('', 0)]),
    JSON.stringify({v: 1, type: 'view-unavailable', session: 's', sequence: 2, reason: ''}),
    frame(2, [{...entity(), extra: 2}]),
  ];
  for (const json of invalid) {
    const r = receiver();
    r.receive(frame());
    assert.equal(r.receive(json).status, 'retired', json);
    assert.equal(r.read().view, null);
    assert.equal(r.read().sequence, 1);
  }
});
test('NW02: complete envelope admits exact UTF8 bytes and rejects oversized duplicate-key input', () => {
  const json = frame(1, [entity('a', 0, '界')]);
  const bytes = Buffer.byteLength(json);
  assert.equal(receiver({...limits, maxBytes: bytes}).receive(json).status, 'accepted');
  assert.equal(receiver({...limits, maxBytes: bytes - 1}).receive(json).status, 'retired');
  const padded = '{"discarded":"' + '界'.repeat(200) + '","discarded":0,' + frame().slice(1);
  assert.equal(receiver({...limits, maxBytes: 512}).receive(padded).status, 'retired');
});
test('NW02: independent row, identity, node and depth bounds reject complete views', () => {
  for (const [bounds, json] of [
    [{maxEntities: 1}, frame(1, [entity(), entity('b')])],
    [{maxIdentityLength: 1}, frame(1, [entity('long')])],
    [{maxNodes: 4}, frame()],
    [{maxDepth: 2}, frame()],
  ] as const)
    assert.equal(receiver({...limits, ...bounds}).receive(json).status, 'retired');
  const r = receiver();
  assert.equal(r.receive(frame(Number.MAX_SAFE_INTEGER)).status, 'accepted');
  assert.equal(r.receive(frame(Number.MAX_SAFE_INTEGER + 1)).status, 'retired');
});
test('NW02: bounds are captured and creators retain JSON field semantics', () => {
  const mutable = {...limits};
  const r = receiver(mutable);
  mutable.maxEntities = 1;
  assert.equal(r.receive(frame(1, [entity('a', 0, null), entity('b', 1, [true, 9])])).status, 'accepted');
  assert.throws(() => receiver({...limits, maxEntities: 0}));
  assert.throws(() => createViewReceiver({session: '', limits}));
});
test('NW02: one outstanding credit blocks projection, dirty updates coalesce to current data', () => {
  let revision = 1,
    projected = 0;
  const h = publisher({
    project: () => {
      projected++;
      return JSON.stringify({worldRevision: revision, entities: []});
    },
  });
  assert.equal(h.owner.pump().status, 'sent');
  assert.equal(projected, 1);
  revision = 2;
  h.owner.markDirty();
  revision = 3;
  h.owner.markDirty();
  assert.equal(h.owner.pump().status, 'waiting');
  assert.equal(projected, 1);
  assert.equal(h.owner.ack('wrong', 1), false);
  assert.equal(h.owner.ack('s', 2), false);
  assert.equal(h.owner.ack('s', 1), true);
  assert.equal(h.owner.ack('s', 1), false);
  assert.equal(h.owner.pump().status, 'sent');
  assert.equal(JSON.parse(h.sent[1]!).worldRevision, 3);
  assert.equal(h.owner.read().sequence, 2);
  h.owner.ack('s', 2);
  assert.equal(h.owner.pump().status, 'idle');
  assert.equal(projected, 2);
});
test('NW02: projection exceptions and overbound envelopes emit bounded unavailable requiring credit', () => {
  for (const project of [
    () => {
      throw Error('sensitive');
    },
    () => '{',
    () => JSON.stringify({worldRevision: 0, entities: [entity('a', 0, 'x'.repeat(400))]}),
  ]) {
    const h = publisher({project}, {...limits, maxBytes: 200});
    assert.equal(h.owner.pump().status, 'sent');
    const wire = JSON.parse(h.sent[0]!);
    assert.equal(wire.type, 'view-unavailable');
    assert.equal(wire.reason, 'projection-failed');
    assert.ok(!h.sent[0]!.includes('sensitive'));
    assert.ok(h.owner.read().outstanding);
    assert.equal(h.owner.pump().status, 'waiting');
  }
});
test('NW02: unavailable frame unable to fit retires rather than weakening bounds', () => {
  const h = publisher({}, {...limits, maxBytes: 10});
  assert.equal(h.owner.pump().status, 'retired');
  assert.deepEqual(h.sent, []);
  assert.equal(h.owner.read().outstanding, null);
  assert.equal(h.owner.read().dirty, false);
});
test('NW02: envelope overhead counts even when the projected body itself fits', () => {
  const project = () => JSON.stringify({worldRevision: 0, entities: [entity()]});
  const h = publisher({project}, {...limits, maxBytes: Buffer.byteLength(project()) + 10});
  h.owner.pump();
  assert.equal(JSON.parse(h.sent[0]!).type, 'view-unavailable');
});
test('NW02: privacy contraction while credit is held clears state before retirement callback', () => {
  let owner: ViewPublisher;
  let calls = 0;
  const h = publisher({
    retire: () => {
      calls++;
      assert.equal(owner.read().outstanding, null);
      assert.equal(owner.read().dirty, false);
      assert.equal(owner.pump().status, 'retired');
      assert.equal(owner.ack('s', 1), false);
      owner.dispose();
      throw Error('transport cleanup failed');
    },
  });
  owner = h.owner;
  owner.pump();
  owner.invalidateDisclosure();
  assert.equal(calls, 1);
  assert.equal(owner.read().state, 'retired');
  owner.markDirty();
  owner.dispose();
  assert.equal(calls, 1);
});
test('NW02: projection reentry invalidation supersedes candidate without sending or spinning', () => {
  let owner: ViewPublisher,
    calls = 0;
  const h = publisher({
    project: () => {
      calls++;
      assert.equal(owner.pump().status, 'busy');
      owner.invalidateDisclosure();
      return JSON.stringify({worldRevision: 0, entities: [entity()]});
    },
  });
  owner = h.owner;
  assert.equal(owner.pump().status, 'superseded');
  assert.equal(calls, 1);
  assert.equal(owner.read().sequence, 0);
  assert.deepEqual(h.sent, []);
  assert.equal(owner.read().dirty, true);
});
test('NW02: authority callback changes cannot publish earlier disclosure', () => {
  let owner: ViewPublisher,
    checks = 0;
  const h = publisher({
    current: () => {
      if (++checks === 2) owner.markDirty();
      return true;
    },
  });
  owner = h.owner;
  assert.equal(owner.pump().status, 'superseded');
  assert.deepEqual(h.sent, []);
  assert.equal(owner.pump().status, 'sent');
});
test('NW02: lost authority and disposed projection callbacks cannot emit data', () => {
  let active = true,
    owner: ViewPublisher;
  const h = publisher({
    current: () => active,
    project: () => {
      active = false;
      return '{"worldRevision":0,"entities":[]}';
    },
  });
  assert.equal(h.owner.pump().status, 'retired');
  assert.deepEqual(h.sent, []);
  const other = publisher({
    project: () => {
      owner.dispose();
      throw Error('late');
    },
  });
  owner = other.owner;
  assert.equal(owner.pump().status, 'retired');
  assert.deepEqual(other.sent, []);
});
test('NW02: send reentry sees reserved credit and cannot recursively pump', () => {
  let owner: ViewPublisher;
  const h = publisher({
    send: json => {
      const seq = JSON.parse(json).sequence;
      assert.equal(owner.read().outstanding?.sequence, seq);
      assert.equal(owner.pump().status, 'busy');
      assert.equal(owner.ack('s', seq), true);
      assert.equal(owner.ack('s', seq), false);
      owner.markDirty();
      return true;
    },
  });
  owner = h.owner;
  assert.equal(owner.pump().status, 'sent');
  assert.equal(owner.read().outstanding, null);
  assert.equal(owner.read().dirty, true);
  assert.equal(owner.pump().sequence, 2);
});
test('NW02: send refusal, throw and synchronous disclosure retirement cannot report success', () => {
  for (const send of [
    () => false,
    () => {
      throw Error('socket');
    },
  ]) {
    const h = publisher({send});
    assert.equal(h.owner.pump().status, 'retired');
    assert.equal(h.owner.read().outstanding, null);
    assert.equal(h.retired.length, 1);
  }
  let owner: ViewPublisher;
  const h = publisher({
    send: () => {
      owner.invalidateDisclosure();
      return true;
    },
  });
  owner = h.owner;
  assert.equal(owner.pump().status, 'retired');
  assert.equal(owner.read().outstanding, null);
});
test('NW02: receiver and publisher compose with failed local adoption and explicit fresh projection', () => {
  const r = receiver();
  const h = publisher({
    send: json => {
      r.receive(json);
      return true;
    },
  });
  h.owner.pump();
  r.invalidate('consumer-failed');
  assert.equal(r.read().view, null);
  h.owner.ack('s', r.read().sequence);
  h.owner.markDirty();
  h.owner.pump();
  assert.equal(r.read().state, 'ready');
  assert.equal(r.read().sequence, 2);
});

test('NW02: identity protocol ceiling is 256 with tighter creator limits preserved', () => {
  const id256 = 'x'.repeat(256),
    id257 = 'x'.repeat(257);
  const ports: ViewPublisherPorts = {
    current: () => true,
    project: () => JSON.stringify({worldRevision: 0, entities: [entity(id256)]}),
    send: () => true,
    retire: () => {},
  };
  const r = createViewReceiver({session: id256, limits});
  assert.equal(r.receive(frame(1, [entity(id256)], {session: id256})).status, 'accepted');
  const p = createViewPublisher({session: id256, limits, ports});
  assert.equal(p.pump().status, 'sent');
  for (const constructor of [
    (session: string, bounds: ViewLimits) => createViewReceiver({session, limits: bounds}),
    (session: string, bounds: ViewLimits) => createViewPublisher({session, limits: bounds, ports}),
  ]) {
    assert.throws(() => constructor('s', {...limits, maxIdentityLength: 257}), /invalid limits/);
    assert.throws(() => constructor(id257, limits));
    assert.throws(() => constructor('12345', {...limits, maxIdentityLength: 4}));
    assert.doesNotThrow(() => constructor('1234', {...limits, maxIdentityLength: 4}));
  }
  assert.equal(r.receive(frame(2, [entity(id257)], {session: id256})).status, 'retired');
  const tight = receiver({...limits, maxIdentityLength: 4});
  assert.equal(tight.receive(frame(1, [entity('1234')])).status, 'accepted');
  assert.equal(tight.receive(frame(2, [entity('12345')])).status, 'retired');
});
