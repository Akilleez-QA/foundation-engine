import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNetworkIntake,
  type ConnectionHandle,
  type NetworkContext,
  type NetworkIntake,
  type NetworkLimits,
  type NetworkPorts,
} from './index';

const limits: NetworkLimits = {
  maxConnections: 4,
  maxPendingAuth: 2,
  maxPreAuthMessages: 2,
  authTimeoutMs: 10,
  maxQueuedMessagesPerPeer: 4,
  maxQueuedBytesPerPeer: 256,
  maxQueuedMessages: 6,
  maxQueuedBytes: 384,
  maxPumpOperations: 3,
  message: {maxBytes: 128, maxNodes: 32, maxDepth: 4},
  principal: {maxBytes: 128, maxNodes: 32, maxDepth: 4},
};
function harness(overrides: Partial<NetworkPorts> = {}, bounds: Partial<NetworkLimits> = {}) {
  const completions: ((json: string | null) => void)[] = [],
    dispatched: NetworkContext[] = [];
  const closed: {peer: ConnectionHandle; reason: string}[] = [],
    sends: string[] = [];
  const owner = createNetworkIntake({
    limits: {...limits, ...bounds},
    ports: {
      authenticate: ({complete}) => {
        completions.push(complete);
      },
      authorize: () => true,
      dispatch: context => {
        dispatched.push(context);
      },
      send: (_peer, json) => {
        sends.push(json);
        return true;
      },
      close: (peer, reason) => {
        closed.push({peer, reason});
      },
      ...overrides,
    },
  });
  function open(now = 0) {
    const result = owner.open(now);
    assert.equal(result.status, 'opened');
    return (result as {peer: ConnectionHandle}).peer;
  }
  function active(principal = '{"id":"a"}', now = 0) {
    const peer = open(now);
    assert.equal(owner.authenticate(peer, '{"token":"secret"}', now).status, 'started');
    completions.at(-1)!(principal);
    assert.equal(owner.read(peer)?.state, 'active');
    return peer;
  }
  return {owner, open, active, completions, dispatched, closed, sends};
}

test('NW01: connection identity is opaque and detached authentication facts do not confer dispatch scope', () => {
  let permit = false;
  const h = harness({authorize: () => permit});
  const peer = h.active();
  assert.notEqual(h.open(), peer);
  assert.equal(h.owner.read({} as ConnectionHandle), null);
  assert.equal(h.owner.receive(peer, '{"target":"x"}', 0).status, 'queued');
  assert.equal(h.owner.pump(0).status, 'pumped');
  assert.equal(h.dispatched.length, 0);
  permit = true;
  h.owner.receive(peer, '{"target":"x"}', 0);
  h.owner.pump(0);
  assert.equal(h.dispatched.length, 1);
  assert.ok(Object.isFrozen(h.dispatched[0]));
  assert.ok(Object.isFrozen(h.dispatched[0]!.command));
  assert.ok(Object.isFrozen(h.owner.read(peer)!.principal));
  assert.equal(h.owner.receive({} as ConnectionHandle, '{}', 0).status, 'refused');
});

test('NW01: late and duplicate verifier completions cannot revive closed or reused connections', () => {
  const h = harness();
  const old = h.open();
  h.owner.authenticate(old, '{}', 0);
  const complete = h.completions[0]!;
  h.owner.close(old);
  complete('{"id":"a"}');
  const next = h.open();
  assert.notEqual(old, next);
  h.owner.authenticate(next, '{}', 0);
  const nextComplete = h.completions[1]!;
  nextComplete('{"id":"new"}');
  nextComplete('{"id":"changed"}');
  assert.deepEqual(h.owner.read(next)?.principal, {id: 'new'});
  assert.equal(h.owner.read(old)?.state, 'closed');
  assert.equal(h.owner.stats().pendingAuth, 0);
  assert.equal(h.closed.length, 1);
});

