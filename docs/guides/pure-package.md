# Optional pure kit package

Creator requirement: independent games can reuse bounded Foundation data owners without
installing its scene runtime, renderer, input loop or persistence store. Existing
`@kits/<name>` imports retain registration and scene adapters. The separate local-only
`@foundation-engine/pure` package has explicit subpath exports and no aggregate entry.

| Export | Public mechanisms |
| --- | --- |
| `/inventory` | Material batches, ledger transactions, checkpoints, retirement and qualified IDs |
| `/resources` | Deposit sampling, surveys, suitability, production and materialization owners |
| `/capabilities` | Evidence/grants, revocation, modifiers, action runs and timed effects |
| `/equipment` | Item-instance equipment owner and snapshots |
| `/housing` | Structure authority, permissions, placements, occupancy and packing |
| `/authoring` | Bounded authored documents, preparation/publication and edit sessions |
| `/metadata.json` | Source revision, content digest, dirty-input flag, compiler and source list |

Factories and their exported types are the same implementation used by stock kits.
Registration functions and `resourceProductionSystem` are intentionally available only
through stock kits. Package consumers supply their own lifecycle, clock and persistence.
This delivery does not extend production recipes, dynamic construction, interior modeling,
character stat pools or cross-owner transaction semantics.

## Build and pin

Run `npm ci`, then `npm run package:pure`. An optional positional output directory is
accepted after `--`. The build typechecks the complete source closure, emits native ESM
and declarations, and rejects external dependencies, runtime/author imports and dynamic
imports. It packs locally with scripts disabled; it never publishes to a registry.

Artifacts default to ignored `dist/pure/`. The tarball filename includes its SHA-256 and
is never replaced. Its adjacent JSON receipt includes npm SHA-512 integrity, source
revision, complete source-content digest and whether relevant inputs were dirty. Use a
clean committed build for handoff. Builds contain no timestamp and repeat identically
for identical source, revision, compiler, npm version and dirty status.

Copy the tarball into the consumer's tracked vendor directory, install that exact local
file with `npm install --save-exact ./vendor/foundation-engine-pure-<sha256>.tgz`, and commit
the consumer manifest and lockfile. Preserve its receipt. Verify the SHA-256 and npm
integrity before adoption. No mutable checkout link, network registry or second runtime
is needed. GPL-3.0-only licensing and LICENSE are preserved.

```ts
import { createInventoryLedger } from '@foundation-engine/pure/inventory';
const inventory = createInventoryLedger({ capacities: { cargo: 32 } });
```

## Ownership and failures

The consumer owns each factory result and explicitly chooses when to construct, advance,
snapshot or retire it. Existing configured limits, result unions, cancellation/disposal
and restore validation remain unchanged; declarations describe individual contracts.
No package background clock, global owner or persistent writer is introduced. Timed
effects are in-memory owners, not a new persistence contract. Coupled changes across
owners still require a consumer transaction coordinator. Publish only after the consumer's
durable commit succeeds; a local owner mutation does not guarantee durable storage.

Packaging owns only its temporary staging directory, removed on success or failure. A
compile/dependency/pack failure produces no replacement artifact; retry starts fresh.
The package is bounded by its explicit six entrypoints and their verified source closure.

## Acceptance

`node --test scripts/package-pure.test.mjs` builds and installs the actual tarball into
an isolated temporary consumer, imports all six APIs under native Node ESM, compiles a
NodeNext TypeScript consumer, compares inventory restore/retry behavior, checks artifact
repeatability and rejects an injected runtime dependency. Existing kit regressions verify
the preserved registration paths. These checks certify the package boundary, not a
downstream game's full integration, save migration, browser experience or device performance.

## Industrial candidate chains

`createIndustryCandidate(source, bounds, {maxCommands: 4096})` validates and captures one industrial state and numeric bounds. `apply(command)` isolates the command and returns a state-free transition receipt; failed commands never change private accepted state. Every attempt consumes one configured admission slot, including rejected attempts. After the limit, commands return `candidate-limit`. Reentrant commands return `busy`; disposed chains return `retired`. `snapshot()` returns detached data and throws while busy/retired; `dispose()` releases the candidate state. Creation and throwing caller getters may throw without publishing state. Command admission reads only known schema fields; construction containers, phase lists and bills are length-checked before bounded indexed capture. Unknown fields and arbitrary extra object graphs are never cloned or enumerated.

