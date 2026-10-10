import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptHost, DEFAULT_SCRIPT_LIMITS, loadScriptVm, type ScriptHost, type ScriptHostOptions} from './index';
import type {ScriptVm} from './vm-contract';

const loadNodeVm = () => import('./lua-vm').then(m => m.createLuaVm());
let vmPromise: Promise<ScriptVm> | null = null;
const vm = () => (vmPromise ??= loadScriptVm({load: loadNodeVm}));
const host = async (o: Partial<ScriptHostOptions> = {}): Promise<ScriptHost> =>
  createScriptHost(await vm(), {seed: 7, ...o});
const loaded = async (source: string, o: Partial<ScriptHostOptions> = {}, caps: string[] = []) => {
  const h = await host(o);
  const r = h.load('s', source, {capabilities: caps});
  assert.equal(r.status, 'loaded', JSON.stringify(r));
  return h;
};
const ok = (r: ReturnType<ScriptHost['call']>) => {
  assert.equal(r.status, 'ok', JSON.stringify(r));
  return (r as {value: unknown}).value;
};

test('SCRIPT limits and options are validated before any state exists', async () => {
  const v = await vm();
  assert.throws(() => createScriptHost(v, {seed: -1}), /seed/);
  assert.throws(() => createScriptHost(v, {seed: 1.5}), /seed/);
  assert.throws(() => createScriptHost(v, {seed: 1, limits: {maxScripts: 0}}), /maxScripts/);
  assert.throws(() => createScriptHost(v, {seed: 1, limits: {memoryBytes: 1000}}), /memoryBytes/);
  assert.throws(() => createScriptHost(v, {seed: 1, limits: {nope: 1} as never}), /unknown limit/);
  assert.throws(() => createScriptHost(v, {seed: 1, api: {'not ok': {run: () => null}}}), /Lua identifier/);
  assert.throws(() => createScriptHost(v, {seed: 1, api: {end: {run: () => null}}}), /Lua identifier/);
  const h = createScriptHost(v, {seed: 1});
  assert.equal(h.load('Bad Id', '').status, 'refused');
  assert.equal(h.load('a', 'x'.repeat(DEFAULT_SCRIPT_LIMITS.maxSourceLength + 1)).status, 'refused');
  assert.deepEqual(h.load('a', '', {capabilities: ['missing']}).status, 'refused');
  h.dispose();
});

test('SCRIPT sandbox exposes only deterministic, interruptible functions', async () => {
  const h = await loaded(
    `
    function probe()
      return {io = type(io), os = type(os), debug = type(debug), package = type(package), coroutine = type(coroutine),
        load = type(load), require = type(require), print = type(print), collectgarbage = type(collectgarbage),
        dofile = type(dofile), dump = type(string.dump), nxt = type(next), seed = type(math.randomseed),
        match = type(string.match), gsub = type(string.gsub)}
    end
    function order()
      local t = {b = 1, a = 2, [3] = 'x', [1] = 'y', [true] = 0, [false] = 0, aa = 3}
      local out = {}
      for k in pairs(t) do out[#out + 1] = tostring(k) end
      return table.concat(out, ',')
    end
    function addresses() return tostring({}) .. ' ' .. tostring(print or tostring) .. ' ' .. string.format('%s', {}) end
    function pointer() return string.format('%p', {}) end
    function finaliser() setmetatable({}, {__gc = function() end}) end
    function weak() setmetatable({}, {__mode = 'k'}) end
    function plain() return {string.find('a.b', '.', 1, true)} end
    function pattern() return string.find('abc', 'b') end
  `,
    {limits: {failuresBeforeFault: 100}},
  );
  const probe = ok(h.call('s', 'probe')) as Record<string, string>;
  assert.equal(Object.keys(probe).length, 15);
  for (const [k, v] of Object.entries(probe)) assert.equal(v, 'nil', k);
  assert.equal(ok(h.call('s', 'order')), '1,3,a,aa,b,false,true');
  assert.equal(ok(h.call('s', 'addresses')), 'table function table');
  for (const fn of ['pointer', 'finaliser', 'weak', 'pattern']) assert.equal(h.call('s', fn).status, 'failed', fn);
  assert.deepEqual(ok(h.call('s', 'plain')), [2, 2]);
  const binary = await host();
  assert.equal(binary.load('b', '\x1bLua').status, 'failed');
  const patterns = await loaded(`function m() return string.match('key=value', '(%w+)=(%w+)') end`, {
    allowPatterns: true,
  });
  assert.equal(ok(patterns.call('s', 'm')), 'key');
  for (const x of [h, binary, patterns]) x.dispose();
});

