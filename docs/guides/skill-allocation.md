# Persistent skill allocation

The creator requested reusable typed XP, skill learning, hybrid professions and
respecs. `src/kits/capabilities/progression.ts` extends the optional capabilities kit
with pure candidate transforms. It does not change `createCapabilities`, its
privileged grants, or its evidence/possession semantics. The public game barrel and the isolated
`@foundation-engine/pure/capabilities` package export this optional contract.

## Authoring and ownership

`ProgressionRules` supplies an identity, allocation ceiling, named XP types with
balance caps, and skill definitions. Each skill names one XP type and cost, a point
cost, prerequisite skill IDs, certificate IDs and schematic IDs. Costs and balances
are nonnegative safe integers. XP earn/spend amounts must be positive safe integers.
Zero-cost skills and empty rules are supported. Grants are opaque authored IDs;
this helper neither looks up equipment nor manufactures recipes.

Skills form a validated DAG. Every prerequisite and XP type must exist; duplicate
IDs, duplicate entries within a skill's lists, and cycles fail admission. A skill
may require several branches. Shared grant IDs across skills are intentional.
Authored skills whose costs exceed a cap remain valid but cannot currently be
learned; no automatic cost adjustment occurs.

A profession is a creator-authored preset of skill IDs or a suggested learning
path, not an exclusive class field. A hybrid character learns from several paths
under the same point ceiling and typed XP balances. The helper does not apply a
preset automatically, grant prerequisites, or spend currencies across types. The
world can prepare a sequence on a local candidate and publish once if every step
succeeds, with its own bounded command count.

The enclosing world is the accepted-state owner. Store `ProgressionState` inside
its existing save section/envelope, alongside its revision and bounded command
receipts. Do not mirror these skill grants into a second independently mutable
possession owner. `deriveProgressionGrants` is a computed view of learned skills
only. The world combines that view with equipment, tutorial, job and other grant
sources according to its own provenance rules.

## Candidate API

- `parseProgressionRules(raw, bounds)` validates and detaches authored data.
- `createProgressionState(rules, bounds)` creates a version-1 empty character with
  an explicit zero balance for every declared XP type.
- `parseProgressionState(raw, rules, bounds)` strictly validates and detaches a save.
- `prepareProgressionChange(state, change, rules, bounds)` prepares one command and
  returns either `{ ok: true, state, grants }` or `{ ok: false, reason }`.
- `deriveProgressionGrants(state, rules, bounds)` returns sorted, unique certificate
  and schematic arrays. They are recomputed, never persisted as additional truth.

Commands are `earn`/`spend` with `xpType` and `amount`, or `learn`/`surrender` with
`skill`. Learning checks all prerequisites, the learned-record bound, allocation
and available XP before charging. A repeated learn is rejected, not charged again.
Surrender refuses a skill that any remaining learned skill directly requires;
valid saved prerequisite closure also protects all transitive dependents. Surrender
refunds point allocation only. Spent XP stays spent, including after reload and
relearning. A shared grant remains until its final granting skill is surrendered.

Example candidate preparation, inside the enclosing world command handler:

```ts
import { prepareProgressionChange } from '@foundation-engine/pure/capabilities';

const candidate = prepareProgressionChange(world.progression,
  { kind: 'learn', skill: selectedSkill }, authoredRules, progressionBounds);
if (!candidate.ok) return candidate;
// Reconcile equipment/job eligibility and record the accepted command receipt
// together with candidate.state in the world's existing atomic acceptance path.
```

**Earn and spend are not idempotent.** Preparing twice against the same base yields
two equivalent candidates; applying the same earn against an advanced state earns
again. The enclosing world must authenticate the event, deduplicate it, verify the
expected revision and durably publish all coupled consequences. This module has no
receipt ledger, event subscription, global state, persistence adapter or authority
to decide whether an activity deserves XP. No API-level event ID implies a guarantee
that the helper cannot enforce.

## Restore, bounds and failure

State stores `version`, `rulesId`, typed XP rows, learned IDs and `spentAllocation`.
Restore requires every declared XP type exactly once, valid balances and skills,
prerequisite closure, and an exact sum of learned point costs within the ceiling.
It rejects extra JSON fields and malformed/sparse arrays. The definition and state
IDs must match. Authors must change the rules identity and explicitly migrate when
changing meanings, prices or dependencies; this helper cannot detect changed
content dishonestly published under the same identity. Migration and quarantine
use the existing world/save owner. No silent reset or loss of progression occurs.
Restore verifies structure and consistency, not historical proof of earned XP.

`ProgressionBounds` caps XP types, skill definitions, total prerequisite references,
total grant references across both grant lists, and learned skill records. Zero
limits are valid. IDs have a 256-code-unit limit. All counters/caps are safe integers;
addition uses remaining-capacity comparisons so overflow is rejected before it can
round. Grants derived from a valid state cannot exceed the authored grant-reference
bound. There is no history or per-frame work. Per command, validation is proportional
to admitted definitions/references/state, plus canonical sorting. DAG validation is
iterative, including for deep trees. These are configured work/retention bounds,
not a wall-clock deadline or an authorization boundary.

All outputs are detached. No input objects are retained or deliberately modified.
Parsers throw validation errors; candidate preparation converts those validation
errors into failure reasons and leaves the input state intact. Exceptions thrown by
caller-defined getters/proxies propagate; unrelated caller side effects are not
rolled back. Use serialized/plain data at the boundary. The helper has no pending
work to cancel: discard a candidate on stale revision, owner retirement or failed
publication. The world must reconcile active jobs/equipment and persistence failure
before making a respec visible.

## Evidence and limits

`src/kits/capabilities/progression-allocation.test.ts` exercises hybrid branches,
shared grants, dependent respec denial, XP non-refund/relearning, full JSON reload,
wrong XP type, allocation/record caps, safe-integer boundaries, malformed restores,
sparse arrays, caller iteration hooks, zero-cost skills and a 12,000-node DAG.
Every successful test transition is revalidated after JSON serialization.
`scripts/package-pure.test.mjs` also packs and installs the artifact in an isolated
consumer, exercises earn/learn/reload/surrender, and checks the published types
without Three or the Foundation runtime. Existing
capability revocation tests retain their separate semantics.

This is a pure reusable contract. There is no character menu, authored profession
catalog, save migration, multiplayer authority or physical-device acceptance here.
A consumer must prove its world-level receipt and publication boundary, coupled
job/equipment reconciliation, and accessible learn/respec workflow separately.
