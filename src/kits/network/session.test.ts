import test from 'node:test';
import assert from 'node:assert/strict';
import type {BrowserSocket} from '../../platform/network/browser-transport.ts';
import {
  createSession,
  createSessionHost,
  defineSessionRules,
  integrityRules,
  isLocalNetworkHost,
  sessionEndpointFromPage,
  type Session,
  type SessionClientOptions,
  type SessionHost,
  type SessionHostIntegrity,
  type SessionIntegrityState,
  type SessionRulesInput,
  type SessionWorld,
} from './index.ts';
import {must} from '../../testing/must';

type Step = {dx: number};
const isStep = (value: unknown): value is Step =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  Number.isInteger((value as Step).dx) &&
  Math.abs((value as Step).dx) <= 3;
const xOf = (world: SessionWorld, player: string) => (world[player] as {x: number} | undefined)?.x;
function makeInput(version = 1, maxPlayers = 2): SessionRulesInput<Step> {
  return {
    id: 'test-world',
    version,
    maxPlayers,
    initial: () => ({}),
    join: (world, player) => ({...world, [player]: {x: 0}}),
    leave: (world, player) => Object.fromEntries(Object.entries(world).filter(([id]) => id !== player)),
    action: isStep,
    // Ignore moves past the edge: the host consumes them, and the client's prediction reconciles.
    apply: (world, player, step) => {
      const me = world[player] as {x: number} | undefined,
        x = (me?.x ?? 0) + step.dx;
      return !me || Math.abs(x) > 5 ? world : {...world, [player]: {x}};
    },
    integrity: [
      integrityRules.valueInRange<Step, SessionIntegrityState>({
        id: 'small-step',
        value: ({command}) => command.dx,
        min: -1,
        max: 1,
      }),
    ],
  };
}
const makeRules = (version = 1, maxPlayers = 2) => defineSessionRules(makeInput(version, maxPlayers));
const JOIN = 'join-code-0123456789abcdef';

/** An in-memory loopback: fake browser sockets on one side, the transport-neutral host on the other. */
class Link implements BrowserSocket {
  readyState = 0;
  bufferedAmount = 0;
  toHost: string[] = [];
  toClient: string[] = [];
  closing: {code: number; reason: string} | null = null;
  clientClosed = false;
  connected = false;
  address: string | undefined;
  listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener) {
    let rows = this.listeners.get(type);
    if (!rows) this.listeners.set(type, (rows = new Set()));
    rows.add(listener);
  }
  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }
  send(text: string) {
    this.toHost.push(text);
  }
  close() {
    if (this.readyState !== 3) {
      this.readyState = 3;
      this.clientClosed = true;
    }
  }
  emit(type: string, fields: Record<string, unknown> = {}) {
    const event = Object.assign(new Event(type), fields);
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
}
function network(rules = makeRules(), integrity: SessionHostIntegrity = 'observe', limits = {}, refreshOnPing = false) {
  let now = 1000;
  const links: Link[] = [],
    refuse = new Set<Link>();
  const host: SessionHost<Link> = createSessionHost({
    rules,
    joinCode: JOIN,
    integrity,
    limits,
    refreshOnPing,
    ports: {
      send: (link, text) => {
        if (link.readyState !== 1) return false;
        link.toClient.push(text);
        return true;
      },
      close: (link, code, reason) => {
        link.closing = {code, reason};
      },
    },
  });
  const factory = (address?: string) => () => {
    const link = new Link();
    link.address = address;
    links.push(link);
    return link;
  };
  function deliver() {
    for (const link of links) {
      if (link.readyState === 0 && !refuse.has(link)) {
        link.readyState = 1;
        link.connected = host.connect(link, now, link.address);
        link.emit('open');
      }
      if (link.clientClosed) {
        link.clientClosed = false;
        host.disconnected(link, now);
      }
      for (const text of link.toHost.splice(0))
        if (link.connected && link.readyState === 1) host.message(link, text, now);
      for (const text of link.toClient.splice(0)) if (link.readyState === 1) link.emit('message', {data: text});
      if (link.closing && link.readyState === 1) {
        link.readyState = 3;
        link.emit('close', link.closing);
      }
    }
  }
  const clients: Session<Step>[] = [];
  const net = {
    host,
    links,
    refuse,
    pump: true,
    get now() {
      return now;
    },
    client(
      endpoint = {url: 'ws://127.0.0.1:8787/session', joinCode: JOIN},
      r = rules,
      address?: string,
      extra: Partial<SessionClientOptions<Step>> = {},
    ) {
      const session = createSession({rules: r, endpoint, socketFactory: factory(address), random: () => 0.5, ...extra});
      clients.push(session);
      return session;
    },
    step(ms = 20, rounds = 1) {
      for (let i = 0; i < rounds; i++) {
        now += ms;
        for (const c of clients) c.update(now);
        deliver();
        if (net.pump) host.pump(now);
        deliver();
        for (const c of clients) c.update(now);
      }
    },
    /** Kill the transport under every client without a close frame (like a dropped TCP connection). */
    drop() {
      for (const link of links)
        if (link.readyState === 1) {
          link.readyState = 3;
          host.disconnected(link, now);
          link.emit('close', {code: 1006, reason: ''});
        }
    },
  };
  return net;
}