test('NW01: pump expires preauth and pending peers without traffic and releases reservations', () => {
  const h = harness();
  const first = h.open();
  const second = h.open();
  h.owner.authenticate(second, '{}', 1);
  assert.equal(h.owner.stats().pendingAuth, 1);
  assert.deepEqual(h.owner.pump(10), {status: 'pumped', attempted: 0, dispatched: 0, denied: 0, expired: 2});
  h.completions[0]!('{}');
  assert.equal(h.owner.read(first)?.reason, 'auth-timeout');
  assert.equal(h.owner.read(second)?.reason, 'auth-timeout');
  assert.equal(h.owner.stats().connections, 0);
  assert.equal(h.owner.stats().pendingAuth, 0);
  assert.throws(() => h.owner.pump(9), /monotonic/);
  assert.throws(() => h.owner.open(NaN), /monotonic/);
});

test('NW01: connection, auth and preauth quotas are independent and rejected auth cleans up', () => {
  const h = harness({}, {maxConnections: 2, maxPendingAuth: 1});
  const a = h.open(),
    b = h.open();
  assert.deepEqual(h.owner.open(0), {status: 'refused', reason: 'connection-limit'});
  h.owner.authenticate(a, '{}', 0);
  assert.deepEqual(h.owner.authenticate(b, '{}', 0), {status: 'refused', reason: 'auth-limit'});
  h.owner.receive(b, '{}', 0);
  assert.deepEqual(h.owner.receive(b, '{}', 0), {status: 'refused', reason: 'pre-auth-limit'});
  h.completions[0]!(null);
  assert.equal(h.owner.stats().connections, 0);
  assert.equal(h.owner.stats().pendingAuth, 0);
  assert.equal(h.owner.read(a)?.reason, 'auth-rejected');
});

test('NW01: malformed, UTF8 oversize, deep and nonfinite messages never reach domain callbacks', () => {
  for (const json of [
    '{',
    JSON.stringify('界'.repeat(50)),
    '[[[[[[0]]]]]]',
    '1e999',
    JSON.stringify(Array(33).fill(0)),
  ]) {
    const h = harness();
    const peer = h.active();
    assert.deepEqual(h.owner.receive(peer, json, 0), {status: 'refused', reason: 'invalid-data'});
    assert.equal(h.owner.read(peer)?.state, 'closed');
    h.owner.pump(0);
    assert.equal(h.dispatched.length, 0);
  }
  const h = harness();
  const peer = h.open();
  h.owner.authenticate(peer, '{}', 0);
  h.completions[0]!('1e999');
  assert.equal(h.owner.read(peer)?.reason, 'invalid-data');
});

test('NW01: queue count and byte bounds release on drain and close', () => {
  const h = harness(
    {},
    {maxQueuedMessagesPerPeer: 2, maxQueuedMessages: 3, maxQueuedBytesPerPeer: 10, maxQueuedBytes: 15},
  );
  const a = h.active(),
    b = h.active();
  h.owner.receive(a, '"1234"', 0);
  assert.equal(h.owner.receive(a, '"1234"', 0).status, 'refused');
  h.owner.receive(a, '{}', 0);
  h.owner.receive(b, '"1234"', 0);
  assert.equal(h.owner.stats().queuedBytes, 14);
  assert.equal(h.owner.receive(b, '{}', 0).status, 'refused');
  h.owner.pump(0, 1);
  assert.equal(h.owner.stats().queuedMessages, 2);
  h.owner.close(a);
  h.owner.close(b);
  assert.equal(h.owner.stats().queuedBytes, 0);
  assert.equal(h.owner.stats().queuedMessages, 0);
});

test('NW01: fair finite drain serves healthy peer amid flood and connection churn', () => {
  const h = harness();
  let flood = h.active('{"id":"flood"}');
  const healthy = h.active('{"id":"healthy"}');
  for (let i = 0; i < 4; i++) h.owner.receive(flood, '{}', 0);
  h.owner.receive(healthy, '{}', 0);
  h.owner.pump(0, 1);
  assert.equal(h.dispatched[0]!.peer, flood);
  h.owner.close(flood);
  flood = h.active('{"id":"flood"}');
  h.owner.receive(flood, '{}', 0);
  h.owner.pump(0, 1);
  assert.equal(h.dispatched[1]!.peer, healthy);
  assert.throws(() => h.owner.pump(0, 4), /budget/);
  assert.equal(h.owner.pump(0, 0).status, 'pumped');
});

