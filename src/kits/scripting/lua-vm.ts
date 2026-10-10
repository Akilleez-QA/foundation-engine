/**
 * The Lua 5.4 script VM (MIT-licensed `wasmoon` WebAssembly build). This is the only module that imports the VM
 * package; `loadScriptVm` loads it with a dynamic import, so a game that never asks for scripts never downloads it.
 *
 * Each script gets its own `lua_State` with a capped allocator. Every host-side touch of a state runs inside one
 * protected call (`protect`), so an allocation failure or a script error can never reach Lua's panic handler. Script
 * code runs under a count hook that enforces the instruction budget and the wall-time guard.
 */
import * as wasmoonModule from 'wasmoon';
import type {
  ScriptFailure,
  ScriptVm,
  VmBudget,
  VmHostFunction,
  VmOutcome,
  VmState,
  VmStateOptions,
} from './vm-contract';
import {captureScriptValue, defineKey, ScriptValueError, type ScriptValue, type ScriptValueLimits} from './values';
import {SANDBOX_PRELUDE} from './prelude';

type Wasmoon = typeof wasmoonModule;
type LuaWasm = Awaited<ReturnType<Wasmoon['LuaWasm']['initialize']>>;
type LuaState = number;

// Lua 5.4 constants (lua.h). The registry index is the one wasmoon's build uses.
const LUA_OK = 0,
  LUA_ERRMEM = 4,
  LUA_MASKCOUNT = 8,
  LUA_RIDX_GLOBALS = 2n,
  T_NIL = 0,
  T_BOOLEAN = 1,
  T_NUMBER = 3,
  T_STRING = 4,
  T_TABLE = 5,
  T_FUNCTION = 6;
/** The hook fires at most this many VM instructions apart, so the wall clock is read often enough to stop a loop. */
const HOOK_SLICE = 1000;
/** Bytes or elements of native library work charged as one instruction. */
const METER_BYTES = 16;
/** The internal host function the prelude uses to charge native work (never visible to scripts by name). */
const METER: VmHostFunction = Object.freeze({cost: 0, run: () => undefined});
/** Error messages handed back to the host are cut to this many code units. */
const MESSAGE_LIMIT = 1000;

// The package is UMD; bundlers expose it either as named exports or as a default export.
const namespace: Wasmoon & {readonly default?: Wasmoon} = wasmoonModule;
const pkg: Wasmoon = namespace.default ?? namespace;

/** Internal: thrown inside a protected call to stop it with a classified reason. */
class Stop extends Error {
  constructor(
    readonly reason: ScriptFailure,
    message: string,
  ) {
    super(message);
  }
}

interface ActiveBudget {
  readonly budget: VmBudget;
  readonly deadline: number;
  used: number;
  slice: number;
  hostCalls: number;
  exhausted: ScriptFailure | null;
}

interface StateRecord {
  readonly L: LuaState;
  readonly functions: VmHostFunction[];
  readonly valueLimits: ScriptValueLimits;
  pending: ((L: LuaState) => void) | null;
  active: ActiveBudget | null;
  stop: Stop | null;
  sentinelRef: number;
}

/** Create the VM from an initialised wasmoon module (`LuaWasm.initialize(url)`). */
export async function createLuaVm(wasmUrl?: string): Promise<ScriptVm> {
  const lua = await pkg.LuaWasm.initialize(wasmUrl);
  return luaVmFrom(lua);
}

