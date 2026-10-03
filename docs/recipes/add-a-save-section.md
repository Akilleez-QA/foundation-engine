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
3. Retain an immutable, version-labelled stored envelope for **every supported
   starting version**, not only the oldest (STD-SAV-7). Add new fixtures; do not
   regenerate old ones from the latest serializer.
4. Load each envelope through a fresh store owner, assert the migrated value,
   flush, dispose, then reopen through another owner over the same backend.
   Verify the current envelope and exact pre-migration backup bytes, and ensure
   reload does not migrate again.
5. Refuse backup or quarantine writes and prove the original bytes remain intact
   until recovery succeeds. Keep failed writes retryable through the existing owner.

See the [versioned example regression](../../src/core/save/migration-fixtures.test.ts)
and its [retained envelopes](../../src/core/save/fixtures/migrations/). These are
synthetic fixtures for an example section, not a claim that all historical game
saves or a previous engine release have been tested. Each creator owns their
section fixtures and declared supported versions.

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

## 6. Report orphan import outcomes

`SaveStore.importPlayer(file, player)` preserves unknown section payloads through
the existing local `StoragePort`. Inspect every `ImportReport.sections` outcome.
Known sections report `saved`, `session` (held in memory because storage refused
the write) or `skipped-newer`. For orphans, `orphan-kept` means the incoming
serialized bytes were written successfully or already match exactly;
`orphan-conflict` means different bytes already occupy the destination and remain
untouched; `orphan-failed` means a storage read/write threw; `orphan-superseded`
means the orphan's id is an alias of a section the same file supplies, so it was
not written (see renamed sections below).
Even semantically equivalent JSON with different whitespace is a conflict. A failed
read never authorizes a write. Keep the source file for creator-directed conflict
reconciliation or retry after storage becomes available; there is no automatic
overwrite, merge, queue or retry for opaque orphan data.

This synchronous operation remains bounded by the existing profile file character
limit (2,000,000 characters) and owned by the SaveStore; a disposed store refuses import. There is no
cancellation within the synchronous call. These outcomes describe individual
storage operations, not a cross-key transaction, compare-and-swap isolation,
physical disk durability or a whole-world checkpoint. Other sections may already
have imported when one orphan fails. The generic test adapter forwards the report;
creators decide how their import UI presents conflicts and retries.

A known incoming section (under its id or an alias, including newer versions) whose
canonical id is also supplied as an orphan is rejected before publishing any staged
values: one report slot cannot represent both outcomes. For duplicate
unknown IDs, the existing precedence remains: `sections[id]` supplies the retained
payload ahead of `orphans[id]`; the per-ID result describes that chosen payload.

Known sections publish and the normal store flush completes before orphan bytes
are read/compared/written. There is no trailing flush to invalidate an orphan
receipt, even if a known-section notification registers a previously unknown owner.
`orphan-conflict` preserves the bytes observed in that final orphan phase; intentional
known writes may already have changed the destination from its pre-import value.
A conflict/failure does not roll back these earlier effects.

**Renamed sections.** Ids are never renamed; when a rename is unavoidable, `aliases`
carry it. On load the store reads the old alias key when the canonical key is empty,
then writes the canonical key on the next flush. It never deletes the alias key: that
copy is what an older build (a rollback, or another tab still on the old build) reads,
and deleting it would make such a build start from defaults and overwrite it. The
key therefore stays as a stale pre-rename copy. Export skips a registered player
section's alias keys (the section itself carries the current value; a newer payload
found only under an alias is exported as an orphan under the canonical id). Import
reports an orphan whose id is an alias of a section in the same file as
`orphan-superseded` and leaves storage untouched, so files from earlier exports that
carried the stale key also import. An alias orphan without its section in the file is
an ordinary orphan. Genuinely unknown orphans keep the conflict/failure/retry rules
above.

Compatibility: the profile file stays `engine-profile` version 2 and section
envelopes are unchanged. `ImportReport.sections` adds `orphan-conflict`,
`orphan-failed` and `orphan-superseded`; exhaustive TypeScript consumers must handle
all three.
Do not interpret a conflict or failure as permission to discard the source file. Older
callers that ignore the report still compile, but cannot present reliable recovery
feedback without inspecting it.
