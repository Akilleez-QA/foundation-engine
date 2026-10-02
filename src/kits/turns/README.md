# kits/turns

Optional, headless deterministic command logs for turn-based, tactics and card rules.
`createTurnLog` keeps an accepted command sequence and derives every state by replaying it
from a captured initial state with a per-position seeded random stream. That one mechanism
gives undo, redo, exact outcome previews, replays, save snapshots and drift detection. The
creator writes the rules; this kit supplies none (no turn order, phases, stack, cards or AI).

Follow [the creator contract](../../../docs/CREATOR-CONTRACT.md). Usage walkthrough:
[recipe](../../../docs/recipes/add-a-turn-log.md).

| Contract | Definition |
|---|---|
| Creator-owned semantics | `TurnRules`: `id` (rules name and version), `validateState`, `validateCommand` (literal `true` accepts) and a pure synchronous `reduce({state, command, random})` returning `{accept:true,state}` or `{accept:false,reason}`. Turn order, phases, priority/stack resolution, triggers, timers, hidden information and AI are creator rules or other owners. |
| Inputs and outputs | Commands and states are JSON values, captured canonically (sorted keys) within `limits.command` / `limits.state` (`maxBytes`, `maxNodes`, `maxDepth`) by the existing network JSON capture over authored documents, then deep-frozen. `read()` returns a frozen view with `revision`, absolute `position`, `cursor`, `length`, `state`, `stateJson`, `canUndo`, `canRedo`. `snapshot()` returns detached plain JSON (`format: 'turns/1'`). |
| Owner | The caller constructs one log per match or puzzle and calls `dispose()` when it ends. No service, system, timer, storage, DOM or frame work. Persistence borrows the existing save sections; authoritative multiplayer borrows the network kit's durable authority through `turnAuthorityPolicies`. |
| Determinism | `random` is `createRng(hashSeed(JSON.stringify([seed, position])))` (core mulberry32), so a reducer drawing more numbers for one command cannot shift a later one. Preview, submit, redo, undo-replay and restore therefore produce identical states. `seed` is an unsigned 32-bit integer or a string name. |
| Bounds | `maxCommands` (positive safe integer) bounds retained commands (undo plus redo). Undo, `replay(k)` and restore call the reducer at most `maxCommands` times; submit, preview and redo call it once. Retained memory is the initial state, the head state and the commands, each bounded by its JSON limits. |
| Overload | Submit at capacity returns `full` (redo entries do not count, since submit discards them). `checkpoint(revision)` folds the applied prefix into the initial state and keeps absolute positions, so random streams stay unchanged; it discards undo/redo history. Over-limit or invalid commands return `invalid`; nothing is queued. |
| Cancellation and replacement | Every mutation takes the `revision` from the last `read()`; an older revision returns `stale`. Calls made from inside the reducer return `busy`. `dispose()` retires the log; disposal inside the reducer prevents publication (`retired`). |
| Failure and recovery | A rejection (`rejected`), a reducer result that is not JSON, exceeds limits or fails `validateState` (`invalid`), and a thrown exception (propagated) all leave state, revision and history unchanged and release the busy guard. Mutating the frozen state throws. `restoreTurnLog(options, snapshot)` never throws for stored data: it returns `invalid` (malformed), `foreign` (other rules id) or `diverged` (replay rejected a command or the replayed head's checksum differs, for example after a rules change without a new id). Keep the stored value and start a new run explicitly; do not overwrite it silently. |
| Evidence | `turns.test.ts` (determinism across seeds, preview equals submit, undo/redo/replay exact including random shuffles, stale refusals, round trip through a real SaveStore and a fresh store reload, foreign/malformed/tampered/drifted restore, capacity and checkpoint), `adversarial.test.ts` (bad construction, non-JSON/cyclic/oversized commands, caller mutation after submit, misbehaving reducers, throwing and mutating reducers, reentrancy, disposal inside the reducer, per-position random isolation, detached snapshots), `authority.test.ts` (the same rules under `createDurableAuthority`: consumed domain rejection, duplicate retry without re-reduction, refused invalid input, recovery and reproduction across authorities). Headless unit tests only. |
| Limits | No game consumer or template uses it yet; no browser, device or performance evidence. The checksum is the replay kit's 64-bit non-cryptographic `hashText`: it detects accidental drift, not tampering. This kit is for discrete commands with undo and previews; the replay kit (SIM-01) records fixed-tick inputs and compares digest traces for real-time simulations. The log stores every command in clear, so a local log is not suitable for hidden information against the local player; hidden-information games keep the deck order on the server (durable authority) and publish per-recipient scoped views (network kit). `turnAuthorityPolicies` keys random by `[seed, stream, sequence]`, not by local position, so a local log and the authority produce the same states only for rules that draw no random numbers. Reducer CPU time is not preempted; a work-count bound is not a deadline. No async play-by-turn timeouts, AI worker budget or replay UI is supplied. |

## Cost

No draws and no per-frame work. One reducer call plus JSON capture per submit/preview/redo;
up to `maxCommands` per undo, replay or restore.
