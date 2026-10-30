# Recipe: store large edited worlds as bounded binary records

Save sections hold JSON in Web Storage and cap each section at 262,144 characters, so
they suit settings, progress and a root seed, not the edits of a large world. For those,
use the **chunk store** (`src/core/save/chunk-store.ts`, exported from
`@kits/procgen`). It keeps one binary record per key in IndexedDB, or in memory when
IndexedDB is unavailable. Pair it with **cell edits** (`createCellEdits`) to store only
what changed from content regenerated from a seed ([seeded content recipe](generate-seeded-content.md)).

## 1. Record the requirement and the seam

State the creator requirement first, e.g. "a player's edits to any region survive a
reload; unedited regions cost no storage". The seams:

| Concern | Owner |
|---|---|
| Root seed, content version | A save section (`defineGenerationSeedSection`) |
| Baseline content | Regenerated with `deriveSeed` + a grid job; never stored |
| Edits | `createCellEdits` over the regenerated baseline |
| Bytes on disk | The chunk store: the only IndexedDB user (lint rule `indexed-db`) |

## 2. Open one store per world or save slot

```ts
import { openChunkStore } from '@kits/procgen';
const store = await openChunkStore({
  name: `mygame-world-${slot}`, schema: 1,
  limits: { maxRecordBytes: 256 * 1024, maxTotalBytes: 128 << 20 },
});
if (store.stats().durability === 'session') showNotice('worlds.not-saved'); // private mode, or IndexedDB refused
```

- The database is named `fe-chunks:<name>`, where `name` is 1–200 code units. Key it by
  world or save slot, and start a new name when the world's content version changes.
- **`session` durability** means memory only. Everything is lost when the store closes
  or the page unloads, so say so to the player.
- **A database written by a newer build** (a higher IndexedDB version) makes
  `openChunkStore` reject with `ChunkStoreError` reason `newer-format`. It does not
  silently fall back to an empty session store that would hide, then overwrite, that
  data.
- **Two more refusals** do not fall back either:
  - `deleting`: this tab's deletion of that name is still pending.
  - `blocked`: the browser did not open the database within `openTimeoutMs` (default
    5,000 ms), usually because another tab is deleting or upgrading it; browsers queue
    such opens silently.

- `schema` is your record format number. Older records come back with their `schema`,
  so you can migrate them. Records with a newer schema, or a newer envelope format from
  a later engine, are `newer`: never overwritten, removed or evicted here. An old build
  never destroys a newer save.
- Open at a boundary (scene preparation or a menu), never inside a frame. `openChunkStore`
  reads every key's small meta row once to learn totals.

## 3. Edit, encode, write atomically

```ts
const edits = createCellEdits(baselineGrid, { saved: stored?.data, revision: stored?.revision });
if (edits.set(x, y, z, block) === 'full') showNotice('worlds.edit-limit');
// later, at a save point (not every frame):
if (edits.dirty) {
  const submittedRevision = edits.revision;
  const r = await store.write([{ key: `region:${cx},${cz}`, revision: submittedRevision, data: edits.encode() }]);
  if (r.status === 'saved') edits.markSaved(submittedRevision);
}
```

- **Acknowledgement:** capture the revision before awaiting the write and acknowledge
  that exact revision. Edits made while the write is pending must remain dirty.
- **Atomic:** one `write` call commits all its records or none. Use one call for
  neighbouring regions that must change together.
- **Revisions:** each must be strictly newer than the stored one. The check runs
  inside the IndexedDB transaction, so a second tab cannot silently overwrite newer
  data; the older writer gets `stale`. Re-read and merge, or tell the player.
- **Results** are values, not exceptions: `saved`, `stale`, `newer`, `full`, `quota`,
  `quarantine-full`, `busy`, `closed` and `unavailable`. `failed` (with `error`) means
  an unexpected error, such as your `evictable` callback throwing. It affects only that
  operation, and later ones keep running. Keep the in-memory edits on any non-`saved`
  result and keep `dirty` true. Only caller mistakes reject with `ChunkStoreError`: an
  invalid key or revision, data that is not a `Uint8Array`, an oversized record or
  batch, or duplicate keys.

## 4. Load: regenerate, then apply

```ts
const stored = await store.read(`region:${cx},${cz}`);
// found → createCellEdits(baseline, {saved: stored.data, revision: stored.revision})
// missing → no edits;  quarantined → unreadable bytes: offer a reset, never guess
// newer → read-only here;  busy / closed / unavailable → keep the current content
```

