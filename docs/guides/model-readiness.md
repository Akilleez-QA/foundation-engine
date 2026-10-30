# Observed model readiness

`ctx.modelState(entity)` reads the existing scene model owner in production and
test builds. It returns a detached frozen `ModelState`:

```ts
const state = ctx.modelState(candidate);
// state.status: 'absent' | 'loading' | 'ready' | 'failed'
// state.requestedAsset: string | null
// state.adoptedAsset: string | null
```

The query does not request assets, acquire leases, create instances, traverse
geometry, advance animation, retry, invalidate rendering or require development
inspection. Work and retained output are constant per query. Asset identifiers
come from the existing authored `Model` component and scene slot; this is not a
manifest variant/hash query or an arbitrary model-content validator.

| State | Meaning |
|---|---|
| `absent` | No current Model+Transform pair, or the scene owner has retired. Both identities are null. |
| `loading` | A requested model has not become the ready current asset. This includes before reconciliation and a request that has not been admitted. It does not promise a fetch is active. |
| `ready` | The current requested asset has an adopted, initialized scene instance. It may be intentionally invisible. |
| `failed` | This owner observed failure for the current asset request. No adopted instance remains for that failed slot. |

Before reconciliation, changing `Model.asset` can produce `loading` with the old
`adoptedAsset` and the new `requestedAsset`. The ordinary asset-change path still
retires the old instance before loading the replacement. This query does not
change that replacement policy. Ready establishes instance adoption, not a
complete semantic appearance: creators still check their required named sockets,
clips and other content requirements. A model may become ready before its first
render. Later animation/pose errors retain their existing reporting behavior and
are not represented as loading failures.

Load, instance preparation and asynchronous publication failures are reported
through the existing error reporter. Failures after lease adoption drain owned
resources and retain only terminal metadata in the existing bounded slot map.
Subsequent synchronization does not hot-retry that same failed request. Change
the requested asset, or remove/despawn and reconcile the old entity before making
a new request, for explicit recovery. Setting the same asset or incrementing the
animation restart revision does not retry. A terminal failed slot counts against
the existing per-scene instance-slot limit until retired.

The existing scene admission limit remains a synchronous error from reconciliation.
An unadmitted entity still reports `loading`: no unbounded failure registry is
created, and reading current capacity does not fabricate a failed attempt. Creators
must budget accepted and candidate instances together and handle admission errors
through the existing runtime error path. Model-library admission failures reject
the async load and do become observed `failed` state.

## Candidate composition

A creator can use the existing document/edit session with a separate candidate
entity rather than replacing the accepted entity's asset immediately:

1. Capture the prepared appearance value and its exact preview ticket. Spawn a
   candidate Model+Transform, initially hidden, under the existing scene owner.
2. On the existing scene/system lifecycle, inspect its model state. While loading,
   retain the accepted entity and document. If failed, remove the candidate and
   expose explicit retry or cancellation in the creator's interface.
3. When ready, validate creator-required sockets/content. Only the still-current
   candidate may become a visible preview or be adopted at document commit.
4. Cancel/replacement/scene exit retires candidate entities. Late completions are
   suppressed by existing slot identity and owner cancellation. Do not interpret
   a reusable asset string as a unique candidate lifetime.
5. Store accepted document data through the existing save owner. Model readiness
   does not acknowledge persistent storage, transfer equipment custody or authorize
   a network command. Renderer adoption and document/save publication have separate
   failure outcomes; define recovery rather than claim a distributed rollback.

This recipe adds no loader, registry, global manager or mandatory appearance schema.
It does not provide atomic multiple-model adoption, same-frame socket attachment,
skinning/retargeting or automatic retention on direct asset assignment.