test('NW01: revoke during current authorization prevents dispatch and frees all queued work', () => {
  let owner: NetworkIntake;
  const h = harness({
    authorize: ({peer}) => {
      owner.revoke(peer);
      return true;
    },
  });
  owner = h.owner;
  const peer = h.active();
  h.owner.receive(peer, '{}', 0);
  h.owner.receive(peer, '{}', 0);
  assert.deepEqual(h.owner.pump(0), {status: 'pumped', attempted: 1, dispatched: 0, denied: 1, expired: 0});
  assert.equal(h.dispatched.length, 0);
  assert.equal(h.owner.stats().queuedMessages, 0);
  assert.equal(h.owner.read(peer)?.principal, null);
});

test('NW01: callbacks cannot recursively admit/drain while bounded replies remain available', () => {
  let owner: NetworkIntake;
  const h = harness({
    dispatch: ({peer}) => {
      assert.deepEqual(owner.open(0), {status: 'refused', reason: 'busy'});
      assert.deepEqual(owner.receive(peer, '{}', 0), {status: 'refused', reason: 'busy'});
      assert.deepEqual(owner.pump(0), {status: 'refused', reason: 'busy'});
      assert.deepEqual(owner.send(peer, '{"reply":1}'), {status: 'sent'});
    },
    send: peer => {
      assert.deepEqual(owner.send(peer, '{}'), {status: 'refused', reason: 'busy'});
      return true;
    },
  });
  owner = h.owner;
  const peer = h.active();
  owner.receive(peer, '{}', 0);
  assert.equal((owner.pump(0) as {dispatched: number}).dispatched, 1);
});

test('NW01: close callback observes retirement before reentry even when cleanup throws', () => {
  let owner: NetworkIntake,
    notifications = 0;
  const h = harness({
    close: peer => {
      notifications++;
      assert.equal(owner.read(peer)?.state, 'closed');
      assert.equal(owner.stats().queuedMessages, 0);
      owner.close(peer);
      assert.equal(owner.open(0).status, 'refused');
      throw Error('cleanup');
    },
  });
  owner = h.owner;
  const peer = h.active();
  owner.receive(peer, '{}', 0);
  owner.close(peer);
  owner.close(peer);
  assert.equal(notifications, 1);
  assert.equal(owner.stats().connections, 0);
});

test('NW01: verifier, authorization and dispatch exceptions retire rather than strand work', () => {
  for (const port of ['authenticate', 'authorize', 'dispatch'] as const) {
    const h = harness({
      [port]: () => {
        throw Error('port');
      },
    });
    const peer = port === 'authenticate' ? h.open() : h.active();
    if (port === 'authenticate') h.owner.authenticate(peer, '{}', 0);
    else {
      h.owner.receive(peer, '{}', 0);
      h.owner.pump(0);
    }
    assert.equal(h.owner.read(peer)?.state, 'closed');
    assert.equal(h.owner.stats().pendingAuth, 0);
    assert.equal(h.owner.stats().queuedBytes, 0);
  }
});

test('NW01: refused/throwing sends release peers and sends invalidated during port call cannot claim sent', () => {
  for (const fail of [
    () => false,
    () => {
      throw Error('write');
    },
  ]) {
    const h = harness({send: fail});
    const peer = h.active();
    h.owner.receive(peer, '{}', 0);
    assert.equal(h.owner.send(peer, '{}').status, 'refused');
    assert.equal(h.owner.stats().connections, 0);
    assert.equal(h.owner.stats().queuedMessages, 0);
  }
  let owner: NetworkIntake;
  const h = harness({
    send: peer => {
      owner.close(peer);
      return true;
    },
  });
  owner = h.owner;
  assert.deepEqual(owner.send(h.active(), '{}'), {status: 'refused', reason: 'closed'});
});

test('NW01: dispose retires active and pending peers and ignores all late work', () => {
  const h = harness();
  const active = h.active();
  const pending = h.open();
  h.owner.authenticate(pending, '{}', 0);
  h.owner.receive(active, '{}', 0);
  h.owner.dispose();
  h.owner.dispose();
  h.completions[1]!('{}');
  assert.deepEqual(h.owner.stats(), {
    connections: 0,
    pendingAuth: 0,
    queuedMessages: 0,
    queuedBytes: 0,
    disposed: true,
  });
  assert.equal(h.closed.length, 2);
  assert.equal(h.owner.open(0).status, 'refused');
  assert.equal(h.owner.send(active, '{}').status, 'refused');
  assert.equal(h.owner.read(pending)?.state, 'closed');
});

