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

## Current status (2026-10-03)

All public PRs merged through #116 are integrated on `main`. That includes the
post-0.2.0 merge-train batches #62 (TB-02, SC-02, RNG-01, INPUT-01, touch hold,
SIM-02), #64 (MV-02, AU-02, W1-2, MP-01) and #65 (W1-4/W1-5/W1-6, FX-01, AUD-02), and
GEN-02 (#56). None of these is in a release yet. Sections below that were written as
candidates now begin with a dated current-status line; their original evidence and
limits are kept unchanged.

The creator-readiness milestone ([issue #66](https://github.com/Akilleez-QA/foundation-engine/issues/66))
added receipts in `docs/verification/`:
[onboarding](../verification/creator-onboarding-20261003.md) (#68),
[session host CLI](../verification/session-host-cli-20261003.md) (#70),
[creator journey](../verification/creator-journey-20261003.md) (#72) and its
[failure paths](../verification/creator-journey-recovery-20261003.md) (#98),
[first use](../verification/first-use-20261003/README.md) (#73, #104),
[bench active restart](../verification/active-restart-20261003/README.md) (#75),
[Blender export](../verification/blender-export-20261003.md) (#74),
[save recovery](../verification/save-recovery-20261003.md) (#76),
[model retirement](../verification/model-retirement-20261003.md) (#78),
[decode cancellation](../verification/decode-cancellation-20261003.md) (#116),
[contributor rehearsal](../verification/contributor-rehearsal-20261003.md) (#80),
[DPR redraw](../verification/dpr-redraw-20261003.md) (#83) and
[session recovery](../verification/session-recovery-20261003.md) (#97).
The [acceptance ledger](upgrade-acceptance-ledger.md#creator-readiness-milestone-2026-10-03)
gives each receipt's PR, merge commit, checked revision and evidence class, the main
CI runs, and the scorecard status. That evidence is focused, CI or simulated. No
human-newcomer, physical-device, LAN-between-machines or WAN evidence exists.

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
[saved evidence](../verification/authority-20261001/README.md). NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history) and included in public `main` since `c0e73c9`. Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed.
DV-01 physical-device acceptance remains open; minimum phone, tablet and laptop/desktop profiles are pending creator selection. Creators may configure,
replace or omit these contracts and retain ownership of all game rules.

## Device acceptance continuation — layout repair integrated in v0.2.0 (PR #9)

The [stock device matrix](../kits/stock-device-acceptance-matrix.md) records all seven
current template declarations and remaining task-specific acceptance. The
[2026-10-01 exploratory receipt](../verification/stock-device-20261001/README.md)
separates 16 passing touch-emulated target/tap cases from an observed compact lesson
content overlap. The [2026-10-02 layout receipt](../verification/stock-device-20261002/README.md)
records the repair in the learn kit's layout seam (desktop geometry unchanged), a
fake-DOM regression and emulated separation checks across board, sim and quiz at
four profiles on a clean commit. The matrix and repair are integrated in v0.2.0 (PR #9, merged to main at `97288f8`). This is emulated evidence, not a completed mobile
experience: full workflows, text scaling and actual minimum-device performance remain
open, and minimum phone, tablet and laptop/desktop profiles are pending creator
selection. DV-01 and the overall upgrade goal remain active. See the
[continuing ledger](upgrade-acceptance-ledger.md) for the authoritative work state.

## Program preparation (2026-10-01) — integrated in v0.2.0 (PR #10)

Program preparation: context-owned link validation, bounded submitted
program readiness and author recovery passed public checkpoint `2cdd442` across
all seven template gates and inspected desktop/mobile snapshots. Integrated in v0.2.0 (PR #10, merged to main at `4f666a2`). See [contract](program-preparation.md). No performance,
quality-budget or engine-wide residency completion claim is made.

The same change includes optional owned submitted-frame completion after
initial draw. Native correctness and exact-head template gates are recorded in the
[checkpoint receipt](../verification/program-preparation/README.md). Completion is not display presentation or a smoothness guarantee.

## Cooperative dependency preparation (2026-10-01) — integrated in v0.2.0 (PR #11)

M2 adds real task boundaries and reserves one acquisition slot for the required
closure while optional work uses remaining capacity. Explicit pumping remains
caller-owned. See the [contract](../../src/platform/assets/dependency-lease.md) and
[prospective oracle and CPU evidence](../verification/dependency-preparation-20261001/README.md).
Native task oracle, all seven template gates and the CI browser suites passed (see the
evidence README and public PR #11);
integrated in v0.2.0 (PR #11, merged to main at `ae8a61f`); frame-time and downstream acceptance remain pending; no resource budget changes.

## Queue age and submit deadlines — NW-06 integrated in v0.2.0

Integrated in v0.2.0 (PR #12, merged to main at `53d549d`).
The [network intake](../../src/kits/network/README.md#optional-queued-command-age-nw-06)
may shed commands older than an optional `maxQueuedAgeMs` before authorization or
dispatch, and [durable authority](durable-authority.md#optional-submit-deadlines-nw-06)
may return `expired` for an optional deadline on an injected clock, only before the
storage call starts. In-flight writes keep committed/rejected/unknown semantics and
`expired` consumes no sequence. Both are off by default. PR #12 evidence was 6 intake and 9
authority focused tests (9 intake after the follow-up below); load, browser composition and devices remain unverified.

Follow-up (PR #33; integrated in v0.2.0, batch PR #42): the
NW-07 overload probe showed that charging each age shed to the pump budget collapsed
goodput once queued wait exceeded the age. Shedding is now uncharged and capped by an
optional `maxStaleDropsPerPump`. With PR #27's probe, at a 300 ms age saturated final/peak goodput was
0.253 and 0.229 before and 0.955 and 0.915 after (two loopback runs each, heavily
loaded host); the deterministic unit regression measured 22.0/s before and 80.4/s
after against an 80.4/s FIFO plateau. Defaults without `maxQueuedAgeMs` are unchanged.

## Reconnect/retry pacing — NW-04 integrated in v0.2.0

`createRetrySchedule` (network kit) is an optional, pure pacing helper: full-jitter
exponential backoff per episode and a token-bucket budget across episodes, driven
by caller time and an injected random stream. The network workbench client wires it
behind an opt-in checkbox. Integrated in v0.2.0 (PR #14, merged to main at `82862d6`); unit tests and the loopback browser workflow are its only evidence.
See the [retry pacing guide](network-retry.md) and the
[ledger](upgrade-acceptance-ledger.md).

## Rate and concurrency admission — NW-05 integrated in v0.2.0 (PR #13)

NW-05 adds an optional, single-process [rate and concurrency admission](rate-admission.md)
helper (`createRateAdmission`, network kit): a per-key token bucket with an optional
concurrency gate, bounded keys, explicit refusal results, caller-supplied time and
idempotent disposal. The three reference hosts replace their hand-rolled fixed
windows with it, keeping limits, close reasons and check order; the change from a
fixed window to a bucket is an intended semantic change recorded in the guide.
Status: integrated in v0.2.0 (PR #13, merged to main at `cc2ef79`). Evidence is unit and loopback
host tests only; distributed limits, measured load and physical devices are outside
this slice.

## Terminal close classification — NW-04 follow-up, integrated in v0.2.0

`read().remoteClose` (browser transport) and `createClosePolicy` (network kit) let a
consumer treat a terminal refusal as final instead of retrying it. Integrated in v0.2.0 (PR #16, merged to main at `b93690d`), building on NW-04 (PR #14). Unit tests and the
loopback browser workflow are its only evidence. See the
[retry pacing guide](network-retry.md#terminal-refusals-and-transient-loss).

## Replay log and divergence detector (SIM-01) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| SIM-01 | Optional `@kits/replay`: bounded tick-input log and player (explicit truncation; version, identity and corruption refusal), creator-digest traces with first-divergence comparison, and a prediction-versus-authority agreement check over the existing owners. Dev/test-only `engine.replay` uses the stock scene fixed lane and `?seed=`. [Contract](replay-divergence.md) | Integrated in v0.2.0 (PR #17, merged to main at `49047ae`). Focused tests and the arcade `?seed=` browser replay passed on the PR head. No cross-device or cross-browser floating-point determinism, physical-device or multiplayer claim. |
| SIM-02 | Creator-chosen replay digest and divergence detail (backlog W1-1; demo finding F1). Optional `defineScene({replay: {digest}})`, `@kits/replay` `replayDigest`/`selectWorldState` (selected components, excluded tags, chosen resources) and `explainDivergence`; dev/test-only `engine.replay.start({digest, detail})` and a bounded `divergence` report naming the first differing entity, component and field. Default digest and identities unchanged. [Contract](replay-divergence.md#choose-what-a-replay-must-reproduce-sim-02), [recipe](../recipes/replay-with-your-own-digest.md) | **Integrated 2026-10-02** (PR #58 merge `4943174`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #58). Focused tests (including the demo's frame-phase orb case: default diverges and names the orb, a digest excluding the cosmetic tag replays exactly) and `npm run test:replay-browser` (arcade, desktop Chromium software GL) passed on the branch. No cross-browser floating-point, physical-device, production-build or multiplayer claim. |

## Deterministic scalar maths (W1-2) — integrated

**Current status (2026-10-03): integrated.** PR #60 (PR merge `ca972b3`) reached `main` through merge-train batch PR #64, merged to `main` at `3b449fa` on 2026-10-03 (main CI run 37082507567 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

| ID | Contract | State |
|---|---|---|
| W1-2 | Optional `dmath` from `@engine` (`src/core/dmath.ts`): `sin`, `cos`, `atan`, `atan2`, `exp`, `log`, `pow`, `sqrt`, `hypot`, built only from correctly rounded operations, so the bits are the same in every engine. `platformMath`/`scalarMath` select it. The character, locomotion and root-motion kits take `math: 'deterministic'` (default `'platform'`, unchanged). Golden vectors are committed as hex (`src/core/dmath.golden.json`). [Guide](deterministic-math.md) | **Integrated 2026-10-03** (PR #60 merge `ca972b3`, batch PR #64, `main` `3b449fa`). Before integration: implemented, candidate (PR #60). Checked: focused tests (golden bits, correctly rounded `Math.sqrt` and `hypot` proved in integers, special values, at most 1 ulp to V8 `Math` over 16 ranges, kit options within 10⁻⁹ of `Math` and repeating exactly) and `npm run test:dmath-browser`: 1,075 vectors (including huge `sin`/`cos` arguments up to about 10³⁰⁸) and a 3,000-tick character-kit workload bit-identical in Chromium 152 and Node 22, where `Math` differed. Cost is about 1–2.5× `Math` per call (`pow` up to 4× in Chromium). Not established: Firefox/WebKit, physical devices, a browser-recorded character-scene replay in Node (camera-relative yaw and default pointer picking stay on `Math`), and the RB-01/SEC-01 slice B consumers. |

## Sustained-session recorder — PERF-01 integrated in v0.2.0

| Slice | Capability and actual seam | State | What remains outside the claim |
|---|---|---|---|
| PERF-01 | [`FrameLoop.attachSampler`](../../src/core/activity/loop.ts) is a single observational slot. Through it, [`createSessionRecorder`](../../src/platform/perf/session-recorder.ts) records bounded rolling-window percentiles and drift, exposed as `engine.sessionRecorder()` and `?session-record` ([guide](session-performance.md)) | Integrated in v0.2.0 (PR #15, merged to main at `ae69a38`). Unit tests and an emulated browser run passed on the PR head; see [verification](../verification/session-perf-20261002/README.md) | No physical-device, thermal, GPU-timer or production telemetry claim. DV-01 remains open |

## Bounded asset residency — RES-01 integrated in v0.2.0

The texture and model libraries' existing `LeaseCache` gains an optional residency
policy from `defineGame({ residency })`: per-preset `warmBytes` and `residentBytes`,
pinned asset ids, least-recently-used eviction of unpinned retained assets, and an
explicit once-per-transition pressure report and creator hook when live and pinned
bytes alone exceed the ceiling. Retained resources drop renderer copies through
three's public `dispose` event and upload again on their next draw, including after
context restoration. Integrated in v0.2.0 (PR #22, merged to main at `9913019`). Evidence is focused
unit tests, an opt-in native software-renderer fixture and a temporary composed
probe ([record](../verification/asset-residency-20261002/README.md)). No program
budget, combined ceiling, prefetch, physical-device memory or performance claim.
See the [guide](asset-residency.md).

## KTX2 model textures — implemented and checked (PR #146)

The model library loads GLBs whose textures use `KHR_texture_basisu`. Its KTX2 step
(`src/platform/assets/model-ktx2.ts`) is a lazy chunk that imports three's `KTX2Loader`
and fetches the Basis transcoder only for a model with a KTX2 image, once per library.
The transcode targets the formats of the renderer the scene runtime binds (the pooled
world renderer, `detectSupport`), with an RGBA8 fallback. Headers are refused and the
worst case admitted against `maxResidentBytes` before any transcode; the transcoded
level bytes count in residency and the `models` probe. Two workers per library by
default, retired with it; late transcodes are dropped. Evidence: unit tests and
`npm run test:ktx2-browser` (dev, fallback, sub-path builds, three cancel-after-transcode
cycles) in SwiftShader Chromium ([record](../verification/ktx2-model-textures-20261003.md)).
Checked, not yet integrated: the integration merge and its CI run are recorded in the
ledger. No phone GPU, driver memory or transcode-time claim; the transcoder workers are
an explicit STD-RUN-35 exception. See the [guide](compressed-textures.md).

## Zero-step press retention (STD-SIM-12) — fix integrated in v0.2.0

The stock author runtime cleared pressed actions and `pointer.pressed` after every
frame, so a press arriving before a frame that ran no fixed tick (frame time below
the 1/60 s step on 120 Hz+ displays, or the `dt = 0` frame after idle, cover or
`engine.clock.hold()`) was never seen by fixed systems; a frame with several ticks
showed it to each of them. [`createPressLatch`](../../src/author/press-latch.ts),
driven by new `beforeStep`/`beforeFrameLane` hooks on `createSystemRunner`, now
keeps a press pending until the first fixed tick, which alone sees it; frame
systems keep their per-frame view. Retention is bounded by the visit and by the
existing cancellation paths (pointer/input cancel, overlay, hidden tab, lost
ownership, a non-simulating frame, a held SIM-01 replay tap). The latch runs before
the replay tap's tick sentinel, so a recorded press lands in exactly one tick. Evidence: focused runtime and runner tests;
browser suites and gates are recorded on the PR. Physical high-refresh devices are unverified. Integrated in v0.2.0 (PR #19; batch PR #42).

## Peer rollback sessions (RB-01) — integrated in v0.2.0

Optional `@kits/rollback` ([README](../../src/kits/rollback/README.md),
[recipe](../recipes/add-rollback-sessions.md)) supplies speculative execution with
bounded rollback, stall and checksum desync detection over a creator-supplied
reliable, ordered link, plus a local sync test. Integrated in v0.2.0 (PR #25; batch PR #42). Evidence is focused headless tests
and one fixed-lane consumer; network, device and multiplayer acceptance are open.

## Deterministic turn log (turns kit, TB-01) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #24; batch PR #42). See the [kit README](../../src/kits/turns/README.md) and [recipe](../recipes/add-a-turn-log.md).

- Runtime-enforced: rules id, validator literal-`true` acceptance, JSON capture limits for commands and states, `maxCommands` retention (`full` overload, `checkpoint` recovery), revision-checked mutations (`stale`), reentrancy (`busy`), disposal (`retired`), frozen states, mutations require an exact safe-integer revision, restore never throws for stored data (`invalid`/`foreign`/`diverged`, including throwing creator validators/reducers) with a 64-bit replay kit `hashText` checksum over the whole retained log (redo entries included), authority random keyed by seed, lineage, stream and sequence.
- Checked: 18 focused headless unit tests (determinism, preview equals submit, undo/redo/replay, real SaveStore round trip across a fresh store, adversarial reducers and inputs, durable-authority composition with an in-memory adapter).
- Not established: any template or game consumer, browser or device evidence, reducer CPU deadlines, hidden-information safety of a local log (it is not), AI worker budgets, play-by-turn timeouts.

## Seeded fault schedules — NW-09 integrated in v0.2.0

`npm run faults:network` (tools/authority-workbench) replays seeded combined faults
against the composed authority path and checks invariants after every step against
independent SQLite readback; failing seeds reproduce exactly by seed and step index
and can be shrunk. Tools/tests only; the host gains optional, default-preserving
fault seams. Integrated in v0.2.0 (PR #26; batch PR #42). Process-scope loopback
evidence only. See the [guide](network-fault-schedule.md) and the
[ledger](upgrade-acceptance-ledger.md).

## Planned drain and capped lifetime — NW-08 integrated in v0.2.0 (PR #21)

`createConnectionDrain` (host) and `createDrainFollower` (client), network kit, let a
host announce a planned drain with a bounded notice and optionally cap connection
lifetime with randomized dither, so clients stop new work, settle pending replies
and reconnect through the existing retry schedule after the announced return. Both
are optional and pure; drain closes are transient (1012). The network workbench host
and client opt in. Integrated in v0.2.0 (PR #21; batch PR #42). Unit, host socket
and loopback browser tests are its only evidence. See the [drain guide](network-drain.md).

## Bounded spatial index (SC-01) — integrated in v0.2.0

The optional `spatial` kit adds [`createSpatialGrid`](spatial-index.md), a preallocated
uniform-grid index for neighbour, range and per-observer interest queries with explicit
cell, result and capacity bounds. It is a reusable proximity mechanism for large
populations, not a visibility, steering or replication policy. Status: integrated in v0.2.0 (PR #23, merged to main at `2c87e3b`). Evidence is focused unit tests
and a headless 1,000/10,000-entry CPU micro-benchmark; no template consumer, browser,
worker or physical-device evidence, and no budget change.

## Seeded generation — GEN-01 integrated in v0.2.0

GEN-01 adds integer-only hierarchical seed derivation (`deriveSeed`, beside the single
mulberry32 generator in `src/core/rng.ts`) and an optional `procgen` kit. The kit runs
creator-registered slice generators over bounded `Uint16Array` cell grids on the
existing WorkerHost, ships one example row (`job.kits.procgen.cellular`) and provides
a strict root-seed save section. It adds no scheduler, registry or publication owner;
results never publish themselves. Status: integrated in v0.2.0 (PR #38; batch PR #45). Evidence is focused unit tests plus one
desktop Chromium worker check. Chunk residency, runtime edit deltas, meshing and
edited-world persistence remain separate work. See the
[kit](../../src/kits/procgen/README.md) and the [ledger](upgrade-acceptance-ledger.md).

## Spatial audio voices (AUD-01) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| AUD-01 | Platform audio output, per voice: `panning` (`'equalpower'` default \| `'HRTF'`), `distanceModel` (`'inverse'` default \| `'linear'` \| `'exponential'`) with bounded `refDistance`/`maxDistance`/`rolloffFactor`, a model-independent `cutoffDistance` (refused start, faded silence beyond), a separate HRTF voice limit with equal-power fallback and diagnostics, an optional smoothed low-pass/gain filter stage, and smoothed position/listener ramps. Creator control through `defineGame({ audio })` (HRTF limit per quality preset, smoothing, optional `sound.headphone-3d` setting). The mechanics template's ineffective `maxDistance: 60` became `cutoffDistance: 60`. [Guide](spatial-audio.md) | Integrated in v0.2.0 (PR #28; batch PR #45). Node unit and boot tests plus `npm run test:audio-browser` (real output rendering into `OfflineAudioContext` in the muted Chromium test browser) passed on the PR head. Proves configuration and rendered signal behaviour only: no human localisation trials, no Firefox/WebKit rendering, no device CPU/battery/latency measurement, no iOS evidence. No occlusion queries, propagation or networking; game sound files arrived separately (PR #37) and share this voice chain. |

## Developer-experience checks (DX-01) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| DX-01 | Boot input check and generator: [`src/author/input-registry.ts`](../../src/author/input-registry.ts) rebuilds the boot's `inputActions` table (engine rows, then game and kit inputs) with the registry's own options. `npm run check` (lint:brief) reports every problem; `npm run new -- input` picks bindings that table leaves free. Dev/test `engine.redraw()` ([`SceneHandle.redraw`](../../src/author/play.ts)) asks the running stock scene for one real draw, so `play:snap` judges budgets on rendered frames and reports `not measured` instead of a vacuous pass. [Recipe](../recipes/add-an-input-action.md) | Integrated in v0.2.0 (PR #39; batch PR #45). Unit and lint regressions plus emulated `play:snap` runs on the PR head. A dev/test boot throws on a clash; production drops the row with a warning. `engine.redraw()` covers the stock scene runtime only; the bench's idle windows are unchanged. Forced redraws can make a gate fail where it used to pass vacuously, and `not measured` exits 0. No device claim. |

## Template polish semantics (DX-02) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| DX-02 | Learn timeline objectives semantics: [`TimelinePlayer.state().objectives`](../../src/kits/learn/timeline.ts) is true from an `objectives` action until the learner passes the next gate after it, then stays false (it used to stay true for the whole scene, so the card returned over later drawings). The learn runtime shows the card from that flag on the first scene, outside interrupts. ui kit HUD lines and the prompt gain a readability plate ([README](../../src/kits/ui/README.md)). `play:script` gains `holdUntil`. | Integrated in v0.2.0 (PR #40; batch PR #45). Timeline unit test, learn `play:script` 9/9 and emulated snaps on the PR head. Lessons that relied on the card returning at later gates would see it once; no stock lesson did. No device claim. |

## Overload and goodput probe — NW-07 integrated in v0.2.0

`npm run probe:network` ([guide](network-overload.md)) measures the loopback network
and replication reference hosts past saturation: goodput against offered load,
rejections by reason, admitted-work latency, high-water marks, a physical non-reading
peer and a host-restart reconnect storm. Tools only; integrated in v0.2.0 (PR #27; batch PR #46). FIFO goodput plateaued and adversaries were limited without closing
healthy peers. The replication host's buffered cap retired a paused peer in 2 of 3
runs. Its finding that a queue age shorter than the real queued wait collapsed goodput
is resolved by the NW-06 follow-up (PR #33), and queue-age plateaus are now asserted. Loopback/process scope only; WAN, browsers and physical devices remain
unverified. See the [evidence](../verification/network-overload-20261002/README.md)
and the [ledger](upgrade-acceptance-ledger.md).

## Tunable jump feel — MV-01 integrated in v0.2.0

`createJumpFeel` and `jumpSystem` (locomotion kit) give creators a frame-rate-independent
jump mechanism: height and time to apex, release, fall and apex gravity, terminal fall,
coyote and buffer windows, each bounded and creator-chosen. Author buttons gain an opt-in
`hold: true` so `ctx.input.held` observes a release; existing buttons are unchanged.
Integrated in v0.2.0 (PR #34; batch PR #46).
Evidence is focused unit tests only. A held touch button for such actions (`touchButton` in
`@kits/ui`) was a candidate in PR #57 and is integrated since 2026-10-02 (PR merge `e58010a`,
batch PR #62, `main` `6485572`); its evidence remains fake-DOM tests and Chromium touch emulation. See the [kit README](../../src/kits/locomotion/README.md#tunable-jump-feel-mv-01),
the [recipe](../recipes/tune-a-jump.md) and the [ledger](upgrade-acceptance-ledger.md).

## Sub-path asset base — DX P1-8, integrated in v0.2.0

Texture and model URLs now follow Vite's `base` (`import.meta.env.BASE_URL`, exported as
`PUBLIC_BASE` from `core/env.ts`) through `publicBase()`/`publicUrl()`; the default `/`
keeps every existing URL unchanged. `npm run test:subpath-browser` (new CI step) fails on
any request outside the sub-path. Integrated in v0.2.0 (PR #35; batch PR #46). Local static hosting and desktop Chromium only; see the
[recipe](../recipes/host-under-a-sub-path.md) for limits.

## Authored materials — DX P1-10, integrated in v0.2.0

New author component `Material` (`texture`, `repeat`, `wrap`, `roughness`, `metalness`,
`emissive`, `emissiveIntensity`, `opacity`, `transparent`) with `defineMaterial` and
`validateMaterial`. Bounds: repeat ≤ 1024, emissive intensity ≤ 16, kebab-case texture ids;
invalid runtime data is reported once and drawn with the original material. Lifetime: one
lease per (texture, wrap) view shared by the visit's surfaces, aborted with the visit; a
texture change keeps the old view until the new one arrives. Overload: none beyond the texture library's existing admission. Integrated in v0.2.0 (PR #36; batch PR #46). Follow-ups outside this slice: particles, rigid-body
physics, a game-facing multiplayer session, normal/roughness maps and `Mesh` texture
coordinates.

## Post-processing (VIS-07) — implemented, candidate

**Current status (2026-10-04): implemented, candidate (PR `feat/post-processing`); not integrated.** `view.post` on
`defineScene` (bloom, vignette, grade; `ctx.view.post` live) drawn at the player's `post.mode` tier, the registered
knob now wired: `off` (low) draws direct, `basic` (medium) adds one combined pass (tone map from `view.output`, grade
and vignette in display values, sRGB), `full` (reference, high) adds a half-resolution 5-mip bloom chain (10 post
draws). Owner `platform.render.post`: backend-neutral settings and plan (`src/platform/render/post/settings.ts`), GLSL
implementation in the WebGL2 backend (`backends/webgl/post.ts`, a lazy chunk, 6.1 kB min / 2.6 kB gzip). Bounds: every
field validated, naming it. Overload: none (no queue). Render on change: post runs only inside a drawn frame; a still
scene draws nothing. Targets allocated on the first composed frame, reallocated only on size, sample or bloom change,
disposed with the visit. Failure: an invalid runtime value keeps the last valid settings; a chunk, context or pipeline
failure is reported once and the visit draws direct; a WebGPU visit reports no implementation. A kit render override
(`@kits/three`) takes precedence. **Budget contract change, stated:** post passes are counted apart as `postDraws`
(probe bracket, bench, gate, derive, play:snap); `draws` keeps measuring scene draws. Evidence: unit tests and
`npm run test:post-browser` (courtyard fixture, reference, medium and low; exact 10/1/0 post draws, equal scene draws,
bloom beside an emissive box at full only, a still scene draws no frame, release audit at the author-API baseline);
`quality:guard` identical for the blank and explorer templates. No reference-GPU cost, physical-device or
visual-quality acceptance; the stock shell does not install the Graphics screen, so the live knob is unit-tested only.
See the [guide](post-processing.md).

## Three.js escape hatch (VIS-09) — implemented, candidate

**Current status (2026-10-03): implemented, candidate (PR `feat/kit-three`); not integrated.** Optional kit
`@kits/three` for a game that lists `three()` in `defineGame({ kits })`: `three`, `three/addons/*` and
`three/examples/jsm/*` imports in that game's files only (`lint:layers`), and per scene, with
`defineScene({ extensions: [sceneThree()] })`, the handle `useThree(ctx)` (scene, kit-owned `root`, camera, renderer,
canvas, `requestRender`, `onFrame`, `onBeforeRender`, `onResize`, `setRenderOverride`, `own`) plus
`customObject({ create, update, dispose })` with `ThreeObject`. Engine seam: the genre-neutral render extension
(`author/scene-extension.ts`, opaque `SceneExtension` in `@engine`). Owner: the scene visit; the kit owns its `root`,
owned resources and custom objects and disposes them before the scene's tree. Bounds: `sceneThree({ max })` custom
objects per scene (default 16, cap 256) and per-object triangle and texture `limits`; refusals reported once. Overload:
refusal, never a late draw. Cancellation and recovery: visit exit disposes everything; a throwing session, hook or
override is reported and closed or dropped for the visit, and the engine-owned render target, size and pixel ratio are
restored after game code. Evidence: unit tests (handle lifecycle, disposal registry, custom objects, lint allowance)
and `npm run test:three-kit-browser` on the courtyard fixture (desktop and phone-sized headless Chromium, software
GL): point-lit lanterns, shadows and UnrealBloom through an EffectComposer, counted draws within the fixture's rows, a
still scene drawing no frame, and nothing left in the renderer pool's release audit. **Unstable across three.js
upgrades by contract.** Not yet: WebGPU refusal of WebGL-only materials, a dev warning for unreported changes, an
upgrade-time changelog of breaking three.js changes beyond the fixture compile. No template uses it; no
physical-device, GPU timing or visual-quality acceptance. See the [recipe](../recipes/use-three-directly.md).

## Particle emitters — FX-01, integrated

**Current status (2026-10-03): integrated.** PR #63 (PR merge `b7b5550`) reached `main` through merge-train batch PR #65, merged to `main` at `1f9d10d` on 2026-10-03. Main CI run 37086722080 on `1f9d10d` failed: the arcade template's active bench window drew no frame (perf inconclusive), the ended-visit defect later fixed by PR #75. The next main CI, run 37088378582 on `2fb6e69` (which contains batch 7), passed. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Optional author component `Emitter` with `defineEmitter`, `validateEmitter` and `burst`, and
a per-scene opt-in `defineScene({ particles: sceneParticles({ max, emitters }) })`. Owner: the
scene visit; a pure field (`author/particle-sim.ts`) steps in the engine fixed system
`engine.particles` after the scene's fixed systems, and `author/scene-particles.ts` (a lazy
chunk) draws one instanced quad mesh per admitted emitter from pools allocated once. Bounds: `max` ≤ 4,096 per emitter, default 16
emitters and 4,096 reserved particles per scene (caps 256 and 65,536), 4 bursts per emitter
per step. Overload: full-pool and per-step excess dropped and counted; over-limit emitters
refused and counted by cause (first refusal of each cause per visit reported): refused bursts are dropped, refused one-shots
removed, refused continuous emitters admitted when capacity frees. Particles use their own seeded stream, never
`ctx.random`. Cancellation: visit exit disposes
meshes, geometries and materials and releases texture leases; late textures are released.
Quality: knob `effects.particles` (reference/high 1, medium 0.75, low 0.5) thins
non-essential emitters to a deterministic subset without changing the random stream.
Evidence: unit tests, the recipe's code as a test, and `npm run test:particle-browser`
(desktop headless Chromium, software GL). Status before integration: implemented, candidate; not integrated. No
physical-device, GPU timing, fill-rate or visual-quality acceptance. See the
[guide](particles.md).

Flipbook follow-up (FX-01a): integrated in PR #141 (merge `4c4f156`). `frames` on an emitter's texture
(one draw, one `frame` attribute, 16 × 16 cap, own random stream) and `npm run fx:pack`; evidence and limits in
the [guide](particles.md#flipbooks-sprite-sheets).

Calm follow-up (FX-01b, PR #171): under Calm (reduced motion) non-essential emitters add no particle and live
particles hold still and fade out; essential ones still show, held at the spawn point. Spawn attempts, the particles'
stream and despawn ticks are unchanged (presentation only). Evidence: unit tests and `play:snap -- --calm` on the
explorer and showcase templates (desktop headless Chromium); see the [guide](particles.md#calm-reduced-motion).

## Material options — VIS-04, implemented and checked in PR #127

New `MaterialData` fields `shading` (`'standard' | 'matte' | 'flat' | 'toon'`), `toonSteps` (2…5), `side`
(`'front' | 'double'`), `alphaCutoff` ([0, 1)) and `vertexColors` (default true), with `MATERIAL_SHADINGS`. A
`Material` on a `Mesh` shades it through the same visit surfaces as a `Shape` (a texture is reported once and not
drawn); on a `Model` it overrides the instance's materials, keeping the model's own value for every field left at its
default. Owner: the scene visit (`author/scene-materials.ts`, `author/model-looks.ts`). Bounds: three material classes
and two-valued options (a fixed program set); at most four shared toon gradients; model overrides at most materials ×
looks in use. Overload: none beyond the texture library. Cancellation: visit exit disposes surface, override and
gradient resources; overrides never dispose library textures. Recovery: CPU-side descriptions; programs and the gradient
upload are recreated after context loss. A class change builds one surface and releases the old one (one redraw, at
most one new program). Defaults reproduce the previous materials, so templates draw identically. Evidence: unit tests,
recipe test, `npm run test:material-options-browser`. See the [guide](material-options.md).

## Instanced scatter — VIS-06, implemented and checked in PR #144

New author component `Scatter` with `defineScatter`, `validateScatter`, `SCATTER_DEFAULTS`/`SCATTER_LIMITS`, and the
per-scene opt-in `sceneScatter({ max, instances })`; batching primitive `instanceStatic`; quality knob
`effects.scatter-density` (1/1/0.6/0.35, `reenter-scene`, unwired); `testScene(...).scatter` and the dev
`engine.scatter()` counters, also in `play:snap`'s probe. Owner: the scene visit; the drawing is a lazy chunk loaded
while an opted-in scene prepares. Bounds: 65,536 copies per scatter; 32 scatters and 65,536 copies per scene by default
(caps 256 and 262,144). Overload: refused, counted by cause, first refusal per cause reported; re-offered on a data
change or freed capacity, never per frame. Cancellation: leaving disposes instance buffers and returns geometry and
surfaces. Recovery: CPU-side buffers re-upload after context loss; a failed chunk load is reported and the visit draws
without scatters. Determinism: a derived stream per scatter, never `ctx.random()`. See the [guide](scatter.md).

## Game sound files — DX P1-10, integrated in v0.2.0

`ctx.play(id, options?)` accepts a game sound id as well as a cue id (`PlayOptions`:
`volume` 0…1, `pitch` 0.25…4, `position`); `CueVoiceOptions` gains `rate` and `wait`
(≤ 5 s); `defineScene({ sounds })` preloads; `AudioOutput.preload` and the `audio` probe's
`sounds` counters are new; `audioModule(spatial, { sound, files })` adds the sound-file wiring beside AUD-01's spatial options. Bounds
follow the brief's minimum device (desktop/laptop: 4 MiB per file, 16 MiB encoded and 32 MiB
decoded kept; phone 1/8/16 MiB), decodes admitted only when their estimated decoded size fits
(exact for PCM WAV, 48× the file otherwise), 4 fetches and 2 decodes at once, 256 files with
LRU replacement, 10 s per fetch or decode, waiting plays counted in the 64-voice cap. Held
files decode on unlock. Failures (including an HTML fallback page) are reported once and
retried on the next preload. Integrated in v0.2.0 (PR #37; batch PR #46). Physical
listening evidence is missing.

## Command integrity — SEC-01 slice A integrated in v0.2.0

`createIntegrity` (network kit) separates validity from policy. Pure `assess` rules
judge `{command, state, tick}` and can run inside the authority reducer, so an invalid
sequenced command is consumed as a domain rejection and the client's prediction
reconciles instead of stalling on `gap`. `admit`/`record` apply local policy: decaying
per-key scores, a tick-rate budget on rate admission, throttle, windowed close with the
terminal reason `integrity-violation`, per-rule ceilings and observe mode; the key table
never refuses a new key and the bounded audit log is exportable as local text.
Tick-addressed generic helpers and an `assertDisclosure` test helper are included. The
network workbench wires one plausibility rule behind `--integrity`. Slice A integrated in v0.2.0 (PR #20; batch PR #47). Evidence is unit and loopback host tests only.
Slice B (verified runs through the SIM-01 replay kit, merged in PR #17) is a design in the
[integrity guide](integrity.md#slice-b-verified-runs-planned-not-built), not built.

## Audio-clock timeline (AU-01) — integrated in v0.2.0

Optional [`createAudioTimeline`](audio-timeline.md) makes the audio context's clock
the master timeline for timed gameplay: smoothed audio↔page-clock mapping with
resync on jumps, heard-time latency from `getOutputTimestamp` or reported latencies,
bounded lookahead dispatch with exact start times, late-drop overload, input
timestamps (`ctx.input.pressedAt`) and a stored calibration. It reuses the one audio
output (new read-only `clock()`, scheduled `playVoice({ at })`). Status: integrated in v0.2.0 (PR #31; batch PR #47). Evidence is unit and headless scene tests only;
no browser output timing, physical-device or audible verification.

## Strings select/ordinals/locale chain and dialogue variables (TB-02) — integrated

**Current status (2026-10-03): integrated.** PR #50 (PR merge `d622111`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Status before integration: implemented, candidate on branch `feat/tb02-strings-dialogue` (PR #50); not integrated. Recipes: [plurals, ordinals and variants](../recipes/write-plurals-ordinals-and-variants.md), [branching dialogue](../recipes/add-branching-dialogue.md); [dialogue kit README](../../src/kits/dialogue/README.md).

- Runtime-enforced: message parsing bounds (16,384 UTF-16 units, argument depth 8, 1,024 parts); CLDR plural categories only; `other` required for `plural`, `selectordinal` and `select`; prototype names never match select cases; locale tags Intl does not support (well-formed or malformed) resolve to `en` rules and digits through `supportedLocalesOf`, never the host default; select and plural form tables have null prototypes; locale chain explicit fallbacks, then truncation, then base, at most 8 entries. Dialogue: declared typed variables (≤256), bounded condition trees (≤64 nodes, depth 8), ≤32 assignments per option, type-checked at construction; atomic assignment with the move; `overflow` without change; visit counts saturating; snapshot validation of variables and visits (the current node must have at least one visit; prototype-named node ids keep their counts); first-version snapshots restore.
- Checked: focused unit tests (`src/core/i18n/select-ordinal.test.ts`, `src/kits/dialogue/variables.test.ts`, including a real SaveStore round trip across a fresh store); existing i18n, string-generation, dialogue and expedition tests unchanged and passing.
- Not established: a run-time locale selection author API (the running game stays `en`), translated catalogues for any template, RTL/bidi or CJK line-breaking policy, text speed or typewriter reveal, any browser or device evidence, a template using dialogue variables.

## Interest sets for scoped views (SC-02) — integrated

**Current status (2026-10-03): integrated.** PR #51 (PR merge `f0f020e`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

The optional `spatial` kit adds [`createInterestSets`](interest-sets.md): per-observer,
ranked and budgeted relevancy sets over the SC-01 grid, with enter/exit hysteresis, a
hold, entered/left changes and fail-closed partial scans. A tools-only reference host
feeds NW-02 complete scoped views from them; with complete scans, no frame or revision
reveals activity outside a connection's set (an `incomplete` scan can). Status before integration: implemented, candidate (PR #51); not
integrated. Evidence is unit, reference-host and headless benchmark tests only; no socket,
browser, device or template evidence and no budget change.

## Saveable random state and input history (RNG-01, INPUT-01) — integrated

**Current status (2026-10-03): integrated.** PR #52 (PR merge `2d5f50e`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

`createSaveableRng` (`@engine`) and the optional `@kits/input-history`
([README](../../src/kits/input-history/README.md),
[recipe](../recipes/add-input-history.md)) close two rollback gaps from the
fighting-game genre study: saving random state, and frame-exact buffered and
sequence input. Before integration: implemented, candidate (PR #52,
`feat/rng-state-input-history`). Evidence is focused headless tests and fixed-lane and rollback
consumers; controller and feel acceptance are open.

## Moving platforms — MV-02 integrated

**Current status (2026-10-03): integrated.** PR #53 (PR merge `b6dd99d`) reached `main` through merge-train batch PR #64, merged to `main` at `3b449fa` on 2026-10-03 (main CI run 37082507567 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

`createPlatforms`, `platformSystem` and new `jumpSystem` options (locomotion kit) let creators
add moving support surfaces described as functions of time. Riders follow each tick's exact
displacement. Leaving keeps the platform's velocity per a Godot-style `onLeave` policy, and
platforms are one-way in their own frame. Paths, sizes, speed limits and policies are
creator-chosen and bounded. Implemented as a candidate (`feat/mv02-moving-platforms`,
PR #53), integrated through batch PR #64. Evidence is focused unit tests only. See the
[kit README](../../src/kits/locomotion/README.md#moving-platforms-mv-02), the
[recipe](../recipes/add-moving-platforms.md) and the [ledger](upgrade-acceptance-ledger.md).

## Music on the audio clock (AU-02) — integrated

**Current status (2026-10-03): integrated.** PR #54 (PR merge `0aa5caf`) reached `main` through merge-train batch PR #64, merged to `main` at `3b449fa` on 2026-10-03 (main CI run 37082507567 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Optional [`playMusic`](music-on-clock.md) plays a decoded song on the audio context's
clock: exact start, stop, seek and native loop points, `songTime` for charts, a music
bus following the music volume and mute, music-sized decode bounds per minimum device,
and skip-ahead for late decodes. Status before integration: implemented, candidate (PR #54); not
integrated. Evidence is fake-context unit tests only; no browser, device or audible
verification.

## Newcomer shared session — MP-01 integrated

**Current status (2026-10-03): integrated.** PR #61 (PR merge `41d0261`) reached `main` through merge-train batch PR #64, merged to `main` at `3b449fa` on 2026-10-03 (main CI run 37082507567 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Game code could not import the browser transport and there was no runnable shared
world. `@kits/network` now exports `defineSessionRules` (one pure rules file for page
and host), `createSession` (a per-visit page owner: local play without an endpoint;
otherwise transport, complete views, prediction reconciled on the view sequence and the
host's `processed` count, paced reconnect and terminal close classification, never
resending lost actions) and `createSessionHost` (transport-neutral authority over the
intake, one view publisher per connection, a frame token bucket and integrity in
observe mode). `npm run host` is a development-only loopback/LAN `ws` host that loads a
game's `session.ts`; the `shared-world` template is the representative consumer. No
existing owner changed behaviour. Status before integration: implemented, candidate (PR #61); not
integrated. Evidence is unit, loopback socket and one desktop headless Chromium
two-context check; see the [guide](multiplayer-session.md) and the
[ledger](upgrade-acceptance-ledger.md#newcomer-shared-session-mp-01--integrated).

## Bench dead-window guard (W1-4) — perf gate behaviour change, integrated

**Current status (2026-10-03): integrated.** PR #59 (PR merge `4931e24`) reached `main` through merge-train batch PR #65, merged to `main` at `1f9d10d` on 2026-10-03. Main CI run 37086722080 on `1f9d10d` failed: the arcade template's active bench window drew no frame (perf inconclusive), the ended-visit defect later fixed by PR #75. The next main CI, run 37088378582 on `2fb6e69` (which contains batch 7), passed. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

An active window that draws no frame fails the gate as "perf inconclusive" only when its
held keys drive the scene (`activeKeys` in the scene's `budgets.json` row, or a game or kit
input action bound to them). Keys that press nothing in the game make it a still window,
comparable like an idle one; the expedition template's active windows are of this kind.
A rejected window, an epoch break or an incomplete window stays invalid whatever the keys.
Evidence: unit tests (`window-class`, `input-registry`, `bench-keys`) and a local expedition
gate run; GitHub CI `check` passed on PR #59 before batch integration.

## Spatial audio sources and occlusion (AUD-02) — integrated

**Current status (2026-10-03): integrated.** PR #55 (PR merge `87c1a20`) reached `main` through merge-train batch PR #65, merged to `main` at `1f9d10d` on 2026-10-03. Main CI run 37086722080 on `1f9d10d` failed: the arcade template's active bench window drew no frame (perf inconclusive), the ended-visit defect later fixed by PR #75. The next main CI, run 37088378582 on `2fb6e69` (which contains batch 7), passed. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

| ID | Contract | State |
|---|---|---|
| AUD-02 | Optional `@kits/spatial-audio` over the integrated AUD-01 voices: bounded logical sources tracked without voices (virtual) until they rank, importance ranking (class × creator `importance()`) with fade-out stealing under hysteresis, fair rotation of equal scores (starvation credit across dropped emissions) and lateness drops, a voice cap that counts fading voices, HRTF claims for `localise` classes within a kit limit (with hysteresis), per-class distance curves with a hard cutoff and air low-pass, and occlusion through a creator `(from, to) => distance \| null` query (the camera kit's `obstruction` shape) under `raysPerPump`, stalest first, with aged results, driving the output's smoothed filter. [Kit README](../../src/kits/spatial-audio/README.md) | **Integrated 2026-10-03** (PR #55 merge `87c1a20`, batch PR #65, `main` `1f9d10d`). Before integration: implemented, candidate (public PR #55). Node unit tests and `npm run test:audio-browser` (kit over the real output in `OfflineAudioContext`, muted browser: occlusion ~24 dB at 3 kHz without steps, steal fades without a cut) pass on the branch. Re-verification fixes (fair rotation, cap including fades, `stats.rotated`, rays for new emissions at a budget of 1, honest `stale`/`unqueried`, HRTF hysteresis) have Node regressions that fail on the previous head `a95497e`. Round-3 fixes (a cut voice's replacement always starts, rotation opt-in and off by default, least-recently-served fairness, priority for free slots, HRTF cap counting fading voices, no voice leak on re-entrant cancel; seeded fuzz of the caps and leaks) have Node regressions that fail on `9eb9612`. Round-4 fixes (nothing plays late by default, opt-in `carryLate` bounded to one interval, honest `dropped`/`late`/`skipped` stats, HRTF cap never delays a repeat, reservation timeout after admission, rotation inside the 1% band) have Node regressions that fail on `158ff29`. Round-5 fixes (late `carryLate` emissions may rotate in again within their one-interval bound, a 64-setup fairness table test, lateness epsilon, docs on late starts after hitches) have Node regressions that fail on `be71bc7`. No template consumer. No listening trials, real level geometry or query cost, propagation, device cost or networking claim. |

## Large edited worlds — GEN-02 integrated

**Current status (2026-10-03): integrated.** PR #56 merged directly to `main` at `2fb6e69` on 2026-10-03; main CI run 37088378582 passed on that merge. The recipe's data-loss pattern (acknowledging a revision read after the await) was corrected by PR #95 (`0a09710`, main CI run 37150583760 passed) with the regression `GEN-02 acknowledging a pending save retains edits made after submission`. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

GEN-02 adds a bounded binary record store for edited worlds beside the save store.
`src/core/save/chunk-port.ts` is the only IndexedDB user (lint rule `indexed-db`).
`chunk-store.ts` owns:
- atomic multi-record writes with in-transaction revision checks;
- the creator's schema number;
- CRC-32 quarantine before any overwrite;
- bounded limits and opt-in least-recently-used eviction;
- a `session` memory fallback when IndexedDB is unavailable.

`createCellEdits` in the procgen kit stores only the cells that differ from content
regenerated by GEN-01. Status before integration: implemented, candidate (PR, `feat/gen02-chunk-store`);
not integrated. Evidence is focused tests over an in-repo IndexedDB fake and one desktop
Chromium real-IndexedDB check. See the [recipe](../recipes/store-large-world-records.md)
and the [ledger](upgrade-acceptance-ledger.md).

### Orphan import receipt correction — integrated

**Current status (2026-10-03): integrated.** PR #77 merged to `main` at `24d7512`; the required `check` passed on the PR head, and the first completed main CI containing it, run 37148687488 on `5b12552`, passed. The evidence below remains MemoryBackend scope; no browser or physical durability acceptance is added by integration.

The existing SaveStore now distinguishes exact retention, conflicting destination
bytes and storage failure, with known writes completed before orphan receipts.
No snapshot API or format migration is included. Six focused regressions cover
both payload locations, duplicate/conflicting bytes, denied reads/writes and retry,
canonical-id known/orphan overlap, pending writes and notification-time owner
registration. Four of these fail against the unchanged public implementation.
A review follow-up keeps renamed sections round-tripping: export no longer writes a
registered section's stale alias key as an orphan, and an alias orphan beside its
section in one file reports `orphan-superseded` instead of rejecting the file. Four
more regressions (rename/export/fresh import, newer alias-only payload, alias orphan
beside the section, genuine conflict and retry beside a rename) fail on the first
candidate; all 57 store tests pass under Node 22.23.3. This is MemoryBackend evidence, not browser or
physical durability acceptance; hosted integration checks were then still required (see current status above). See
[the import recipe](../recipes/add-a-save-section.md#6-report-orphan-import-outcomes)
for the expanded result union and recovery boundaries.

### Author scene DPR-only redraw — integrated (PR #83), 2026-10-03

**Current status (2026-10-03): integrated.** PR #83 merged to `main` at `5b12552`; the required `check` passed on the PR head and main CI run 37148687488 passed on `5b12552` (all jobs and the aggregate `check`). The browser evidence below stays scoped to source `422975c`; no physical-device acceptance.

The focused `fix/author-dpr-redraw` candidate connects the existing quality owner's
resize notification to the visit-owned author resize callback. It guards retired
visits and removes the listener on cleanup. Existing quality defaults, creator
profiles and on-demand rendering semantics are preserved.

Evidence: eight focused resize/cleanup tests and a clean-source browser run at
`422975c43904037e7895a5ebe96a4a9913f45b4c` passed. A quality DPR change with unchanged
CSS produced one redraw and then idle rendering; the unchanged public runtime
reproduced the missing redraw. See the [contract](render-resize-lifecycle.md) and
[source-scoped receipt](../verification/dpr-redraw-20261003.md). The receipt is candidate-source
evidence; it is not a full local gate or physical-device acceptance.

### Creator-selectable render backend (ADR 0078) — decision recorded, 2026-10-03

[ADR 0078](../adr/0078-creator-selectable-render-backend.md) supersedes ADR 0034.
WebGL2 stays the default backend; WebGPU becomes an opt-in, creator-selected and
lazily loaded backend. The default changes only by a later author decision when the
ADR's five measured criteria (C1–C5) hold. This entry records the decision and the
narrowed `three-webgpu` lint (allowed only under `platform/render/backends/webgpu/`,
banned in the rest of the engine, kits and game code).

**Renderer seam (plan step 1), candidate.** The renderer pool, the stage role and the
snapshot role now create renderers and contexts and handle object tracking, loss and
readiness through a `RenderBackend` interface. The WebGL2 backend
(`src/platform/render/backends/webgl/`) is the code the pool used to run inline,
moved without change. `defineBuild({ render: { backend } })` selects the backend and
defaults to `'webgl2'`. `'webgpu'` is refused as "not available yet" by the brief and
at boot. See the [render backend guide](render-backend.md).

Evidence:
- The picture guard in `identical` mode gave the same sha256 for base and head on
  blank (`main`) and explorer (`garden`, `shed`).
- The software-GL bench gave the same mean and max draws on all eight templates.
  Averaged triangle counts and idle windows varied within base's own run-to-run
  spread.
- The `runtime` chunk grew by at most 446 B raw.

There is still no WebGPU backend, per-backend budget, WebGPU tooling or device
evidence.

## Scene look — VIS, in progress

Optional, per-scene visual capabilities on `@engine` data (the [scene look guide](scene-look.md)):

- **Output (VIS-01), integrated (PR #124, merge `522815f`).** `view.output` gives a scene tone mapping (`'none'`, `'aces'`,
  `'agx'`, `'neutral'`) and an exposure in (0, 16]. Owner: the scene visit, through the renderer lease profile.
  Defaults are a fresh renderer's own values, so the picture guard reports identical pictures for templates that do
  not opt in. A run-time change draws one frame; an invalid value is reported once and the last valid output stays.
  Evidence: unit tests and `npm run test:output-browser` (desktop headless Chromium, software GL). No physical-device
  or HDR acceptance.
- **Local lights (VIS-02), integrated (PR #138, merge `ef0d1bb`).** `PointLight` and `SpotLight` components claim fixed per-visit
  slots from `sceneLights({ point, spot })` (at most 16 and 4); the rig never changes size, so no program recompiles
  on spawn or despawn. Overflow is refused essential-first then in spawn order and reported once per cause; the
  `lights.local-max` knob (16/8/4/2, unwired) caps slots per kind. Evidence: unit tests and
  `npm run test:lights-browser` (desktop headless Chromium, software GL). No budget row for slots and no physical-device
  fill-rate evidence.
  Follow-up (PR #172): a non-essential light refused only by the quality tier is cause `tier`, reported once at
  info level (designed behaviour, never a page error); an essential light refused stays `full`, an error.
- **Shadows (VIS-03), integrated (PR #148, merge `e84afcf`).** `sceneShadows()` opts a scene in (shadow map through the lease
  profile, PCF); the sun casts with `directional.shadow`, local lights with `shadow: true`, and `Shadow` overrides an
  entity. Shadowed local slots are fixed per visit and bounded by `lights.shadowed-max` (4/2/1/0, unwired); maps
  redraw only on change through the existing scheduler. Evidence: unit tests, `npm run test:shadows-browser` and a
  courtyard bench (`shadowCasters` measured for an opted-in scene). The bench also counts `shadowPasses` (one per
  map face; sun 1, point light 6) and every template budgets it; light refusal counters count lights, not reports
  (D4 shadow cost accounting). No physical-device evidence.
- **Sky and haze (VIS-05), implemented and checked (candidate PR #150).** `defineEnvironment({ sky })` draws a gradient with an optional
  sun-like discs and stars from one CPU-generated texture on an unlit sphere (no custom shader, backend-neutral);
  `haze` gains `{ kind: 'exp2', density }` and `color: 'sky'`. Evidence: unit tests and `npm run test:sky-browser`
  (desktop headless Chromium, software GL). No physical-device evidence.

## Asset provenance and AI disclosure — DX-03, implemented

- **Records and check.** Every model, texture and sound under a game's `public/` needs a provenance record (origin,
  author, licence, source, SHA-256; tool, model, prompt or reference and human edits for AI origins).
  `lint:provenance` in `npm run check` warns by default; `defineBuild({ assets: { provenance: 'required' } })` makes it
  an error. **Disclosure.** `npm run disclosure` drafts Steam and itch.io AI-disclosure text from the records, with
  development tooling kept apart from content players see. Evidence: focused tests and `npm run check`. Tooling only;
  no store-acceptance or licence-truth claim. [Guide](asset-provenance.md).


## Service assignment experiment — isolated candidate, 2026-10-09

`tools/service-assignment-lab/` contains an unexported bounded ownership prototype with service-request and weighted-worksite fixtures. It demonstrates exclusive actor claims, generation-scoped token refusal, capacity admission, atomic failed-transfer preservation, bounded explicit retry withdrawals and disposal. It adds no installed kit, scheduler, thread, persistence adapter or product API. [Contract and limitations](service-assignment-lab.md).

Evidence: 15 focused Node tests passed, including a 600-command independent allocation model and 1000 admission/removal cycles; both Node fixtures ran, and `npm run check` passed with the one prototype test file selected (15/15). Integration gates, browser behavior and physical-device performance are not accepted by this evidence. This entry records a branch candidate, not integration or production readiness.


## Optional assignment kit candidate — ASG-01, 2026-10-09

The independently implemented `@kits/assignments` helper graduates the service/worksite ownership mechanism into a typed optional public surface. It retains bounded actors, targets, weighted claims and retry counts, preserves existing claims on failed transfer, rejects retired tokens, and supports explicit disposal. Existing navigation/command/save/inventory owners keep their responsibilities; no matching policy, global scheduler or persistence format is added. The original lab now imports the kit through two consumer modules. [Contract](assignments.md).

Evidence: 23 focused tests passed (8 typed kit/consumer tests plus 15 retained lab regressions), including real route-owner cancellation, stale result rejection, an independent allocation model and bounded churn. `npm run check` passed with 27/27 tests across four selected files, and the migrated demo ran successfully. This is a local candidate; hosted/full integration gates, playable consumers and browser/physical-device acceptance remain pending.

## Editable itinerary experiment — candidate, 2026-10-09

[Lab contract](itinerary-lab.md): bounded order edits preserve the active cursor;
opaque attempts reject late/replayed completion. Nineteen headless tests and scoped
controller typechecking passed. Unexported prototype; no navigation/scheduler owner
added, no production persistence or browser/device acceptance. Not integrated.

## Public itinerary helper — graduation candidate, 2026-10-09

ITINERARY-01 exposes createItinerary from @kits/itinerary with caller-owned lifetime
and no registration or execution owner. The lab now consumes this implementation.
Base: reviewed prototype e7aa2e55; branch feat/itinerary-kit. Twenty-four focused
tests and scoped strict typechecking passed, including a real SaveStore/fresh-store
round trip. This supersedes the prototype's unexported status, not its evidence
limits. No full gate, browser, durable custody transaction or physical-device claim;
not integrated. See the [contract](../../src/kits/itinerary/README.md).

### Interaction alignment prototype — 2026-10-09

Unexported planar alignment candidate: [contract and limits](interaction-alignment-lab.md). Creator-owned poses, clock and clearance assertions; bounded approach proposals and identity-checked prepare/acknowledge tickets. Observed drift revokes prepared tickets even during paused or zero-duration calls. Ten focused tests pass; independent review completed. Hosted integration CI is pending. No collision oracle, movement owner, public kit export, performance claim or physical-device acceptance.

## Planar alignment public kit candidate — 2026-10-09

The earlier unexported experiment is graduated in this candidate to optional `@kits/alignment` (ALN-01), reusing frames identity validation without installing a system or requiring kit registration. It provides bounded target-relative proposals and exact-ticket acknowledgment; creators retain movement, clearance, eligibility, clock and effect ownership. Lab consumers now use the kit; no duplicate tool implementation or new installed system remains. Public yaw matches author Y rotation, with focused frame-composition coverage. Evidence: 15 focused headless tests, isolated typecheck and formatting. Full CI, browser/runtime playability, physics, save composition and devices remain unverified; this does not establish integration. [Contract](../../src/kits/alignment/README.md) and [consumer guide](interaction-alignment-lab.md).

### Acceptance evidence prototype — 2026-10-09

Local unexported development candidate: [contract and limits](../../tools/acceptance-evidence/README.md). Required-case/minimum-sample admission with explicit failure statuses and bounded JSON CLI; real replay and historical-save consumer tests. Seven focused tests passed locally, including CLI negative cases. Existing test glob includes the regressions; complete hosted CI is pending. No engine runtime API, new scheduler, performance claim or physical-device acceptance.

### Combined optional-helper implementation — 2026-10-09

This combined implementation supersedes the earlier lab-only export status: assignments, itinerary and alignment are public optional pure helpers; the lab fixtures consume those helpers. Acceptance reporting remains a development-only tool. Historical candidate evidence above is retained as history, not a claim of current integration. [ADR 0080](../adr/0080-optional-interaction-ownership.md) records ownership and limitations. Full hosted CI on the combined candidate is the integration prerequisite; physical-device and concrete-game acceptance remain unverified.

## Visibility contributions — VISIBILITY-01 candidate, 2026-10-09

[Contract](../../src/kits/visibility/README.md), [decision](../adr/0081-visibility-contributions.md), [discussion #198](https://github.com/Akilleez-QA/foundation-engine/issues/198). Pure optional per-observer cell contributions with atomic replacement, stale calculation refusal, explored history and bounded coalesced draining. Creator geometry, relationships and disclosure remain external. Evidence: focused lifetime/refusal/drain tests, two distinct headless sensor/facility consumers and a 600-command set-union/history model. Validation: eight focused tests and scoped strict typechecking pass; `npm run check` passes all steps and 12 selected tests across three files. Candidate only; no integrated game, full CI, browser, save or physical-device acceptance claimed here.

## Weighted choice/history — candidate, 2026-10-09

Existing procgen helper extension; ADR0082 proposed. Ten focused tests pass, including
endpoint/no-draw/refusal/eviction and saved RNG/history continuation via real SaveStore.
Two headless consumers; no browser/full-gate/device claim. See [contract](weighted-choice.md).

## Timed contribution checkpoint candidate (2026-10-09)

The existing capabilities owner now exposes separate portable checkpoint/restore.
Configured base and bounds, saved time and ordered contributions validate before a
single modifier transaction; successful load retires old runtime handles. Seven
focused new tests exercise continuation, malformed/overflow atomicity, safe batch
aggregation and real SaveStore failed-write recovery. See
[timed contribution continuation](timed-effects.md#portable-continuation).
This is a local candidate pending independent review and complete integration CI;
no whole action-session persistence or device-performance acceptance is implied.

## Recurring phase lab candidate (2026-10-09)

The [unexported recurring phase lab](../../tools/recurring-lab/README.md) tests
explicit skip/coalesce/bounded-replay policies while reusing the existing clock
and SaveStore. Thirteen headless tests cover two consumer projections, pause,
mid-period reload, large jumps, stale callbacks, reentry and failed durability.
It is a composition experiment, not a public scheduler or whole-game persistence
claim. Callbacks stage state without storage writes; explicit host save boundaries flush.
Production integration still needs coordinated clock/consumer restore, full CI and creator acceptance.

### Integrated ownership helpers and continuation candidates — 2026-10-09

[PR #197](https://github.com/Akilleez-QA/foundation-engine/pull/197) integrated
assignments, itineraries, planar alignment and development acceptance reporting
at main commit `5b26285da7ba1f75fef5bf3c47df115331da8b69`.
[Full candidate CI](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37886326403)
passed on reviewed head `e10f0ef54535a737455757c9366a78f76b4bf2db`.
This supersedes earlier entries' “not integrated” status for that batch only;
it does not add concrete-game or physical-device acceptance.

The follow-up condition and recurring-phase experiments remain unexported.
They compose existing equipment/modifier/save and clock/save owners respectively.
Separate agent reviews and thirteen focused tests per experiment passed.
The combined follow-up candidate also retains real-owner regressions for failed
scene preflight and queued action delivery. These exercise headless ownership
boundaries; production scene wiring and physical resource reclamation are not
certified. Full CI on the combined candidate remains required before integration.

### Integrated continuation and diagnostic boundary fixes — 2026-10-09

[PR #213](https://github.com/Akilleez-QA/foundation-engine/pull/213) integrated
the unexported condition and recurring-phase compositions, shared dependency
preflight ownership regression, and queued action-delivery regression at main
`0a873d2070fecf605c25e0f9b98dee0f4a5f26d7`.
[Candidate CI](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37889789566)
completed successfully on `1961cc0638cf76385aa17f50b61700ff64c78517`.
This closes the earlier integration-pending status for that batch, not its
concrete-game or physical-device acceptance questions.

[PR #218](https://github.com/Akilleez-QA/foundation-engine/pull/218) integrated
frame identity and adapter caching, camera reset admission, decoder retirement
accounting, replay numeric validation and script observation matching at main
`0214411f89badbefabc16712039967b7799fc37a`.
[Candidate CI](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37891867717)
completed successfully on `1cfece534241c563be5ebc6f2ffffcfc8dc16db8`.
The combined candidate preserved the independently reviewed component files and
passed 331 affected tests locally. Decoder admission and retained-byte accounting
do not establish a browser native-heap ceiling.

These receipts cover those merged batches only. Resource-observation failure
reporting is a subsequent candidate; further source coverage, application wiring,
device experience and physical reclamation evidence remain separate obligations.


## Fixed-step numeric admission candidate (2026-10-09)

The existing core runner now rejects nonfinite configuration/frame inputs and unsafe
step-count or frame/step/drop-counter arithmetic before frame work. Zero step budgets
remain valid; finite negative deltas retain their fixed-lane clamp and presentation
value. Step-relative tolerance replaces the absolute seconds tolerance, preventing
phantom ticks for tiny steps. See [the system recipe](../recipes/add-a-system.md#core-runner-numeric-boundary).
Targeted tests cover ordinary30/60/144Hz, tiny/subnormal steps, zero budgets, retained
phase after refusal and overflow. This is a numeric-boundary candidate, not full
engine, browser or physical-device acceptance; hosted integration remains required.

### Resource-observation failure reporting integrated — 2026-10-09

[PR #219](https://github.com/Akilleez-QA/foundation-engine/pull/219) integrated
resource capture rejection and script, snapshot, and batch failure evidence at main
`6dfbcf944098afe96daf79e468decda1516102eb`.
[Candidate CI](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37893991051)
completed successfully on `82bb981bf927dc038025cb916da516ba3005415f`.
This closes the earlier resource-observation integration-pending statement.
Failed capture stops the affected script; incomplete snapshots retain partial
evidence; report-write failures retain prior causes and the in-memory report.
This receipt does not certify every diagnostic caller, physical-device behavior,
or completion of the wider engine work. The fixed-step numeric candidate above
still requires CI on its combined head after integration with this base.


## Optional shared-session liveness — candidate (2026-10-09)

The existing session client accepts paired connection/host deadlines and the host
can refresh its existing one-credit view on ping. Defaults remain unchanged; no
new timer or protocol owner. See [the contract](multiplayer-session.md#optional-host-liveness).
Focused unit and real loopback acceptance is recorded in the upgrade ledger;
independent review and full hosted integration CI remain required.


## Editable-focus keyboard retirement candidate (2026-10-09)

The existing document input bridge selectively retires prior non-inText keyboard
work when editable focus begins, including queued actions and reentrant press
completion. Explicit text actions and non-keyboard sources retain their policies;
no new owner or global cancellation is introduced. See the input README for
recovery and focus-event limitations. Dispatcher and bridge regressions cover
selectivity, stale repeats, fresh presses and listener retirement. This is a
candidate; full hosted integration and physical-device acceptance remain separate.


## Atomic cell batches and occupancy candidate (2026-10-09)

Optional procgen batch edits and immutable spatial point/rectangle/segment queries
reuse existing storage and lifetime owners. See [contract and evidence](cell-occupancy.md)
and ADR0085. Configured limits and exact contact ordering are runtime contracts;
focused geometric, persistence and consumer tests are candidate evidence. Hosted
full CI, browser/GPU and physical-device acceptance are not established here.
No new scheduler, material policy or whole-engine completion claim.


## Shared navigation distance-field candidate (2026-10-09)

The optional navigation helper prepares immutable multi-goal distances and acyclic
next hops over existing directed weighted graphs. Reverse adjacency, search and
output publication are incrementally budgeted; graph admission and storage setup
remain explicit synchronous preparation. It installs no scheduler or movement
policy. Independent integer-graph oracles and two activity-lifetime compositions
exercise cancellation and stale publication; floating accumulation order is
documented separately from forward route parity. See the navigation README.
Full hosted integration and physical-performance acceptance remain separate.


## Ordinary image mip accounting correction — candidate (2026-10-09)

Ordinary 2D image estimates now sum the full RGBA8 mip chain using integer
dimensions with independent axis clamping. Thin images no longer use the
undercharging four-thirds approximation. The existing model owner refuses an
over-budget thin image, retires its resources, and permits a valid retry.
Compressed accounting is unchanged; no-mip images retain conservative full-chain
charging. Cube, array, volume, authored mip and non-RGBA8 descriptor support remain
explicit accounting limitations. See [asset residency](asset-residency.md).
Focused and affected checks plus independent review are required before hosted
integration; no physical memory or device evidence is implied.

## Data-defined formulas (FORMULA-01) — candidate, 2026-10-09

Optional `formulas` kit ([contract](../../src/kits/formulas/README.md), [ADR 0098](../adr/0098-data-defined-formulas.md)): validated JSON/text expressions, ordered sheets, stacking stages and a damage model; deterministic arithmetic and caller-supplied randomness. Evidence: eleven focused headless tests (parsing, refusal, ordering, seeded/restored streams, stacking, damage pipeline, 2,000-case named-preset transcription check, review-hardening cases); one independent adversarial review with its findings addressed. Candidate only; no game integration, browser, full CI or device acceptance claimed.
