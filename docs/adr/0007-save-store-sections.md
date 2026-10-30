# ADR 0007: One save store with typed sections, scopes and migrations

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Persistence
- **Related:** [0052 Coherent saves before physical section splits](0052-save-atomicity-boundary.md)

## Context

Ad hoc storage keys with hand-written parsers lose data on shape changes, and export and reset that list keys by hand miss some.

## Decision

- `SaveSection<T> {id, scope: player|profile|device, version, initial, parse, migrations, legacy, merge, aliases, storage, flush}` is registered by its owning module as a row of the `saveSections` registry (`core.save`).
- The store:
  - saves automatically with an idle debounce;
  - quarantines unreadable values and never overwrites them;
  - supports many players;
  - generates export, import and reset from the section list.
- Every key sits under the game's namespace (`<ns>|`, quarantine `<ns>-q|`, backup `<ns>-bak|`), so reset clears exactly the game's data.
- A version bump carries a pure migration from the previous version. Old keys can be imported once through legacy bindings.

## Consequences

- Every section round-trips export and import by construction.
- The recipe `docs/recipes/add-a-save-section.md` shows a v1 → v2 migration.
- `core/save/store.test.ts` covers quarantine, migrations, merge and reset.

### Terminal store disposal

A store's disposal ends its ownership of autosave and storage subscriptions. It
attempts one final flush of existing dirty cells, without scheduling retries when
storage remains unavailable. Successful writes still persist. This remains a sequence of per-section writes, not
an atomic multi-section transaction. Failed dirty cells
remain visible through the implementation's pure `pending()` diagnostic; a retired
store never resumes saving them when storage recovers. Applications that need a
retry must keep the owning store alive rather than disposing it.

Disposal is idempotent and suppresses change notifications during its final flush.
It attempts every subscription cleanup even when flushing or another cleanup
throws, then reports collected exceptions as an `AggregateError`. Retained section
handles and other store operations throw `SaveStore is disposed` after disposal;
this includes apparent reads such as `get()` because they can load, migrate or
quarantine storage. Existing unsubscribe callbacks remain safe to call. `pending()`
is the sole post-disposal inspection seam; it does not load or write data.

### Callback-stable section targets

Each section update or replacement captures its target cell before invoking the
updater or parser. An active-player change inside those callbacks affects future
operations, not the destination of this operation's value. An explicit `of(player)`
handle retains that player's target as before. If reset or disposal retires the
captured cell before commit, the operation throws instead of writing to a new
player or reviving detached save data. Notifications and immediate flushes still
belong to the captured cell; a notification that retires it prevents a subsequent
immediate flush from writing the detached cell.