test('MP01: rules are validated at definition time and frozen', () => {
  const rules = makeInput(),
    defined = defineSessionRules(rules);
  assert.ok(Object.isFrozen(defined) && Object.isFrozen(defined.limits));
  assert.equal(defined.kind, 'session-rules');
  assert.throws(() => defineSessionRules({...rules, id: 'has space'}));
  assert.throws(() => defineSessionRules({...rules, version: 0}));
  assert.throws(() => defineSessionRules({...rules, maxPlayers: 17}));
  assert.throws(() => defineSessionRules({...rules, initial: () => ({'@you': 1})}), /entity id/);
  assert.throws(() => defineSessionRules({...rules, initial: () => [] as unknown as SessionWorld}));
  assert.throws(
    () => defineSessionRules({...rules, limits: {maxEntities: 1}, initial: () => ({a: 1, b: 2})}),
    /too many/,
  );
});

test('MP01: without an endpoint the same rules run locally for one player', () => {
  const session = createSession({rules: makeRules()});
  assert.equal(session.read().status, 'local');
  assert.equal(session.read().player, 'p1');
  assert.deepEqual(session.act({dx: 1}), {status: 'applied'});
  assert.equal(xOf(session.read().world, 'p1'), 1);
  assert.deepEqual(session.act({dx: 9} as Step), {status: 'refused', reason: 'invalid-action'});
  const before = session.read().revision;
  session.update(5);
  session.act({dx: 3});
  session.act({dx: 3});
  assert.equal(xOf(session.read().world, 'p1'), 4, 'the rule ignores the move past the edge');
  assert.ok(session.read().revision > before);
  session.dispose();
  assert.deepEqual(session.act({dx: 1}), {status: 'refused', reason: 'disposed'});
});

test('MP01: two clients join one host, predict their own moves and see each other through authoritative views', () => {
  const net = network(),
    a = net.client(),
    b = net.client();
  net.step(20, 3);
  assert.equal(a.read().status, 'joined');
  assert.equal(b.read().status, 'joined');
  assert.deepEqual([a.read().player, b.read().player].sort(), ['p1', 'p2']);
  assert.equal(a.read().stale, false);
  const pa = a.read().player!,
    pb = b.read().player!;
  assert.equal(xOf(b.read().world, pa), 0);
  assert.deepEqual(a.act({dx: 1}), {status: 'predicted'});
  assert.equal(xOf(a.read().world, pa), 1, 'own move shows before the host replies');
  assert.equal(xOf(a.read().confirmed!, pa), 0);
  assert.equal(a.read().pending, 1);
  net.step(20, 3);
  assert.equal(xOf(net.host.read().world, pa), 1);
  assert.equal(xOf(b.read().world, pa), 1, 'the other player sees the authoritative move');
  assert.equal(xOf(a.read().confirmed!, pa), 1);
  assert.equal(a.read().pending, 0);
  b.act({dx: -1});
  b.act({dx: -1});
  net.step(20, 3);
  assert.equal(xOf(a.read().world, pb), -2);
  assert.equal(net.host.read().metrics.applied, 3);
});