The baseline must be the same content the edits were made against. The encoding carries
the grid's `cellsX`, `cellsY` and `cellsZ` and a CRC-32 of its values (`edits.baseline`,
`baselineChecksum`). Loading edits over a different shape throws `grid dimensions
mismatch`, and over different values `baseline mismatch`, instead of applying them
silently. Different values usually come from a new seed, generator or parameters. A
baseline with the same shape and the same values is the same content, so the edits
apply correctly. Store the root seed with
its `contentVersion` and compare it on load, as the seeded content recipe describes, so
the mismatch is a decision you make up front rather than an error.

## 5. Bounds, eviction and recovery

| Limit | Default | Over it |
|---|---|---|
| Key length | 256 | rejects (`ChunkStoreError`) |
| Record bytes | 1 MiB (max 64 MiB) | rejects |
| Records (per store instance; see below) | 65,536 | `full`, or eviction |
| Total bytes (per store instance; see below) | 256 MiB | `full`, or eviction |
| Records per write | 64 | rejects |
| Queued operations | 64 | `busy` |
| Quarantine rows | 32 | `quarantine-full` for writes over unreadable records |
| Edits per grid (`createCellEdits`) | 65,536 | `full` from `set` |
| Database name | 200 | rejects |
| Open wait (`openTimeoutMs`) | 5,000 ms | rejects `blocked` |

The record and byte limits are enforced against each store instance's own index. That
index is read at open and updated by that instance's writes. Writes from another tab
are not counted until reopen, so two tabs can together store up to twice the limit.
Revisions are still compared inside every transaction, so this affects accounting, not
correctness. Use one writer per world, or reopen to refresh the totals.

- **Eviction:** only with `evictable(key)`. Records go least recently used first, where
  recency counts reads and writes in this session only; at open, the order is the
  persisted write order. Mark only regenerable records, such as caches; player edits
  are never evicted unless you mark them. Victims are read and validated inside the
  write's transaction:
  - unreadable victims are copied to the quarantine first, or the write is refused with
    `quarantine-full`;
  - newer victims are never evicted.

  Without the policy, the store refuses with `full`.
- **Quota:** a browser `QuotaExceededError` aborts the whole transaction and the result
  is `quota`. Stored data is unchanged.
- **Corruption:** CRC-32 and envelope checks run on every read and before every
  overwrite, removal or eviction. Unreadable bytes are copied to the quarantine in the
  same transaction. A row is as large as the corrupted record it holds, so the
  quarantine is bounded by `maxQuarantine` rows of at most about `maxRecordBytes` each.
  `quarantine()` lists rows for support export, and `clearQuarantine()` frees them.
- **Lifetime:** operations run one at a time in order. `close()` resolves queued
  operations as `closed`, and they never reach storage; one already inside a
  transaction finishes and reports its real result. A version change from another tab
  closes the connection: `stats().available` becomes false, and later operations
  return `unavailable`.

## 6. Reset, export and deletion

The chunk store is a second persistence owner beside the save store. The save store's
`resetAll`, profile export and import, player switching and the test API's
`engine.reset` do **not** touch chunk databases: those operations are synchronous
Web-Storage operations, and IndexedDB deletion is asynchronous and can be blocked by
another tab. Wire them yourself:

- **Clearing a world in place:** call `store.clear()`. It deletes every record and
  quarantine row in one transaction.
- **Deleting a world:** call `store.destroy()`, or `deleteChunkDatabase(name)` when the
  store is not open. Other engine stores on that database close themselves on the
  resulting version change (`stats().available` becomes false), so the result is
  normally `destroyed`. `blocked` means some other connection did not close, for
  example code that opened the database directly. **The deletion still happens once
  that connection closes.** Until then:
  - `openChunkStore(name)` in this tab rejects with `deleting`, and
    `chunkDatabaseDeleting(name)` reports it;
  - in other tabs, the browser queues the open, and it rejects with `blocked` after
    `openTimeoutMs`.

  A world reopened after the deferred deletion is empty.
- **Listing worlds:** `listChunkDatabases()` lists this origin's chunk databases where the
  browser supports `indexedDB.databases()`, and returns `unsupported` otherwise. Keep
  your own list of world names in a save section if you need it everywhere.
- **Export:** there is no whole-world export. A player profile export does not include
  chunk data.

## 7. Evidence to add

- A test named after the success criterion: edit, write, reopen, regenerate, apply and
  compare to an independent expectation.
- Your own `stale`, `full` and `quota` handling paths.
- Browser checks on the creator's selected targets. The stock check is desktop
  Chromium only, and browser storage eviction, private modes and quotas differ per
  browser and device.