The consumer owns this short-lived candidate during preparation of one durable world transaction. It supplies bounded clock commands; no timer, persistent writer, receipt history or background scheduler is created. Commit one detached snapshot through the surrounding world; on cancellation or failed preparation discard this chain. Exact storage retry uses the world's staged snapshot, not a rerun of these commands. Retained memory is bounded by the captured industry/stock limits; work per command follows the existing transition bounds. These are work-count limits, not frame-time promises.

The standalone `prepareIndustryCommand` remains a full-validation API. Both paths use the same transitions, retaining custody/phase/capacity validation for stock changes and full final-state validation for construction. Private copy-on-write machine/deposit records avoid reparsing the catalogue on every work tick; no public trusted-state switch exists. Consumer timing still needs measurement for the authored colony and scheduling cadence.


## Crafting candidates

The optional resources entry exports `resolveCraftSlots`, `beginCraftExperiment`,
`applyCraftExperiment`, `lockCraftManifest` and `parseCraftManifest`. Inputs are a
versioned `CraftRecipe`, exact slot/container/batch quantities, the current dimensional
stock plus its bounds, and `CraftBounds`. No registry, clock, random source, inventory
owner or save writer is installed. Returned candidates are detached; locked manifests
are recursively frozen. Existing kit registration imports remain available.

A slot names accepted material families, its integer unit and required quantity.
Admission resolves exact identities and checks aggregate source availability across
slots. Subsequent experiment restoration checks immutable batch facts, not remaining
source quantities: the enclosing game has already reserved or consumed those units.
The game must commit reservation/assembly stock changes and experiment state together;
calling `beginCraftExperiment` alone does not reserve anything. Before commitment the
game can release reservations; after commitment cancellation follows the authored
prototype/scrap policy, never an implicit refund from this helper.

Relevant material properties are integer scores 0–1000. Each weighted property first
uses the floor of its quantity-weighted slot mean, then recipe weights combine those
means with integer floor rounding. Weights are positive integers. This is authored
arithmetic, not a physical material model. Attribute values start at the configured
fraction of their ceiling. Each step spends positive points, with an effect exactly
matching the recipe's authored `effectPermille`; callers cannot choose success strength.
There is no RNG. The enclosing authority captures the skill-derived point budget,
bounded by the recipe point limit, and must validate its own actor/worksite/version
rules. A transcript is consistency data, not proof that a user-edited save was authentic.

Output mass, packing volume and integer properties use authored affine models:
`base + sum(floor(attribute * coefficient / 1000))`. Intermediate mass arithmetic uses
BigInt; final values must be nonnegative safe integers, and primary mass positive.
One primary unit plus an exact integer quantity of named scrap must conserve selected
input mass. Manifest compilation produces an `IndustrialPlan` with exact input batch
IDs, fixed output metadata and authored work/power. Native industry reservation and
completion supply powered repetition; no cycle rerolls the product. Existing batch
ID conflicts and output batch capacity bounds reject compilation. Restoring a manifest
reconstructs values, recipe inputs, mass, scrap and output properties instead of trusting
stored derived fields. The enclosing game validates dynamic plan admission and IDs.

Configured limits bound slots, selections, attributes, weights per attribute, points,
steps and output properties. Runtime ceilings additionally cap slots at1024, selections
at4096, attributes/properties at128, weights at4096 and points/steps at1024. Oversized
arrays reject before indexed entry capture; unknown object graphs are not copied.
Invalid input, overload, exhausted points, locked edits or incompatible metadata throw
without publishing changes. These are work-count limits, not elapsed-time guarantees.
Exact persistence retry must reuse the enclosing world's prepared snapshot rather than
rerunning a new crafting action. Retirement of manifests remains the game's job and must
preserve references from live stock, equipment, active work and installed hardware.
