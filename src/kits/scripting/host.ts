/**
 * The script host: owns every script state, its budgets, its capabilities, its timers on the fixed tick, its saveable
 * random stream and its persistent `state` table. Pure TypeScript; the VM arrives through `ScriptVm`.
 */
import {createSaveableRng, hashSeed, type SaveableRng} from '../../core/rng';
import type {ScriptFailure, ScriptVm, VmBudget, VmHostFunction, VmState} from './vm-contract';
import {
  canonicalScriptJson,
  captureScriptValue,
  ScriptValueError,
  sourceDigest,
  type ScriptValue,
  type ScriptValueLimits,
} from './values';

// ------------------------------------------------------------------ limits

export interface ScriptLimits {
  /** Scripts loaded at once. */
  readonly maxScripts: number;
  /** UTF-16 code units of one script's source. */
  readonly maxSourceLength: number;
  /** VM instructions for one call or timer callback (exact; host calls are charged their `cost`). */
  readonly instructionsPerCall: number;
  /** VM instructions for a script's top level when it is loaded, reloaded or restored. */
  readonly instructionsPerLoad: number;
  /** Wall-clock milliseconds for one call: a safety stop, not a deterministic outcome. */
  readonly wallMsPerCall: number;
  /** Bytes one script state may allocate, including its standard library (about 30 KiB). */
  readonly memoryBytes: number;
  /** Host function invocations in one call. */
  readonly maxHostCallsPerCall: number;
  /** Pending timers per script. */
  readonly maxTimersPerScript: number;
  /** Timer callbacks fired in one `tick()`; the rest stay due and fire first on the next tick. */
  readonly maxTimerFiresPerTick: number;
  /** Largest delay or period of a timer, in ticks. */
  readonly maxTimerTicks: number;
  /** Consecutive failed calls after which a script is faulted (refused until reloaded or restored). */
  readonly failuresBeforeFault: number;
  /** Log lines retained (oldest dropped first and counted). */
  readonly maxLogLines: number;
  /** Bounds on arguments, results, host-function values and timer arguments. */
  readonly maxValueDepth: number;
  readonly maxValueNodes: number;
  readonly maxValueStringLength: number;
  /** Bounds on one script's saved `state` table. */
  readonly maxStateDepth: number;
  readonly maxStateNodes: number;
  readonly maxStateStringLength: number;
}

/** Accepted range per limit: engine safety ceilings, not recommended game values. */
export const SCRIPT_LIMIT_RANGES: Readonly<Record<keyof ScriptLimits, readonly [number, number]>> = Object.freeze({
  maxScripts: [1, 1024],
  maxSourceLength: [1, 4 * 1024 * 1024],
  instructionsPerCall: [1, 1_000_000_000],
  instructionsPerLoad: [1, 1_000_000_000],
  wallMsPerCall: [1, 60_000],
  memoryBytes: [64 * 1024, 512 * 1024 * 1024],
  maxHostCallsPerCall: [0, 1_000_000],
  maxTimersPerScript: [0, 65_536],
  maxTimerFiresPerTick: [1, 65_536],
  maxTimerTicks: [1, 2 ** 31],
  failuresBeforeFault: [1, 1_000_000],
  maxLogLines: [0, 65_536],
  maxValueDepth: [1, 64],
  maxValueNodes: [1, 1_000_000],
  maxValueStringLength: [1, 16 * 1024 * 1024],
  maxStateDepth: [1, 64],
  maxStateNodes: [1, 1_000_000],
  maxStateStringLength: [1, 16 * 1024 * 1024],
});

/** Defaults: a starting point to measure against, not a recommendation for any game. */
export const DEFAULT_SCRIPT_LIMITS: ScriptLimits = Object.freeze({
  maxScripts: 32,
  maxSourceLength: 256 * 1024,
  instructionsPerCall: 200_000,
  instructionsPerLoad: 1_000_000,
  wallMsPerCall: 8,
  memoryBytes: 1024 * 1024,
  maxHostCallsPerCall: 1_000,
  maxTimersPerScript: 64,
  maxTimerFiresPerTick: 256,
  maxTimerTicks: 60 * 60 * 60,
  failuresBeforeFault: 3,
  maxLogLines: 64,
  maxValueDepth: 16,
  maxValueNodes: 4_096,
  maxValueStringLength: 16_384,
  maxStateDepth: 32,
  maxStateNodes: 65_536,
  maxStateStringLength: 65_536,
});

