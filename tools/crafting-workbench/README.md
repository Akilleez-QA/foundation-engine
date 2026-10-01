# Crafting workbench

Optional desktop diagnostic at `tools/crafting-workbench/index.html`. The creator
owns recipe policy, materials, experiment coefficients, clocks, power, storage,
quality and device choices. This sample installs no global crafting or stock owner.

Open the workbench with keyboard or pointer. Native recipe controls expose slot
materials/unit/quantity, attribute weight mappings, initial/gain/effect permille,
point limit and output affine terms. Advanced JSON supplements these fields.
Validation and isolated evaluation precede commit; undo/redo and explicit recipe
saving remain separate from production. A schema-valid recipe can be incompatible
with the sample ingredients; the preview reports that without reserving stock.

The production pane selects exact quantities from two source containers. A runtime
candidate captures the committed recipe and selected batch facts, reserves units
in holding custody, and publishes only after durable readback. The UI exposes
experimentation, manifest locking, explicit machine assignment, caller-fed work,
capacity changes, stock transfers and cancellation. A failed write retains the
exact candidate and old visible custody; retry and acknowledgment are separate.
Editing the recipe cannot rewrite accepted sessions. Sample units, shapes and
controls are replaceable creator policy, not a universal economy or quality score.

The survey pane uses the existing `createSurvey` through a scene-owned observation
lease: 64 points maximum, eight per explicit step. It checks current accepted spawn
facts/incarnation and expiry before and after work. Replacement, cancellation and
retirement invalidate retained callbacks. A survey does not harvest; explicit
harvest commands use the runtime's own identity and stock authority. Current spawn
remaining stock and historical harvested batches are distinct facts.

Only accepted stock is projected into native ECS shapes. Source, holding, machine
and output lanes show container/batch quantities. The disclosed reading sheet
pauses rendering; closing it resumes the scene. Exit retires observation and
controller lifetimes. Within the same app visit, exit retains the runtime owner’s
authentic single-consumption continuation token; return consumes it to preserve the
last accepted custody and any exact pending candidate. Dirty SaveStore memory is
not silently adopted on reentry. Retry may establish durable bytes, but visible
acceptance still requires acknowledgment. The token is not serialized: a full page
reload follows actual durable state and rejects incoherent recovery. Both recipe and
runtime use independent guarded SaveStore keys; no cross-section transaction,
distributed authority or cross-process compare-and-swap is claimed.

Selected surface: desktop keyboard/pointer at 1440×960. This does not establish
phone/tablet layouts, physical controllers, accessibility completeness, thermal
performance or sustained GPU timing. The tool is absent from ordinary player entry.

Run `node scripts/play/crafting-workbench-check.mjs`; evidence is written under
`playtest/crafting-workbench`. The runner uses native controls, independent integer
mass/weighted-value assertions and actual ECS projections. Its source being present
is not evidence of a passing browser run. The first exploratory run exposed a wrong startup route; a later run exposed a
runner trying to edit a closed disclosure. Both failures are retained under
`playtest/crafting-workbench-exploratory`, `playtest/crafting-workbench-startup` and
`playtest/crafting-workbench-route-repair`. After explicit sample routing and the
native disclosure interaction were repaired, the exploratory desktop workflow
passed in `playtest/crafting-workbench-disclosure-repair`; recipe and accepted-output
screenshots were inspected. Four focused observation-lease tests also pass. This
was exploratory evidence while runtime repairs continued. After the runtime repair
and authentic scene-continuation wiring, the full native workflow passed at
`74454ab` with no page or console errors; evidence is in
`playtest/crafting-workbench-continuation-74454ab`. The failed-write → scene exit →
return → retry → acknowledgment regression compares accepted custody and actual
ECS projections, and its reentry screenshot was inspected. The final formatted candidate `790aaea` passed the native workflow and all seven
template gates (1,871 tests), then integrated in PR #118 at `1c177d5` after combined
main tests/build. The subsequent shared startup repair removes the explicit route
workaround; its browser acceptance is tracked separately.
See [recipe workbench](../../docs/guides/recipe-workbench.md) and the
[acceptance ledger](../../docs/guides/upgrade-acceptance-ledger.md) for current status.
