# kits/scripting

Optional **sandboxed Lua 5.4 scripts** for behaviour that should be editable as text and loaded at run time
(triggers, quests, level logic, mods), with capability-scoped host functions, deterministic per-call instruction budgets, a
wall-time stop, a per-script memory cap, timers on the fixed tick, a saveable random stream, save/restore and hot
reload. Core stays TypeScript ([ADR 0120](../../../docs/adr/0120-optional-sandboxed-script-runtime.md)); nothing
here is registered or required, and a game that never calls `loadScriptVm` ships no VM. Guide:
[scripting](../../../docs/guides/scripting.md).

```ts
import { createScriptHost, loadScriptVm, scriptTickSystem, type ScriptHost } from '@kits/scripting';
let scripts: ScriptHost | null = null;

export default defineScene({
  id: 'level', title: 'Level',
  systems: [scriptTickSystem(() => scripts)],          // timers and now() follow the fixed step
  async prepare(_ctx, signal) {
    const vm = await loadScriptVm({ signal });          // lazy: VM chunk + wasm fetched here, once per page
    scripts = createScriptHost(vm, {
      seed: 1234,                                       // e.g. derived from ctx.random() for replayable runs
      clock: () => performance.now(),                   // enables the wall-time stop; the kit reads no clock itself
      api: { open_door: { cost: 50, run: ([id]) => openDoor(String(id)) } },
    });
    scripts.load('gate', gateSource, { capabilities: ['open_door'] });
  },
  exit() { scripts?.dispose(); scripts = null; },
});
```

