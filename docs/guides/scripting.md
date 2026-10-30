# Sandboxed scripts (optional)

`@kits/scripting` runs creator- or player-editable **Lua 5.4** text inside the game with explicit bounds. Use it
when behaviour must change without a rebuild (level triggers, quest steps, designer tuning, mods). Keep it out when
typed TypeScript systems are enough: they are faster, checked by the compiler and need no VM. Decision record:
[ADR 0120](../adr/0120-optional-sandboxed-script-runtime.md); option study:
[script runtime options](../research/script-runtime-options.md); full contract table:
[kit README](../../src/kits/scripting/README.md).

## Inputs, outputs and owner

| Part | Who owns it | Notes |
|---|---|---|
| The VM | The page, once | `loadScriptVm({signal})` imports the VM module and its WebAssembly binary on first use. Pass the scene's `prepare` signal |
| A script host | The scene (or any creator owner) | `createScriptHost(vm, {seed, api, limits, clock})`; drive with `scriptTickSystem`; `dispose()` on exit |
| A script | The host | `load(id, source, {capabilities, state})`; own Lua state, own memory cap, own random stream |
| Host functions | The creator | `api: { name: { cost, run(args, {script, tick}) } }`; a script sees only the names in its `capabilities` as `host.<name>` |
| Script state | The script, saved by the host | The global `state` table, plain data only |
| Snapshots | The creator | `save()` JSON in a save section, rollback state text or a replay log |

The kit adds no module, registry, scheduler or save section. Calls are synchronous and run inside the fixed step
that makes them; there is no background execution.

## Budgets and what a failure means

| Stop | Deterministic | Effect on the script |
|---|---|---|
| `instructions` (VM instructions per call, deterministic, stopping within one 1,000-instruction slice of the limit; host calls charge their `cost` and native library calls charge 1 per 16 bytes or elements) | Yes | Counts toward `failuresBeforeFault` |
| `host-calls` (invocations per call) | Yes | Counts toward `failuresBeforeFault` |
| `error` (a Lua error or a host function that threw) | Yes | Counts toward `failuresBeforeFault` |
| `value` (a result or argument outside the plain-data domain or its bounds) | Yes | Counts toward `failuresBeforeFault` |
| `wall` (`wallMsPerCall`, checked every 1,000 instructions; only when you pass `clock`, e.g. `() => performance.now()`; a clock that throws or returns NaN fails closed) | No | Faults at once |
| `memory` (`memoryBytes` per script) | No | Faults at once |

Native library calls are metered into the instruction budget at one instruction per 16 bytes or elements they touch,
so loops over large strings or tables run out of instructions. One native call can still take milliseconds on large
data, and with `allowPatterns` a pattern can be super-linear: pass a `clock` for a wall-time stop. A script cannot catch a budget stop: `pcall`/`xpcall` re-raise it, and after the stop the VM refuses every further
instruction of that call. A faulted script is refused (`refused: faulted`) and its timers are skipped until you
`reload` or `restore` it. A failed call does not undo changes it already made to `state`; design scripts so a
partial update is harmless, or restore a snapshot.

Under rollback or lockstep, treat any non-deterministic stop as a desync: one machine may hit the wall clock or the
memory cap where another does not. Choose `wallMsPerCall` and `memoryBytes` well above what your scripts need and
use `instructionsPerCall` as the real bound.

## Determinism and the restart contract

- `now()` is the host tick, advanced once per `tick()`; timers (`after`, `every`) are due on ticks. Timers fire in
  due tick, then timer id order, at most `maxTimerFiresPerTick` per tick; the rest are `deferred` to the next tick.
- `math.random` draws from a per-script stream derived from the host `seed` and the script id. Take the seed from
  the seeded `ctx.random()` (for example `Math.floor(ctx.random() * 2 ** 32)` at scene entry) so `?seed=` replays.
- `pairs` visits keys in a fixed order (numbers ascending, strings in byte order, then `false`, `true`) and refuses
  other key types; raw `next` is not available. Addresses are not printable; `__gc` and `__mode` are refused.
- `setmetatable` gives a table a private copy of its metatable, so `__gc` or `__mode` added later has no effect;
  metamethods added to a metatable after `setmetatable` are not seen (define them first). `getmetatable` returns the
  table you passed.
- Numbers in `state` are saved as JSON numbers: an integral float such as `2.0` comes back as the integer `2`, and
  `-0.0` as `0`. Keep values that must stay floats non-integral, or do not depend on `math.type`/`tostring` of them.
- **Only `state` survives a restore.** Lua locals, upvalues, closures and other globals are rebuilt by running the
  script's top level again in a fresh state, then `on_restore()` if it exists. Keep every simulation value in
  `state`; make the top level define functions and defaults (`state.x = state.x or 0`), and start timers from a
  function you call once rather than from the top level.

The `@kits/rollback` sync test is a good local check: its consumer test passes for a script that keeps everything
in `state` and reports a desync for one that counts in a local.

## Save and restore

```ts
const ScriptsSave = defineSaveSection<{snapshot: unknown}>({
  id: 'level.scripts', initial: {snapshot: null}, parse: raw => raw as {snapshot: unknown},
});
// Saving (outside a script call):
const s = scripts.save();
if (s.ok) ctx.save(ScriptsSave).update(d => { d.snapshot = s.snapshot; });
// Loading, after createScriptHost with the same seed and api:
const saved = ctx.save(ScriptsSave).get().snapshot;
if (saved) scripts.restore(saved, { gate: gateSource });
```

`restore` checks the format, seed, limits and each script's source digest; changed code is refused unless you pass
`{acceptChangedSources: true}` (then your script must accept the old `state` shape). A restore that fails for any
script changes nothing.

## Hot reload in development

`reload(id, source)` swaps code while keeping `state`, timers and the random stream, then calls `on_reload()` if it
exists. If the new code does not load, the old code keeps running and you get the failure. With Vite:

```ts
import gateSource from './gate.lua?raw';
if (import.meta.hot)
  import.meta.hot.accept('./gate.lua?raw', mod => {
    const r = scripts?.reload('gate', (mod as {default: string}).default);
    if (r && r.status !== 'loaded') console.warn('gate.lua did not reload', r);
  });
```

## Cost and bundle

A game that never imports `@kits/scripting` is unchanged. A game that calls `loadScriptVm` fetches a 121 KB
JavaScript chunk (40 KB gzip) and a 272 KB WebAssembly asset (111 KB gzip) once, lazily; neither is in first-load
JavaScript. Importing the host statically adds about 18 KiB to first-load JavaScript (measured on a fixture build);
put the scripted scene in a lazy `body` if that matters. Each script state starts at about 23 KiB. Headless
timings are in the kit README; they are not device budgets.

## Evidence and limits

Implemented and tested headlessly (unit and consumer tests), and exercised in headless Chromium through both the
Vite development server and a production-mode build of a fixture game (VM chunk and binary fetched lazily, no page
errors, timers advancing). Not established: hosted full CI on this change, any physical device, and
long-running memory behaviour. The sandbox limits what a script can reach and how much it can run; it is not a
security boundary against the page itself, and host functions are ordinary TypeScript outside the budget.
