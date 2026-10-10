# Script runtime options (2026-10-09)

Decision input for [ADR 0120](../adr/0120-optional-sandboxed-script-runtime.md). The creator approved an optional
sandboxed script runtime kit with one new dependency for that kit only. Requirements: capability-scoped host API
(registered functions only), per-call instruction and wall-time budgets, a memory cap, deterministic random numbers
and clock injected by the host, timers on the fixed tick, save/restore of script state or a documented restart
contract, hot reload in development, and error isolation per script. A game that does not use the kit must not pay
for it in its bundle.

Package facts were read from the npm registry on 2026-10-09 (`npm view <name> version license dist.unpackedSize
time.modified`) and, for the chosen package and the closest alternatives, from the installed files. Anything marked
*unverified* was not inspected here. Unpacked size is the whole npm tarball, not what a browser downloads.

## Twenty options

| # | Option | Licence | Size (verified) | Exact instruction budget | Wall stop | Memory cap | Deterministic as shipped | VM state serialisable | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **wasmoon 1.16.0** (Lua 5.4 in WebAssembly) | MIT (Lua: MIT) | 272 KB wasm + 152 KB JS; one package (+ a types-only package) | Yes: raw `lua_sethook` count hook is exported | Yes, from the hook | Yes: custom allocator with a maximum (`LuaGlobal(..., true)`) | No: table iteration order uses a time-seeded hash (observed: three runs, three orders), `math.random` is time-seeded, addresses are printable. All three are fixable in a prelude | No (restart contract needed) | Full raw C API exported, so the kit controls marshalling, protection and libraries itself |
| 2 | fengari 0.1.5 (Lua 5.3 in JavaScript) | MIT | 1.6 MB | Yes, via its debug hook | Yes | No: objects live in the JS heap | Same Lua hazards, plus JS engine differences | No | Last release 2025-12; markedly slower than a native interpreter (*unverified for this workload*) |
| 3 | quickjs-emscripten 0.32.0 (QuickJS) | MIT | core 0.8 MB + one 503 KB wasm variant + ffi types: at least two direct packages | No: interrupt handler polled on a counter of calls/branches, not instructions | Yes | Yes (`setMemoryLimit`) | Mostly: JS property order is specified; `Math.random`/`Date` must be replaced | No | Strong candidate; needs two direct dependencies, which exceeds the approval |
| 4 | @sebastianwessel/quickjs 3.1.0 | MIT | 0.7 MB + quickjs-emscripten | As 3 | Yes | Yes | As 3 | No | A wrapper over 3; more dependencies, more surface |
| 5 | luau-web 1.5.0 (Luau) | MIT | 1.3 MB (asyncify build, wasm inlined) | Not exposed by the bindings (inspected `index.d.ts`) | Not exposed | Not exposed | *unverified* | No | Luau's own sandbox design is attractive, but these bindings are a single-maintainer fork with no budget API |
| 6 | Hardened JavaScript `ses` 2.3.0 (Compartments) | Apache-2.0 | 4.7 MB | No | No: same thread, cannot stop a loop | No | No | n/a | Capability isolation without resource bounds; also locks down the page's own intrinsics |
| 7 | ShadowRealm | n/a | n/a | No | No | No | No | n/a | Not shipped in browsers; no resource bounds even when it ships |
| 8 | Worker + `new Function`, terminate on timeout | n/a | 0 | No | Yes, but only by killing the worker | Only per worker, coarse | No | No | Asynchronous calls do not fit a fixed-step system; needs `unsafe-eval` in the page's CSP |
| 9 | Sandboxed iframe | n/a | 0 | No | No | No | No | No | Same problems as 8, plus layout and lifecycle cost |
| 10 | js-interpreter 6.0.2 (JS interpreter in JS) | Apache-2.0 | 0.96 MB | Yes (step count) | Yes | No | Yes if the host controls inputs | Yes (documented serialisation) | ES5 only; orders of magnitude slower than a VM (*unverified here*) |
| 11 | sval 0.6.12 (JS interpreter in JS) | MIT | 0.65 MB | No | No | No | No | No | No resource controls |
| 12 | moonshine 0.2.1 / lua.vm.js 0.0.1 | MIT | small | *unverified* | *unverified* | No | *unverified* | No | Unmaintained since 2022 or earlier |
| 13 | Pyodide 314.0.7 (CPython) | MPL-2.0 | 13.9 MB | No | Interrupt buffer only | No | No | No | Far too large for an optional game kit |
| 14 | MicroPython WebAssembly 1.29.0-6 | MIT | 2.4 MB | No hook exposed (*unverified in detail*) | *unverified* | Heap size fixed at start | *unverified* | No | Smaller than Pyodide; budgets would need a custom build |
| 15 | Creator-compiled WebAssembly with instruction metering (e.g. `wasm-metering` 0.2.1) | MPL-2.0 | 20.8 MB tool | Yes (injected counters) | Yes | Yes (module memory maximum) | Yes | Possible (linear memory copy) | Asks creators for a compiled-language toolchain; the metering tool is unmaintained since 2022 |
| 16 | AssemblyScript scripts (`@assemblyscript/loader` 0.28.20) | Apache-2.0 | 54 KB loader + compiler at build time | Only with metering (15) | Same | Yes | Yes | Possible | A build step per script; no hot reload without the compiler in the page |
| 17 | inkjs 2.4.0 (narrative scripting) | MIT | 6.9 MB | No | No | No | Mostly | Yes (story state JSON) | Domain-specific: dialogue and narrative, not general behaviour |
| 18 | Dialogue-graph languages (e.g. yarn-bound 0.5.5) | ISC | 0.3 MB | No | No | No | Mostly | Partly | Domain-specific; Foundation already has a dialogue kit |
| 19 | A bounded in-house interpreter (own small language) | Project | small | Yes | Yes | Yes | Yes by construction | Yes | Best control and serialisation, but a new language to design, document, test and maintain, with no existing editor or library support |
| 20 | No runtime scripting (status quo: typed TypeScript content and systems, ADR 0005) | n/a | 0 | n/a | n/a | n/a | Yes | n/a | Remains the default; does not serve creators who need modder- or designer-editable behaviour loaded as text |