test('MP01: a move the host consumes as a rejection reconciles the prediction back (enforced integrity)', () => {
  const net = network(makeRules(), 'enforce'),
    a = net.client();
  net.step(20, 3);
  const p = a.read().player!;
  assert.deepEqual(a.act({dx: 2}), {status: 'predicted'});
  assert.equal(xOf(a.read().world, p), 2, 'the client predicts with the same rule');
  net.step(20, 3);
  assert.equal(xOf(net.host.read().world, p), 0, 'enforced integrity rejected the large step');
  assert.equal(xOf(a.read().world, p), 0, 'prediction reconciled to the authoritative state');
  assert.equal(a.read().pending, 0);
  assert.equal(net.host.read().metrics.rejected, 1);
  assert.equal(
    (net.host.read().integrity.stats as {rejected: number}).rejected,
    0,
    'assess/record path, not a check refusal',
  );
  assert.ok(net.host.read().integrity.audit.length >= 1);
});

test('MP01: integrity observe mode (the default) audits but never changes the outcome', () => {
  const net = network(),
    a = net.client();
  net.step(20, 3);
  const p = a.read().player!;
  a.act({dx: 3});
  net.step(20, 3);
  assert.equal(xOf(net.host.read().world, p), 3);
  const integrity = net.host.read().integrity;
  assert.equal(integrity.mode, 'observe');
  assert.equal((integrity.stats as {wouldReject: number}).wouldReject, 1);
  assert.equal((integrity.audit[0] as {observed: boolean}).observed, true);
});

test('MP01: a wrong join code and a rules mismatch are terminal: no reconnect', () => {
  const net = network();
  const wrong = net.client({url: 'ws://127.0.0.1:8787/session', joinCode: 'not-the-code-0000000000'});
  const old = net.client(undefined, makeRules(2));
  net.step(20, 4);
  assert.equal(wrong.read().status, 'closed');
  assert.equal(wrong.read().reason, 'auth-rejected');
  assert.deepEqual(wrong.read().lastClose, {code: 1008, reason: 'auth-rejected', class: 'terminal'});
  assert.equal(old.read().status, 'closed');
  assert.equal(old.read().reason, 'rules-mismatch');
  const opened = net.links.length;
  net.step(500, 20);
  assert.equal(net.links.length, opened, 'no further attempts');
  assert.equal(net.host.read().players.length, 0);
});

test('MP01: a dropped connection reconnects with paced backoff, resumes the same player and resends nothing', () => {
  const net = network(),
    a = net.client(),
    b = net.client();
  net.step(20, 3);
  const p = a.read().player!;
  a.act({dx: 1});
  net.step(20, 3);
  a.act({dx: 1}); // In flight when the connection drops: never resent after the reconnect.
  net.drop();
  net.step(1, 1);
  assert.equal(a.read().status, 'reconnecting');
  assert.ok(a.read().retryAt !== null);
  assert.equal(a.read().stale, true);
  assert.equal(a.read().lastClose?.class, 'transient');
  net.step(50, 120);
  assert.equal(a.read().status, 'joined');
  assert.equal(b.read().status, 'joined');
  assert.equal(a.read().player, p, 'same page key keeps the slot within the grace period');
  assert.equal(a.read().reconnects, 1);
  assert.equal(xOf(net.host.read().world, p), 1, 'the unconfirmed second step was not resent');
  assert.equal(xOf(a.read().world, p), 1);
  assert.equal(a.read().pending, 0);
  assert.equal(net.host.read().metrics.resumed, 2);
});

test('MP01: a host that never answers ends in retry-exhausted, bounded by the schedule', () => {
  const net = network();
  const a = net.client();
  // Every socket stays unopened, then reports an error-close.
  const tick = () => {
    for (const link of net.links)
      if (link.readyState === 0) {
        link.readyState = 3;
        link.emit('close', {code: 1006, reason: ''});
      }
  };
  for (let i = 0; i < 400 && a.read().status !== 'closed'; i++) {
    a.update(net.now + i * 50);
    tick();
    a.update(net.now + i * 50);
  }
  assert.equal(a.read().status, 'closed');
  assert.equal(a.read().reason, 'retry-exhausted');
  assert.equal(net.links.length, 7, 'one first attempt and six paced retries');
});