function captureLimits(input: Partial<ScriptLimits> | undefined): ScriptLimits {
  if (input !== undefined && (input === null || typeof input !== 'object')) throw Error('scripting: invalid limits');
  const out = {...DEFAULT_SCRIPT_LIMITS} as Record<keyof ScriptLimits, number>;
  for (const key of Object.keys(input ?? {})) {
    if (!(key in SCRIPT_LIMIT_RANGES)) throw Error(`scripting: unknown limit ${key}`);
    const k = key as keyof ScriptLimits;
    const v = (input as Record<string, unknown>)[k];
    const [min, max] = SCRIPT_LIMIT_RANGES[k];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
      throw Error(`scripting: invalid limit ${key} (an integer in ${min}..${max})`);
    out[k] = v;
  }
  return Object.freeze(out);
}

// ------------------------------------------------------------------ public types

/** What a script may call: one creator function, exposed to the script as `host.<name>(...)`. */
export interface ScriptApiFunction {
  /** Instructions charged to the calling script per invocation (default 100): host work is not free. */
  readonly cost?: number;
  /** Arguments are frozen script values already checked against the value limits. Return a script value or
   *  nothing; throw an Error to raise a script error with its message. Keep it bounded: the instruction budget does
   *  not see time spent here. Never call back into the host from here (refused as `reentrant`). */
  run(args: readonly ScriptValue[], call: {readonly script: string; readonly tick: number}): ScriptValue | undefined;
}

export interface ScriptHostOptions {
  /** Unsigned 32-bit seed; each script's `math.random` stream derives from it and the script id. Take it from
   *  `ctx.random()` (seeded) so a run replays exactly. */
  readonly seed: number;
  readonly limits?: Partial<ScriptLimits>;
  /** The capabilities a script can be granted, by name (a Lua identifier). */
  readonly api?: Readonly<Record<string, ScriptApiFunction>>;
  /** Allow `string.find`/`match`/`gmatch`/`gsub` with patterns. Native pattern matching is not interruptible, so a
   *  hostile pattern can exceed the wall-time budget; leave off unless scripts are trusted. Default false. */
  readonly allowPatterns?: boolean;
  /** Starting tick (default 0). */
  readonly startTick?: number;
  /** Monotonic milliseconds, read only to enforce `wallMsPerCall`, for example `() => performance.now()`. Without it
   *  the kit reads no clock and there is no wall-time stop; the instruction budget still bounds every call. */
  readonly clock?: () => number;
}

export interface ScriptLoadOptions {
  /** Names from `api` this script may call; anything else is absent from its `host` table. Default none. */
  readonly capabilities?: readonly string[];
  /** The script's initial `state` table (default `{}`). */
  readonly state?: ScriptValue;
}

export type ScriptRefusal =
  'disposed' | 'reentrant' | 'invalid' | 'unknown-script' | 'exists' | 'full' | 'faulted' | 'source-mismatch';

export type ScriptCallResult =
  | {readonly status: 'ok'; readonly value: ScriptValue; readonly charged: number}
  | {readonly status: 'missing'}
  | {readonly status: 'refused'; readonly reason: ScriptRefusal; readonly message: string}
  | {
      readonly status: 'failed';
      readonly reason: ScriptFailure;
      readonly message: string;
      readonly charged: number;
      /** False for `wall` and `memory`: those depend on the machine and heap history, so peers may disagree. */
      readonly deterministic: boolean;
      /** True when this failure faulted the script. */
      readonly faulted: boolean;
    };

export type ScriptLoadResult =
  | {readonly status: 'loaded'; readonly digest: string}
  | {readonly status: 'refused'; readonly reason: ScriptRefusal; readonly message: string}
  | {readonly status: 'failed'; readonly reason: ScriptFailure; readonly message: string};

export interface ScriptTimerSnapshot {
  readonly id: number;
  readonly due: number;
  /** Period in ticks for a repeating timer, or 0. */
  readonly every: number;
  readonly fn: string;
  readonly arg: ScriptValue;
}