`testScene` deliberately performs no model I/O: existing Model+Transform pairs
report `loading`, absent pairs and disposed visits report `absent`, and
`adoptedAsset` is always null. Use real scene-model tests or browser consumers for
actual readiness evidence; a headless scene cannot establish rendered acceptance.
Targeted tests cover load/instance/publication failure, cleanup and reporter
reentry, bounded admission, stale completion, owner exit, immutable snapshots and
side-effect-free reads. This contract alone does not certify any device profile.

## Real model candidate consumer

Run the isolated muted workflow with:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/model-preview-check.mjs playtest/model-preview
```

The diagnostic runner serves an optional desktop fixture at its temporary
`/__model-preview.html` route. It uses the original mechanics beacon GLB and a
visibly wider cyan variant derived from that original file in memory. The real
registered asset service, GLTF parser, scene model owner, appearance document,
edit session and SaveStore are used. Neither fixture nor runner enters the player
build. The creator fixture owns at most an accepted entity and one candidate.
There is no hardcoded body taxonomy in the engine API.

The workflow holds an actual model HTTP request to prove that a loading candidate
is hidden while the accepted model remains visible. It exercises preview,
keyboard Commit, cancellation, superseded loading, missing required socket,
explicit HTTP failure, save/reload, failed restoration without rewriting accepted
data, retry, scene replacement and disposal during load. Narrow assertions allow
only the two intentionally injected 503 responses and their two owned model
failure reports; unexpected console and page errors fail. Instrumented WebGL draw
calls and model resource probes verify repeated queries create neither redraws nor
asset work while the accepted model is idle. Teardown checks zero retained model
instances and resident model memory. Screenshots and snapshots are emitted to the
requested evidence directory, with the Git revision and terminal result.

This is a desktop 1440×960 Chromium keyboard/pointer consumer. Its controls occupy
a separate panel. It is not a complete appearance editor, phone/tablet acceptance,
screen-reader certification, physical GPU timing, skeletal retargeting or
multi-model transaction guarantee. The saved document remains a separate
acceptance boundary from its rendered projection; restore errors are visible and
recoverable rather than silently converted into a default selection.

The fixture's persistence feedback compares the accepted document with the save
handle's current value and checks that the physical local envelope exists. A new
unsaved default is `not-saved`; committing a different appearance is `unsaved`
until the save owner accepts and writes matching data. The raw `saveStatus` remains
visible separately and is not presented as proof that a different document was
saved. This assumes the documented single writer.

Restored and retried accepted entities start hidden. Loading success is followed
by the same creator-required socket check used for candidates before visibility
or Save is enabled. A schema-valid saved selection with incompatible model data
remains saved but hidden with recovery feedback. The browser workflow checks both
a saved `missing` selection and changed bytes at a previously valid asset path;
neither silently replaces saved appearance or displays an incompatible instance.

Before admitting new model requests, reconciliation retires existing slots whose
entities were despawned or lost Model/Transform. This pass is bounded by the
existing slot limit and keeps the same cleanup/error behavior. At a limit of two,
an accepted entity plus a cancelled candidate can therefore admit the replacement
candidate on the next reconciliation without a transient cap increase. A late
completion for the retired candidate releases its lease and cannot replace either
live entity. Truly over-capacity live Model+Transform pairs still cause the normal
admission error; this does not increase or bypass admission bounds.

Cleanup callbacks may invalidate an entity already inspected by the first
retirement pass. Before rejecting full capacity, admission rechecks obsolete
slots. The retry count is bounded by the number of existing slots, and a pass
must retire a slot to continue; genuine live overload still throws. This rare
capacity-recovery path has at most quadratic work in the configured slot limit.
It does not spin until application callbacks happen to stop changing the world.

The fixture directs incompatible-content recovery to **Reload** after correcting
asset bytes and disables Retry for that condition. The model library deliberately
keeps session file bytes; recreating an instance of the same URL can reparse those
cached bytes. Retry remains appropriate for the fixture's failed HTTP request.
Reload recreates the library and fetches corrected content without adding an
implicit cache-invalidation API or rewriting the accepted appearance document.