test('SCRIPT instruction budget is exact, deterministic and cannot be caught', async () => {
  const h = await loaded(
    `
    function spin() while true do end end
    function evade() while true do pcall(function() while true do end end) end end
    function evade_x() while true do xpcall(function() while true do end end, function(e) return e end) end end
    function count(n) local s = 0 for i = 1, n do s = s + i end return s end
  `,
    {limits: {instructionsPerCall: 50_000, failuresBeforeFault: 100}},
  );
  for (const fn of ['spin', 'evade', 'evade_x']) {
    const r = h.call('s', fn);
    assert.equal(r.status, 'failed');
    if (r.status !== 'failed') continue;
    assert.equal(r.reason, 'instructions', fn);
    assert.equal(r.charged, 50_000);
    assert.equal(r.deterministic, true);
  }
  // The same work stops at the same place every time.
  const a = h.call('s', 'count', [1e9]),
    b = h.call('s', 'count', [1e9]);
  assert.deepEqual(a, b);
  assert.equal(ok(h.call('s', 'count', [100])), 5050);
  h.dispose();
});

test('SCRIPT wall-time and memory stops fault the script and report non-determinism', async () => {
  let fake = 0;
  const h = await host({
    clock: () => (fake += 1),
    limits: {wallMsPerCall: 50, instructionsPerCall: 1_000_000_000, memoryBytes: 256 * 1024},
  });
  assert.equal(h.load('wall', 'function spin() while true do end end').status, 'loaded');
  assert.equal(
    h.load('mem', 'function grow() local t = {} for i = 1, 1e8 do t[i] = i end end function hi() return 1 end').status,
    'loaded',
  );
  const w = h.call('wall', 'spin');
  assert.equal(w.status === 'failed' && w.reason, 'wall');
  assert.equal(w.status === 'failed' && w.deterministic, false);
  assert.equal(w.status === 'failed' && w.faulted, true);
  assert.equal(h.call('wall', 'spin').status, 'refused');
  const m = h.call('mem', 'grow');
  assert.equal(m.status === 'failed' && m.reason, 'memory');
  assert.ok((h.status('mem')?.memoryBytes ?? Infinity) <= 256 * 1024);
  assert.equal(h.status('mem')?.faulted, true);
  h.dispose();
});

test('SCRIPT capabilities: only granted host functions exist; values are copied and bounded', async () => {
  const seen: unknown[] = [];
  let hostRef: ScriptHost | null = null;
  const api = {
    add: {run: ([a, b]: readonly unknown[]) => (a as number) + (b as number)},
    record: {cost: 1, run: (args: readonly unknown[]) => void seen.push(args)},
    fail: {
      run: () => {
        throw Error('no such door');
      },
    },
    reenter: {
      run: () => {
        const r = hostRef!.call('s', 'ping');
        return r.status === 'refused' ? r.reason : 'entered';
      },
    },
    leak: {run: () => ({fn: () => 1}) as never},
  };
  const h = await host({api, limits: {maxHostCallsPerCall: 3, maxValueNodes: 8}});
  hostRef = h;
  assert.equal(
    h.load(
      's',
      `
      function caps() return {add = type(host.add), record = type(host.record), fail = type(host.fail)} end
      function sum() return host.add(2, 3) end
      function pass(x) host.record(x, {1, 2}) end
      function caught() local ok, e = pcall(host.fail) return {ok, e} end
      function many() for i = 1, 4 do host.add(1, 1) end end
      function back() return host.reenter() end
      function bad() return host.leak() end
      function fn() return function() end end
      function ping() return 'pong' end
    `,
      {capabilities: ['add', 'record', 'fail', 'reenter', 'leak']},
    ).status,
    'loaded',
  );
  assert.equal(h.load('other', `function try() return type(host.add) end`, {capabilities: []}).status, 'loaded');
  assert.equal(ok(h.call('other', 'try')), 'nil');
  assert.equal(ok(h.call('s', 'sum')), 5);
  ok(h.call('s', 'pass', [{a: [1, 'x']}]));
  assert.deepEqual(seen, [[{a: [1, 'x']}, [1, 2]]]);
  assert.ok(Object.isFrozen(seen[0]));
  const caught = ok(h.call('s', 'caught')) as unknown[];
  assert.equal(caught[0], false);
  assert.match(String(caught[1]), /no such door/);
  const many = h.call('s', 'many');
  assert.equal(many.status === 'failed' && many.reason, 'host-calls');
  assert.equal(ok(h.call('s', 'back')), 'reentrant');
  assert.equal(h.call('s', 'bad').status, 'failed');
  const fn = h.call('s', 'fn');
  assert.equal(fn.status === 'failed' && fn.reason, 'value');
  assert.equal(h.call('s', 'ping', [[1, 2, 3, 4, 5, 6, 7, 8, 9]]).status, 'refused');
  assert.equal(h.call('s', 'ping', [() => 1] as never).status, 'refused');
  assert.equal(h.call('s', 'nothing').status, 'missing');
  h.dispose();
});