export interface ScriptSnapshot {
  readonly id: string;
  readonly digest: string;
  readonly capabilities: readonly string[];
  readonly state: ScriptValue;
  readonly rng: number;
  readonly failures: number;
  readonly faulted: boolean;
  readonly timers: readonly ScriptTimerSnapshot[];
}

/** Plain JSON: store it in a save section, or as rollback state text with `JSON.stringify`. */
export interface ScriptHostSnapshot {
  readonly format: 'foundation-scripts';
  readonly version: 1;
  readonly seed: number;
  readonly tick: number;
  readonly nextTimerId: number;
  readonly scripts: readonly ScriptSnapshot[];
}

export interface ScriptTickReport {
  readonly tick: number;
  readonly fired: number;
  /** Due timers left for the next tick because `maxTimerFiresPerTick` was reached. */
  readonly deferred: number;
  /** Timers of faulted scripts that were due and did not fire. */
  readonly skipped: number;
  readonly failures: readonly {readonly script: string; readonly timer: number; readonly result: ScriptCallResult}[];
}

export interface ScriptStatus {
  readonly id: string;
  readonly digest: string;
  readonly capabilities: readonly string[];
  readonly faulted: boolean;
  readonly failures: number;
  readonly timers: number;
  readonly memoryBytes: number;
}

export interface ScriptLogEntry {
  readonly tick: number;
  readonly script: string;
  readonly text: string;
}

export interface ScriptHost {
  /** The fixed tick: advanced only by `tick()`; what scripts read with `now()`. */
  readonly now: number;
  load(id: string, source: string, options?: ScriptLoadOptions): ScriptLoadResult;
  /** Replace a script's code, keeping its `state`, timers and random stream; calls `on_reload()` if defined.
   *  Atomic: if the new code fails to load, the old script keeps running. For hot reload in development. */
  reload(id: string, source: string): ScriptLoadResult;
  /** Remove a script and its timers. False when unknown. */
  unload(id: string): boolean;
  /** Call the script's global function `fn`. */
  call(id: string, fn: string, args?: readonly ScriptValue[]): ScriptCallResult;
  /** Advance the tick by one and fire due timers (due tick, then timer id order). Call once per fixed step. */
  tick(): ScriptTickReport;
  status(id: string): ScriptStatus | null;
  /** Ids in sorted order. */
  scripts(): readonly string[];
  /** Log lines since the last drain, and how many were dropped by `maxLogLines`. */
  drainLog(): {readonly lines: readonly ScriptLogEntry[]; readonly dropped: number};
  save():
    | {readonly ok: true; readonly snapshot: ScriptHostSnapshot}
    | {readonly ok: false; readonly script: string; readonly message: string};
  /** Replace every script with the snapshot's. Each script's source must be supplied and match its saved digest
   *  (unless `acceptChangedSources`). Top levels run again, then `on_restore()` if defined. Atomic. */
  restore(
    snapshot: unknown,
    sources: Readonly<Record<string, string>>,
    options?: {readonly acceptChangedSources?: boolean},
  ):
    | {readonly ok: true}
    | {readonly ok: false; readonly reason: ScriptRefusal | ScriptFailure; readonly message: string};
  /** Free every script state. Idempotent; later calls are refused as `disposed`. */
  dispose(): void;
}

// ------------------------------------------------------------------ implementation

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const LUA_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LUA_RESERVED = new Set(
  'and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(
    ' ',
  ),
);
const isLuaName = (s: unknown): s is string => typeof s === 'string' && LUA_NAME.test(s) && !LUA_RESERVED.has(s);
const BUILTINS = new Set(['now', 'log', 'after', 'every', 'cancel', 'state', 'host']);
const MAX_LOG_TEXT = 256;
const SAFE_TICK = 2 ** 52;

interface Timer {
  readonly id: number;
  due: number;
  readonly every: number;
  readonly fn: string;
  readonly arg: ScriptValue;
}

interface Script {
  readonly id: string;
  readonly digest: string;
  readonly capabilities: readonly string[];
  vm: VmState;
  rng: SaveableRng;
  timers: Map<number, Timer>;
  failures: number;
  faulted: boolean;
}

const refused = (reason: ScriptRefusal, message: string) => ({status: 'refused', reason, message}) as const;

