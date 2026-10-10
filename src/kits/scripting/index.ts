/**
 * kits/scripting: optional sandboxed Lua 5.4 scripts with capability-scoped host functions, exact per-call
 * instruction budgets, a wall-time guard, a per-script memory cap, timers on the fixed tick, a saveable random stream
 * and save/restore of each script's `state` table. The VM loads lazily (`loadScriptVm`); nothing is registered.
 * Cost: no draws; one VM per page (a 272 KB WebAssembly asset and a 121 KB JavaScript chunk, fetched on first load); each script
 * state about 23 KiB plus its own allocations up to `memoryBytes`.
 */
export {loadScriptVm, type LoadScriptVmOptions} from './vm';
export {
  createScriptHost,
  DEFAULT_SCRIPT_LIMITS,
  SCRIPT_LIMIT_RANGES,
  type ScriptApiFunction,
  type ScriptCallResult,
  type ScriptHost,
  type ScriptHostOptions,
  type ScriptHostSnapshot,
  type ScriptLimits,
  type ScriptLoadOptions,
  type ScriptLoadResult,
  type ScriptLogEntry,
  type ScriptRefusal,
  type ScriptSnapshot,
  type ScriptStatus,
  type ScriptTickReport,
  type ScriptTimerSnapshot,
} from './host';
export {scriptTickSystem} from './system';
export type {ScriptFailure, ScriptVm} from './vm-contract';
export {canonicalScriptJson, type ScriptValue} from './values';