test('MP01: a full session refuses the extra player as capacity (transient), and leaving frees the slot after the grace period', () => {
  const net = network(makeRules(1, 1), 'observe', {leaveAfterMs: 1000}),
    a = net.client();
  net.step(20, 3);
  const b = net.client();
  net.step(20, 3);
  assert.equal(b.read().lastClose?.reason, 'session-full');
  assert.equal(b.read().lastClose?.code, 1013);
  assert.equal(b.read().lastClose?.class, 'transient');
  a.dispose();
  net.step(20, 2);
  assert.deepEqual(net.host.read().players, [{player: 'p1', connected: false}]);
  assert.ok('p1' in net.host.read().world, 'kept during the grace period');
  net.step(100, 12);
  assert.equal(net.host.read().metrics.left, 1, 'rules.leave ran after the grace period');
  net.step(250, 40);
  assert.equal(b.read().status, 'joined');
  assert.equal(b.read().player, 'p1');
});

test('MP01: the host closes protocol violations, out-of-order sequences and frame floods', () => {
  const net = network(makeRules(1, 4), 'observe', {framesPerSecond: 8});
  const link = new Link();
  link.readyState = 1;
  const ports: string[] = [];
  const send = (text: string) => net.host.message(link, text, net.now);
  assert.equal(net.host.connect(link, net.now), true);
  send('{"v":1,"type":"action","seq":1,"action":{"dx":1}}');
  assert.equal(link.closing?.reason, 'protocol', 'actions before joining');
  const fresh = (): Link => {
    const l = new Link();
    l.readyState = 1;
    net.host.connect(l, net.now);
    return l;
  };
  const join = (l: Link) =>
    net.host.message(
      l,
      JSON.stringify({
        v: 1,
        type: 'join',
        rules: 'test-world',
        version: 1,
        token: JOIN,
        player: 'k'.repeat(16) + ports.length,
      }),
      net.now,
    );
  const seq = fresh();
  ports.push('a');
  join(seq);
  assert.match(seq.toClient[0]!, /"type":"welcome"/);
  net.host.message(seq, '{"v":1,"type":"action","seq":2,"action":{"dx":1}}', net.now);
  net.host.pump(net.now);
  assert.equal(seq.closing?.reason, 'sequence');
  const junk = fresh();
  ports.push('b');
  join(junk);
  net.host.message(junk, 'not json', net.now);
  assert.equal(junk.closing?.reason, 'protocol');
  const flood = fresh();
  ports.push('c');
  join(flood);
  for (let i = 0; i < 20 && !flood.closing; i++) net.host.message(flood, '{"v":1,"type":"ping"}', net.now);
  assert.equal(flood.closing?.reason, 'rate-limit');
  assert.equal(flood.closing?.code, 1013);
  net.host.dispose();
  assert.ok(Object.keys(net.host.read().closeReasons).includes('sequence'));
});

test('MP01: page endpoints accept only local-network hosts and a well-formed join code', () => {
  const page = (search: string, hostname = '127.0.0.1') => sessionEndpointFromPage({search, hostname});
  assert.deepEqual(page(`?host=8787&join=${JOIN}`), {url: 'ws://127.0.0.1:8787/session', joinCode: JOIN});
  assert.deepEqual(page(`?host=8787&join=${JOIN}`, '192.168.1.20'), {
    url: 'ws://192.168.1.20:8787/session',
    joinCode: JOIN,
  });
  assert.equal(
    page(`?host=${encodeURIComponent('ws://10.0.0.5:9000/session')}&join=${JOIN}`)?.url,
    'ws://10.0.0.5:9000/session',
  );
  assert.equal(page(`?host=${encodeURIComponent('wss://example.com/session')}&join=${JOIN}`), null);
  assert.equal(page(`?host=8787&join=${JOIN}`, 'example.com'), null);
  assert.equal(page(`?host=${encodeURIComponent('http://127.0.0.1:1/x')}&join=${JOIN}`), null);
  assert.equal(page('?host=8787&join=short'), null);
  assert.equal(page(''), null);
  assert.equal(sessionEndpointFromPage(undefined), null);
  for (const host of [
    'localhost',
    '127.0.0.2',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.1.1',
    'box.local',
    '[::1]',
  ])
    assert.equal(isLocalNetworkHost(host), true, host);
  for (const host of ['172.32.0.1', '8.8.8.8', 'example.com', '192.169.0.1', '300.1.1.1'])
    assert.equal(isLocalNetworkHost(host), false, host);
});