test('NW01: all bounds reject nonpositive or unsafe settings; caller mutations cannot alter captured budgets', () => {
  assert.throws(() => harness({}, {maxConnections: Infinity}), /limits/);
  assert.throws(() => harness({}, {message: {maxBytes: 0, maxDepth: 1, maxNodes: 1}}), /limits/);
  const settings = {...limits, message: {...limits.message}};
  const h = harness({}, settings);
  settings.message.maxBytes = 9999;
  const peer = h.active();
  assert.equal(h.owner.receive(peer, JSON.stringify('x'.repeat(129)), 0).status, 'refused');
});

test('NW01: synchronous verifier reentry retires attempt before its attempted completion', () => {
  let owner: NetworkIntake;
  const h = harness({
    authenticate: ({peer, complete}) => {
      assert.deepEqual(owner.authenticate(peer, '{}', 0), {status: 'refused', reason: 'busy'});
      owner.revoke(peer);
      complete('{"id":"late"}');
    },
  });
  owner = h.owner;
  const peer = h.open();
  assert.equal(owner.authenticate(peer, '{}', 0).status, 'started');
  assert.equal(owner.read(peer)?.state, 'closed');
  assert.equal(owner.read(peer)?.principal, null);
  assert.equal(owner.stats().pendingAuth, 0);
});

test('NW01: authorization can emit bounded refusal without permitting the domain action', () => {
  let owner: NetworkIntake;
  const h = harness({
    authorize: ({peer}) => {
      assert.equal(owner.send(peer, '{"denied":true}').status, 'sent');
      return false;
    },
  });
  owner = h.owner;
  const peer = h.active();
  owner.receive(peer, '{}', 0);
  owner.pump(0);
  assert.equal(h.dispatched.length, 0);
  assert.deepEqual(h.sends, ['{"denied":true}']);
});

test('NW06: queued age is unbounded by default and the pump result keeps its prior shape', () => {
  const h = harness();
  const peer = h.active();
  h.owner.receive(peer, '{"n":1}', 0);
  assert.deepEqual(h.owner.pump(1_000_000), {status: 'pumped', attempted: 1, dispatched: 1, denied: 0, expired: 0});
  assert.equal(h.dispatched.length, 1);
});

test('NW06: a command is shed exactly when its age reaches maxQueuedAgeMs, before authorize or dispatch', () => {
  let authorizations = 0;
  const stale: {ageMs: number; receivedAt: number; command: unknown}[] = [];
  const h = harness(
    {
      authorize: () => {
        authorizations++;
        return true;
      },
      stale: ({ageMs, receivedAt, command}) => {
        stale.push({ageMs, receivedAt, command});
      },
    },
    {maxQueuedAgeMs: 5, authTimeoutMs: 1000},
  );
  const peer = h.active();
  h.owner.receive(peer, '{"n":1}', 10);
  assert.deepEqual(h.owner.pump(14), {status: 'pumped', attempted: 1, dispatched: 1, denied: 0, expired: 0, stale: 0});
  h.owner.receive(peer, '{"n":2}', 14);
  assert.deepEqual(h.owner.pump(19), {status: 'pumped', attempted: 0, dispatched: 0, denied: 0, expired: 0, stale: 1});
  assert.equal(authorizations, 1);
  assert.equal(h.dispatched.length, 1);
  assert.deepEqual(stale, [{ageMs: 5, receivedAt: 14, command: {n: 2}}]);
  assert.equal(h.owner.stats().queuedMessages, 0);
  assert.equal(h.owner.stats().queuedBytes, 0);
  assert.equal(h.owner.read(peer)?.state, 'active');
});

