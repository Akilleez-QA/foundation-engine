import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthorityGenesis,
  createDurableAuthority,
  type AuthorityOptions,
  type AuthorityStorage,
} from './authority';
import { captureAuthorityEnvelope } from './authority-envelope';

const json = { maxBytes: 65536, maxNodes: 4096, maxDepth: 12 };
const limits = {
  envelope: json,
  state: json,
  input: json,
  result: json,
  maxStreams: 2,
  maxReceiptsPerStream: 2,
};
const validators = {
  validateState: (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v),
  validateInput: (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v),
  validateResult: (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v),
};
const config = { lineage: 'world', schema: 'sum-v1', limits, ...validators };
function fixture(extra: Partial<AuthorityOptions> = {}) {
  let raw: string | null = createAuthorityGenesis({
      ...config,
      stateJson: '0',
    }),
    writes = 0,
    reductions = 0;
  const storage: AuthorityStorage = {
    async settle() {},
    async read() {
      return raw;
    },
    async compareAndSwap(q) {
      writes++;
      const old = JSON.parse(raw!);
      if (
        old.lineage !== q.lineage ||
        old.schema !== q.schema ||
        old.revision !== q.revision
      )
        return 'rejected';
      raw = q.json;
      return 'committed';
    },
  };
  const owner = createDurableAuthority({
    ...config,
    storage,
    authorize: () => true,
    reduce({ state, input }) {
      reductions++;
      const value = (state as number) + Math.max(0, input as number);
      return { stateJson: String(value), resultJson: String(value) };
    },
    ...extra,
  });
  return {
    owner,
    storage,
    get raw() {
      return raw;
    },
    set raw(value: string | null) {
      raw = value;
    },
    get writes() {
      return writes;
    },
    get reductions() {
      return reductions;
    },
  };
}
const command = (stream: string, sequence: number, input: number) => ({
  stream,
  sequence,
  inputJson: String(input),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('literal two-stream durable oracle, domain rejection, suffix eviction and exact retry', async () => {
  const f = fixture();
  assert.equal(
    (await f.owner.submit(command('a', 1, 3))).status,
    'unavailable',
  );
  await f.owner.recover();
  await f.owner.submit(command('a', 1, 3));
  await f.owner.submit(command('b', 1, 4));
  await f.owner.submit(command('a', 2, -1));
  await f.owner.submit(command('a', 3, 2));
  const saved = JSON.parse(f.raw!);
  assert.equal(saved.revision, 4);
  assert.equal(saved.state, 9);
  assert.deepEqual(
    saved.streams.map((s: any) => [
      s.id,
      s.through,
      s.receipts.map((r: any) => [r.sequence, r.revision, r.result]),
    ]),
    [
      [
        'a',
        3,
        [
          [2, 3, 7],
          [3, 4, 9],
        ],
      ],
      ['b', 1, [[1, 2, 7]]],
    ],
  );
  assert.equal((await f.owner.submit(command('a', 3, 2))).status, 'duplicate');
  assert.equal((await f.owner.submit(command('a', 3, 99))).status, 'conflict');
  assert.equal(
    (await f.owner.submit(command('a', 1, 99))).status,
    'result-unavailable',
  );
  assert.equal((await f.owner.submit(command('a', 5, 2))).status, 'gap');
  assert.equal((await f.owner.submit(command('c', 1, 1))).status, 'refused');
  assert.equal(f.writes, 4);
  assert.equal(f.reductions, 4);
  const restarted = createDurableAuthority({
    ...config,
    storage: f.storage,
    authorize: () => true,
    reduce() {
      throw Error('must not replay');
    },
  });
  await restarted.recover();
  assert.equal(
    (await restarted.submit(command('a', 1, 3))).status,
    'result-unavailable',
  );
  assert.equal(
    (await restarted.submit(command('a', 3, 2))).status,
    'duplicate',
  );
});
test('recovery rejects independently corrupted coupled envelope fields without writing', async () => {
  const f = fixture();
  await f.owner.recover();
  await f.owner.submit(command('a', 1, 1));
  await f.owner.submit(command('a', 2, 2));
  await f.owner.submit(command('b', 1, 3));
  const base = JSON.parse(f.raw!);
  const mutants = [
    (e: any) => e.streams.push(e.streams[0]),
    (e: any) => e.streams[0].receipts.pop(),
    (e: any) => (e.streams[0].receipts[0].sequence = 2),
    (e: any) => (e.streams[0].through = 0),
    (e: any) => (e.revision = 4),
    (e: any) => (e.streams[0].receipts[0].revision = 4),
    (e: any) => (e.streams[1].receipts[0].revision = 2),
    (e: any) => (e.lineage = 'foreign'),
    (e: any) => (e.schema = 'other'),
    (e: any) => (e.extra = true),
  ];
  for (const mutate of mutants) {
    const e = structuredClone(base);
    mutate(e);
    assert.throws(() => captureAuthorityEnvelope(JSON.stringify(e), config));
  }
  assert.equal(f.writes, 3);
});
test('canonical retries match object order and normalized numeric wire values', async () => {
  let reduced: any;
  const f = fixture({
    validateInput: () => true,
    reduce(c) {
      reduced = c.input;
      return { stateJson: '1', resultJson: '1' };
    },
  });
  await f.owner.recover();
  await f.owner.submit({
    stream: 'a',
    sequence: 1,
    inputJson: '{"b":1e0,"a":-0}',
  });
  assert.equal(Object.is(reduced.a, -0), false);
  assert.equal(
    (
      await f.owner.submit({
        stream: 'a',
        sequence: 1,
        inputJson: ' { "a":0, "b":1 } ',
      })
    ).status,
    'duplicate',
  );
  assert.equal(f.writes, 1);
  assert.equal(
    (
      await f.owner.submit({
        stream: 'a',
        sequence: 1,
        inputJson: '{"a":0,"b":2}',
      })
    ).status,
    'conflict',
  );
});
test('unknown delayed write cannot be bypassed by recovery reading old data', async () => {
  const f = fixture(),
    settlement = deferred<void>();
  let delayed: string | null = null,
    reads = 0;
  const storage: AuthorityStorage = {
    settle: () => (delayed ? settlement.promise : Promise.resolve()),
    async read() {
      reads++;
      return f.raw;
    },
    async compareAndSwap(q) {
      delayed = q.json;
      return 'unknown';
    },
  };
  const owner = createDurableAuthority({
    ...config,
    storage,
    authorize: () => true,
    reduce: () => ({ stateJson: '3', resultJson: '3' }),
  });
  await owner.recover();
  assert.equal((await owner.submit(command('a', 1, 3))).status, 'unknown');
  assert.equal(owner.read().snapshot, null);
  const recover = owner.recover();
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal((await owner.submit(command('a', 1, 3))).status, 'busy');
  f.raw = delayed;
  settlement.resolve();
  assert.equal((await recover).status, 'recovered');
  assert.equal((await owner.submit(command('a', 1, 3))).status, 'duplicate');
});
test('external CAS conflict requires recovery; same-revision corruption and known rollback refuse', async () => {
  const f = fixture();
  await f.owner.recover();
  const old = f.raw!;
  const other = createDurableAuthority({
    ...config,
    storage: f.storage,
    authorize: () => true,
    reduce: () => ({ stateJson: '8', resultJson: '8' }),
  });
  await other.recover();
  await other.submit(command('b', 1, 8));
  assert.equal(
    (await f.owner.submit(command('a', 1, 2))).status,
    'unavailable',
  );
  assert.equal(f.owner.read().status, 'unavailable');
  assert.equal((await f.owner.recover()).status, 'recovered');
  assert.equal(f.owner.read().snapshot?.envelope.state, 8);
  const corrupt = JSON.parse(f.raw!);
  corrupt.state = 10;
  f.raw = JSON.stringify(corrupt);
  assert.equal((await f.owner.recover()).status, 'unavailable');
  f.raw = old;
  assert.equal((await f.owner.recover()).status, 'unavailable');
  assert.equal(f.owner.read().floor, 1);
});
test('storage missing/read/settlement failures cannot seed or admit mutations', async () => {
  for (const failure of ['missing', 'read', 'settle']) {
    let writes = 0;
    const storage: AuthorityStorage = {
      async settle() {
        if (failure === 'settle') throw Error();
      },
      async read() {
        if (failure === 'read') throw Error();
        return null;
      },
      async compareAndSwap() {
        writes++;
        return 'committed';
      },
    };
    const f = fixture({ storage });
    assert.equal((await f.owner.recover()).status, 'unavailable');
    assert.equal(
      (await f.owner.submit(command('a', 1, 1))).status,
      'unavailable',
    );
    assert.equal(writes, 0);
  }
});
test('authorization is checked before retained disclosure and again after reduction', async () => {
  let allowed = true,
    calls = 0;
  const f = fixture({
    authorize() {
      calls++;
      return allowed;
    },
    reduce() {
      allowed = false;
      return { stateJson: '1', resultJson: '1' };
    },
  });
  await f.owner.recover();
  assert.equal((await f.owner.submit(command('a', 1, 1))).status, 'refused');
  assert.equal(f.writes, 0);
  assert.equal(calls, 2);
  const g = fixture({ authorize: () => allowed });
  allowed = true;
  await g.owner.recover();
  await g.owner.submit(command('a', 1, 1));
  allowed = false;
  assert.equal((await g.owner.submit(command('a', 1, 1))).status, 'refused');
  assert.equal(g.writes, 1);
});
test('callback reentry is busy and disposal fences final CAS and late recovery', async () => {
  let nested: Promise<unknown> | undefined,
    owner!: ReturnType<typeof createDurableAuthority>;
  const f = fixture({
    reduce() {
      nested = owner.submit(command('b', 1, 2));
      owner.dispose();
      return { stateJson: '1', resultJson: '1' };
    },
  });
  owner = f.owner;
  await owner.recover();
  assert.equal((await owner.submit(command('a', 1, 1))).status, 'retired');
  assert.deepEqual(await nested, { status: 'busy' });
  assert.equal(f.writes, 0);
  assert.equal(owner.read().lastConfirmed, null);
  const gate = deferred<void>(),
    g = fixture({
      storage: {
        settle: () => gate.promise,
        async read() {
          throw Error('must not read');
        },
        async compareAndSwap() {
          return 'committed';
        },
      },
    });
  const recovery = g.owner.recover();
  g.owner.dispose();
  gate.resolve();
  assert.equal((await recovery).status, 'retired');
});
test('dispose during invoked commit does not promise rollback or publish locally', async () => {
  const f = fixture(),
    gate = deferred<'committed'>();
  let next = '';
  const g = fixture({
    storage: {
      async settle() {},
      async read() {
        return f.raw;
      },
      compareAndSwap(q) {
        next = q.json;
        return gate.promise;
      },
    },
  });
  await g.owner.recover();
  const submit = g.owner.submit(command('a', 1, 4));
  assert.equal(g.owner.read().status, 'pending');
  g.owner.dispose();
  f.raw = next;
  gate.resolve('committed');
  assert.equal((await submit).status, 'retired');
  assert.equal(g.owner.read().lastConfirmed, null);
  assert.equal(JSON.parse(f.raw!).state, 4);
});
test('whole-envelope capacity refuses before storage and exhaustion retains read/retry', async () => {
  const f = fixture({
    limits: { ...limits, envelope: { ...json, maxBytes: 100 } },
  });
  await f.owner.recover();
  assert.equal((await f.owner.submit(command('a', 1, 1))).status, 'refused');
  assert.equal(f.writes, 0);
  assert.equal(f.owner.read().status, 'ready');
  const g = fixture();
  const maximum = Number.MAX_SAFE_INTEGER;
  g.raw = JSON.stringify({
    version: 1,
    lineage: 'world',
    schema: 'sum-v1',
    revision: maximum,
    state: 0,
    streams: [
      {
        id: 'a',
        through: maximum,
        receipts: [
          { sequence: maximum - 1, revision: maximum - 1, input: 0, result: 0 },
          { sequence: maximum, revision: maximum, input: 0, result: 0 },
        ],
      },
    ],
  });
  await g.owner.recover();
  assert.equal((await g.owner.submit(command('b', 1, 1))).status, 'exhausted');
  assert.equal(
    (await g.owner.submit(command('a', maximum, 0))).status,
    'duplicate',
  );
  assert.equal(g.writes, 0);
});

test('throw after possible storage commit is unknown; settled readback returns exact retained receipt', async () => {
  const f = fixture();
  const g = fixture({
    storage: {
      async settle() {},
      async read() {
        return f.raw;
      },
      async compareAndSwap(q) {
        f.raw = q.json;
        throw Error('reply lost');
      },
    },
  });
  await g.owner.recover();
  assert.equal((await g.owner.submit(command('a', 1, 6))).status, 'unknown');
  assert.equal(g.owner.read().lastConfirmed?.envelope.state, 0);
  assert.equal(
    (await g.owner.submit(command('a', 1, 6))).status,
    'unavailable',
  );
  await g.owner.recover();
  assert.equal((await g.owner.submit(command('a', 1, 6))).status, 'duplicate');
  assert.equal(g.owner.read().snapshot?.envelope.state, 6);
});
test('late revocation cannot undo invoked commit; transport must separately gate disclosure', async () => {
  let allowed = true;
  const f = fixture(),
    gate = deferred<'committed'>();
  let raw = '';
  const g = fixture({
    authorize: () => allowed,
    storage: {
      async settle() {},
      async read() {
        return f.raw;
      },
      compareAndSwap(q) {
        raw = q.json;
        return gate.promise;
      },
    },
  });
  await g.owner.recover();
  const pending = g.owner.submit(command('a', 1, 2));
  allowed = false;
  f.raw = raw;
  gate.resolve('committed');
  assert.equal((await pending).status, 'committed');
  assert.equal(g.owner.read().snapshot?.envelope.state, 2);
  assert.equal((await g.owner.submit(command('a', 1, 2))).status, 'refused');
});
test('trusted floor, permanent stream floors and incompatible receipt capacity fail closed', async () => {
  const floor = fixture({ minimumRevision: 1 });
  assert.equal((await floor.owner.recover()).status, 'unavailable');
  assert.equal(floor.writes, 0);
  const f = fixture();
  await f.owner.recover();
  await f.owner.submit(command('a', 1, 1));
  await f.owner.submit(command('a', 2, 1));
  const wrong = JSON.parse(f.raw!);
  wrong.streams[0].id = 'b';
  wrong.streams[0].through = 3;
  wrong.streams[0].receipts = [
    { sequence: 2, revision: 2, input: 1, result: 2 },
    { sequence: 3, revision: 3, input: 1, result: 3 },
  ];
  wrong.revision = 3;
  wrong.state = 3;
  f.raw = JSON.stringify(wrong);
  assert.equal((await f.owner.recover()).status, 'unavailable');
  assert.equal(f.owner.read().floor, 2);
  assert.throws(() =>
    captureAuthorityEnvelope(f.raw!, {
      ...config,
      limits: { ...limits, maxReceiptsPerStream: 1 },
    }),
  );
});
test('final authorization reentry disposing owner cannot invoke CAS', async () => {
  let calls = 0,
    owner!: ReturnType<typeof createDurableAuthority>;
  const f = fixture({
    authorize() {
      if (++calls === 2) owner.dispose();
      return true;
    },
  });
  owner = f.owner;
  await owner.recover();
  assert.equal((await owner.submit(command('a', 1, 2))).status, 'retired');
  assert.equal(f.writes, 0);
});

test('retiring in recovery validation prevents every later creator validator', async () => {
  const seed = fixture();
  await seed.owner.recover();
  await seed.owner.submit(command('a', 1, 3));
  for (const phase of ['state', 'input']) {
    const calls: string[] = [];
    let owner!: ReturnType<typeof createDurableAuthority>;
    const check = (name: string) => {
      calls.push(name);
      if (phase === name) owner.dispose();
      return true;
    };
    owner = createDurableAuthority({
      ...config,
      storage: seed.storage,
      authorize: () => true,
      validateState: () => check('state'),
      validateInput: () => check('input'),
      validateResult: () => check('result'),
      reduce() {
        throw Error('not permitted');
      },
    });
    assert.equal((await owner.recover()).status, 'retired');
    assert.deepEqual(calls, phase === 'state' ? ['state'] : ['state', 'input']);
    assert.equal(seed.writes, 1);
  }
});
test('recovery cannot rewrite overlapping confirmed receipt identity or result at a newer revision', async () => {
  for (const field of ['input', 'result', 'revision']) {
    const f = fixture(); await f.owner.recover();
    await f.owner.submit(command('a', 1, 7));
    await f.owner.submit(command('b', 1, 1));
    const e = JSON.parse(f.raw!);
    e.revision = 3; e.streams[1].through = 2;
    e.streams[1].receipts.push({ sequence: 2, revision: 3, input: 1, result: 9 }); e.state = 9;
    if (field === 'revision') {
      e.streams[0].receipts[0].revision = 2;
      e.streams[1].receipts[0].revision = 1;
    } else e.streams[0].receipts[0][field] = 8;
    f.raw = JSON.stringify(e);
    assert.equal((await f.owner.recover()).status, 'unavailable', field);
    assert.equal(f.owner.read().lastConfirmed?.envelope.revision, 2);
    assert.equal(f.writes, 2);
  }
});
test('receipt chronology rejects competing omitted prefixes without iterating world history', () => {
  const receipt = (sequence: number, revision: number) => ({ sequence, revision, input: 1, result: 1 });
  const e = { version: 1, lineage: config.lineage, schema: config.schema, revision: 6, state: 0, streams: [
    { id: 'a', through: 3, receipts: [receipt(2, 2), receipt(3, 6)] },
    { id: 'b', through: 3, receipts: [receipt(2, 3), receipt(3, 5)] },
  ] };
  assert.throws(() => captureAuthorityEnvelope(JSON.stringify(e), config));
  e.streams[1].receipts[0].revision = 4; // a1,a2,b1,b2,b3,a3 is feasible
  assert.equal(captureAuthorityEnvelope(JSON.stringify(e), config).envelope.revision, 6);
  const large = Number.MAX_SAFE_INTEGER;
  e.revision = large; e.streams = [{ id: 'a', through: large, receipts: [receipt(large - 1, large - 1), receipt(large, large)] }];
  assert.equal(captureAuthorityEnvelope(JSON.stringify(e), config).envelope.revision, large);
});
test('recovery permits actual multi-stream history with receipt eviction and unchanged overlapping receipts', async () => {
  const f = fixture(); await f.owner.recover();
  await f.owner.submit(command('a', 1, 1)); await f.owner.submit(command('b', 1, 2));
  const other = createDurableAuthority({ ...config, storage: f.storage, authorize: () => true,
    reduce: ({ state, input }) => ({ stateJson: String(Number(state) + Number(input)), resultJson: String(input) }) });
  await other.recover();
  await other.submit(command('a', 2, 3)); await other.submit(command('b', 2, 4));
  await other.submit(command('a', 3, 5)); await other.submit(command('b', 3, 6));
  assert.equal((await f.owner.recover()).status, 'recovered');
  assert.equal(f.owner.read().snapshot?.envelope.revision, 6);
  assert.equal((await f.owner.submit(command('a', 1, 1))).status, 'result-unavailable');
  assert.equal((await f.owner.submit(command('a', 2, 3))).status, 'duplicate');
});
test('bounded receipt chronology agrees with independently enumerated small command interleavings', () => {
  const possible = new Set<string>();
  for (let mask = 0; mask < 64; mask++) {
    const a: number[] = [], b: number[] = [];
    for (let revision = 1; revision <= 6; revision++) ((mask & (1 << (revision - 1))) ? a : b).push(revision);
    if (a.length === 3 && b.length === 3) possible.add(JSON.stringify([a.slice(1), b.slice(1)]));
  }
  const receipt = (sequence: number, revision: number) => ({ sequence, revision, input: 1, result: 1 });
  for (let a2 = 1; a2 <= 6; a2++) for (let a3 = a2 + 1; a3 <= 6; a3++) {
    for (let b2 = 1; b2 <= 6; b2++) for (let b3 = b2 + 1; b3 <= 6; b3++) {
      const e = { version: 1, lineage: config.lineage, schema: config.schema, revision: 6, state: 0, streams: [
        { id: 'a', through: 3, receipts: [receipt(2, a2), receipt(3, a3)] },
        { id: 'b', through: 3, receipts: [receipt(2, b2), receipt(3, b3)] },
      ] };
      let accepted = true;
      try { captureAuthorityEnvelope(JSON.stringify(e), config); } catch { accepted = false; }
      const key = JSON.stringify([[a2, a3], [b2, b3]]);
      assert.equal(accepted, possible.has(key), key);
    }
  }
});

function timed(readings: number[] | (() => number), extra: Partial<AuthorityOptions> = {}) {
  const base = fixture();
  let calls = 0;
  const list = Array.isArray(readings) ? readings : null;
  const clock = () => {
    calls++;
    if (!list) return (readings as () => number)();
    return list.length > 1 ? list.shift()! : list[0]!;
  };
  const f = fixture({ storage: base.storage, clock, ...extra });
  return {
    owner: f.owner,
    get writes() {
      return base.writes;
    },
    get reductions() {
      return f.reductions;
    },
    get calls() {
      return calls;
    },
    get raw() {
      return base.raw;
    },
  };
}

test('NW06: deadline expires exactly at the boundary before any work and consumes no sequence', async () => {
  const t = timed([100]);
  await t.owner.recover();
  assert.deepEqual(await t.owner.submit(command('a', 1, 3), { deadlineMs: 100 }), { status: 'expired' });
  assert.equal(t.writes, 0);
  assert.equal(t.reductions, 0);
  assert.equal(t.owner.read().status, 'ready');
  assert.equal(t.owner.read().reason, null);
  const committed = await t.owner.submit(command('a', 1, 3), { deadlineMs: 101 });
  assert.equal(committed.status, 'committed');
  assert.equal((committed as { sequence: number }).sequence, 1);
  assert.equal(JSON.parse(t.raw!).revision, 1);
  assert.equal(t.writes, 1);
});

test('NW06: deadline passing during creator callbacks refuses at the last pre-invocation check', async () => {
  let time = 0;
  const t = timed(() => time, {
    reduce({ state, input }) {
      time = 50;
      const value = (state as number) + (input as number);
      return { stateJson: String(value), resultJson: String(value) };
    },
  });
  await t.owner.recover();
  assert.deepEqual(await t.owner.submit(command('a', 1, 2), { deadlineMs: 50 }), { status: 'expired' });
  assert.equal(t.writes, 0);
  assert.equal(t.calls, 2);
  assert.equal(t.owner.read().snapshot!.envelope.revision, 0);
  time = 0;
  assert.equal((await t.owner.submit(command('a', 2, 2))).status, 'gap');
  assert.equal((await t.owner.submit(command('a', 1, 2))).status, 'committed');
  assert.equal(t.writes, 1);
});

test('NW06: deadline passing while storage is in flight never converts committed/unknown into expiry', async () => {
  for (const ending of ['committed', 'unknown', 'throw'] as const) {
    const base = fixture(),
      gate = deferred<void>();
    let time = 10,
      calls = 0;
    const owner = createDurableAuthority({
      ...config,
      authorize: () => true,
      reduce: () => ({ stateJson: '1', resultJson: '1' }),
      clock: () => {
        calls++;
        return time;
      },
      storage: {
        settle: () => base.storage.settle(),
        read: () => base.storage.read(),
        async compareAndSwap(q) {
          await gate.promise;
          if (ending === 'throw') throw Error('lost connection');
          const outcome = await base.storage.compareAndSwap(q);
          return ending === 'unknown' ? 'unknown' : outcome;
        },
      },
    });
    await owner.recover();
    const pending = owner.submit(command('a', 1, 1), { deadlineMs: 20 });
    await Promise.resolve();
    assert.equal(calls, 2);
    time = 1_000;
    gate.resolve();
    const outcome = await pending;
    assert.equal(calls, 2, 'clock is never read after invocation');
    assert.equal(base.writes, ending === 'throw' ? 0 : 1);
    if (ending === 'committed') {
      assert.equal(outcome.status, 'committed');
      assert.equal(owner.read().status, 'ready');
    } else {
      assert.deepEqual(outcome, { status: 'unknown' });
      assert.equal(owner.read().status, 'unknown');
      assert.equal(owner.read().reason, 'commit-unknown');
    }
  }
});

test('NW06: non-monotonic clock readings are compared independently and invalid readings refuse before storage', async () => {
  const back = timed([50, 10]);
  await back.owner.recover();
  assert.equal((await back.owner.submit(command('a', 1, 1), { deadlineMs: 60 })).status, 'committed');
  const late = timed([10, 60, 0]);
  await late.owner.recover();
  assert.deepEqual(await late.owner.submit(command('a', 1, 1), { deadlineMs: 60 }), { status: 'expired' });
  assert.equal(late.writes, 0);
  assert.equal((await late.owner.submit(command('a', 1, 1), { deadlineMs: 60 })).status, 'committed');
  for (const reading of [() => NaN, () => Infinity, () => { throw Error('clock'); }]) {
    const t = timed(reading);
    await t.owner.recover();
    assert.deepEqual(await t.owner.submit(command('a', 1, 1), { deadlineMs: 60 }), {
      status: 'refused',
      reason: 'clock',
    });
    assert.equal(t.writes, 0);
    assert.equal(t.owner.read().status, 'ready');
    assert.equal((await t.owner.submit(command('a', 1, 1))).status, 'committed');
  }
});

test('NW06: expired exact retries never read receipts and a later live retry keeps idempotent identity', async () => {
  const t = timed([5]);
  await t.owner.recover();
  assert.equal((await t.owner.submit(command('a', 1, 4))).status, 'committed');
  assert.deepEqual(await t.owner.submit(command('a', 1, 4), { deadlineMs: 5 }), { status: 'expired' });
  assert.deepEqual(await t.owner.submit(command('a', 1, 99), { deadlineMs: 5 }), { status: 'expired' });
  assert.equal((await t.owner.submit(command('a', 1, 4), { deadlineMs: 6 })).status, 'duplicate');
  assert.equal((await t.owner.submit(command('a', 1, 99), { deadlineMs: 6 })).status, 'conflict');
  assert.deepEqual(await t.owner.submit(command('a', 2, 1), { deadlineMs: 1 }), { status: 'expired' });
  assert.equal((await t.owner.submit(command('a', 3, 1))).status, 'gap');
  const retried = await t.owner.submit(command('a', 2, 1), { deadlineMs: 6 });
  assert.equal(retried.status, 'committed');
  assert.equal((retried as { revision: number }).revision, 2);
  assert.equal((await t.owner.submit(command('a', 2, 1))).status, 'duplicate');
  assert.equal(t.writes, 2);
});

test('NW06: deadlines are optional, need an injected clock and finite value, and admit no queued work', async () => {
  const silent = timed([0]);
  await silent.owner.recover();
  assert.equal((await silent.owner.submit(command('a', 1, 1))).status, 'committed');
  assert.equal(silent.calls, 0);
  const f = fixture();
  await f.owner.recover();
  assert.deepEqual(await f.owner.submit(command('a', 1, 1), { deadlineMs: 10 }), {
    status: 'refused',
    reason: 'deadline',
  });
  for (const deadlineMs of [NaN, Infinity, '10' as never])
    assert.deepEqual(await silent.owner.submit(command('a', 2, 1), { deadlineMs }), {
      status: 'refused',
      reason: 'deadline',
    });
  assert.equal(f.writes + silent.writes, 1);
  assert.throws(() => fixture({ clock: 1 as never }), /clock/);
  const gate = deferred<void>(),
    base = fixture();
  const owner = createDurableAuthority({
    ...config,
    authorize: () => true,
    reduce: () => ({ stateJson: '1', resultJson: '1' }),
    clock: () => 0,
    storage: {
      settle: () => base.storage.settle(),
      read: () => base.storage.read(),
      async compareAndSwap(q) {
        await gate.promise;
        return base.storage.compareAndSwap(q);
      },
    },
  });
  await owner.recover();
  const first = owner.submit(command('a', 1, 1), { deadlineMs: 10 });
  assert.deepEqual(await owner.submit(command('b', 1, 1), { deadlineMs: 0 }), { status: 'busy' });
  gate.resolve();
  assert.equal((await first).status, 'committed');
});

test('NW06: clock reentry is busy and disposal from the clock prevents storage invocation', async () => {
  let owner!: ReturnType<typeof createDurableAuthority>,
    nested: Promise<unknown> | undefined,
    reads = 0;
  const t = timed(() => {
    reads++;
    if (reads === 1) nested = owner.submit(command('b', 1, 1));
    if (reads === 2) owner.dispose();
    return 0;
  });
  owner = t.owner;
  await owner.recover();
  assert.deepEqual(await owner.submit(command('a', 1, 1), { deadlineMs: 10 }), { status: 'retired' });
  assert.deepEqual(await nested, { status: 'busy' });
  assert.equal(t.writes, 0);
});

test('NW06: a deadlineMs getter reads under the reserved slot, so reentry is busy and disposal retires', async () => {
  for (const reenter of ['submit', 'recover', 'dispose'] as const) {
    const base = fixture(),
      gate = deferred<void>();
    let inflight = 0,
      maxInflight = 0,
      nested: Promise<unknown> | undefined,
      owner!: ReturnType<typeof createDurableAuthority>;
    owner = createDurableAuthority({
      ...config,
      authorize: () => true,
      reduce: () => ({ stateJson: '1', resultJson: '1' }),
      clock: () => 0,
      storage: {
        settle: () => base.storage.settle(),
        read: () => base.storage.read(),
        async compareAndSwap(q) {
          inflight++;
          maxInflight = Math.max(maxInflight, inflight);
          await gate.promise;
          inflight--;
          return base.storage.compareAndSwap(q);
        },
      },
    });
    await owner.recover();
    const admission = {
      get deadlineMs() {
        if (reenter === 'submit') nested ??= owner.submit(command('b', 1, 1));
        if (reenter === 'recover') nested ??= owner.recover();
        if (reenter === 'dispose') owner.dispose();
        return 100;
      },
    };
    const outer = owner.submit(command('a', 1, 1), admission);
    if (reenter === 'dispose') {
      assert.deepEqual(await outer, { status: 'retired' });
      assert.equal(owner.read().status, 'retired');
      assert.equal(base.writes, 0);
      continue;
    }
    assert.deepEqual(await nested, { status: 'busy' });
    assert.equal(owner.read().status, 'pending');
    assert.deepEqual(await owner.submit(command('c', 1, 1)), { status: 'busy' });
    gate.resolve();
    assert.equal((await outer).status, 'committed');
    assert.equal(maxInflight, 1);
    assert.equal(base.writes, 1);
    assert.equal(owner.read().status, 'ready');
  }
});

test('NW06: the clock is called without a receiver and non-object admission arguments are ignored', async () => {
  const holder = {
    base: 0,
    now(this: { base: number }) {
      return this.base;
    },
  };
  const unbound = timed(holder.now as () => number);
  await unbound.owner.recover();
  assert.deepEqual(await unbound.owner.submit(command('a', 1, 1), { deadlineMs: 10 }), {
    status: 'refused',
    reason: 'clock',
  });
  const wrapped = timed(() => holder.now());
  await wrapped.owner.recover();
  assert.equal((await wrapped.owner.submit(command('a', 1, 1), { deadlineMs: 10 })).status, 'committed');
  const mapped = timed([0]);
  await mapped.owner.recover();
  const outcomes = [];
  for (const [index, cmd] of [command('a', 1, 1), command('a', 2, 1)].entries())
    outcomes.push(await (mapped.owner.submit as (c: unknown, i: unknown) => Promise<{ status: string }>)(cmd, index));
  assert.deepEqual(outcomes.map((o) => o.status), ['committed', 'committed']);
  assert.equal((await mapped.owner.submit(command('a', 3, 1), null as never)).status, 'committed');
  assert.equal(mapped.calls, 0);
  assert.deepEqual(await mapped.owner.submit(command('a', 4, 1), {} as never), {
    status: 'refused',
    reason: 'deadline',
  });
});