test('SCRIPT errors are isolated per script and fault after repeated failures; reload recovers', async () => {
  const h = await host({limits: {failuresBeforeFault: 2}});
  h.load('a', `function boom() error('bad') end function ok() return 1 end`);
  h.load('b', `x = 0 function inc() x = x + 1 return x end`);
  assert.equal(h.call('a', 'boom').status, 'failed');
  assert.equal(ok(h.call('b', 'inc')), 1);
  const second = h.call('a', 'boom');
  assert.equal(second.status === 'failed' && second.faulted, true);
  assert.equal(h.call('a', 'ok').status, 'refused');
  assert.equal(ok(h.call('b', 'inc')), 2);
  assert.equal(h.reload('a', `function ok() return 2 end`).status, 'loaded');
  assert.equal(ok(h.call('a', 'ok')), 2);
  h.dispose();
});

test('SCRIPT timers run on the fixed tick in due/id order, bounded per tick with deferral', async () => {
  const h = await loaded(
    `
    fired = {}
    function note(tag) fired[#fired + 1] = tag .. '@' .. now() end
    function setup()
      after(2, 'note', 'b')
      after(1, 'note', 'a')
      every(3, 'note', 'r')
      local c = after(1, 'note', 'cancelled')
      cancel(c)
      for i = 1, 3 do after(5, 'note', 'burst' .. i) end
    end
    function read() return fired end
    function too_many() for i = 1, 100 do after(1, 'note', 'x') end end
  `,
    {limits: {maxTimerFiresPerTick: 2, maxTimersPerScript: 8}},
  );
  ok(h.call('s', 'setup'));
  const reports = Array.from({length: 7}, () => h.tick());
  assert.deepEqual(ok(h.call('s', 'read')), ['a@1', 'b@2', 'r@3', 'burst1@5', 'burst2@5', 'burst3@6', 'r@6']);
  assert.equal(reports[4]?.deferred, 1);
  assert.equal(h.call('s', 'too_many').status, 'failed');
  h.dispose();
});

test('SCRIPT math.random draws from a seeded per-script stream', async () => {
  const src = `function roll() local t = {} for i = 1, 5 do t[i] = math.random(1, 6) end t[6] = math.random() return t end`;
  const a = await host({seed: 11}),
    b = await host({seed: 11}),
    c = await host({seed: 12});
  for (const h of [a, b, c]) h.load('dice', src);
  a.load('other', src);
  const ra = ok(a.call('dice', 'roll')) as number[];
  assert.deepEqual(ra, ok(b.call('dice', 'roll')));
  assert.notDeepEqual(ra, ok(c.call('dice', 'roll')));
  assert.notDeepEqual(ra, ok(a.call('other', 'roll')));
  assert.ok(ra.slice(0, 5).every(n => Number.isInteger(n) && n >= 1 && n <= 6));
  for (const h of [a, b, c]) h.dispose();
});

const COUNTER = `
  state.n = state.n or 0
  function start() every(2, 'bump', 1) end
  function bump(by) state.n = state.n + by + math.random(0, 3) end
  function on_restore() state.restored = (state.restored or 0) + 1 end
  function read() return {state.n, now()} end
`;

