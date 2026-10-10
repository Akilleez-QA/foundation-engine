# ADR 0116: optional coherent multi-key save generations

- **Status:** Proposed
- **Date:** 2026-10-10
- **Area:** Optional kits / Persistence
- **Related:** [0007 One save store with typed sections, scopes and migrations](0007-save-store-sections.md),
  [0052 Coherent saves before physical section splits](0052-save-atomicity-boundary.md)
- **Tracking:** linked from the pull request

## Context

Creator requirement: some saves are larger than one envelope should hold (the save store caps a section at 262,144
characters by default) or are naturally several documents, yet must load as one consistent state after a crash, a
quota error or damaged bytes. ADR 0052 keeps coherent state in one physical envelope and records that any future
multi-key protocol "needs one writer and recovery owner, coherent snapshots for readers, and real-store fault
injection before adoption". STD-SAV-16 is Provisional until such a protocol is proven.

Existing seams: `StoragePort` (`src/core/save/storage-port.ts`) is the only code that touches Web Storage and
already models throwing reads and writes and several tabs over one backend; the save store owns every key under its
namespace's reset prefixes; the chunk port and chunk store own IndexedDB records and already commit several keys in
one transaction; `fake-idb.ts` is an IndexedDB-shaped test double.

## Decision

Add an optional kit, `@kits/save-generations`, layered on the existing port seam rather than extending core:

- **Protocol.** Two alternating slots per save. A commit writes the slot that does not hold the newest valid
  generation: it removes that slot's commit record first, writes every key (each value prefixed with its generation),
  then writes the record last. The record lists each key with its stored length and CRC-32 and carries a CRC-32 of
  itself, so it is a checksum over the whole multi-key payload. A slot is valid only when its record parses, names
  this namespace, save and slot, and every listed key is present, well-formed and verifies. Load verifies the higher generation, falls back to
  the older, and re-reads the record it relied on (retrying a bounded number of times) so a concurrent writer cannot
  hand it a mix. The counter is a bounded safe integer that refuses at the ceiling instead of wrapping.
- **One writer and recovery owner.** One owner object per port, namespace and save; a second owner on the same
  port object throws. Its operations are exclusive: a second commit or a load during a commit returns `busy`,
  nothing is queued, and `close()` releases the claim only when an in-flight operation settles. `current()` gives
  readers the last loaded or committed generation as one frozen snapshot. A commit refuses with `conflict` when the
  disk no longer holds the generation the owner last saw (another tab). After writing its record, a commit reads the
  slots back as a loader would and reports `committed` only if its generation is then the newest fully valid one;
  otherwise `lost` (or `unconfirmed` if the read-back threw), and the owner does not adopt it. `committed` is true at
  that moment, not a lock: owners on different port objects are not excluded and a later writer can supersede it.
  The post-commit sweep removes only keys of older generations named by the slot's previous record or under its
  prefix, and is skipped once the owner is stopped.
- **Statuses, never silent loss.** Load: `loaded`, `recovered` (the other slot torn or invalid), `empty` (no record
  in either slot), `corrupt` (nothing valid, something damaged), `unavailable`, `contended`. Commit: `committed`,
  `lost`, `unconfirmed`, `busy`, `not-loaded`, `conflict`, `too-large`, `exhausted`, `cancelled`, `failed`, `unavailable`, `closed`; every
  status except `committed`, `lost` and `unconfirmed` leaves the previous generation authoritative without writing
  a record.
- **Inputs.** Each entry value is read once; payloads must be well-formed text, because a lone surrogate encodes to
  U+FFFD and could not be told apart by the UTF-8 checksum (`RangeError` at commit, `invalid` when stored).
- **Bounds.** Keys per generation (16, at most 256), characters per payload (262,144, at most 2,000,000) and per
  generation (1,048,576, at most 4,000,000), load attempts (3, at most 8). Oversized input is refused before any write.
- **Cancellation.** A signal checked before every write, and `close()`; the record is never written after either.
- **Composition.** Keys live under `<namespace>-gen|<name>|`, inside the save store's reset prefixes, so
  `resetAll()` clears them and `usage()` counts them (STD-SAV-10). The kit uses the chunk store's CRC-32 and the save
  store's namespace validation rather than its own.

Why a kit and not core: the save store's sections and their single-envelope rule stay unchanged, nothing in core,
platform or the author layer depends on it, and the protocol is useful only to creators who choose multi-key state.
It runs on the existing port abstraction, so no second store, database or storage path is created. A creator who
needs atomic multi-key writes in IndexedDB can already use one chunk-port transaction; this protocol adds most on
Web Storage, which has no multi-key atomicity.

## Consequences

- ADR 0052's open boundary now has a candidate protocol with one writer and recovery owner, coherent snapshots and
  fault-injection evidence. ADR 0052's decision is unchanged and STD-SAV-16 stays **Provisional**: save store sections
  are still separate envelopes, `batch` is still not atomicity, and adoption needs review and real-store evidence.
- Evidence is headless only: crash injection at every write index of multi-key commits (synchronous and asynchronous
  ports), byte flips, dropped and stale keys, throwing reads and writes, the memory quota, a racing writer, a seeded
  randomised fault sequence, a live `SaveStore` sharing the port, and runs over the IndexedDB-shaped test double
  through the chunk port (quota at every put, a connection closed mid-commit, corrupted rows). The double is not a
  browser: real IndexedDB, real Web Storage, power loss and physical devices are unverified.
- An independent review of the first implementation found that racing owners could both report `committed`, that
  `close()` released the claim mid-commit and its sweep could remove a successor's keys, that values were read
  several times, that lone surrogates were indistinguishable and that the record lacked the namespace. All were fixed
  with regression tests, including a two-owner race and a seeded fuzz of racing asynchronous owners that replays the
  mutation log and checks every `committed` result was the head at some moment.
- Not a cross-writer lock: racing commits mostly end `lost` or `conflict`; a confirmed commit can be superseded later,
  and the sweep's read-then-remove has a small window against another writer. Loads stay coherent. Ports without
  `keys()` can leave unnamed keys of an interrupted commit until a reset. Bound ceilings can exceed a browser's Web
  Storage quota (refused at runtime as `failed`). A save store must not use the namespace `<namespace>-gen`.
  CRC-32 detects accidental damage, not tampering. Every commit rewrites the whole generation; two slots double the
  stored size. Payload versioning, export and import remain the creator's.
