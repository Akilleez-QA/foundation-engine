# Recipe: add a save section, with a migration

All state that outlives a scene visit is a save section (STD-SAV-1, STD-REG-20, ADR 0007). The store saves, flushes, exports, imports, resets and quarantines it for you.

## 1. Define it

```ts
// game/best.ts
import { defineSaveSection } from '@engine';

export default defineSaveSection({
  id: 'run.best',
  initial: { score: 0, runs: 0 },
  // version 1 stored { best: number }; version 2 is { score, runs }
  migrate: { 1: (old: { best: number }) => ({ score: old.best, runs: 0 }) },
  merge: (a, b) => ({ score: Math.max(a.score, b.score), runs: Math.max(a.runs, b.runs) }),
});
```

- **id**: `<owner>.<name>`. It is save data: never rename it.
- **scope**: `player` (default) for progress; `device` for this browser only (never exported).
- **migrate**: `migrate[n]` turns version-`n` data into version `n+1`; the version is one past the highest key. Pure; never edit an old one.
- **parse** (optional): the default checks the value has `initial`'s shape and throws otherwise, and the store then quarantines the stored value instead of overwriting it (STD-SAV-3).
- **merge** (optional): import and two tabs. Progress never un-happens: take maxima and unions.

## 2. Use it

```ts
import best from './best';
const save = ctx.save(best);
if (ctx.state.score > save.get().score) save.update(d => { d.score = ctx.state.score as number; });
```

## 3. Changing the shape later

1. Add `migrate[<current version>]` returning the new shape.
2. Update `initial`.
3. Add a test that parses an old value through the migration.

## 4. Report persistence separately from edits

`SaveHandle` exposes the store's actual `SectionStatus` through `status()` and the
return value of `update`. Its callback remains mutation-only; returned replacement
objects are ignored. Existing callers may continue ignoring the result.

```ts
import type { SectionStatus } from '@engine';
const handle = ctx.save(documentSection);
// Explicit UI command, outside frame execution; serialize only committed content.
const status: SectionStatus = handle.update(draft => {
  draft.json = committedDocumentJson;
}, { now: true });
```

Without `now`, updates use the store's existing debounce policy. `{now:true}` attempts
persistence immediately; it does not guarantee a successful write. `dirty` means a
write is pending; `session` means the last write failed and memory is retained for
retry. `unavailable`, `quarantined` and `newer` require their distinct recovery flows.
Use `handle.status()` to refresh feedback after existing store flush/retry events.
Value subscriptions do not report every persistence-status transition.

Fresh defaults can report `saved` before any envelope exists. Do not label them
“Saved locally” solely from that status. A save confirmation needs a successful save
attempt (or established loaded-save provenance), `saved` status, and a saved value
matching the current committed document. Preview, commit, undo and redo are not
persistence receipts. Keep unsaved content available after failure and retry through
the same handle; do not replace it with defaults.

Exceptions do not establish rollback. Proposal/parser failures precede publication,
but a throwing value subscriber can escape after memory changed and before an
immediate flush. Catch and report the error, then re-read `get()` and `status()`;
never infer that storage or memory reverted. One coherent creator document belongs
in one section envelope. Multiple sections are not atomic, and concurrent writers
have no compare-and-swap isolation; without a creator merge policy the later write
can replace the whole envelope. The authoring workflow assumes one writer.

## 5. Test the same save path

`testScene(scene,{services:{save}})` uses the injected real SaveStore for both
`ctx.save(...)` and `ctx.service('save')`. The injected store stays caller-owned;
dispose it explicitly after testing. Failure-injectable `MemoryBackend` ports can
exercise quota/read failure, retry and fresh-store reload without browser storage.
These are memory-backend observations, not physical disk durability evidence.

Without injection, `testScene` owns a real SaveStore backed by separate memory
ports. Its timer seam schedules no real timer and retains no callback: eager writes
remain dirty until `{now:true}`, an explicit `ctx.service('save').flush()`, or helper
disposal. Simulated frame time does not advance autosave. Supply a store with a
controlled timer seam when testing debounce behavior. Fresh helper instances do not
share saved data; inject stores over a shared backend for reload tests.

Call `test.dispose()` when finished. It invokes scene exit once and disposes only
its default save store, including when exit throws. An enter/prepare failure also
cleans up the default store. Retained save handles follow the store lifetime and
throw after its disposal. The helper installs no browser-storage listener or real
save timer; the normal runtime continues using its existing SaveStore scheduling.