test('SCRIPT save/restore continues exactly: state, timers, random stream and tick survive JSON', async () => {
  const live = await host({seed: 3});
  live.load('counter', COUNTER);
  ok(live.call('counter', 'start'));
  for (let i = 0; i < 9; i++) live.tick();
  const saved = live.save();
  assert.ok(saved.ok);
  const text = JSON.stringify(saved.ok && saved.snapshot);
  for (let i = 0; i < 9; i++) live.tick();
  const expected = ok(live.call('counter', 'read'));

  const other = await host({seed: 3});
  const restored = other.restore(JSON.parse(text), {counter: COUNTER});
  assert.deepEqual(restored, {ok: true});
  for (let i = 0; i < 9; i++) other.tick();
  assert.deepEqual(ok(other.call('counter', 'read')), expected);
  const st = other.save();
  assert.equal(st.ok && (st.snapshot.scripts[0]?.state as {restored: number}).restored, 1);

  // Changed code is refused unless accepted; malformed snapshots change nothing.
  assert.equal(other.restore(JSON.parse(text), {counter: COUNTER + ' '}).ok, false);
  assert.equal(other.restore(JSON.parse(text), {counter: COUNTER + ' '}, {acceptChangedSources: true}).ok, true);
  const before = other.now;
  for (const bad of [
    null,
    {},
    {...JSON.parse(text), version: 2},
    {...JSON.parse(text), seed: 4},
    {...JSON.parse(text), tick: -1},
  ])
    assert.equal(other.restore(bad, {counter: COUNTER}).ok, false);
  assert.equal(other.now, before);
  // A restore whose code fails keeps the running scripts.
  assert.equal(other.restore(JSON.parse(text), {counter: 'error("x")'}, {acceptChangedSources: true}).ok, false);
  assert.ok(ok(other.call('counter', 'read')));
  live.dispose();
  other.dispose();
});

test('SCRIPT state that is not plain data cannot be saved; the save reports which script', async () => {
  const h = await loaded(`state.f = function() end`);
  const r = h.save();
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.script, 's');
  h.dispose();
});

test('SCRIPT hot reload keeps state, timers and stream; a broken reload keeps the old code', async () => {
  const h = await host();
  h.load('door', `state.opens = state.opens or 0 function open() state.opens = state.opens + 1 return 'v1' end`);
  ok(h.call('door', 'open'));
  assert.equal(
    h.reload(
      'door',
      `state.opens = state.opens or 0 function open() state.opens = state.opens + 1 return 'v2' end
      function on_reload() state.reloaded = true end`,
    ).status,
    'loaded',
  );
  assert.equal(ok(h.call('door', 'open')), 'v2');
  const s = h.save();
  assert.deepEqual(s.ok && s.snapshot.scripts[0]?.state, {opens: 2, reloaded: true});
  const broken = h.reload('door', `function open( return end`);
  assert.equal(broken.status, 'failed');
  assert.equal(ok(h.call('door', 'open')), 'v2');
  h.dispose();
});

test('SCRIPT dispose is idempotent and refuses later work; loading honours abort', async () => {
  const h = await loaded(`function f() return 1 end`);
  h.dispose();
  h.dispose();
  assert.equal(h.call('s', 'f').status, 'refused');
  assert.equal(h.load('t', '').status, 'refused');
  assert.throws(() => h.tick(), /disposed/);
  const pre = new AbortController();
  pre.abort(Error('left'));
  await assert.rejects(loadScriptVm({signal: pre.signal, load: loadNodeVm}), /left/);
  const mid = new AbortController();
  const p = loadScriptVm({signal: mid.signal, load: () => new Promise(() => {})});
  mid.abort(Error('route changed'));
  await assert.rejects(p, /route changed/);
});

test('SCRIPT the wall clock is injected: none means no wall stop; a failing clock fails closed', async () => {
  const src = 'function spin() while true do end end';
  const none = await loaded(src, {limits: {instructionsPerCall: 200_000, wallMsPerCall: 1}});
  const r = none.call('s', 'spin');
  assert.equal(r.status === 'failed' && r.reason, 'instructions');
  const broken = await loaded(src, {
    clock: () => {
      throw Error('no clock');
    },
  });
  const b = broken.call('s', 'spin');
  assert.equal(b.status === 'failed' && b.reason, 'wall');
  assert.equal(b.status === 'failed' && b.charged < 2_000, true);
  none.dispose();
  broken.dispose();
});

test('SCRIPT a host function that throws a non-Error value raises an ordinary script error', async () => {
  const h = await loaded(
    `function f() local ok, e = pcall(host.odd) return {ok, e} end`,
    {
      api: {
        odd: {
          run: () => {
            throw 'plain string';
          },
        },
      },
    },
    ['odd'],
  );
  assert.deepEqual(ok(h.call('s', 'f')), [false, 'plain string']);
  h.dispose();
});

