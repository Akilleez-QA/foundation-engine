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

- `schema` is your record format number. Older records come back with their `schema`,
  so you can migrate them. Newer ones are read-only (`newer`), so an old build never
  destroys a newer save.
- Open at a boundary (scene preparation or a menu), never inside a frame. `openChunkStore`
  reads every key's small meta row once to learn totals.

## 3. Edit, encode, write atomically

```ts
const edits = createCellEdits(baselineGrid, { saved: stored?.data, revision: stored?.revision });
if (edits.set(x, y, z, block) === 'full') showNotice('worlds.edit-limit');
// later, at a save point (not every frame):
if (edits.dirty) {
  const r = await store.write([{ key: `region:${cx},${cz}`, revision: edits.revision, data: edits.encode() }]);
  if (r.status === 'saved') edits.markSaved(edits.revision);
}
```

- **Atomic:** one `write` call commits all its records or none. Use one call for
  neighbouring regions that must change together.
- **Revisions:** each must be strictly newer than the stored one. The check runs
  inside the IndexedDB transaction, so a second tab cannot silently overwrite newer
  data; the older writer gets `stale`. Re-read and merge, or tell the player.
- **Results** are values, not exceptions: `saved`, `stale`, `newer`, `full`, `quota`,
  `quarantine-full`, `busy`, `closed` and `unavailable`. Keep the in-memory edits on
  any non-`saved` result and keep `dirty` true. Only caller mistakes reject with
  `ChunkStoreError`: an invalid key or revision, data that is not a `Uint8Array`, an
  oversized record or batch, or duplicate keys.

## 4. Load: regenerate, then apply

```ts
const stored = await store.read(`region:${cx},${cz}`);
// found → createCellEdits(baseline, {saved: stored.data, revision: stored.revision})
// missing → no edits;  quarantined → unreadable bytes: offer a reset, never guess
// newer → read-only here;  busy / closed / unavailable → keep the current content
```

The baseline must be the same content the edits were made against. Store the root seed
with its `contentVersion` and compare it on load, as the seeded content recipe describes.
Edits over a different baseline still decode, but they describe a different world.

## 5. Bounds, eviction and recovery

| Limit | Default | Over it |
|---|---|---|
| Key length | 256 | rejects (`ChunkStoreError`) |
| Record bytes | 1 MiB (max 64 MiB) | rejects |
| Records | 65,536 | `full`, or eviction |
| Total bytes | 256 MiB | `full`, or eviction |
| Records per write | 64 | rejects |
| Queued operations | 64 | `busy` |
| Quarantine rows | 32 | `quarantine-full` for writes over unreadable records |
| Edits per grid (`createCellEdits`) | 65,536 | `full` from `set` |

- **Eviction:** only with `evictable(key)`, least recently used first. Mark only
  regenerable records, such as caches. Player edits are never evicted unless you mark
  them. Without the policy, the store refuses with `full`.
- **Quota:** a browser `QuotaExceededError` aborts the whole transaction and the result
  is `quota`. Stored data is unchanged.
- **Corruption:** CRC-32 and envelope checks run on every read and before every
  overwrite. Unreadable bytes are copied to the quarantine in the same transaction as
  the replacing write. `quarantine()` lists them for support export, and
  `clearQuarantine()` frees the rows.
- **Lifetime:** operations run one at a time in order. `close()` resolves queued
  operations as `closed`; one already inside a transaction finishes. A version change
  from another tab closes the connection, and later operations return `unavailable`.

## 6. Evidence to add

- A test named after the success criterion: edit, write, reopen, regenerate, apply and
  compare to an independent expectation.
- Your own `stale`, `full` and `quota` handling paths.
- Browser checks on the creator's selected targets. The stock check is desktop
  Chromium only, and browser storage eviction, private modes and quotas differ per
  browser and device.
