# Framework upgrade status and acceptance boundaries

This record describes a finite upgrade program, not completion of every possible
engine or game requirement. Foundation remains a configurable skeleton. Creators
choose their documents, source data, geometry, rules, devices, presentation,
quality floors and performance budgets. They may use, extend, replace or omit these
frameworks. The engine supplies ownership, bounded admission, staged changes,
explicit failures and evidence mechanisms; it does not select a game's design.
See the [creator contract](../CREATOR-CONTRACT.md) and
[device experience policy](../policy/DEVICE-EXPERIENCE.md).

## Reading this record

Revision references: PR numbers and merge/commit hashes before the public
repository's first commit `c0e73c9` refer to the private development history,
which is not published. `c0e73c9` has the same source tree as private `main`
`b983e1a`. Later public PRs are on
[github.com/Akilleez-QA/foundation-engine](https://github.com/Akilleez-QA/foundation-engine/pulls).

The original program integrated through PRs #80–#94 on private `main`. Historical
results below refer to that baseline. The continuation now includes regional Surface
integration, rigid/weighted appearance, custody, stats/progression and objective
authoring plus action composition through PR #117 (`2aabe49`). The [continuing ledger](upgrade-acceptance-ledger.md)
records exact candidates and unresolved acceptance. AC-01 passed its final native
browser and all seven gates after repairing a scene-activation failure. “Integrated” means
source delivery; it does not mean that every application uses the API or every
device has passed acceptance. Program labels identify work slices, not maturity
certifications. Exact final gate results are recorded on the integration PR and
merge message; configured CI coverage and a remote CI result remain distinct.

The crafting continuation is integrated in PR #118 at `1c177d5`. Candidate
`790aaea` passed 41 focused tests, final native desktop browser and all seven gates
(1,871 tests; 129 performance checks; zero enforced breaches/regressions/inconclusive,
four advisory software-GL heap warnings). Combined main tests/build passed. The subsequent startup correction integrated in PR #119 at `a3d1516`; its own
`7673d74` browser and seven-template evidence is recorded below. Earlier passing
gates are not transferred to newer work.

## Capability map

| Slice | Capability and actual seam | State at baseline | What remains outside the claim |
|---|---|---|---|
| T1 | [`createSampledSurface`](../../src/kits/terrain/surface.ts) owns finite sampled height/material/exclusion data and supplies canonical triangles, contact, normals and ray queries | Integrated | No automatic world streaming, planetary topology or data-source quality guarantee |
| T2 | [`terrainRecipeSlices`, `evaluateTerrainRecipe`](../../src/kits/terrain/recipe.ts) evaluate ordered, versioned creator operators over declared fields | Integrated | No automatic dependency inference or deterministic replay of arbitrary creator callbacks |
| T3 | [`createTerrainRecipeJob`, `prepareTerrainRecipe`](../../src/kits/terrain/recipe-job.ts) use the existing WorkerHost for admission, shared worker/fallback slices and owned output adoption | Integrated; real-worker diagnostic source included | No hard callback CPU deadline or physical-device timing certification |
| T4–T5 | [`createTerrainRegion`, `terrainRegionSlices`](../../src/kits/terrain/region.ts), [`createTerrainCoverage`](../../src/kits/terrain/region-coverage.ts) add a global integer lattice, halo normals and explicit finite coverage states | Baseline PR #91; ordinary Surface/worker continuation integrated in PR #109 | Core/halo patching, chunk LOD and generation/raycast compatibility are supported; automatic residency and streaming worlds are not |
| A1 | [`createAuthoredDocument`, `authoredReference`](../../src/kits/authoring/document.ts) own bounded creator-defined JSON and separate authored identity from runtime allocation | Integrated | Reference construction does not allocate unique IDs or enforce the creator's identity registry |
| A2–A3 | [`createAuthoringSession`](../../src/kits/authoring/session.ts) composes preview/cancel, staged commit and bounded undo/redo over the document owner | Integrated | Runtime projections and durable saving are separate; no universal document/game schema |
| A4 | [Author save handles](../recipes/add-a-save-section.md#4-report-persistence-separately-from-edits) return actual store status and support explicit immediate attempts | Integrated | `saved` defaults alone do not prove a write; separate sections and concurrent writers are not atomic |
| A5 | [Optional desktop authoring tool](manual-authoring.md) edits two authored objects through the existing renderer/document/session/save seams | Integrated | A finite demonstration, not a required editor, general placement tool or phone/tablet editor |
| D1 | [`captureDiagnosticSubjects`](../../scripts/play/diagnostic-subjects.mjs) joins explicit authored subjects to bounded capture records with provenance and completeness | Integrated | Script-side helper; no automatic observer, scene-wide registry or proof that a declared association was observed |
| D2 | [`engine.model(request)`](model-inspection.md) inspects adopted model identity, playback, sockets and cached rigid bounds through the existing scene/model owners | Integrated in PR #92 at `b21ec4f`; browser and production comparison passed | No asset editor, fresh pose evaluation, complete animated silhouette bounds or extra resource acquisition |
| W1 | [`createLifetimeRouteQueue`](../../src/kits/navigation/lifetimes.ts) admits replaceable owner lifetimes into the existing shared routing queue | Integrated | No new scheduler, serialized actor identity or automatic motion |
| W2 | [`createRouteDependencies`](../../src/kits/navigation/dependencies.ts) invalidates affected queued and adopted-route tickets after accepted scope changes | Integrated; real actor/portal browser consumer in PR #94 | No automatic navmesh generation, spatial partition or guarantee that arbitrary external views publish atomically |
| R1 | [`createRetirementInventory`, `qualifiedInventoryId`](../../src/kits/inventory/retirement.ts) bound historical identity retention with qualified generations and registered claims | Integrated | Unregistered external references and independent historical saves cannot be protected automatically |
| R2 | [`createMaterializationOwner`](materialization.md) composes exact input reservations, output-definition selection, settlement and retry in one staged envelope | Integrated in PR #93 at `b6ce136`; independent SaveStore consumer and gate passed | No factory clock, global catalog, new persistence backend or remote transaction guarantee |

Detailed consumer contracts: [model inspection](model-inspection.md),
[route dependencies](route-dependencies.md), [materialization](materialization.md)
and [manual authoring](manual-authoring.md).

## Terrain ownership and scale

The [terrain kit contract](../../src/kits/terrain/README.md) keeps finite samples
private and returns detached presentation data. Ordinary surfaces admit at most
256 cells on either axis. Recipe evaluation admits at most 64 steps and 64
operator definitions. Default per-step parameters allow 4,096 UTF-8 bytes,
256 nodes and depth 16; custom jobs capture their selected limits explicitly.
Callbacks declare fields read/written and operator versions, while creator semantics
remain executable code outside the serialized recipe.

Worker preparation captures bounded metadata before admission; payload creation,
JSON parsing and sample generation occur after admission through the existing host.
Sampling and canonical intake yield by row; normal preparation yields during
triangle accumulation and normalization. Main-thread fallback shares that generator.
Refusal, supersession and cancellation produce explicit outcomes. Failed work does
not replace the current generation. Adoption still performs a bounded synchronous
validation/copy pass; it does not secretly recompute normals or establish an
arbitrary custom worker's mathematical correctness. Callback execution and allocation
are trusted and are not a hard real-time or heap sandbox.

The existing [`createTerrainOwner`](../../src/kits/terrain/generation.ts) keeps the
previous accepted generation while a replacement is prepared. A publication adapter
must synchronously install its coordinated views or leave them unchanged. Returning
false does not make arbitrary external side effects reversible. Accepted publication
and subsequent dependency notification are different operations.

The [regional API](regional-terrain.md) retains a region object with a cached branded
`region.surface` facade for ordinary sampling, raycasts, patches, chunk LOD and
generation ownership. Each core has at most 254 cells per axis plus a private
one-cell halo. World positions derive directly from global sample indices,
including fractional bases and negative indices. Halo incident triangles supply
shared smooth vertex normals; contact reports the actual triangle face normal.
Core and halo patches retain canonical backing and identify actual dirty render
vertices for chunk reuse. Registered generation and patch adapters reuse WorkerHost;
accounting includes retained padded/core buffers and adoption overlap. Creators own
source revisions, neighbor selection and coherent multi-region replacement.

Coverage snapshots admit 1–64 entries and distinguish `covered`, `pending`,
`unavailable`, `failed`, `outside` and overlapping `ambiguous` coverage. Missing
coverage never invents a flat height. Edge ownership, waiting, fallback and collision
policy remain creator choices.

**Explicitly absent:** automatic regional residency, streaming-world scheduling,
planetary coverage or whole-world navigation. The integrated finite Surface/worker
adapters do not choose LOD thresholds, repair an inconsistent source revision or
provide sustained physical-device performance evidence.

## Authoring without a prescribed editor

The [authoring kit](../../src/kits/authoring/README.md) accepts the creator's JSON
schema and validator. Byte/node/depth bounds control retained documents; exact
owner/revision tickets reject stale or foreign publications. An authored reference
contains creator document/object/incarnation identity, not a saved runtime entity
number. The creator defines uniqueness, deletion and incarnation policy.

The optional session owns one draft and history bounded by entry count and the
serialized before/after byte charge. Commit preflights history capacity. Undo/redo
publish new revisions after validation; external document edits invalidate the
session head until explicit reconciliation. Overflow, stale heads, rejected
validation, cancellation and disposal do not quietly publish partial document state.

The [manual tool](manual-authoring.md) demonstrates real selection controls,
separate Shape previews, cancel/commit, undo/redo, removal and restoration, and
save/reload under reversed runtime allocation. Its desktop-only workflow is optional
and omitted from the ordinary player entry. Numeric transformation limits belong to
that two-object demonstration, not to every creator's game. A renderer preview is
not the accepted document, and neither is a durable save.

Save feedback forwards the existing store's `saved`, `dirty`, `session`,
`unavailable`, `quarantined` and `newer` states. A failed write can preserve new
in-memory data while old durable bytes remain. Save confirmation needs a successful
attempt or established loaded-save provenance plus matching content; fresh defaults
can report `saved` without having written an envelope. The existing single-writer,
one-envelope boundary remains explicit.

## Diagnostics describe what was actually observed

[D1 associations](diagnostic-subjects.md) preserve owner epochs, capture identity,
authored subject revision, source locators, declared/observed provenance and partial
results. Before/after tokens must represent every relevant lifetime and revision;
changed or unavailable ownership rejects the capture. Caller-provided labels and
digests are not magically observed facts. The script helper performs no polling,
resource loading or live subscription.

The D2 inspector separately reports **requested** model settings and the **adopted**
lease's actual asset path/format/hash, playback restart revision and socket state.
Its bounds use cached geometry and world matrices. Skinned, morphed, uncached and
nonfinite geometry is skipped explicitly; partial rigid coverage is not the whole
model's animated silhouette. Caps include 64 clip rows, 32 requested sockets,
256-character labels and a 4,096-node traversal. Queries do not fetch assets, acquire
leases or evaluate poses. The later AP-02 extension optionally samples at most 32
explicit weighted vertices using existing cached runtime matrices; this does not
turn rigid bounds into a complete animated silhouette or update the pose. Stale/ended visits are unavailable.
Production omission and emitted-byte comparisons are separate checks from dev
handle visibility; disabled callers alone do not prove all inspector bodies were
removed from a production bundle.

## Routing after accepted world changes

The [navigation contracts](../../src/kits/navigation/README.md) separate immutable
graph preparation, budgeted search, owner lifetime and application motion. W1
shares existing request/node/work budgets across a configurable maximum of owners.
Terminal results retain capacity until release. Reused private slots advance their
own epochs, so late work cannot target a replacement owner with the same label.
Abort/retirement releases that owner's routes; exhausted slot counters saturate.

W2 adds bounded creator-defined scopes with identity, incarnation, revision and
readiness. Identical acceptance is a no-op, older versions are stale and conflicting
readiness at the same revision rejects. Accepting a changed scope invalidates only
its dependent requests. The motion adapter must check the ticket both before
adoption **and before using a copied route**. Invalidating a ticket cannot itself
stop an arbitrary actor that ignores that contract.

Preparation, failure or an unaccepted notification is not an accepted world change.
Creators map actual affected bounds to scopes and publish readiness loss if the old
world becomes unusable. [`crossPortal`](../../src/kits/navigation/portals.ts) still
checks current portal revision, openness, readiness, frame validity, clearance and
the creator's swept test at crossing time. Planning-time checks are insufficient.
The additional browser consumer exercises a west obstacle/detour while an east actor
continues, plus an independently changed portal; it is a finite integration example,
not a replacement collision or navigation engine.

## Retention and delayed output

[R1](../../src/kits/inventory/README.md#optional-retirement-of-qualified-identities)
adds a facade, leaving existing ledger/checkpoint behavior unchanged. Unknown
output identities must carry the current issuance generation; known older batches
retain their original facts. Retiring eligible zero-stock, unreserved and unclaimed
metadata rebuilds a copied checkpoint, validates it, then advances generation and
request epoch. Any failing candidate leaves the complete old envelope unchanged.
An old forgotten ID cannot be introduced again merely by using a fresh request ID.

Reference claims have bounded admission and persisted, nonreused counters. The
default maximum is 1,024 live claims; existing defaults are 256 operations per retry
window and 1,024 retained materials. These are configurable retained-count bounds,
not comprehensive request-byte or CPU budgets. Missing persisted checkpoint records
reject rather than silently restoring empty stock. Arbitrary external references,
backups and remote recipients are outside the enclosure unless the creator registers
and manages their claims.

The R2 owner reserves exact creator-selected inputs at admission. Frozen facts
and pinned-by-value definition versions remain unchanged; a current policy requires
an explicit versioned selection. Capacity failure preserves that selection and
reservation. Settlement qualifies the local output name against the current
inventory generation, then stores the exact resulting identity in its receipt.
Changed facts under an existing same-generation name report a conflict rather than
silently changing identity semantics.

One authored-document envelope contains inventory, bounded requests, retained
selections, nonreused request serials and bounded retry receipts. Exact retries
report the prior result; checkpoint boundaries prune receipts and reject old epochs.
One prepared publication blocks subsequent mutations. A rejected or throwing save
adapter retains the same candidate for retry. After any external publication
attempt it cannot be discarded casually: an existing SaveStore write may still be
dirty and later flush. No new storage owner, recipe registry or periodic job is added.
Durability and recovery depend on the existing save owner and application policy.

## Historical baseline integration and regression wiring

T4–T5 landed in PR #91 at `d5ced54`; the optional desktop authoring consumer landed
in PR #90 at `2bcd9a1`. D2 integrated in PR #92 at `b21ec4f` after 1,500 tests and 28 configured
performance checks passed; its real-GLB browser workflow passed. An earlier physical build comparison, **`d5ced54` → `862bb9b`**, reported
unchanged first-load JavaScript at 249.6 KiB, with total emitted JavaScript increasing
47 raw bytes / 81 gzip bytes. Inspection and bridge markers were absent from the
production output and present in the test build. These are results for that named
comparison, not a transfer of acceptance to every later commit or a frame-time claim.
D2 includes corrected cached instanced bounds. R2 integrated in PR #93 at `b6ce136` after 1,507 tests and 28 configured checks
passed. The route consumer integrated through PR #94 with the same test/check
counts plus its native-control movement and portal workflow.

`test:framework-browser` runs the terrain-worker, regional
terrain, model-inspection and route-dependency diagnostics serially. The package command and CI invocation are included with this record. A configured
workflow is distinct from a passing remote CI run. `test:authoring-browser` is already configured separately.

## Baseline acceptance matrix and later extensions

The following observations were made on the named feature candidates before
integration; the final combined regression commands repeat them on one candidate.
Local software-rendered evidence does not certify physical-device performance.

| Required observation | Observed result and evidence surface | Remaining boundary |
|---|---|---|
| Sample contact/render agreement; recipe facts and rounding | Independent plane/saddle and ordered-operator tests, PRs #80/#84 | Creator source correctness remains theirs |
| Worker admission/cancellation/transfers and fallback parity | Real module-worker browser oracle plus focused failure tests, PR #89 | Adoption has a bounded synchronous copy; no arbitrary callback CPU deadline |
| Independent regions match monolith/corner normals | Four-region rendered browser plus independently enumerated triangle oracle, PR #91 | PR #109 subsequently adds Surface/worker integration and independent patch/LOD/ray oracles; shared-edge face ownership remains explicit |
| Different document schemas; stale tickets and bounded preview/history | Placement/dialogue consumers and failure regressions, PRs #81/#85 | No universal schema or cross-owner transaction |
| Desktop preview/history/save/reload and editor omission | Native controls, failed writes/retry, reversed runtime allocation, viewed screenshots, PR #90 | Desktop emulation; full accessibility and physical devices unverified |
| Detached provenance and stale capture rejection | Live terrain-inspection producer supplies partial capture records and authored revisions, PR #83 | Declared associations remain declared, no automatic global wiring |
| Adopted model/playback/socket diagnostics | Real original GLB browser, instance-cache regression and production comparison, PR #92 | Cached bounds are not full animated silhouette bounds |
| Affected-route movement and portal revision | Actual ECS actor browser, independent 22-step coordinate oracle, old crossing rejection, PR #94 | Consumer must check tickets and define accepted scope changes |
| Identity retirement and restoration | Independent invalid-checkpoint, protected-reference and resurrection regressions, PR #88 | Unknown external references cannot be protected |
| Deferred facts, capacity/save retry and duplicate restoration | Frozen/pinned/current hand-calculated inventory traces and actual SaveStore consumer, PR #93 | Dirty persistence may precede live adoption; retry exact envelope |
| Integration and budgets | Each feature passed its current-main rebased head gate, then combined tests/build before push | Final combined command/CI outcomes belong to their exact revision, not old counts |
| Device experience and sustained performance | No blanket physical-device evidence claimed | Creator-selected profiles need their own usability, thermal and performance acceptance |

Reproduce the final suite with `npm run gate:templates`,
`GAME_DIR=templates/expedition/game npm run test:framework-browser` and
`GAME_DIR=templates/expedition/game npm run test:authoring-browser`.
The existing UI, diagnostic and capture commands remain in CI alongside these
additions. Generated local browser reports live under `playtest/`; store or export
them with the checked revision when using them as release evidence.

The integrated baseline and accepted continuation establish named bounded contracts and their
consumers. They cannot establish that every future creator callback, game economy,
world size, mobile layout or device meets its own requirements. Those remain
explicit extension and acceptance work rather than hidden promises of this engine.

Current optional consumers have separate commands, including
`test:regional-surface-browser`, `test:model-preview-browser`,
`test:model-attachment-browser`, `test:weighted-appearance-browser`,
`test:progression-workbench-browser`, `test:custody-composition-browser` and
`test:objective-workbench-browser` and `test:action-workbench-browser`.
Each is wired separately; configured coverage is not a passing result. Consult the
[composition map](composition-framework-status.md) and [ledger](upgrade-acceptance-ledger.md)
for current delivery boundaries, networking and device acceptance. The original baseline command list is not the whole
continuing upgrade suite.

### Integration checkpoint — PR #117

Integrated at `2aabe49` after candidate `c245896` passed its final native desktop
browser and all seven template gates: 1,830 tests, 129 performance checks, no
enforced breaches/regressions/inconclusive checks, and four advisory software-GL
heap warnings. Combined main tests and build passed. Earlier failed browser
observations above remain historical evidence; the scene activation repair is
included. This does not certify physical devices, durable action saves or networking.

### Startup routing integration — PR #119

The declared `firstScene` fallback integrated at `a3d1516` with
focused compile-to-shell activation coverage. Candidate `7673d74` passed both native
action/crafting browsers and all seven gates (1,873 tests). Combined main tests/build
passed. See [scene startup](scene-startup.md) and the acceptance ledger; this
repair does not change framework scope or creator gameplay choices.


### Networking admission — NW-01 integrated

PR #120 (`3a97ca6`) integrates the first networking slice, including:

- `bd65713`: [pure connection intake](../../src/kits/network/README.md), with exact
  opaque lifetimes, bounded captured authentication/command data, current operation
  authorization, finite fair pumping, timeout/revocation and callback cleanup.
  Sixteen focused tests pass.
- `540bece`: [explicit browser text transport](network-transport.md), with bounded
  raw-text admission, buffered-send checks and socket/listener retirement. Thirteen
  injected-socket tests pass; this is not native-browser workflow evidence.
- `63730cc`: [optional reference host](../../tools/network-workbench/README.md),
  using maintained `ws` framing, operator-issued fixture credentials and ephemeral
  creator-defined counter commands. Ten real TCP/WebSocket tests pass.

`a7cbd8b` adds exact reference response schemas and original request-target checks;
five additional tests bring the combined focused total to 44. Candidate `4e51a04`
passed the native two-browser/separate-host diagnostic, including visible accepted
shapes and clearing retired connection facts. Screenshots were inspected. Integrated in PR #120 at `3a97ca6`; final `5f871b3` passed all seven template
gates and combined main passed 1,917 tests/build. NW-02 local load observations are separate evidence, recorded below. This evidence does not certify physical devices, public deployment
security or multiplayer scale. The [network guide](network-admission.md) links the
contracts and reproducible checks.
The earlier integrated PR #119 results remain specific to its startup revision.

This slice supplies neither a replica owner nor prediction, deduplicated retries
or server persistence. Those NW-03 contracts are integrated separately below. DV-01's actual
supported-device evidence remains unresolved. A sent message means transport admission only; repeating
a reference command ID can apply again, and restarting the host resets its counters.
No network service or second simulation loop is installed by the optional helpers.

## Input resize retirement — integrated at `894fc52` (2026-10-01)

On base `3a97ca6d`, independent adapter tests reproduced retained touch action,
pinch and scene press after window resize. The candidate reuses each existing
ownership/cancellation seam, releases capture and requires a fresh gesture.
All 26 focused tests pass. Exact candidate `8b1aa34` passed all seven template
gates (1,922 tests per gate, 129 software checks, four advisory heap warnings),
plus inspected desktop/mobile smoke. Native held-resize and physical-device
acceptance are not established by these Node tests or blank-scene snapshots. No budget, device policy or
input bounds change. [Evidence and limits](../verification/input-resize-20261001/README.md).


### Scoped views — NW-02 integrated and observed limits

Implementation commits `685a25f`, `272a759` and `0dbed00` add optional bounded
complete-view receiver/publisher ownership and the reference host. `0070b6e` /
`eaaaf2f` add factual scene activity hooks, actual retirement on nonconvergent
callback overload, and a native render-return notification. Creator scope remains
explicit; no generic ECS serialization, spatial policy, delta history or extra
browser scheduler is installed. See [network views](network-views.md) and
[scene activity](scene-activity.md).

Runner `534c11a` passed the two-browser/separate-host workflow on clean revision
`f98eb2c` (`playtest/replication-workbench/report.json`). The earlier `eaaaf2f`
dirty-tree exploratory run remains historical evidence. Independent raw-wire and host/ECS checks cover
private fields, disclosure-only replacement, incarnation retirement, overload and
partial-projection clearing, synchronous scrim/opaque suspension, fresh sessions
and stalled-credit privacy retirement. Screenshots were inspected with no page or
console errors. The following all-template gate attempt failed in Arcade:
1,960/1,961 npm tests, with a file-level `entity-inspection.test.ts` failure despite
its inner test passing. The standalone test and full source-suite TAP retry passed (1,960 tests, zero
failures/cancellations); the cause is not established. The
completed 18 performance checks passed, but the gate did not. The subsequent exact-head gate passed on `8121257`: all seven templates,
1,960 tests and 129 performance checks, with zero enforced breaches, regressions
or inconclusive results. Four software-GL heap advisories remain (two Mechanics,
two Terrain). NW-02 is now integrated on `main` by merge `ea48539` (work tracked in PR #122 in the private development history).
The rebased clean browser run passed at `508edd9`; final `47a7e6d` passed all seven
template gates with 1,965 tests and 129 performance checks, zero enforced breaches,
regressions or inconclusive results, and four advisory heap warnings. Combined
main tests (1,965) and build passed. Integration here is verified Git ancestry;
the GitHub PR API still reported OPEN immediately after push, so no PR-state
transition is asserted.

Four declared loopback load cases passed (2/8 peers × 8/64 entities, 100 updates),
with worst observed publisher p95 0.321 ms and healthy available-credit service
within the declared driver round. The [host README](../../tools/replication-workbench/README.md)
qualifies timing and memory scope. This is local application-credit evidence,
not physical TCP backpressure, WAN scaling, mobile performance, durable recovery
or prediction. NW-03 integration is recorded below; DV-01 remains open.


## Durable authority and prediction continuation — integrated

NW-03 now has implemented, separately optional [durable authority](durable-authority.md)
and [bounded prediction](prediction.md) owners integrated through PR #123, plus an
[optional SQLite tooling adapter](../../tools/authority-workbench/README.md).
Canonical capture has 4 focused tests, prediction 13, authority 19, the SQLite
adapter 12 and the host 5. All 53 pass; storage/host also pass on Node 22.13.0.
The exploratory native two-client correction/restart workflow passed within its
desktop loopback scope. See the [versioned evidence ledger](upgrade-acceptance-ledger.md#durable-authority-and-prediction--integrated)
for historical candidate commits and current integration evidence.

Clean-revision native acceptance passed at `8317c69`; see the
[saved evidence](../verification/authority-20261001/README.md). NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed.
DV-01 physical-device acceptance remains open; minimum phone, tablet and laptop/desktop profiles are pending creator selection. Creators may configure,
replace or omit these contracts and retain ownership of all game rules.

## Device acceptance continuation — public PR, not integrated

The [stock device matrix](../kits/stock-device-acceptance-matrix.md) records all seven
current template declarations and remaining task-specific acceptance. The
[2026-10-01 exploratory receipt](../verification/stock-device-20261001/README.md)
separates 16 passing touch-emulated target/tap cases from an observed compact lesson
content overlap. The [2026-10-02 layout receipt](../verification/stock-device-20261002/README.md)
records the repair in the learn kit's layout seam (desktop geometry unchanged), a
fake-DOM regression and emulated separation checks across board, sim and quiz at
four profiles on a clean commit. This is emulated evidence, not a completed mobile
experience: full workflows, text scaling and actual minimum-device performance remain
open, and minimum phone, tablet and laptop/desktop profiles are pending creator
selection. DV-01 and the overall upgrade goal remain active. See the
[continuing ledger](upgrade-acceptance-ledger.md) for the authoritative work state.

## Program preparation candidate (2026-10-01) — public PR #10, not integrated

Program preparation candidate: context-owned link validation, bounded submitted
program readiness and author recovery passed public checkpoint `2cdd442` across
all seven template gates and inspected desktop/mobile snapshots. Integration is pending. See [contract](program-preparation.md). No performance,
quality-budget or engine-wide residency completion claim is made.

The same candidate now includes optional owned submitted-frame completion after
initial draw. Native correctness and exact-head template gates are recorded in the
[checkpoint receipt](../verification/program-preparation/README.md). Completion is not display presentation or a smoothness guarantee.

## Cooperative dependency preparation candidate (2026-10-01)

M2 adds real task boundaries and reserves one acquisition slot for the required
closure while optional work uses remaining capacity. Explicit pumping remains
caller-owned. See the [contract](../../src/platform/assets/dependency-lease.md) and
[prospective oracle and CPU evidence](../verification/dependency-preparation-20261001/README.md).
Native task oracle, all seven template gates and the CI browser suites passed (see the
evidence README and public PR #11);
integration, frame-time and downstream acceptance remain pending; no resource budget changes.

## Queue age and submit deadlines — NW-06 implemented, candidate

Implemented, candidate (PR #12); not integrated.
The [network intake](../../src/kits/network/README.md#optional-queued-command-age-nw-06)
may shed commands older than an optional `maxQueuedAgeMs` before authorization or
dispatch, and [durable authority](durable-authority.md#optional-submit-deadlines-nw-06)
may return `expired` for an optional deadline on an injected clock, only before the
storage call starts. In-flight writes keep committed/rejected/unknown semantics and
`expired` consumes no sequence. Both are off by default. Evidence is 6 intake and 9
authority focused tests; load, browser composition and devices remain unverified.

## Reconnect/retry pacing — NW-04 implemented, candidate

`createRetrySchedule` (network kit) is an optional, pure pacing helper: full-jitter
exponential backoff per episode and a token-bucket budget across episodes, driven
by caller time and an injected random stream. The network workbench client wires it
behind an opt-in checkbox. Implemented as a candidate (PR #14, `feat/nw04-reconnect-schedule`),
not integrated; unit tests and the loopback browser workflow are its only evidence.
See the [retry pacing guide](network-retry.md) and the
[ledger](upgrade-acceptance-ledger.md).

## Rate and concurrency admission — NW-05 implemented, candidate (PR #13)

NW-05 adds an optional, single-process [rate and concurrency admission](rate-admission.md)
helper (`createRateAdmission`, network kit): a per-key token bucket with an optional
concurrency gate, bounded keys, explicit refusal results, caller-supplied time and
idempotent disposal. The three reference hosts replace their hand-rolled fixed
windows with it, keeping limits, close reasons and check order; the change from a
fixed window to a bucket is an intended semantic change recorded in the guide.
Status: implemented, candidate (PR #13); not integrated. Evidence is unit and loopback
host tests only; distributed limits, measured load and physical devices are outside
this slice.

## Terminal close classification — NW-04 follow-up, candidate

`read().remoteClose` (browser transport) and `createClosePolicy` (network kit) let a
consumer treat a terminal refusal as final instead of retrying it. Candidate
(PR #16), building on integrated NW-04 (PR #14); not integrated. Unit tests and the
loopback browser workflow are its only evidence. See the
[retry pacing guide](network-retry.md#terminal-refusals-and-transient-loss).

## Replay log and divergence detector (SIM-01) — candidate, not integrated

| ID | Contract | State |
|---|---|---|
| SIM-01 | Optional `@kits/replay`: bounded tick-input log and player (explicit truncation; version, identity and corruption refusal), creator-digest traces with first-divergence comparison, and a prediction-versus-authority agreement check over the existing owners. Dev/test-only `engine.replay` uses the stock scene fixed lane and `?seed=`. [Contract](replay-divergence.md) | Implemented, candidate (public PR #17). Focused tests and the arcade `?seed=` browser replay pass on the branch. Not integrated. No cross-device or cross-browser floating-point determinism, physical-device or multiplayer claim. |

## Sustained-session recorder — PERF-01 candidate

| Slice | Capability and actual seam | State | What remains outside the claim |
|---|---|---|---|
| PERF-01 | [`FrameLoop.attachSampler`](../../src/core/activity/loop.ts) is a single observational slot. Through it, [`createSessionRecorder`](../../src/platform/perf/session-recorder.ts) records bounded rolling-window percentiles and drift, exposed as `engine.sessionRecorder()` and `?session-record` ([guide](session-performance.md)) | Implemented, candidate (PR #15 on the public repository). Unit tests and an emulated browser run passed on the candidate head; see [verification](../verification/session-perf-20261002/README.md) | No physical-device, thermal, GPU-timer or production telemetry claim. DV-01 remains open |

### Bounded asset residency — RES-01 implemented, candidate

The texture and model libraries' existing `LeaseCache` gains an optional residency
policy from `defineGame({ residency })`: per-preset `warmBytes` and `residentBytes`,
pinned asset ids, least-recently-used eviction of unpinned retained assets, and an
explicit once-per-transition pressure report and creator hook when live and pinned
bytes alone exceed the ceiling. Retained resources drop renderer copies through
three's public `dispose` event and upload again on their next draw, including after
context restoration. Candidate (PR #22); not integrated. Evidence is focused
unit tests, an opt-in native software-renderer fixture and a temporary composed
probe ([record](../verification/asset-residency-20261002/README.md)). No program
budget, combined ceiling, prefetch, physical-device memory or performance claim.
See the [guide](asset-residency.md).