test('MP01: views larger than the action message bound still reach clients (view limits, not message limits)', () => {
  const big = defineSessionRules<Step>({
    ...makeInput(),
    initial: () =>
      Object.fromEntries(
        Array.from({length: 30}, (_, i) => [`rock-${i}`, {at: [i, i * 2, i * 3], tag: 'x'.repeat(40)}]),
      ),
  });
  const net = network(big),
    a = net.client();
  net.step(20, 3);
  assert.equal(a.read().status, 'joined');
  assert.equal(a.read().stale, false);
  assert.equal(Object.keys(a.read().world).length, 31);
  assert.ok(JSON.stringify(a.read().world).length > big.limits.action.maxBytes * 2);
});

test('MP01: idle sockets without the join code cannot lock players out (per-address cap, resume reserve, short deadline)', () => {
  const net = network(makeRules(1, 4), 'observe', {leaveAfterMs: 20000});
  const a = net.client(undefined, undefined, '10.0.0.1');
  net.step(20, 3);
  assert.equal(a.read().status, 'joined');
  const player = a.read().player;
  // An attacker reopening idle sockets every step from the given addresses; refused ones are closed at once.
  let opened = 0,
    refused = 0;
  const flood = (addresses: string[]) => {
    for (const address of addresses) {
      const idle = new Link();
      idle.readyState = 1;
      if (net.host.connect(idle, net.now, address)) opened++;
      else refused++;
    }
  };
  // One hostile address holds at most its share of the pre-join pool: new players from elsewhere still join.
  for (let round = 0; round < 3; round++) {
    // Three new players fill the remaining slots.
    const fresh = net.client(undefined, undefined, `10.0.1.${round}`);
    for (let i = 0; i < 40 && fresh.read().status !== 'joined'; i++) {
      flood(['10.0.0.9']);
      net.step(20);
    }
    assert.equal(fresh.read().status, 'joined', `fresh join ${round} under a one-address flood`);
    fresh.dispose();
    net.step(20, 2);
  }
  assert.ok(refused > 0, 'the flooding address was capped');
  // Many hostile addresses fill the normal pool: a returning player still gets back in through the resume reserve.
  net.drop();
  for (let i = 0; i < 300 && a.read().status !== 'joined'; i++) {
    flood(['10.0.2.1', '10.0.2.2', '10.0.2.3', '10.0.2.4']);
    net.step(25);
  }
  assert.equal(a.read().status, 'joined', 'the returning player rejoined, not retry-exhausted');
  assert.equal(a.read().player, player);
  assert.ok(must(net.host.read().metrics.reserveConnections) >= 1);
  // A brand-new player is not admitted through the reserve.
  const late = new Link();
  late.readyState = 1;
  for (const address of ['10.0.3.1', '10.0.3.2', '10.0.3.3', '10.0.3.4'])
    net.host.connect(new Link(), net.now, address);
  if (net.host.connect(late, net.now, '10.0.3.9')) {
    net.host.message(
      late,
      JSON.stringify({
        v: 1,
        type: 'join',
        rules: 'test-world',
        version: 1,
        token: JOIN,
        player: 'never-seen-key-000000',
      }),
      net.now,
    );
    assert.equal(late.closing?.reason, 'connection-limit');
  }
  assert.ok(opened > 0);
});

test('MP01: act() on every 60 Hz tick is paced by the client: no rate-limit close, nothing reported predicted is dropped', () => {
  const net = network(),
    a = net.client(undefined, undefined, '10.0.0.1'),
    b = net.client(undefined, undefined, '10.0.0.2');
  net.step(20, 3);
  const p = a.read().player!;
  let predicted = 0,
    paced = 0,
    busy = 0,
    dx = 1;
  for (let tick = 0; tick < 600; tick++) {
    // Ten seconds of fixed ticks at 60 Hz; the other player moves too.
    const result = a.act({dx});
    if (result.status === 'predicted') {
      predicted++;
      dx = -dx;
    } else if (result.status === 'refused' && result.reason === 'paced') paced++;
    else if (result.status === 'refused' && result.reason === 'busy') busy++;
    if (tick % 4 === 0) b.act({dx: 0});
    net.step(1000 / 60);
    assert.equal(a.read().status, 'joined', `tick ${tick}`);
  }
  net.step(20, 5);
  assert.ok(predicted >= 290 && predicted <= 331, `30 per second plus a burst of 30, got ${predicted}`);
  assert.ok(paced > 250);
  assert.equal(net.host.read().closeReasons['rate-limit'], undefined);
  assert.equal(a.read().reconnects, 0);
  assert.equal(a.read().pending, 0);
  assert.equal(must(net.host.read().metrics.applied) + must(net.host.read().metrics.rejected) >= predicted, true);
  assert.equal(xOf(a.read().world, p), xOf(net.host.read().world, p));
  void busy;
});

