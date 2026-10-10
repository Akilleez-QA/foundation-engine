- **Optional world change detection, observers and cached queries.** `World` can record per-component add and change
  ticks for opted-in types (`trackChanges`, `markChanged`), filter queries with `added(T)`/`changed(T)` against a
  caller-held cursor (`queryFiltered`, `sinceLastRun`; tick wraparound handled conservatively), queue bounded
  observers on add, remove, change and despawn delivered after each system, and keep incrementally maintained cached
  queries with the same order and mid-iteration rules as `query`. Nothing changes for a world that does not use them.
  See [the guide](docs/guides/world-change-detection.md) and [ADR 0170](docs/adr/0170-optional-world-change-detection.md).