export function createScriptHost(vm: ScriptVm, options: ScriptHostOptions): ScriptHost {
  if (!vm || typeof vm.createState !== 'function') throw Error('scripting: a loaded ScriptVm is required');
  if (!options || typeof options !== 'object') throw Error('scripting: options are required');
  const {seed} = options;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error('scripting: seed must be an unsigned 32-bit integer');
  const limits = captureLimits(options.limits);
  const allowPatterns = options.allowPatterns === true;
  const userClock = options.clock ?? null;
  if (userClock !== null && typeof userClock !== 'function') throw Error('scripting: clock must be a function');
  // A clock that throws or returns a non-number stops the call as if time had run out (fail closed).
  const clock =
    userClock === null
      ? null
      : () => {
          try {
            const t = userClock();
            return typeof t === 'number' && !Number.isNaN(t) ? t : Infinity;
          } catch {
            return Infinity;
          }
        };
  const startTick = options.startTick ?? 0;
  if (!Number.isSafeInteger(startTick) || startTick < 0 || startTick > SAFE_TICK)
    throw Error('scripting: startTick must be a nonnegative integer');

  const api = new Map<string, {cost: number; run: ScriptApiFunction['run']}>();
  for (const [name, f] of Object.entries(options.api ?? {})) {
    if (!isLuaName(name)) throw Error(`scripting: api name ${JSON.stringify(name)} is not a Lua identifier`);
    if (!f || typeof f.run !== 'function') throw Error(`scripting: api ${name} needs a run function`);
    const cost = f.cost ?? 100;
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > 1_000_000)
      throw Error(`scripting: api ${name} cost is invalid`);
    api.set(name, {cost, run: f.run});
  }

  const valueLimits: ScriptValueLimits = Object.freeze({
    maxDepth: limits.maxValueDepth,
    maxNodes: limits.maxValueNodes,
    maxStringLength: limits.maxValueStringLength,
  });
  const stateLimits: ScriptValueLimits = Object.freeze({
    maxDepth: limits.maxStateDepth,
    maxNodes: limits.maxStateNodes,
    maxStringLength: limits.maxStateStringLength,
  });
  const callBudget: VmBudget = Object.freeze({
    instructions: limits.instructionsPerCall,
    wallMs: limits.wallMsPerCall,
    hostCalls: limits.maxHostCallsPerCall,
    clock,
  });
  const loadBudget: VmBudget = Object.freeze({...callBudget, instructions: limits.instructionsPerLoad});

  let tick = startTick;
  let nextTimerId = 1;
  let disposed = false;
  let busy = false;
  let scripts = new Map<string, Script>();
  const log: ScriptLogEntry[] = [];
  let dropped = 0;

  const rngFor = (id: string) => createSaveableRng((seed ^ hashSeed('script:' + id)) >>> 0);

  /** Build a VM state for script `id`. `owner` is resolved lazily so built-ins act on the script that is current
   *  when they run (a reload or restore swaps the record behind the same id). */
  const createVmState = (id: string, capabilities: readonly string[], owner: () => Script | undefined): VmState => {
    const needOwner = (): Script => {
      const s = owner();
      if (!s) throw Error('script is not loaded');
      return s;
    };
    const intArg = (v: ScriptValue, what: string, min: number, max: number): number => {
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
        throw Error(`${what} must be an integer in ${min}..${max}`);
      return v;
    };
    const schedule = (args: readonly ScriptValue[], repeat: boolean): ScriptValue => {
      const s = needOwner();
      const delay = intArg(args[0] ?? null, repeat ? 'every: period' : 'after: delay', 1, limits.maxTimerTicks);
      const fn = args[1];
      if (!isLuaName(fn)) throw Error(`${repeat ? 'every' : 'after'}: the callback is a global function name`);
      if (s.timers.size >= limits.maxTimersPerScript)
        throw Error(`${repeat ? 'every' : 'after'}: more than ${limits.maxTimersPerScript} pending timers`);
      const id = nextTimerId++;
      s.timers.set(id, {id, due: tick + delay, every: repeat ? delay : 0, fn, arg: args[2] ?? null});
      return id;
    };
    const globals: Record<string, VmHostFunction> = {
      now: {cost: 1, run: () => tick},
      log: {
        cost: 10,
        run: args => {
          if (limits.maxLogLines === 0) return undefined;
          let text = args.map(a => (typeof a === 'string' ? a : canonicalScriptJson(a))).join(' ');
          if (text.length > MAX_LOG_TEXT) text = text.slice(0, MAX_LOG_TEXT);
          log.push(Object.freeze({tick, script: id, text}));
          if (log.length > limits.maxLogLines) {
            log.shift();
            dropped++;
          }
          return undefined;
        },
      },
      after: {cost: 10, run: args => schedule(args, false)},
      every: {cost: 10, run: args => schedule(args, true)},
      cancel: {
        cost: 5,
        run: ([timer]) => (typeof timer === 'number' ? needOwner().timers.delete(timer) : false),
      },
    };
    const host: Record<string, VmHostFunction> = {};
    for (const name of capabilities) {
      const f = api.get(name) as {cost: number; run: ScriptApiFunction['run']};
      host[name] = {cost: f.cost, run: args => f.run(args, {script: id, tick})};
    }
    return vm.createState({
      memoryBytes: limits.memoryBytes,
      valueLimits,
      allowPatterns,
      globals,
      host,
      random: () => needOwner().rng.next(),
    });
  };

  const checkCapabilities = (caps: unknown): readonly string[] | string => {
    if (caps === undefined) return Object.freeze([]);
    if (!Array.isArray(caps)) return 'capabilities must be an array of api names';
    const out = new Set<string>();
    for (const c of caps) {
      if (typeof c !== 'string' || !api.has(c)) return `capability ${JSON.stringify(c)} is not in the host api`;
      out.add(c);
    }
    return Object.freeze([...out].sort());
  };

  const guard = (): ReturnType<typeof refused> | null => {
    if (disposed) return refused('disposed', 'the script host is disposed');
    if (busy) return refused('reentrant', 'a script call is already running');
    return null;
  };

  /** Construct a script state, set its `state` table, run its top level and, if defined, a hook function. */
  const build = (
    id: string,
    source: string,
    capabilities: readonly string[],
    state: ScriptValue,
    rngWord: number | null,
    timers: Map<number, Timer>,
    hook: string | null,
  ): {ok: true; script: Script} | {ok: false; reason: ScriptFailure; message: string} => {
    const holder: {script?: Script} = {};
    let vmState: VmState;
    try {
      vmState = createVmState(id, capabilities, () => holder.script);
    } catch (e) {
      return {ok: false, reason: 'memory', message: e instanceof Error ? e.message : String(e)};
    }
    const rng = rngFor(id);
    if (rngWord !== null) rng.restore(rngWord);
    const script: Script = {
      id,
      digest: sourceDigest(source),
      capabilities,
      vm: vmState,
      rng,
      timers,
      failures: 0,
      faulted: false,
    };
    holder.script = script;
    const fail = (reason: ScriptFailure, message: string) => {
      vmState.close();
      return {ok: false as const, reason, message};
    };
    const written = vmState.write('state', state);
    if (!written.ok) return fail('value', `state: ${written.message}`);
    const ran = vmState.run(source, id, loadBudget);
    if (!ran.ok) return fail(ran.reason, ran.message);
    if (hook !== null) {
      const r = vmState.call(hook, [], callBudget);
      if (!r.ok && r.reason !== 'missing') return fail(r.reason, `${hook}: ${r.message}`);
    }
    return {ok: true, script};
  };

  const checkSource = (source: unknown): string | null =>
    typeof source !== 'string'
      ? 'source must be a string'
      : source.length > limits.maxSourceLength
        ? `source is longer than ${limits.maxSourceLength}`
        : null;

  const invoke = (s: Script, fn: string, args: readonly ScriptValue[]): ScriptCallResult => {
    let r: ReturnType<VmState['call']>;
    try {
      r = s.vm.call(fn, args, callBudget);
    } catch (e) {
      // The VM itself trapped: nothing more can be trusted from this script.
      s.faulted = true;
      const message = `script VM failed: ${e instanceof Error ? e.message : 'unknown'}`;
      return {status: 'failed', reason: 'error', message, charged: 0, deterministic: false, faulted: true};
    }
    if (r.ok) {
      s.failures = 0;
      return {status: 'ok', value: r.value, charged: r.instructions};
    }
    if (r.reason === 'missing') return {status: 'missing'};
    const deterministic = r.reason !== 'wall' && r.reason !== 'memory';
    s.failures++;
    if (!deterministic || s.failures >= limits.failuresBeforeFault) s.faulted = true;
    return {
      status: 'failed',
      reason: r.reason,
      message: r.message,
      charged: r.instructions,
      deterministic,
      faulted: s.faulted,
    };
  };

  const self: ScriptHost = {
    get now() {
      return tick;
    },

    load(id, source, o = {}) {
      const g = guard();
      if (g) return g;
      if (typeof id !== 'string' || !ID.test(id)) return refused('invalid', 'script ids are 1-64 of a-z, 0-9 and -');
      const bad = checkSource(source);
      if (bad) return refused('invalid', bad);
      if (scripts.has(id)) return refused('exists', `script ${id} is already loaded (use reload)`);
      if (scripts.size >= limits.maxScripts) return refused('full', `more than ${limits.maxScripts} scripts`);
      const caps = checkCapabilities(o.capabilities);
      if (typeof caps === 'string') return refused('invalid', caps);
      let state: ScriptValue;
      try {
        state = captureScriptValue(o.state ?? {}, stateLimits, 'state');
      } catch (e) {
        return refused('invalid', e instanceof ScriptValueError ? e.message : String(e));
      }
      busy = true;
      try {
        const built = build(id, source, caps, state, null, new Map(), null);
        if (!built.ok) return {status: 'failed', reason: built.reason, message: built.message};
        scripts.set(id, built.script);
        return {status: 'loaded', digest: built.script.digest};
      } finally {
        busy = false;
      }
    },

    reload(id, source) {
      const g = guard();
      if (g) return g;
      const old = scripts.get(id);
      if (!old) return refused('unknown-script', `script ${String(id)} is not loaded`);
      const bad = checkSource(source);
      if (bad) return refused('invalid', bad);
      const current = old.vm.read('state', stateLimits);
      if (!current.ok) return {status: 'failed', reason: 'value', message: `state: ${current.message}`};
      busy = true;
      try {
        const timers = new Map([...old.timers].map(([k, t]) => [k, {...t}] as const));
        const built = build(id, source, old.capabilities, current.value, old.rng.state(), timers, 'on_reload');
        if (!built.ok) return {status: 'failed', reason: built.reason, message: built.message};
        old.vm.close();
        scripts.set(id, built.script);
        return {status: 'loaded', digest: built.script.digest};
      } finally {
        busy = false;
      }
    },

    unload(id) {
      if (disposed || busy) return false;
      const s = scripts.get(id);
      if (!s) return false;
      s.vm.close();
      scripts.delete(id);
      return true;
    },

    call(id, fn, args = []) {
      const g = guard();
      if (g) return g;
      const s = scripts.get(id);
      if (!s) return refused('unknown-script', `script ${String(id)} is not loaded`);
      if (s.faulted) return refused('faulted', `script ${id} is faulted; reload or restore it`);
      if (!isLuaName(fn)) return refused('invalid', 'the function name is not a Lua identifier');
      if (BUILTINS.has(fn)) return refused('invalid', `${fn} is a built-in, not a script function`);
      let captured: ScriptValue;
      try {
        if (!Array.isArray(args)) throw new ScriptValueError('args must be an array');
        captured = captureScriptValue(args, valueLimits, 'args');
      } catch (e) {
        return refused('invalid', e instanceof Error ? e.message : String(e));
      }
      busy = true;
      try {
        return invoke(s, fn, captured as readonly ScriptValue[]);
      } finally {
        busy = false;
      }
    },

    tick() {
      if (disposed) throw Error('scripting: the script host is disposed');
      if (busy) throw Error('scripting: tick() was called from inside a script call');
      if (tick >= SAFE_TICK) throw Error('scripting: the tick counter is exhausted');
      tick++;
      const due: {s: Script; t: Timer}[] = [];
      let skipped = 0;
      for (const s of scripts.values())
        for (const t of s.timers.values())
          if (t.due <= tick) {
            if (s.faulted) skipped++;
            else due.push({s, t});
          }
      due.sort((a, b) => a.t.due - b.t.due || a.t.id - b.t.id);
      const failures: {script: string; timer: number; result: ScriptCallResult}[] = [];
      const live = (s: Script, t: Timer) => scripts.get(s.id) === s && !s.faulted && s.timers.has(t.id);
      let fired = 0,
        next = 0;
      busy = true;
      try {
        for (; next < due.length && fired < limits.maxTimerFiresPerTick; next++) {
          const {s, t} = due[next] as {s: Script; t: Timer};
          if (!live(s, t)) continue;
          fired++;
          if (t.every > 0) t.due = tick + t.every;
          else s.timers.delete(t.id);
          const result = invoke(s, t.fn, t.arg === null ? [] : [t.arg]);
          if (result.status === 'missing') s.timers.delete(t.id);
          if (result.status !== 'ok') failures.push({script: s.id, timer: t.id, result});
        }
      } finally {
        busy = false;
      }
      let deferred = 0;
      for (; next < due.length; next++) {
        const {s, t} = due[next] as {s: Script; t: Timer};
        if (live(s, t)) deferred++;
      }
      return Object.freeze({tick, fired, deferred, skipped, failures: Object.freeze(failures)});
    },

    status(id) {
      const s = scripts.get(id);
      if (!s || disposed) return null;
      return Object.freeze({
        id: s.id,
        digest: s.digest,
        capabilities: s.capabilities,
        faulted: s.faulted,
        failures: s.failures,
        timers: s.timers.size,
        memoryBytes: s.vm.memoryUsed(),
      });
    },

    scripts: () => Object.freeze([...scripts.keys()].sort()),

    drainLog() {
      const out = {lines: Object.freeze(log.splice(0)), dropped};
      dropped = 0;
      return out;
    },

    save() {
      if (disposed) return {ok: false, script: '', message: 'the script host is disposed'};
      const out: ScriptSnapshot[] = [];
      for (const id of [...scripts.keys()].sort()) {
        const s = scripts.get(id) as Script;
        const st = s.vm.read('state', stateLimits);
        if (!st.ok) return {ok: false, script: id, message: `state: ${st.message}`};
        const timers = [...s.timers.values()]
          .sort((a, b) => a.id - b.id)
          .map(t => Object.freeze({id: t.id, due: t.due, every: t.every, fn: t.fn, arg: t.arg}));
        out.push(
          Object.freeze({
            id,
            digest: s.digest,
            capabilities: s.capabilities,
            state: st.value,
            rng: s.rng.state(),
            failures: s.failures,
            faulted: s.faulted,
            timers: Object.freeze(timers),
          }),
        );
      }
      return {
        ok: true,
        snapshot: Object.freeze({
          format: 'foundation-scripts',
          version: 1,
          seed,
          tick,
          nextTimerId,
          scripts: Object.freeze(out),
        }),
      };
    },

    restore(snapshot, sources, o = {}) {
      const g = guard();
      if (g) return {ok: false, reason: g.reason, message: g.message};
      let parsed: ParsedSnapshot;
      try {
        parsed = parseSnapshot(snapshot, limits, stateLimits, valueLimits, api, seed);
      } catch (e) {
        return {ok: false, reason: 'invalid', message: e instanceof Error ? e.message : String(e)};
      }
      if (!sources || typeof sources !== 'object')
        return {ok: false, reason: 'invalid', message: 'sources are required'};
      for (const s of parsed.scripts) {
        const src = Object.prototype.hasOwnProperty.call(sources, s.id) ? sources[s.id] : undefined;
        const bad = checkSource(src);
        if (bad) return {ok: false, reason: 'invalid', message: `${s.id}: ${bad}`};
        if (sourceDigest(src as string) !== s.digest && o.acceptChangedSources !== true)
          return {ok: false, reason: 'source-mismatch', message: `${s.id}: the source differs from the saved revision`};
      }
      const savedTick = tick,
        savedNextTimer = nextTimerId;
      busy = true;
      const built: Script[] = [];
      try {
        tick = parsed.tick;
        nextTimerId = parsed.nextTimerId;
        for (const s of parsed.scripts) {
          const timers = new Map(s.timers.map(t => [t.id, {...t}] as const));
          const r = build(s.id, sources[s.id] as string, s.capabilities, s.state, s.rng, timers, 'on_restore');
          if (!r.ok) {
            for (const b of built) b.vm.close();
            tick = savedTick;
            nextTimerId = savedNextTimer;
            return {ok: false, reason: r.reason, message: `${s.id}: ${r.message}`};
          }
          r.script.failures = s.failures;
          r.script.faulted = s.faulted;
          built.push(r.script);
        }
      } finally {
        busy = false;
      }
      for (const s of scripts.values()) s.vm.close();
      scripts = new Map(built.map(s => [s.id, s]));
      return {ok: true};
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const s of scripts.values()) s.vm.close();
      scripts.clear();
      log.length = 0;
    },
  };
  return Object.freeze(self);
}