test('MP01: unconfirmed actions stop at the host queue size, so a burst cannot trigger queue-limit', () => {
  const net = network(),
    a = net.client(undefined, undefined, '10.0.0.1', {actionsPerSecond: 1000});
  net.step(20, 3);
  const results = Array.from({length: 40}, () => a.act({dx: 0}));
  assert.equal(results.filter(r => r.status === 'predicted').length, 16);
  assert.deepEqual(results[16], {status: 'refused', reason: 'busy'});
  net.step(20, 4);
  assert.equal(a.read().status, 'joined');
  assert.equal(net.host.read().closeReasons['queue-limit'], undefined);
  assert.throws(() => createSession({rules: makeRules(), actionsPerSecond: 0}));
});

const LIVE = {pingMs: 100, liveness: {connectTimeoutMs: 300, hostTimeoutMs: 350}};

test('MP01 liveness: deadlines are captured once before validation', () => {
  let reads = 0;
  const config = {
    get connectTimeoutMs() {
      return ++reads === 1 ? 300 : Infinity;
    },
    hostTimeoutMs: 400,
  };
  const silent = silentClient('connecting', {liveness: config});
  assert.equal(reads, 1);
  silent.step(0);
  silent.step(300);
  assert.equal(silent.client.read().lastClose?.reason, 'connect-timeout');
  silent.client.dispose();
});

test('MP01 liveness: paired idle views advance without changing the world or redrawing; defaults stay silent', () => {
  for (const enabled of [false, true]) {
    const net = network(makeRules(), 'observe', {}, enabled),
      a = net.client(undefined, undefined, undefined, enabled ? LIVE : {});
    net.step(20, 4);
    const revision = a.read().revision,
      worldRevision = net.host.read().worldRevision,
      views = must(net.host.read().metrics.views);
    net.step(20, 100);
    assert.equal(a.read().status, 'joined');
    assert.equal(a.read().reconnects, 0);
    assert.equal(a.read().revision, revision);
    assert.equal(net.host.read().worldRevision, worldRevision);
    assert.equal(must(net.host.read().metrics.views) > views, enabled);
  }
});

test('MP01 liveness: stopped pump expires despite messages, drops prediction and resumes without resend', () => {
  const net = network(makeRules(), 'observe', {}, true),
    a = net.client(undefined, undefined, undefined, LIVE);
  net.step(20, 4);
  const player = a.read().player!;
  net.pump = false;
  assert.equal(a.act({dx: 1}).status, 'predicted');
  net.step(20, 18);
  assert.equal(a.read().status, 'reconnecting');
  assert.equal(a.read().lastClose?.reason, 'host-timeout');
  assert.equal(a.read().stale, true);
  assert.equal(a.read().pending, 0);
  assert.equal(xOf(a.read().world, player), 0, 'unconfirmed display restored immediately');
  net.pump = true;
  net.step(20, 30);
  assert.equal(a.read().status, 'joined');
  assert.equal(a.read().player, player);
  assert.equal(xOf(net.host.read().world, player), 0, 'uncertain action was not resent');
});

test('MP01 liveness: continuous actions do not suppress probes; ping cannot publish without pump', () => {
  const net = network(makeRules(), 'observe', {}, true),
    a = net.client(undefined, undefined, undefined, LIVE);
  net.step(20, 4);
  const link = net.links[0]!,
    sent: string[] = [],
    original = link.send.bind(link);
  link.send = text => {
    sent.push(text);
    original(text);
  };
  for (let i = 0; i < 40; i++) {
    a.act({dx: 0});
    net.step(20);
  }
  assert.ok(sent.filter(text => JSON.parse(text).type === 'ping').length >= 7);
  net.step(1); // Deliver the last action view's credit-releasing ack.
  const views = must(net.host.read().metrics.views);
  net.host.message(link, '{"v":1,"type":"ping"}', net.now);
  assert.equal(must(net.host.read().metrics.views), views);
  net.host.pump(net.now);
  assert.equal(must(net.host.read().metrics.views), views + 1);
});

