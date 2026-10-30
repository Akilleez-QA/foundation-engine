# Inspect authored progression choices

The optional progression adapter can explain its own eligibility and skill-derived grant sources. It does not decide whether a creator's combined inventory, receipt, permission or save transaction is acceptable.

```ts
import {inspectProgressionChange, deriveProgressionGrantSources} from '@kits/capabilities';

const check = inspectProgressionChange(accepted, {kind: 'learn', skill: selectedId}, rules, bounds);
if (!check.ok) {
  // Invalid state/rules/command or unknown identity: do not present an eligible choice.
  showDiagnostic(check.reason);
} else {
  showFacts(check.facts);
  showProgressionEligibility(check.eligible, check.reason, check.blockers);
}
const acceptedSources = deriveProgressionGrantSources(accepted, rules, bounds);
```

`inspectProgressionChange` accepts the same state, command, rules and bounds as `prepareProgressionChange`. Both use the same assessment. Inspection captures caller data once and returns detached frozen facts; it changes no state and does not charge balances. An `ok: true` inspection means the command is understood, **not** that it is eligible. Check `eligible`. Invalid inputs return `ok: false` with the existing failure reason; arbitrary exceptions thrown by caller getters still propagate, just as they do during preparation.

For learn/surrender, facts include the selected id, learned state, named balance and authored cost, allocation costs/current limit, learned count/limit, missing prerequisites and directly learned dependents. For earn/spend, facts include the named balance, maximum balance and requested amount. These are accepted-state facts. A surrender's `xpCost` describes the authored learning cost; surrender still refunds allocation only, never spent XP.

`blockers` contains the applicable progression failures in the existing admission order. `reason` is its first entry or `null`. Learn checks already learned, prerequisites, learned-count limit, allocation, then insufficient XP. Surrender checks not learned then dependents. Bounds, rules and saved-state validation precede command assessment. Inspection does not repair invalid saved state or change existing first-failure behavior.

Use creator-selected labels for ids and explain this adapter's policies explicitly. Revalidate against the accepted document ticket before publishing a coupled candidate: a frozen inspection is a stable old observation, not an authorization or a stale-safe transaction handle.

## Grant contributors

`deriveProgressionGrantSources` returns frozen rows of `{kind, id, skills}`. `kind` is `certificate` or `schematic`; identical ids in those two domains remain distinct. Rows are ordered by kind (certificates first), then id; contributing skill ids are sorted. Each row contains only currently learned contributors. The same captured learned/rules traversal constructs these rows and the union returned by `deriveProgressionGrants`.

Derive sources from accepted state for accepted labels. Derive them from a successful candidate's state for explicitly labelled preview labels. Do not present candidate contributors as already possessed. Removing one learned contributor leaves the grant if another learned skill supplies it. Previously returned rows remain unchanged after later preparation or mutation of caller objects.

External, equipment, tutorial and migration facts are not included. Keep their provenance in the creator's existing accepted envelope and explicitly combine it with skill-derived facts. The general capability owner stores one possession/provenance record per capability; repeatedly granting the same id from different sources does not turn it into a reference-counted source collection.

All traversal and output sizes follow the caller's existing progression bounds: skills, prerequisite references, total grant references, learned count and XP types. Inspection adds no hidden cap, clock, global owner or polling. Grant-source derivation retains the existing strict restore behavior and throws on invalid inputs. Neither API deduplicates accepted events or provides persistence; those remain enclosing-world responsibilities.