test('NW06: shedding is not charged to the dispatch budget; a peer sheds its aged prefix on its turn and fresh work dispatches fairly', () => {
  const h = harness({}, {maxQueuedAgeMs: 5, authTimeoutMs: 1000, maxPumpOperations: 3});
  const a = h.active('{"id":"a"}'),
    b = h.active('{"id":"b"}');
  h.owner.receive(a, '{"old":1}', 0);
  h.owner.receive(a, '{"old":2}', 0);
  h.owner.receive(b, '{"old":3}', 0);
  h.owner.receive(a, '{"fresh":1}', 4);
  h.owner.receive(b, '{"fresh":2}', 4);
  assert.deepEqual(h.owner.pump(6, 0), {
    status: 'pumped',
    attempted: 0,
    dispatched: 0,
    denied: 0,
    expired: 0,
    stale: 0,
  });
  assert.equal(h.owner.stats().queuedMessages, 5);
  assert.deepEqual(h.owner.pump(6, 1), {
    status: 'pumped',
    attempted: 1,
    dispatched: 1,
    denied: 0,
    expired: 0,
    stale: 2,
  });
  assert.deepEqual(
    h.dispatched.map(d => d.command),
    [{fresh: 1}],
  );
  assert.deepEqual(h.owner.pump(6), {status: 'pumped', attempted: 1, dispatched: 1, denied: 0, expired: 0, stale: 1});
  assert.deepEqual(
    h.dispatched.map(d => d.command),
    [{fresh: 1}, {fresh: 2}],
  );
  assert.equal(h.owner.stats().queuedMessages, 0);
  assert.equal(h.owner.stats().queuedBytes, 0);
});

test('NW06: maxStaleDropsPerPump bounds shedding per pump and never lets a still-stale head dispatch', () => {
  const h = harness({}, {maxQueuedAgeMs: 5, maxStaleDropsPerPump: 1, authTimeoutMs: 1000, maxPumpOperations: 3});
  const a = h.active('{"id":"a"}'),
    b = h.active('{"id":"b"}');
  h.owner.receive(a, '{"old":1}', 0);
  h.owner.receive(a, '{"old":2}', 0);
  h.owner.receive(a, '{"fresh":1}', 4);
  h.owner.receive(b, '{"fresh":2}', 4);
  assert.deepEqual(h.owner.pump(6), {status: 'pumped', attempted: 1, dispatched: 1, denied: 0, expired: 0, stale: 1});
  assert.deepEqual(
    h.dispatched.map(d => d.command),
    [{fresh: 2}],
  );
  assert.equal(h.owner.read(a)?.queuedMessages, 2);
  assert.deepEqual(h.owner.pump(6), {status: 'pumped', attempted: 1, dispatched: 1, denied: 0, expired: 0, stale: 1});
  assert.deepEqual(
    h.dispatched.map(d => d.command),
    [{fresh: 2}, {fresh: 1}],
  );
  for (const maxStaleDropsPerPump of [0, -1, 1.5, Infinity])
    assert.throws(() => harness({}, {maxQueuedAgeMs: 5, maxStaleDropsPerPump}), /limits/);
  const off = harness({}, {maxStaleDropsPerPump: 1});
  const peer = off.active();
  off.owner.receive(peer, '{}', 0);
  assert.deepEqual(off.owner.pump(9), {status: 'pumped', attempted: 1, dispatched: 1, denied: 0, expired: 0});
});

test('NW06: backwards time throws before work and never drops or dispatches the queued command', () => {
  const h = harness({}, {maxQueuedAgeMs: 5, authTimeoutMs: 1000});
  const peer = h.active();
  h.owner.receive(peer, '{}', 10);
  assert.throws(() => h.owner.pump(9), /monotonic/);
  assert.throws(() => h.owner.pump(NaN), /monotonic/);
  assert.equal(h.owner.stats().queuedMessages, 1);
  assert.equal(h.dispatched.length, 0);
  assert.deepEqual(h.owner.pump(10), {status: 'pumped', attempted: 1, dispatched: 1, denied: 0, expired: 0, stale: 0});
});

test('NW06: the stale notice may reply through send; reentry is busy and a throwing notice retires the peer', () => {
  let owner: NetworkIntake;
  const h = harness(
    {
      stale: ({peer}) => {
        assert.deepEqual(owner.pump(20), {status: 'refused', reason: 'busy'});
        assert.deepEqual(owner.receive(peer, '{}', 20), {status: 'refused', reason: 'busy'});
        assert.deepEqual(owner.send(peer, '{"expired":true}'), {status: 'sent'});
      },
    },
    {maxQueuedAgeMs: 5, authTimeoutMs: 1000},
  );
  owner = h.owner;
  const peer = h.active();
  owner.receive(peer, '{}', 0);
  owner.pump(20);
  assert.deepEqual(h.sends, ['{"expired":true}']);
  assert.equal(owner.read(peer)?.state, 'active');
  const t = harness(
    {
      stale: () => {
        throw Error('notice');
      },
    },
    {maxQueuedAgeMs: 5, authTimeoutMs: 1000},
  );
  const victim = t.active();
  t.owner.receive(victim, '{}', 0);
  t.owner.receive(victim, '{}', 0);
  assert.deepEqual(t.owner.pump(5), {status: 'pumped', attempted: 0, dispatched: 0, denied: 0, expired: 0, stale: 1});
  assert.equal(t.owner.read(victim)?.reason, 'stale-error');
  assert.equal(t.owner.stats().queuedMessages, 0);
  assert.equal(t.dispatched.length, 0);
});