function silentClient(
  mode: 'connecting' | 'open' | 'welcome',
  extra: Partial<SessionClientOptions<Step>> = {},
  enabled = true,
) {
  const links: Link[] = [];
  const client = createSession({
    rules: makeRules(),
    endpoint: {url: 'ws://localhost/session', joinCode: JOIN},
    ...(enabled ? LIVE : {pingMs: 100}),
    random: () => 0.5,
    ...extra,
    socketFactory: () => {
      const link = new Link();
      links.push(link);
      return link;
    },
  });
  function step(now: number) {
    client.update(now);
    const link = links.at(-1)!;
    if (link.readyState === 0 && mode !== 'connecting') {
      link.readyState = 1;
      link.emit('open');
      if (mode === 'welcome') link.emit('message', {data: '{"v":1,"type":"welcome","player":"p1","session":"silent"}'});
    }
    client.update(now);
  }
  return {client, links, step};
}

test('MP01 liveness: connecting, no welcome, and welcome-only attempts all exhaust without external close events', () => {
  for (const mode of ['connecting', 'open', 'welcome'] as const) {
    const {client, links, step} = silentClient(mode);
    for (let now = 0; now < 30000 && client.read().status !== 'closed'; now += 50) step(now);
    assert.equal(client.read().reason, 'retry-exhausted', mode);
    assert.equal(links.length, 7, mode);
    assert.ok(
      links.every(link => link.readyState === 3 && [...link.listeners.values()].every(rows => rows.size === 0)),
    );
  }
});

test('MP01 liveness: opt-in against a nonparticipating idle host expires; disabled connecting stays unchanged', () => {
  const net = network(),
    a = net.client(undefined, undefined, undefined, LIVE);
  net.step(20, 4);
  net.step(20, 18);
  assert.equal(a.read().lastClose?.reason, 'host-timeout');
  const silent = silentClient('connecting', {}, false);
  silent.step(0);
  silent.step(100000);
  assert.equal(silent.client.read().status, 'connecting');
  assert.equal(silent.links.length, 1);
});

test('MP01 liveness: exact deadline, regression, large jumps and disposal remain bounded', () => {
  const {client, links, step} = silentClient('connecting');
  step(100);
  step(99);
  step(399);
  assert.equal(client.read().lastClose, null);
  step(400);
  assert.equal(client.read().lastClose?.reason, 'connect-timeout');
  client.dispose();
  step(1000000);
  assert.equal(links.length, 1);
  assert.equal(client.read().reason, 'disposed');
  links[0]!.emit('message', {data: '{"v":1,"type":"welcome","player":"p1","session":"late"}'});
  assert.equal(client.read().status, 'closed');
});

test('MP01 liveness: malformed and incompatible durations are refused, captured options are immutable', () => {
  for (const liveness of [
    null,
    {},
    {connectTimeoutMs: 0, hostTimeoutMs: 400},
    {connectTimeoutMs: Infinity, hostTimeoutMs: 400},
    {connectTimeoutMs: 300, hostTimeoutMs: 100},
    {connectTimeoutMs: 0.1, hostTimeoutMs: 400},
    {connectTimeoutMs: 300, hostTimeoutMs: Number.MAX_SAFE_INTEGER + 1},
  ])
    assert.throws(() => Reflect.apply(createSession, null, [{rules: makeRules(), pingMs: 100, liveness}]));
  const config = {connectTimeoutMs: 300, hostTimeoutMs: 400};
  const silent = silentClient('connecting', {liveness: config});
  silent.step(0);
  config.connectTimeoutMs = 99999;
  silent.step(300);
  assert.equal(silent.client.read().lastClose?.reason, 'connect-timeout');
  assert.throws(() =>
    Reflect.apply(createSessionHost, null, [
      {
        rules: makeRules(),
        joinCode: JOIN,
        refreshOnPing: 1,
        ports: {send: () => true, close: () => {}},
      },
    ]),
  );
});

