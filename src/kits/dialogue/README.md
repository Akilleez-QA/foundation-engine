# Dialogue kit

`createDialogue(definition, sessionId, snapshot?)` owns one conversation. Nodes/options have stable IDs and localization keys. Conditions are caller-provided facts; selected effects are returned as intents, not automatically applied to world state. `view(facts)` returns the session, node and revision to echo in `choose`. Stale choices are rejected, conditions are rechecked, and `close` always provides an exit independent of narrative hooks. No index clamping.

Snapshots are plain data for the existing save-section API. Definition versions must use a new definition ID or explicit migration. A successful choice and applying its effects are separate operations; callers needing durable rewards must use a shared transaction/claim record. No distributed or cross-section atomicity is claimed. Graph validation bounds nodes/options and checks that every node has an authored exit route. Conditions can temporarily block all choices; close remains available. No rendering or per-frame cost.

## Variables, visit counts and conditions (optional)

Walkthrough: [branching dialogue recipe](../../../docs/recipes/add-branching-dialogue.md).

| Contract | Definition |
|---|---|
| Creator-owned semantics | `definition.variables` declares names and initial values (boolean, safe integer, or string of at most 256 UTF-16 units); each keeps its declared type. Option `when` is a JSON condition tree: `{var, op, value}`, `{visits: nodeId, op, value}`, `{fact}`, `{all: [...]}`, `{any: [...]}`, `{not: ...}` with `op` in `eq ne lt le gt ge` (ordered ops for numbers only). Option `set` is a list of `{var, op: 'set', value}` or `{var, op: 'add', value}` (numbers). There is no expression language, string evaluation or callback. |
| Inputs and outputs | `view(facts)` lists options whose `requires` facts are present and whose `when` holds, plus a copy of `variables` (usable as message variables, for example a `select` on a pronoun variable). `choose` rechecks both, then applies `set` in order together with the move and the visit count, and returns `effects`. `variables()` and `visits(node)` read the current values. |
| Owner | The caller, as before; no service, timer or frame work. Persistence borrows save sections through `snapshot()`. |
| Bounds | Validated at construction: at most 1024 nodes, 32 options per node, 256 variables, 32 assignments per option, 64 condition nodes and nesting depth 8 per condition. Evaluation is therefore bounded by the definition. Visit counts saturate at `Number.MAX_SAFE_INTEGER`. |
| Overload | An `add` that would leave the safe-integer range returns `overflow` and changes nothing (no move, no visit, no assignment). |
| Cancellation and replacement | Unchanged: session/node/revision echo gives `stale`; closing inside a fact callback gives `closed` and publishes nothing. |
| Failure and recovery | Invalid definitions throw at construction (unknown variable or node, type mismatch, unknown op, oversize tree). Snapshots: `variables` and `visits` are optional; a first-version snapshot restores with initial values and one visit to its current node. A saved variable the definition no longer declares, a changed type, an unknown node in `visits`, or a negative or non-integer count throws (the save section then quarantines it). Adding a newly declared variable needs no migration: it starts at its initial value. |
| Evidence | `variables.test.ts`: gating, atomic assignment with the move, visit counting, choose-time recheck, facts combined with variables, overflow without change, a real SaveStore round trip across a fresh store, first-version snapshot restore, refused snapshots, definition validation and tree bounds, and isolation from later edits of the authored definition. The first-version tests (`dialogue.test.ts`, `adversarial.test.ts`) pass unchanged. Headless unit tests only. |
| Limits | No template uses variables yet; no browser or device evidence. Conditions see only declared variables, visit counts and caller facts, not other game state; pass that as facts. No storylet/saliency selection, random choice, line metadata or text presentation (typewriter speed, auto-advance) is supplied. |