```lua
-- gate.lua: all simulation state lives in `state`; top level only defines functions and defaults.
state.opened = state.opened or false
function on_switch(who)
  if state.opened then return false end
  state.opened = true
  after(30, 'close')                -- 30 fixed ticks later
  return host.open_door('north')
end
function close() state.opened = false end
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | Which scripts exist and where their text comes from; which host functions exist, what they do and which script may call each (`capabilities`); the seed; what a failed call or a faulted script means for the game; where snapshots are stored (a save section, rollback state text) |
| Inputs and outputs | Script ids: a lowercase letter, then up to 63 of `a-z0-9-`. Values crossing the boundary are plain data only: null (nil; allowed as a whole argument or object member, not as an array item), booleans, finite numbers, strict UTF-8 strings without NUL, arrays and string-keyed objects, bounded by depth, node count and string length, and checked before the call (a bad argument is `refused: invalid`, never charged to the script); host arguments arrive frozen. Numbers are JSON numbers: a safe integer becomes a Lua integer, so an integral float such as `2.0` reads back as the integer `2` and `-0.0` as `0` (relevant to `math.type`, `tostring` and `//` after a restore). A Lua table reads back as an array when its keys are exactly 1..n, otherwise as an object with string keys (empty: `{}`); mixed or other keys are refused. `call` returns `ok` (first return value), `missing`, `refused` (`disposed`, `reentrant`, `invalid`, `unknown-script`, `faulted`) or `failed` (`error`, `instructions`, `wall`, `memory`, `host-calls`, `value`) with `charged` instructions and `deterministic`. `tick()` advances the tick by one and reports fired, deferred and skipped timers and failures. `save()` returns JSON; `restore()` and `reload()` are atomic |
| Script surface | `state` (the persistent table), `host.<granted>`, `now()`, `log(...)`, `after(ticks, 'fn', arg)`, `every(ticks, 'fn', arg)`, `cancel(id)`, `math.random` (host stream; `math.random(0)` gives a full integer; ranges wider than 2^53 are refused), `pairs` in a fixed key order (numbers, strings, false, true; other key types refused), `setmetatable` with a private copy of the metatable (so `__gc`/`__mode` cannot be added later; metamethods added to the metatable after `setmetatable` are not seen; `getmetatable` returns the original), `table.move` implemented in Lua, `string`, `table`, `math`, `utf8`, `pcall`/`xpcall`/`error`. Absent: `io`, `os`, `debug`, `package`, `coroutine`, `load`, `dofile`, `require`, `print`, `collectgarbage`, `next`, `string.dump`, `math.randomseed`; `string.match`/`gmatch`/`gsub` and pattern `find` unless `allowPatterns`. Optional hooks: `on_restore()`, `on_reload()` |
| Owner | The creator's scene (or any owner) creates the host after `loadScriptVm`, drives it from one fixed system and disposes it. The VM is one per page and shared; each script has its own Lua state. The kit borrows `createSaveableRng`/`hashSeed` and the fixed step; it adds no module, registry, scheduler or save section |
| Bounds (defaults; ranges in `SCRIPT_LIMIT_RANGES`) | `maxScripts` 32; `maxSourceLength` 256 Ki code units; `instructionsPerCall` 200,000 (deterministic; stops within one 1,000-instruction slice after the limit); `instructionsPerLoad` 1,000,000; `wallMsPerCall` 8 (only with an injected `clock`; a clock that throws or returns NaN stops the call); `memoryBytes` 1 MiB per script (sandbox itself about 23 KiB); `maxHostCallsPerCall` 1,000 and each host function's `cost` (default 100 instructions); `maxTimersPerScript` 64; `maxTimerFiresPerTick` 256; `maxTimerTicks` 216,000; `failuresBeforeFault` 3; `maxLogLines` 64 (256 code units each); values depth 16 / 4,096 nodes / 16 Ki string; state depth 32 / 65,536 nodes / 64 Ki string. Page-wide script memory is at most `maxScripts × memoryBytes` plus the VM |
| Overload | Over-budget calls stop with a `failed` result; a budget stop cannot be caught by `pcall`/`xpcall`. Native library calls are metered into the instruction budget at one instruction per 16 bytes or elements they touch (`string.rep` before it runs; `sub`, `upper`, `lower`, `reverse`, `format`, `char`, `table.concat`, `utf8.char` by their result; `find`, `byte`, `pack`, `unpack`, patterns and `utf8` readers by their input; `table.sort` by n log n; `table.unpack`, `insert`, `remove` by length), so a loop over large data runs out of instructions rather than wall time. More due timers than `maxTimerFiresPerTick`: the rest stay due and fire first next tick (`deferred`). Full tables (`maxScripts`, `maxTimersPerScript`) refuse; nothing is dropped silently. The log ring drops oldest lines and counts them |
| Cancellation and replacement | `loadScriptVm({signal})` rejects on abort and keeps nothing. `unload` removes a script and its timers; `cancel` removes one timer; a timer whose callback no longer exists is removed. `reload` swaps code and keeps state, timers and stream; `restore` replaces every script. `dispose()` closes every state, is idempotent, and later calls are refused (`tick()` throws). Host functions must not call the host: `call`, `load`, `reload`, `restore` and `save` are refused as `reentrant`, `unload` returns false, `tick()` throws, and `dispose()` is deferred until the running call returns |
| Failure and recovery | Script errors, budget stops and invalid values are results, never exceptions into the game. `failuresBeforeFault` consecutive failures fault a script; `wall` and `memory` fault at once (their outcome depends on the machine and heap history). A faulted script is refused and its timers skipped until `reload` or `restore`. A call that fails part-way keeps whatever it already changed in `state` (no transaction). A failed load, reload or restore changes no script, timer or timer id (log lines it wrote stay). `save` fails, naming the script, if a `state` holds functions or exceeds its bounds |
| Determinism | Same seed, sources, calls and ticks give the same results, state, random draws and instruction charges. Lua locals, upvalues and globals other than `state` are **not** saved: on restore every top level runs again in a fresh state, then `on_restore()`. Keep simulation state in `state`; a top level that schedules timers re-schedules them on each restore |
| Evidence | `scripting.test.ts` (20 tests): validation; metered native work (`table.move` and `string.rep` with huge counts, a loop of 400 KB copies) stopping on instructions within seconds; `dispose()` from a host function deferred to the end of the call; a `__mode` added after `setmetatable` ignored; argument domain refused before the call, invalid UTF-8 results refused, depth limits consistent between load and save; a host throwing `Infinity` and a reentrant `save()` handled; failed loads leave timer ids unchanged and `math.random(0)`; injected wall clock (none: no wall stop; failing: fails closed); non-Error host throws become script errors; sandbox surface, ordered `pairs`, hidden addresses, refused `%p`/`__gc`/`__mode`, patterns off/on, binary chunks refused; uncatchable instruction stops (`pcall`, `xpcall`) and identical charges on repeat; wall and memory stops fault and report non-determinism; capability scoping, frozen copies, host errors catchable by scripts, host-call limit, reentrancy refusal, value bounds; per-script isolation, faulting and reload recovery; timer order, cancel, deferral and limits; seeded per-script random streams; JSON save/restore continuing exactly, source digest refusal, malformed snapshots unchanged, failing restore keeps old scripts; unsaveable state; hot reload; dispose and abort. `consumers.test.ts` (3 tests): a `@kits/rollback` sync test over 40 frames with 6-frame resimulation passes; a script hiding state in a local is caught as a desync; a `testScene` scene loads the VM in `prepare`, ticks timers with `scriptTickSystem` and moves an entity through a granted host function |
| Limits | Not a security boundary against the page or a guarantee about the VM binary; host functions run as ordinary TypeScript outside the instruction budget. Native library calls are not interruptible while they run: each is metered by its data (bounded by `memoryBytes`), but one call can still take milliseconds on a large string, and pattern matching (off by default) can be super-linear; with `allowPatterns`, pass a `clock`. Without a `clock` there is no wall-time stop at all. `charged` counts whole 1,000-instruction slices plus host costs and metered work, so a successful short call can report less than it ran (the stop itself is deterministic). No coroutines (suspended coroutines cannot be saved). No debugger or source maps. Restore rebuilds states (about 0.2 ms per script headless), which limits deep rollback with many scripts. Browser evidence is headless Chromium only; no physical-device evidence |

## Measured cost (headless, not a device budget)

One local Node 26 run on a desktop CPU (probe not committed): VM start 6-7 ms; loading a small script 0.35 ms; a
call with one host function about 5 µs; 10 million VM instructions about 33 ms; `save()` of 100 small scripts
0.4 ms, `restore()` of 100 scripts about 21 ms. Production build of a fixture game: the lazily loaded VM chunk is
121 KB (40 KB gzip) and the WebAssembly asset 272 KB (111 KB gzip); first-load JavaScript of that fixture rose by
18 KiB because it imported the host statically. The stock game's first-load JavaScript is unchanged.
