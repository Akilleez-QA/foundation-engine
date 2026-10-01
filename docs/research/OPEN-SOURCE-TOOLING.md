# Foundation Engine: open-source tooling study

Research pass: 2026-09-30. Read-only; no engine changes or imported third-party code. This pass examines two implementations deeply: Bevy's asset processing and dependency readiness, and Godot's import configuration and editor boundary. It is not a proposal to replace Foundation's TypeScript runtime or to build game content.

## Evidence and reproducibility

Pinned sources inspected directly from the official repositories, downloaded as individual source files rather than cloning the engines:

- Bevy: `157e1ce6bc66fadca9f57260c18a16d743c11ed5`.
- Godot: `cd9c5d57fb9795886f3bfed8e2003062e1378178`.
- Local source excerpts: `/tmp/foundation-tooling-study/{bevy,godot}/`; these are research-only downloads, not repository additions.
- Foundation inspected: `scripts/lib/content-bundle.mjs`, `src/platform/assets/dependency-lease.ts`, `src/platform/assets/lease-cache.ts` and current implementation inventory. Compiler and editor ideas below are deferred candidates, not scheduled work or shipped capabilities; the publication correction is identified separately.

License metadata observed: Bevy root contains [MIT](https://github.com/bevyengine/bevy/blob/157e1ce6bc66fadca9f57260c18a16d743c11ed5/LICENSE-MIT) and [Apache-2.0](https://github.com/bevyengine/bevy/blob/157e1ce6bc66fadca9f57260c18a16d743c11ed5/LICENSE-APACHE) texts. Godot's [LICENSE.txt](https://github.com/godotengine/godot/blob/cd9c5d57fb9795886f3bfed8e2003062e1378178/LICENSE.txt) is MIT-form license text with contributor notices. This inventory does not assess every dependency or establish redistribution rights for assets/plugins. No source translation or vendoring is recommended here.

## Adoption review: actual consumer before compiler

A follow-up audit at `c4e43b4` traced `publishContent`, `content:publish`,
`active.json` and release references across scripts, source, templates and docs.
The only executable publication callers were `scripts/publish-content.mjs` and
`scripts/lib/content-bundle.test.mjs`. No checked-in publication description,
application consumer of an active release, or measured converter workload was
found. Typed asset manifests and runtime dependency leases do not establish a
build-time transformation requirement. This is a repository finding, not a claim
that independent creators have no such workflow.

Therefore defer the compiler, recipe cache and inspector proposals below. Before
selecting one, identify a concrete creator-owned source/output example and its
consumer, show the existing workflow's correctness or repeated-build cost, and
specify the smallest bounded transformation that resolves it. A toy JSON converter
or feature parity with another engine is not sufficient justification for a DAG,
cache, watcher or editor. Use the existing publisher if the need is only publication.

One directly applicable correction is implemented in
[PR #34](https://github.com/Akilleez-QA/foundation-engine-private-history/pull/34): manifest artifact
paths use explicit UTF-16 code-unit order instead of host-locale collation before
SHA-256 identity calculation. Separate English/Swedish Node-process tests exercise
different default collation while requiring identical manifest bytes and release
IDs. Authored reference order and duplicates remain unchanged. Existing immutable
releases stay valid; republishing paths with a changed order can produce a new ID.
See the [publication contract](../recipes/publish-content.md). This fixes existing
CLI reproducibility without introducing compilation infrastructure.

## 1. Bevy: compilation dependencies differ from runtime ownership

### What the implementation does

`ProcessedInfo` distinguishes an asset-and-metadata hash from a full hash that includes processing dependency hashes. Each `ProcessDependencyInfo` stores a dependency path and its full hash. Hash format changes explicitly require a metadata version bump. `get_asset_hash` streams input through a bounded buffer; `get_full_asset_hash` combines the input hash and dependency hashes. This makes metadata and transitive processing inputs part of cache validity, rather than trusting file modification time. [meta.rs, ProcessedInfo/get_asset_hash/get_full_asset_hash](https://github.com/bevyengine/bevy/blob/157e1ce6bc66fadca9f57260c18a16d743c11ed5/crates/bevy_asset/src/meta.rs#L94)

The processor compares the current source hash and recorded dependency full hashes before skipping work. It locks an individual output transaction only after releasing the global asset-info lock, explicitly avoiding a lock-order deadlock. Processing writes begin/end log records; unfinished transactions are recovered on restart. Output and metadata are written under the same transaction lock. It deliberately rereads local source data for processing after hashing to avoid retaining entire files, while acknowledging that a remote source may incur another download. [processor/mod.rs, process_asset_internal and validate_transaction_log_and_recover](https://github.com/bevyengine/bevy/blob/157e1ce6bc66fadca9f57260c18a16d743c11ed5/crates/bevy_asset/src/processor/mod.rs#L1108)

`LoadContext::read_asset_bytes` records the dependency after reading it. In processed mode it reads metadata while the asset reader remains active so the asset and its hash describe one coherent transaction. This is an important tooling seam: reads used during a transformation create invalidation edges even when their results are baked into a different output. [loader.rs, LoadContext::read_asset_bytes](https://github.com/bevyengine/bevy/blob/157e1ce6bc66fadca9f57260c18a16d743c11ed5/crates/bevy_asset/src/loader.rs#L608)

At runtime, `process_asset_load` tracks direct dependency readiness separately from recursive readiness and records reverse waiter sets. The full-dependency event is emitted when recursive loading completes; an asset inserted into storage is not sufficient. A missing dependency remains unresolved with a warning in this implementation. Foundation should retain its stricter bounded graph validation instead of inheriting that indefinite state. [server/info.rs, process_asset_load](https://github.com/bevyengine/bevy/blob/157e1ce6bc66fadca9f57260c18a16d743c11ed5/crates/bevy_asset/src/server/info.rs#L445) The public event type similarly distinguishes Added, Modified, Removed, Unused and LoadedWithDependencies. [event.rs, AssetEvent](https://github.com/bevyengine/bevy/blob/157e1ce6bc66fadca9f57260c18a16d743c11ed5/crates/bevy_asset/src/event.rs#L48)

### What Foundation should learn

Foundation's current publisher already provides immutable output directories, SHA-256 artifact verification, an atomic active pointer, a publication lock and explicit retention. Keep that mechanism. If an evidenced consumer later justifies incremental compilation, run it **before** `publishContent`; do not add a second publisher or compile inside rendering.

The compiler graph and runtime lease graph are different contracts. A source consumed to bake a mesh can invalidate that mesh without being a runtime lease dependency. Conversely, a texture needed by a loaded mesh may remain a runtime dependency even if it was not consumed during the mesh transformation. Use separately named `buildDependencies` and `runtimeReferences`; do not overload today's manifest references.

A justified future Node-side compiler should hash canonical importer identity/version, options, input bytes, output schema version and sorted dependency identities plus hashes. Record dependency reads through an injected context. Foundation already uses SHA-256: a different digest algorithm brings no demonstrated benefit here. Preserve existing publication atomicity instead of copying Bevy's mutable-output transaction recovery design.

This study does not establish that Foundation needs Bevy's reflection system, ECS asset storage, its task executor or a persistent background watcher. Those would be disproportionate additions for this slice.

## 2. Godot: reproducible import configuration is separate from generated cache

### What the implementation does

`EditorFileSystem::_reimport_file` reads existing import parameters, overlays explicitly supplied parameters and preserves the importer and stable resource identity. It writes an import descriptor containing importer name/version, UID, output remaps, generated files and authored parameters. Source and output checksums are stored separately from the descriptor so authored import settings can be version controlled. Import failure is recorded as invalid output. It also describes platform variants explicitly rather than choosing them implicitly in arbitrary loaders. [editor_file_system.cpp, _reimport_file](https://github.com/godotengine/godot/blob/cd9c5d57fb9795886f3bfed8e2003062e1378178/editor/file_system/editor_file_system.cpp#L2799)

The importer interface declares option schemas/defaults/visibility, compatibility handling, an import operation, optional grouped import, and explicit threading eligibility. `can_import_threaded()` defaults to false; importers opt into concurrent execution. This is a useful boundary: "there are spare CPUs" is not evidence that a plugin is reentrant. [resource_importer.h, ResourceImporter](https://github.com/godotengine/godot/blob/cd9c5d57fb9795886f3bfed8e2003062e1378178/core/io/resource_importer.h#L147)

`get_import_settings_hash` sorts importers by name before including their settings strings. `get_build_dependencies` delegates dependency discovery to the selected importer. These explicit seams are preferable to watching all files and guessing which importer state changed. Godot uses MD5 here for its existing cache protocol; Foundation should keep its own SHA-256 publication protocol. [resource_importer.cpp, get_import_settings_hash/get_build_dependencies](https://github.com/godotengine/godot/blob/cd9c5d57fb9795886f3bfed8e2003062e1378178/core/io/resource_importer.cpp#L565)

### What Foundation should learn

If the adoption criteria above are met, a compact versioned import recipe could separate source-controlled settings from a disposable derived cache. It should contain a stable source ID, relative source path, importer ID/version, typed options, intended output type/schema and declared target variants. Rename/move should change the path mapping without silently rewriting references that use the stable ID. Generated timestamps and machine-local paths must not enter recipe diffs or deterministic cache identities.

The same option schema should eventually drive a CLI validator and a small inspector UI. The UI should edit recipes and show diagnostics; it should not become a privileged second engine API or bypass the compiler. First prove the required importer through the actual consumer CLI workflow. A pure JSON transformer could exercise that contract without native dependencies if the consumer needs it; it does not by itself justify an inspector.

Threading should be an explicit importer capability with a bounded executor and byte reservations. Plugins not declaring concurrency safety run serially. Builds publish only after all required results validate; cancel, stale input or failed output must leave the existing active pointer intact. Node tooling jobs and browser runtime WorkerHost jobs have different lifetimes and should not be conflated.

## Adoption status and conditional acceptance

| Status | Decision | Smallest useful deliverable | Acceptance evidence |
|---|---|---|---|
| Deferred candidate | Incremental compilation, only after a concrete consumer/workload is established | Versioned recipe + one pure importer + dependency-read context + bounded graph + cache index; unchanged `publishContent` promotion | Second identical build invokes zero transforms; changing a leaf rebuilds only its reverse closure; importer/options/schema changes invalidate expected outputs; unrelated source remains cached |
| Conditional on compiler adoption | Reproducibility and failure proofs | Canonical hashes, declared outputs, staging, source snapshot validation, explicit missing/cycle diagnostics | Permuted recipe ordering yields same output IDs; interrupted transform leaves old active pointer; corrupt cache is rejected; cycles and missing dependencies fail before any converter starts |
| Deferred candidate | Stable source IDs and recipe inspection, if the workflow needs them | ID-to-relative-path mapping plus CLI `inspect` showing dependencies, importer/version, outputs and rebuild reasons | Move source while preserving ID keeps references valid; duplicate IDs fail; machine paths/timestamps do not alter canonical result; diagnostics name exact dependency edge |
| Existing mechanism | Reuse dependency ownership and readiness | Keep `DependencyLease`, shared admission, `ScenePreparationContext`, current lease cache and lifetime tests | Failed required resource preserves current view; no additional frame loop; abort/late completion stays bounded; readiness names the failed dependency rather than collapsing everything to a generic failure |
| Deferred candidate | Thin editor only after CLI recipes and a real editing need are demonstrated | Schema-driven recipe editor and explicit rebuild action using exactly the CLI pipeline | UI and CLI produce identical recipe/hash/output; invalid option cannot publish; editor closes without leaving converter jobs or retained handles |
| Deferred | Watch mode, dynamic plugins, distributed builds, native editor frameworks | Wait for measured repeated-build or authoring cost | Adoption needs specific author workflows and measured before/after, not feature parity with other engines |

## Boundaries and unresolved questions

- This pass demonstrates source-backed design lessons, not measured speedups or a complete tooling audit.
- Establish a real content-size/converter-time workload before choosing default parallelism. Current publisher limits remain unchanged; do not enlarge them to accommodate an unbounded compiler.
- A build graph needs explicit cycle rejection, node/edge/depth limits, output-byte ceilings and owned cancellation. Stable IDs do not imply a general database, network identity or entity persistence layer.
- Cache format migration and recipe schema migration are separate. Old disposable caches can be invalidated; authored recipes need explicit migration or a diagnostic preserving the original file.
- For third-party converter reuse, evaluate one concrete converter's input/output contract, version pinning and complete dependency notices before adoption. This pass recommends no new runtime dependency.
- Companion studies examine [audio lifetime](JUCE-AUDIO-LIFETIME.md) and [editor architecture](JUCE-EDITOR-ARCHITECTURE.md). Their proposals share the same existing engine owners and adoption criteria.