test('MP01 liveness: duplicates, obsolete and foreign views do not renew the lease; queued fresh view wins at deadline', () => {
  for (const kind of ['duplicate', 'obsolete', 'foreign', 'fresh'] as const) {
    const net = network(makeRules(), 'observe', {}, true),
      a = net.client(undefined, undefined, undefined, LIVE);
    net.step(20, 4);
    const link = net.links[0]!;
    let captured = '';
    link.addEventListener('message', ((event: Event & {data: string}) => {
      if (JSON.parse(event.data).type === 'view') captured = event.data;
    }) as EventListener);
    net.step(20, 6);
    assert.ok(captured);
    const frame = JSON.parse(captured);
    // Adopt another genuine view first, leaving an older frame to replay.
    net.step(20, 5);
    const current = JSON.parse(captured),
      start = net.now;
    net.pump = false;
    const injected =
      kind === 'duplicate'
        ? captured
        : JSON.stringify(
            kind === 'obsolete'
              ? frame
              : kind === 'foreign'
                ? {...current, session: 'another-session', sequence: current.sequence + 1}
                : {...current, sequence: current.sequence + 1},
          );
    link.emit('message', {data: injected});
    a.update(start + 350);
    if (kind === 'fresh') {
      assert.equal(a.read().status, 'joined');
      const sent = link.toHost.length;
      a.update(start + 350);
      a.update(start + 300);
      assert.equal(link.toHost.length, sent, 'no catch-up burst or regressing-clock probe');
      a.update(start + 1000000);
      assert.equal(a.read().lastClose?.reason, 'host-timeout');
    } else assert.equal(a.read().lastClose?.reason, 'host-timeout', kind);
  }
});

test('MP01 liveness: unacknowledged view coalesces probes and send refusal still retires the peer', () => {
  const net = network(makeRules(), 'observe', {}, true),
    a = net.client(undefined, undefined, undefined, LIVE);
  net.step(20, 4);
  net.step(1);
  const link = net.links[0]!;
  net.host.message(link, '{"v":1,"type":"ping"}', net.now);
  net.host.pump(net.now);
  const views = must(net.host.read().metrics.views);
  for (let i = 0; i < 10; i++) {
    net.host.message(link, '{"v":1,"type":"ping"}', net.now);
    net.host.pump(net.now);
  }
  assert.equal(must(net.host.read().metrics.views), views, 'one outstanding credit, no snapshot outbox');
  a.update(net.now + 400); // No host frames delivered: downstream silent loss.
  assert.equal(a.read().lastClose?.reason, 'host-timeout');
  assert.equal(a.read().stale, true);
  const failure = network(makeRules(), 'observe', {}, true),
    b = failure.client(undefined, undefined, undefined, LIVE);
  failure.step(20, 4);
  failure.step(1);
  const blocked = failure.links[0]!;
  blocked.readyState = 3;
  failure.host.message(blocked, '{"v":1,"type":"ping"}', failure.now);
  failure.host.pump(failure.now);
  assert.equal(failure.host.read().closeReasons['view-send-refused'], 1);
  void b;
});

test('MP01 liveness: malformed input retains protocol refusal and late old frames cannot renew a replacement', () => {
  const net = network(makeRules(), 'observe', {}, true),
    a = net.client(undefined, undefined, undefined, LIVE);
  net.step(20, 4);
  const old = net.links[0]!;
  old.emit('message', {data: '{"v":1,"type":"pong"}'});
  a.update(net.now);
  assert.equal(a.read().lastClose?.reason, 'protocol');
  net.step(20, 30);
  assert.equal(a.read().status, 'joined');
  net.pump = false;
  for (let i = 0; i < 18; i++) {
    old.emit('message', {data: '{"v":1,"type":"welcome","player":"p1","session":"late"}'});
    net.step(20);
  }
  assert.equal(a.read().lastClose?.reason, 'host-timeout');
});

test('MP01 liveness: old clients accept refreshed views and ping floods still hit the existing rate bound', () => {
  const net = network(makeRules(), 'observe', {}, true),
    a = net.client();
  net.step(20, 4);
  const views = must(net.host.read().metrics.views);
  net.step(100, 60);
  assert.equal(a.read().status, 'joined');
  assert.equal(a.read().reconnects, 0);
  assert.ok(must(net.host.read().metrics.views) > views);
  const link = net.links[0]!;
  for (let i = 0; i < 100; i++) net.host.message(link, '{"v":1,"type":"ping"}', net.now);
  assert.equal(link.closing?.reason, 'rate-limit');
  net.host.pump(net.now);
  assert.equal(net.host.read().connections, 0);
});