function luaVmFrom(lua: LuaWasm): ScriptVm {
  const states = new Map<LuaState, StateRecord>();
  const REG = pkg.LUA_REGISTRYINDEX;
  const mod = lua.module;

  const record = (L: LuaState): StateRecord => {
    const r = states.get(L);
    if (!r) throw Error('scripting: unknown Lua state (coroutines are not available)');
    return r;
  };

  // ------------------------------------------------------------------ raising errors from JS
  // `lua_error` unwinds with emscripten's longjmp, which is a thrown `Infinity`; a trap means the VM itself failed.
  // Both must keep unwinding. Anything else thrown by kit or creator code is turned into a Lua error.
  const mustUnwind = (e: unknown) => e === Infinity || e instanceof WebAssembly.RuntimeError;
  const asError = (e: unknown): Error => {
    if (e instanceof Error) return e;
    try {
      return Error(String(e));
    } catch {
      return Error('a host function threw a value that is not an Error');
    }
  };
  const pushMessage = (L: LuaState, text: string) => {
    lua.lua_pushstring(L, text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) : text);
  };
  const raiseSentinel = (r: StateRecord): number => {
    lua.lua_rawgeti(r.L, REG, BigInt(r.sentinelRef));
    return lua.lua_error(r.L);
  };
  const exhaust = (r: StateRecord, reason: ScriptFailure): number => {
    const a = r.active;
    if (a && a.exhausted === null) a.exhausted = reason;
    // From now on every instruction raises again, so a script that catches the stop cannot keep running.
    lua.lua_sethook(r.L, hookPtr, LUA_MASKCOUNT, 1);
    return raiseSentinel(r);
  };

  // ------------------------------------------------------------------ shared function-table entries
  const hookPtr = mod.addFunction((L: LuaState) => {
    const r = states.get(L);
    const a = r?.active;
    if (!r || !a) return;
    if (a.exhausted !== null) return void exhaust(r, a.exhausted);
    a.used += a.slice;
    if (a.used >= a.budget.instructions) return void exhaust(r, 'instructions');
    if (a.budget.clock !== null && a.budget.clock() > a.deadline) return void exhaust(r, 'wall');
    a.slice = Math.min(HOOK_SLICE, a.budget.instructions - a.used);
    lua.lua_sethook(L, hookPtr, LUA_MASKCOUNT, a.slice);
  }, 'vii');

  const trampolinePtr = mod.addFunction((L: LuaState) => {
    const r = record(L);
    const fn = r.pending;
    r.pending = null;
    if (!fn) return 0;
    let failure: Error | null = null;
    try {
      fn(L);
    } catch (e) {
      if (mustUnwind(e)) throw e;
      failure = asError(e);
    }
    if (failure) {
      if (failure instanceof Stop) r.stop ??= failure;
      pushMessage(L, failure.message);
      return lua.lua_error(L);
    }
    return 0;
  }, 'ii');

  const dispatchPtr = mod.addFunction((L: LuaState) => {
    const r = record(L);
    const a = r.active;
    if (!a) {
      pushMessage(L, 'host functions run only inside a script call');
      return lua.lua_error(L);
    }
    if (a.exhausted !== null) return exhaust(r, a.exhausted);
    const index = Number(lua.lua_tointegerx(L, lua.lua_upvalueindex(1), null));
    const entry = r.functions[index];
    if (!entry) {
      pushMessage(L, 'unknown host function');
      return lua.lua_error(L);
    }
    if (entry === METER) {
      // Native library work charged by the sandbox prelude: 1 instruction per METER_BYTES of data.
      const units = lua.lua_tonumberx(L, 1, null);
      a.used += Number.isFinite(units) && units > 0 ? Math.ceil(units / METER_BYTES) : 0;
      if (a.used >= a.budget.instructions) return exhaust(r, 'instructions');
      if (a.budget.clock !== null && a.budget.clock() > a.deadline) return exhaust(r, 'wall');
      return 0;
    }
    if (++a.hostCalls > a.budget.hostCalls) return exhaust(r, 'host-calls');
    a.used += entry.cost;
    if (a.used >= a.budget.instructions) return exhaust(r, 'instructions');
    // Kit work (marshalling) may unwind with a real Lua error; creator code never may, so it is fenced separately.
    let args: readonly ScriptValue[] = [];
    let failure: Error | null = null;
    try {
      const n = lua.lua_gettop(L);
      const list: ScriptValue[] = [];
      const counter = {nodes: 0};
      for (let i = 1; i <= n; i++) list.push(toJs(L, i, r.valueLimits, counter, 0));
      args = Object.freeze(list);
    } catch (e) {
      if (mustUnwind(e)) throw e;
      failure = asError(e);
    }
    let result: ScriptValue | undefined;
    if (!failure)
      try {
        const value = entry.run(args);
        result = value === undefined ? undefined : captureScriptValue(value, r.valueLimits, 'host function result');
      } catch (e) {
        // Whatever creator code throws (even a number such as Infinity) is an ordinary script error.
        failure = asError(e);
      }
    if (failure) {
      pushMessage(L, failure.message);
      return lua.lua_error(L);
    }
    if (result !== undefined) {
      let pushFailure: Error | null = null;
      try {
        push(L, result);
      } catch (e) {
        if (mustUnwind(e)) throw e;
        pushFailure = asError(e);
      }
      if (pushFailure) {
        pushMessage(L, pushFailure.message);
        return lua.lua_error(L);
      }
    }
    return result === undefined ? 0 : 1;
  }, 'ii');

  // ------------------------------------------------------------------ marshalling (always inside `protect`)
  const utf8Length = (s: string) => mod.lengthBytesUTF8(s);
  /** `lua_rawlen` returns a 64-bit size, which arrives as a BigInt although the binding is typed as a number. */
  const rawlen = (L: LuaState, idx: number): number => {
    const n: unknown = lua.lua_rawlen(L, idx);
    return typeof n === 'bigint' || typeof n === 'number' ? Number(n) : NaN;
  };
  const decoder = new TextDecoder('utf-8', {fatal: true});
  /** A Lua string as JS text: strict UTF-8 (no NUL, no malformed sequences), so it round-trips byte for byte. */
  function readString(L: LuaState, idx: number, limits: ScriptValueLimits): string {
    const bytes = rawlen(L, idx);
    if (!(bytes <= limits.maxStringLength * 3)) throw new ScriptValueError('a string is too long');
    const ptr: unknown = mod.ccall('lua_tolstring', 'number', ['number', 'number', 'number'], [L, idx, 0]);
    if (typeof ptr !== 'number' || ptr === 0) throw new ScriptValueError('a string could not be read');
    const view = mod.HEAPU8.subarray(ptr, ptr + bytes);
    if (view.includes(0)) throw new ScriptValueError('strings must not contain NUL characters');
    let text: string;
    try {
      text = decoder.decode(view);
    } catch {
      throw new ScriptValueError('strings must be valid UTF-8 text');
    }
    if (text.length > limits.maxStringLength) throw new ScriptValueError('a string is too long');
    return text;
  }
  function toJs(
    L: LuaState,
    idx: number,
    limits: ScriptValueLimits,
    counter: {nodes: number},
    depth: number,
  ): ScriptValue {
    if (++counter.nodes > limits.maxNodes) throw new ScriptValueError(`more than ${limits.maxNodes} values`);
    const type = lua.lua_type(L, idx);
    switch (type) {
      case T_NIL:
        return null;
      case T_BOOLEAN:
        return lua.lua_toboolean(L, idx) !== 0;
      case T_NUMBER: {
        if (lua.lua_isinteger(L, idx)) {
          const big = lua.lua_tointegerx(L, idx, null);
          const n = Number(big);
          if (!Number.isSafeInteger(n)) throw new ScriptValueError('an integer is outside the safe integer range');
          return n;
        }
        const n = lua.lua_tonumberx(L, idx, null);
        if (!Number.isFinite(n)) throw new ScriptValueError('numbers must be finite');
        return Object.is(n, -0) ? 0 : n;
      }
      case T_STRING:
        return readString(L, idx, limits);
      case T_TABLE: {
        if (depth >= limits.maxDepth) throw new ScriptValueError(`nested deeper than ${limits.maxDepth}`);
        lua.luaL_checkstack(L, 4, null);
        const t = lua.lua_absindex(L, idx);
        const named: [string, ScriptValue][] = [];
        const indexed: [number, ScriptValue][] = [];
        lua.lua_pushnil(L);
        while (lua.lua_next(L, t) !== 0) {
          const keyType = lua.lua_type(L, -2);
          if (keyType === T_STRING) {
            const key = readString(L, -2, limits);
            named.push([key, toJs(L, -1, limits, counter, depth + 1)]);
          } else if (keyType === T_NUMBER && lua.lua_isinteger(L, -2)) {
            const k = Number(lua.lua_tointegerx(L, -2, null));
            indexed.push([k, toJs(L, -1, limits, counter, depth + 1)]);
          } else throw new ScriptValueError('table keys must be strings or a 1..n sequence');
          lua.lua_settop(L, -2);
        }
        if (indexed.length && named.length) throw new ScriptValueError('a table mixes a sequence with named keys');
        if (indexed.length) {
          const out: ScriptValue[] = new Array<ScriptValue>(indexed.length);
          for (const [k, v] of indexed) {
            if (!Number.isSafeInteger(k) || k < 1 || k > indexed.length)
              throw new ScriptValueError('table keys must be strings or a 1..n sequence');
            out[k - 1] = v;
          }
          return Object.freeze(out);
        }
        named.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
        const obj: Record<string, ScriptValue> = {};
        for (const [k, v] of named) defineKey(obj, k, v);
        return Object.freeze(obj);
      }
      case T_FUNCTION:
        throw new ScriptValueError('functions are not script values');
      default:
        throw new ScriptValueError('only nil, booleans, numbers, strings and tables are script values');
    }
  }

  function push(L: LuaState, v: ScriptValue): void {
    lua.luaL_checkstack(L, 3, null);
    if (v === null) return lua.lua_pushnil(L);
    if (typeof v === 'boolean') return lua.lua_pushboolean(L, v ? 1 : 0);
    if (typeof v === 'number') {
      if (Number.isSafeInteger(v)) lua.lua_pushinteger(L, BigInt(v));
      else lua.lua_pushnumber(L, v);
      return;
    }
    if (typeof v === 'string') {
      if (v.includes('\0')) throw new ScriptValueError('strings must not contain NUL characters');
      lua.lua_pushstring(L, v);
      return;
    }
    if (Array.isArray(v)) {
      const arr = v as readonly ScriptValue[];
      lua.lua_createtable(L, arr.length, 0);
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i] as ScriptValue;
        if (item === null) throw new ScriptValueError('arrays passed to a script must not contain null');
        push(L, item);
        lua.lua_rawseti(L, -2, BigInt(i + 1));
      }
      return;
    }
    const obj = v as {readonly [key: string]: ScriptValue};
    const keys = Object.keys(obj).sort();
    lua.lua_createtable(L, 0, keys.length);
    for (const key of keys) {
      const item = obj[key] as ScriptValue;
      if (item === null) continue;
      if (key.includes('\0')) throw new ScriptValueError('keys must not contain NUL characters');
      lua.lua_pushstring(L, key);
      push(L, item);
      lua.lua_rawset(L, -3);
    }
  }

  const pushGlobals = (L: LuaState) => void lua.lua_rawgeti(L, REG, LUA_RIDX_GLOBALS);

  // ------------------------------------------------------------------ states
  function createState(o: VmStateOptions): VmState {
    const global = new pkg.LuaGlobal(lua, true);
    const L = global.address;
    const r: StateRecord = {
      L,
      functions: [],
      valueLimits: o.valueLimits,
      pending: null,
      active: null,
      stop: null,
      sentinelRef: 0,
    };
    states.set(L, r);
    let closed = false;

    /** Run `fn` on the state inside one protected call. Returns the Lua status and the error value text. */
    const protect = (fn: (L: LuaState) => void): {status: number; message: string} => {
      r.pending = fn;
      r.stop = null;
      lua.lua_settop(L, 0);
      lua.lua_pushcclosure(L, trampolinePtr, 0);
      const status = lua.lua_pcallk(L, 0, 0, 0, 0, null);
      r.pending = null;
      let message = '';
      if (status !== LUA_OK) {
        const t = lua.lua_type(L, -1);
        if (t === T_STRING) message = lua.lua_tolstring(L, -1, null);
        else if (t === T_NUMBER) message = String(lua.lua_tonumberx(L, -1, null));
        else message = `error object (${t === T_TABLE ? 'table' : 'value'})`;
        if (message.length > MESSAGE_LIMIT) message = message.slice(0, MESSAGE_LIMIT);
      }
      lua.lua_settop(L, 0);
      return {status, message};
    };

    const addFunction = (f: VmHostFunction) => {
      r.functions.push(f);
      lua.lua_pushinteger(L, BigInt(r.functions.length - 1));
      lua.lua_pushcclosure(L, dispatchPtr, 1);
    };

    // Set up with no cap: the libraries and the sandbox prelude are fixed engine cost, not script cost.
    const setup = protect(L => {
      lua.luaopen_base(L);
      lua.lua_settop(L, 0);
      pushGlobals(L);
      for (const [name, open] of [
        ['string', lua.luaopen_string],
        ['table', lua.luaopen_table],
        ['math', lua.luaopen_math],
        ['utf8', lua.luaopen_utf8],
      ] as const) {
        lua.lua_pushstring(L, name);
        open(L);
        lua.lua_rawset(L, 1);
      }
      lua.lua_createtable(L, 0, 0);
      r.sentinelRef = lua.luaL_ref(L, REG);
      for (const [name, f] of Object.entries(o.globals)) {
        lua.lua_pushstring(L, name);
        addFunction(f);
        lua.lua_rawset(L, 1);
      }
      lua.lua_pushstring(L, 'host');
      lua.lua_createtable(L, 0, Object.keys(o.host).length);
      for (const [name, f] of Object.entries(o.host)) {
        lua.lua_pushstring(L, name);
        addFunction(f);
        lua.lua_rawset(L, -3);
      }
      lua.lua_rawset(L, 1);
      const status = lua.luaL_loadbufferx(L, SANDBOX_PRELUDE, utf8Length(SANDBOX_PRELUDE), '=sandbox', 't');
      if (status !== LUA_OK) throw Error('scripting: the sandbox prelude did not compile');
      lua.lua_rawgeti(L, REG, BigInt(r.sentinelRef));
      lua.lua_pushboolean(L, o.allowPatterns ? 1 : 0);
      addFunction({cost: 1, run: () => o.random()});
      addFunction(METER);
      lua.lua_callk(L, 4, 0, 0, null);
    });
    if (setup.status !== LUA_OK) {
      states.delete(L);
      global.close();
      throw Error(`scripting: could not create a script state (${setup.message})`);
    }
    if (global.getMemoryUsed() >= o.memoryBytes) {
      states.delete(L);
      global.close();
      throw Error(`scripting: memoryBytes ${o.memoryBytes} is below the sandbox's own ${global.getMemoryUsed()} bytes`);
    }
    global.setMemoryMax(o.memoryBytes);

    /** A clock that cannot be read (non-finite start) stops the call at the first hook. */
    const deadlineFor = (budget: VmBudget): number => {
      if (budget.clock === null) return Infinity;
      const start = budget.clock();
      return Number.isFinite(start) ? start + budget.wallMs : -Infinity;
    };
    /** Run script code under a budget; classify the result. */
    const budgeted = (
      budget: VmBudget,
      fn: (L: LuaState) => void,
    ): {status: number; message: string; used: number; reason: ScriptFailure | null} => {
      const slice = Math.max(1, Math.min(HOOK_SLICE, budget.instructions));
      const a: ActiveBudget = {
        budget,
        deadline: deadlineFor(budget),
        used: 0,
        slice,
        hostCalls: 0,
        exhausted: null,
      };
      r.active = a;
      lua.lua_sethook(L, hookPtr, LUA_MASKCOUNT, slice);
      let out: {status: number; message: string};
      try {
        out = protect(fn);
      } finally {
        lua.lua_sethook(L, 0, 0, 0);
        r.active = null;
      }
      let reason: ScriptFailure | null = null;
      if (out.status !== LUA_OK)
        reason = a.exhausted ?? r.stop?.reason ?? (out.status === LUA_ERRMEM ? 'memory' : 'error');
      return {...out, used: Math.min(a.used, budget.instructions), reason};
    };

    const failureMessage = (reason: ScriptFailure, message: string, budget: VmBudget): string => {
      switch (reason) {
        case 'instructions':
          return `instruction budget of ${budget.instructions} exhausted`;
        case 'wall':
          return `wall-time budget of ${budget.wallMs} ms exhausted`;
        case 'host-calls':
          return `more than ${budget.hostCalls} host calls`;
        case 'memory':
          return `memory cap of ${o.memoryBytes} bytes reached`;
        default:
          return message;
      }
    };

    const live = () => {
      if (closed) throw Error('scripting: the script state is closed');
    };

    return {
      write(name, value) {
        live();
        const res = protect(L => {
          pushGlobals(L);
          lua.lua_pushstring(L, name);
          push(L, value);
          lua.lua_rawset(L, -3);
        });
        return res.status === LUA_OK ? {ok: true} : {ok: false, message: res.message};
      },
      read(name, limits) {
        live();
        let value: ScriptValue = null;
        const res = protect(L => {
          pushGlobals(L);
          lua.lua_pushstring(L, name);
          lua.lua_rawget(L, -2);
          value = toJs(L, -1, limits, {nodes: 0}, 0);
        });
        return res.status === LUA_OK ? {ok: true, value} : {ok: false, message: res.message};
      },
      run(source, chunkName, budget): VmOutcome {
        live();
        const res = budgeted(budget, L => {
          const status = lua.luaL_loadbufferx(L, source, utf8Length(source), '=' + chunkName, 't');
          if (status !== LUA_OK) {
            lua.lua_error(L);
            return;
          }
          lua.lua_callk(L, 0, 0, 0, null);
        });
        if (res.reason === null) return {ok: true, value: null, instructions: res.used};
        return {
          ok: false,
          reason: res.reason,
          message: failureMessage(res.reason, res.message, budget),
          instructions: res.used,
        };
      },
      call(fn, args, budget) {
        live();
        let missing = false;
        let value: ScriptValue = null;
        const res = budgeted(budget, L => {
          pushGlobals(L);
          lua.lua_pushstring(L, fn);
          if (lua.lua_rawget(L, -2) !== T_FUNCTION) {
            missing = true;
            return;
          }
          for (const arg of args) push(L, arg);
          lua.lua_callk(L, args.length, 1, 0, null);
          try {
            value = toJs(L, -1, o.valueLimits, {nodes: 0}, 0);
          } catch (e) {
            if (e instanceof ScriptValueError) throw new Stop('value', `result: ${e.message}`);
            throw e;
          }
        });
        if (missing) return {ok: false, reason: 'missing'};
        if (res.reason === null) return {ok: true, value, instructions: res.used};
        return {
          ok: false,
          reason: res.reason,
          message: failureMessage(res.reason, res.message, budget),
          instructions: res.used,
        };
      },
      memoryUsed: () => (closed ? 0 : global.getMemoryUsed()),
      close() {
        if (closed) return;
        if (r.active !== null || r.pending !== null)
          throw Error('scripting: a script state cannot be closed while it is running');
        closed = true;
        states.delete(L);
        global.close();
      },
    };
  }

  return Object.freeze({language: 'lua-5.4' as const, createState});
}