test('NW06: a stale notice that retires its peer does not end the pump before other peers are served', () => {
  const h = harness(
    {
      stale: () => {
        throw Error('notice');
      },
    },
    {maxQueuedAgeMs: 5, authTimeoutMs: 1000},
  );
  const a = h.active('{"id":"a"}'),
    b = h.active('{"id":"b"}');
  h.owner.receive(a, '{"old":1}', 0);
  h.owner.receive(b, '{"fresh":1}', 4);
  assert.deepEqual(h.owner.pump(6), {status: 'pumped', attempted: 1, dispatched: 1, denied: 0, expired: 0, stale: 1});
  assert.equal(h.owner.read(a)?.reason, 'stale-error');
  assert.deepEqual(
    h.dispatched.map(d => d.command),
    [{fresh: 1}],
  );
  assert.equal(h.owner.stats().queuedMessages, 0);
});

test('NW06: maxQueuedAgeMs and the stale port reject invalid configuration', () => {
  for (const maxQueuedAgeMs of [0, -1, 1.5, Infinity, NaN])
    assert.throws(() => harness({}, {maxQueuedAgeMs}), /limits/);
  assert.throws(() => harness({stale: 1 as never}, {maxQueuedAgeMs: 5}), /port/);
});

/** Deterministic sustained overload shaped like the NW-07 network-workbench probe (80 attempts/s capacity). */
function overload(maxQueuedAgeMs?: number) {
  const bounds: Partial<NetworkLimits> = {
    maxConnections: 8,
    authTimeoutMs: 1000,
    maxQueuedMessagesPerPeer: 8,
    maxQueuedBytesPerPeer: 4096,
    maxQueuedMessages: 32,
    maxQueuedBytes: 16384,
    maxPumpOperations: 4,
    ...(maxQueuedAgeMs === undefined ? {} : {maxQueuedAgeMs}),
  };
  const h = harness({}, bounds);
  const peers = Array.from({length: 7}, (_, i) => h.active(`{"id":${i}}`));
  const periodMs = 62,
    pumpMs = 50,
    endMs = 20_000,
    measureFromMs = 10_000; // 7 x ~16/s = ~113/s offered
  let measured = 0,
    stale = 0,
    maxAttempts = 0;
  for (let now = 0; now <= endMs; now++) {
    peers.forEach((peer, i) => {
      if ((now + i * 9) % periodMs === 0) h.owner.receive(peer, '{}', now);
    });
    if (now % pumpMs === 0) {
      const before = h.dispatched.length;
      const result = h.owner.pump(now) as {attempted: number; stale?: number};
      maxAttempts = Math.max(maxAttempts, result.attempted);
      if (now >= measureFromMs) {
        measured += h.dispatched.length - before;
        stale += result.stale ?? 0;
      }
    }
  }
  const seconds = (endMs - measureFromMs) / 1000;
  return {goodput: measured / seconds, stale, maxAttempts};
}

test('NW06: a tight queue age under sustained overload keeps goodput at the FIFO plateau', () => {
  const fifo = overload();
  assert.ok(fifo.goodput >= 76 && fifo.goodput <= 80.5, `FIFO goodput ${fifo.goodput}`);
  for (const age of [150, 300, 600]) {
    const aged = overload(age);
    assert.ok(aged.goodput >= 0.95 * fifo.goodput, `age ${age} ms goodput ${aged.goodput} vs FIFO ${fifo.goodput}`);
    assert.ok(aged.maxAttempts <= 4);
  }
  assert.ok(overload(300).stale > 0, 'the tight age actually sheds work');
});