Other names considered and not tabled: embedded Rust languages compiled to WebAssembly (no maintained npm package
was found; `rhai-wasm` is unpublished), Starlark (the npm name holds an empty 0.0.0 package), Duktape builds (no
maintained npm package found).

## Choice: option 1, wasmoon (Lua 5.4)

- **Budgets** are exact: the exported count hook stops a call after exactly N VM instructions, re-armed per call, and
  reads the wall clock every 1,000 instructions. The per-state allocator cap is enforced inside the VM.
- **One package**, MIT, Lua itself MIT; the WebAssembly binary is a separate 272 KB asset that Vite emits with a hash
  and fetches only when `loadScriptVm` runs.
- **Control**: wasmoon exports the raw Lua C API, so the kit does not use wasmoon's JavaScript-object proxying at
  all. The kit opens only `base`, `string`, `table`, `math` and `utf8`, runs every host-side touch of a state in a
  protected call, and marshals only plain data with explicit limits.
- **Determinism hazards** found by experiment are closed in the sandbox prelude: `pairs` iterates in a fixed key
  order and raw `next` is removed; `math.random` reads a host-owned saveable stream; addresses are not printable
  (`tostring`, `%s`, `%p`); finalisers and weak tables are refused; native pattern matching (not interruptible) is
  off unless the creator allows it.
- **Lua** is the most common embedded game-scripting language, so creators and modders are likely to know it.

## Critic pass

| Objection | Answer |
|---|---|
| A JavaScript engine (3) would let creators script in the language they already use. | Two direct packages exceed the approval, and its interrupt handler cannot give an exact, deterministic instruction budget. The kit's VM contract (`ScriptVm`) is small; a creator can implement it over another engine without changing the host. |
| Lua VM state cannot be serialised, so rollback and saves are weaker than an in-house interpreter (19). | True. The kit makes it a stated contract: simulation state lives in the script's `state` table (plain data, saved and restored with timers and the random stream); top levels re-run on restore. A rollback sync-test consumer shows a script that hides state in a local is caught. Restore costs about 0.2 ms per script (headless measurement), which limits deep rollback with many scripts. |
| An in-house interpreter (19) would have no dependency at all. | It would also have no users, documentation or tooling, and its correctness would be ours to establish. The creator asked for a starting point; an established language serves that better. |
| Lua's own hash seed still varies; is iteration order really fixed? | Only `pairs` is reachable; it sorts keys (numbers, strings, then booleans) and refuses table/function keys. `#t` and `ipairs` are defined by the language. Raw `next` is removed. |
| Can a script escape the budget with `pcall`, `xpcall` or an error handler? | `pcall`/`xpcall` re-raise the private budget sentinel, and after exhaustion the hook fires on every instruction, so any recovery attempt stops again. Tests cover loops wrapped in `pcall` and `xpcall`. |
| Native library calls are not interrupted by the hook. | Remaining native calls are linear in data already bounded by the memory cap (`string.rep`, `table.concat`, `table.sort`), or are off by default (patterns). The wall-time stop is reported as non-deterministic and faults the script. |
| Memory exhaustion inside host-side marshalling could reach Lua's panic handler and abort the shared VM. | Every host-side touch runs inside one protected call; an allocation failure becomes an ordinary `memory` result. |
| The WebAssembly memory is shared by all scripts on the page. | Each script's allocations are capped; the page-wide total is bounded by `maxScripts × memoryBytes` plus the VM's own memory. A browser that cannot grow memory makes allocations fail, which scripts see as `memory`. |
| wasmoon's own build is a development-flavoured emscripten output (152 KB JS with assertions). | Measured lazily loaded cost is 121 KB minified JS (40 KB gzip) plus the 272 KB wasm (111 KB gzip), only for games that call `loadScriptVm`. |