// ------------------------------------------------------------------ snapshot validation

interface ParsedSnapshot {
  tick: number;
  nextTimerId: number;
  scripts: {
    id: string;
    digest: string;
    capabilities: readonly string[];
    state: ScriptValue;
    rng: number;
    failures: number;
    faulted: boolean;
    timers: Timer[];
  }[];
}

function parseSnapshot(
  raw: unknown,
  limits: ScriptLimits,
  stateLimits: ScriptValueLimits,
  valueLimits: ScriptValueLimits,
  api: ReadonlyMap<string, unknown>,
  seed: number,
): ParsedSnapshot {
  const obj = (v: unknown, what: string): Record<string, unknown> => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw Error(`snapshot: ${what} must be an object`);
    return v as Record<string, unknown>;
  };
  const int = (v: unknown, what: string, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
      throw Error(`snapshot: ${what} is invalid`);
    return v;
  };
  const root = obj(raw, 'the snapshot');
  if (root.format !== 'foundation-scripts' || root.version !== 1)
    throw Error('snapshot: not a version 1 script snapshot');
  if (root.seed !== seed) throw Error('snapshot: it was saved by a host with a different seed');
  const tick = int(root.tick, 'tick', 0, SAFE_TICK);
  const nextTimerId = int(root.nextTimerId, 'nextTimerId', 1, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(root.scripts)) throw Error('snapshot: scripts must be an array');
  if (root.scripts.length > limits.maxScripts) throw Error('snapshot: too many scripts');
  const ids = new Set<string>();
  const timerIds = new Set<number>();
  const scripts = root.scripts.map((entry, i) => {
    const s = obj(entry, `scripts[${i}]`);
    if (typeof s.id !== 'string' || !ID.test(s.id) || ids.has(s.id))
      throw Error(`snapshot: scripts[${i}].id is invalid`);
    ids.add(s.id);
    if (typeof s.digest !== 'string' || !/^[0-9a-f]{16}$/.test(s.digest))
      throw Error(`snapshot: ${s.id} digest is invalid`);
    if (!Array.isArray(s.capabilities) || s.capabilities.some(c => typeof c !== 'string' || !api.has(c)))
      throw Error(`snapshot: ${s.id} capabilities are not all in the host api`);
    const capabilities = Object.freeze([...new Set(s.capabilities as string[])].sort());
    const state = captureScriptValue(s.state, stateLimits, `${s.id} state`);
    const rng = int(s.rng, `${s.id} rng`, 0, 0xffffffff);
    const failures = int(s.failures, `${s.id} failures`, 0, limits.failuresBeforeFault);
    if (typeof s.faulted !== 'boolean') throw Error(`snapshot: ${s.id} faulted is invalid`);
    if (!Array.isArray(s.timers) || s.timers.length > limits.maxTimersPerScript)
      throw Error(`snapshot: ${s.id} timers are invalid`);
    const timers = s.timers.map((tv, j) => {
      const t = obj(tv, `${s.id} timers[${j}]`);
      const id = int(t.id, `${s.id} timer id`, 1, nextTimerId - 1);
      if (timerIds.has(id)) throw Error(`snapshot: timer ${id} appears twice`);
      timerIds.add(id);
      const every = int(t.every, `${s.id} timer every`, 0, limits.maxTimerTicks);
      const due = int(t.due, `${s.id} timer due`, 0, tick + limits.maxTimerTicks);
      if (!isLuaName(t.fn)) throw Error(`snapshot: ${s.id} timer callback is invalid`);
      const arg = captureScriptValue(t.arg ?? null, valueLimits, `${s.id} timer arg`);
      return {id, due, every, fn: t.fn, arg};
    });
    return {id: s.id, digest: s.digest, capabilities, state, rng, failures, faulted: s.faulted, timers};
  });
  return {tick, nextTimerId, scripts};
}
