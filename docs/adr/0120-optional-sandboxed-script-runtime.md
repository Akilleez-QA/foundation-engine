# ADR 0120: optional sandboxed script runtime

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Area: Optional kits / content
- Amends: [ADR 0005](0005-registries-and-typed-content.md) ("content is typed TypeScript") for creators who opt in.
- Research: [script runtime options](../research/script-runtime-options.md) (twenty options and a critic pass).

## Context

Foundation content and behaviour are typed TypeScript (ADR 0005): the compiler checks them and the bundler splits
them. Some creators want behaviour that designers or players can edit as text and load at run time (quests,
triggers, level logic, mods), without a rebuild and without granting that text the page's full JavaScript authority.
The creator approved an optional sandboxed script runtime with one new dependency for that kit only. Core stays
TypeScript; no engine module imports the kit.

## Decision

Add `@kits/scripting`: Lua 5.4 (the MIT-licensed `wasmoon` WebAssembly build, exact-pinned) behind a small VM
contract, and a pure TypeScript host that owns everything the scripts may affect.

- **Loading.** `loadScriptVm({signal})` imports the VM module and its binary dynamically, once per page; a game that
  never calls it ships no VM. Abort rejects without keeping the VM; a failed load is retried on the next call.
- **Isolation.** Each script has its own Lua state with its own allocation cap. Only `base`, `string`, `table`,
  `math` and `utf8` are opened; `io`, `os`, `debug`, `package`, `coroutine`, `load`, `require`, `print`,
  `collectgarbage` and `string.dump` are absent. Source is compiled as text only. A script reaches the game only
  through host functions the creator registers and grants to that script by name (`host.<name>`), plus the kit's
  built-ins (`now`, `log`, `after`, `every`, `cancel`, `state`, `math.random`).
- **Budgets.** Every call has a deterministic VM instruction budget (a count hook, stopping within one 1,000-instruction slice of the limit; native library work is metered into it), a host-call count and per-call cost, a
  wall-time stop and the memory cap. A budget stop cannot be caught by the script. Instruction, host-call, error and
  value failures are deterministic; wall-time and memory stops are reported as not deterministic and fault the
  script at once. Repeated failures fault a script; a faulted script is refused until reloaded or restored.
- **Determinism.** Time is the host's integer tick, advanced once per fixed step. Random numbers come from a saveable
  per-script stream derived from the host seed. Iteration order, printed addresses, finalisers, weak tables and
  native pattern matching (unless allowed) are closed off in the sandbox prelude.
- **State and restore.** A script's simulation state is its `state` table of plain data. `save()` returns JSON with
  each script's state, timers, random word and source digest; `restore()` rebuilds fresh states, re-runs top levels
  and calls `on_restore()`, atomically. Lua locals, upvalues and closures are not saved: that is the restart
  contract. `reload()` swaps code while keeping state, timers and stream, for development hot reload.
- **Ownership.** The creator creates the host (normally in a scene's `prepare`), drives it with `scriptTickSystem`
  or its own fixed system, and disposes it on exit. The kit installs no module, registry, scheduler or save section.

## Consequences

- A game that opts in gains editable behaviour with explicit bounds; it accepts a lazily loaded 121 KB JavaScript
  chunk and a 272 KB WebAssembly asset (about 150 KB gzip together) and about 18 KB of first-load JavaScript when it
  imports the kit statically. Games that do not import the kit are unchanged.
- Host functions run as creator TypeScript: their time is outside the instruction budget, so they must be bounded.
  The sandbox is a resource and capability boundary inside one page, not a security boundary against a hostile page
  or a guarantee about the VM binary.
- Rollback with many scripts is limited by restore cost (fresh states per restore); deep rollback should keep the
  number of scripted entities small or keep hot simulation in TypeScript.
- Changing the VM (another Lua build, or another language behind the same contract) is a creator-directed
  replacement through `loadScriptVm({load})`; the host and its tests stay.