test('SCRIPT native library work is charged to the budget: no zero-instruction loops, no unbounded copies', async () => {
  const h = await loaded(
    `
    function move() table.move({}, 1, 100000000, 1) end
    function rep_empty() return #string.rep('', 1e8) .. #string.rep('', 2^62, '') end
    function rep_huge() return string.rep('ab', 2^62) end
    function churn() while true do local x = string.rep('a', 400000) end end
    function small() local t = {} for i = 1, 10 do t[i] = i end table.move(t, 1, 10, 2) return {#t, t[11], #string.rep('ab', 3, ',')} end
  `,
    {limits: {failuresBeforeFault: 100}},
  );
  const started = Date.now();
  const move = h.call('s', 'move');
  assert.equal(move.status === 'failed' && move.reason, 'instructions');
  assert.equal(ok(h.call('s', 'rep_empty')), '00');
  const huge = h.call('s', 'rep_huge');
  assert.equal(huge.status === 'failed' && huge.reason, 'instructions');
  const churn = h.call('s', 'churn');
  assert.equal(churn.status === 'failed' && churn.reason, 'instructions');
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
  assert.deepEqual(ok(h.call('s', 'small')), [11, 10, 8]);
  h.dispose();
});

test('SCRIPT dispose requested by a host function waits until the running call has finished', async () => {
  let ref: ScriptHost | null = null;
  const h = await loaded(
    `function f() host.stop() return 'finished' end`,
    {api: {stop: {run: () => void ref!.dispose()}}},
    ['stop'],
  );
  ref = h;
  assert.equal(ok(h.call('s', 'f')), 'finished');
  assert.equal(h.call('s', 'f').status, 'refused');
  const other = await loaded(`function g() return 2 end`);
  assert.equal(ok(other.call('s', 'g')), 2);
  other.dispose();
});

test('SCRIPT a __mode added to a metatable after setmetatable has no effect', async () => {
  const h = await loaded(
    `
    function weak()
      local mt = {}
      local w = setmetatable({}, mt)
      mt.__mode = 'v'
      for i = 1, 100 do w[i] = {} end
      for i = 1, 300000 do local junk = {i, i, i} end
      local n = 0
      for _ in pairs(w) do n = n + 1 end
      return {n, getmetatable(w) == mt}
    end
  `,
    {limits: {instructionsPerCall: 50_000_000, memoryBytes: 8 * 1024 * 1024}},
  );
  assert.deepEqual(ok(h.call('s', 'weak')), [100, true]);
  h.dispose();
});

test('SCRIPT value domain is checked before the call, and strings read back strictly', async () => {
  const h = await loaded(
    `function f(x) return x end function bad() return '\\xC2A' end function nul() return 'a\\0b' end`,
    {limits: {maxStateDepth: 3, failuresBeforeFault: 2}},
  );
  for (let i = 0; i < 3; i++) assert.equal(h.call('s', 'f', [[1, null]]).status, 'refused');
  assert.equal(h.call('s', 'f', ['a\0b']).status, 'refused');
  assert.equal(ok(h.call('s', 'f', [null])), null);
  const bad = h.call('s', 'bad');
  assert.equal(bad.status === 'failed' && bad.reason, 'value');
  assert.equal(h.status('s')?.faulted, false);
  const deep = await host({limits: {maxStateDepth: 3}});
  assert.equal(deep.load('d', 'x = 1', {state: {a: {b: {}}}}).status, 'loaded');
  assert.equal(deep.save().ok, true);
  h.dispose();
  deep.dispose();
});

test('SCRIPT host functions throwing Infinity, and reentrant save, are refused cleanly', async () => {
  let ref: ScriptHost | null = null;
  const h = await loaded(
    `function f() local ok, e = pcall(host.boom) return {ok, e} end function g() return host.snap() end`,
    {
      api: {
        boom: {
          run: () => {
            throw Infinity;
          },
        },
        snap: {run: () => (ref!.save().ok ? 'saved' : 'refused')},
      },
    },
    ['boom', 'snap'],
  );
  ref = h;
  assert.deepEqual(ok(h.call('s', 'f')), [false, 'Infinity']);
  assert.equal(ok(h.call('s', 'g')), 'refused');
  h.dispose();
});

test('SCRIPT a failed load leaves timer ids unchanged; math.random(0) draws a full integer', async () => {
  const h = await host();
  assert.equal(h.load('bad', `after(1, 'x') error('no')`).status, 'failed');
  h.load(
    'good',
    `function x() end function start() return after(1, 'x') end function r() return math.type(math.random(0)) end`,
  );
  assert.equal(ok(h.call('good', 'start')), 1);
  assert.equal(ok(h.call('good', 'r')), 'integer');
  h.dispose();
});
