# Explain accepted derived values

`createModifiers(base).explain(stat)` reports why one accepted stat has its current value. It uses the same evaluator as `values()`, source replacement and removal. This optional query changes no values, clocks, ownership, resource admission or persistence.

```ts
const stats = createModifiers({ pace: 10 });
stats.set('equipment', [{ stat: 'pace', add: 2, multiply: 2 }]);
stats.set('environment', [{ stat: 'pace', add: 3, multiply: 0.5 }]);
const explanation = stats.explain('pace');
// base: 10, additive: 5, multiplier: 1, value: 15
```

The formula remains `(base + additive) * multiplier`. All additions accumulate together and all multipliers accumulate together; the rows do not describe sequential transformations of the result. Sources use the existing sorted-id order and contributions preserve their authored array order, including floating-point behavior. No rounding, clamping or formula policy is added.

The result contains `stat`, `base`, `additive`, `multiplier`, `value` and `contributions`. Each contribution contains `source`, `row`, `stat`, `add` and `multiply`. `row` is the original index in the source's entire captured contribution array, including intervening contributions for other stats. Filtering does not renumber it.

Only strings are accepted as queries. Unknown strings return `null`; other argument types throw without string coercion. Returned facts, arrays and rows are frozen and detached from future updates. A saved explanation remains a historical snapshot after a source is replaced or removed. It is not a revision ticket authorizing an operation.

Explanation allocation occurs only on request. A single-stat query can return at most the admitted source count multiplied by 64 contribution rows. This is a count bound, not a byte limit: existing source/stat identifiers and creator-selected source capacity retain their existing contracts. There is no new hidden base-stat cap, paging rule or truncation. Creators choose which stats to inspect and how to format/localize source labels.

## Timed source provenance

`createTimedEffects(...).explain(stat)` adds `now`, the owner's accepted time, and enriches each contribution with `key`, `handle`, `expiresAt` and `effectRow`. Its numeric result comes from the same modifier evaluation; provenance is mapped onto those exact rows rather than recomputing arithmetic.

- `row` identifies the contribution in the complete flattened accepted modifier array.
- `effectRow` identifies the original contribution within its effect's full array.
- `key` and `expiresAt` are captured accepted effect facts.
- `handle` is deliberately the **exact frozen live handle** returned by that owner. It can be passed to that owner's `cancel`. It is the exception to detached identity: cloning `{serial}` or restoring that serial in another session does not recreate cancellation authority.

Equal-key stacked effects remain distinguishable by their handles. Replacement changes the accepted rows; old snapshots remain unchanged. Effects with no contribution to the requested stat do not produce trace rows, so an explanation is not a full effect inventory; use `snapshot()` for that.

Expiry occurs only when the creator advances the owner. If advancing time would overflow the remaining aggregate, the operation throws and retains the previous time, effects, values and explanation. An explanation must not display the attempted future time or pretend refused expiry succeeded. The creator chooses recovery, such as cancelling a different contribution or clearing the complete set before advancing again.

These APIs explain numeric derivation and accepted source facts. They do not infer game causality, alter a current resource quantity when a capacity changes, choose expiry policy, or persist state. Consumers should use the existing accepted-state and save owners, and present accepted memory separately from durable saves.

Focused tests cover hand-calculated aggregate arithmetic, original indices across mixed stats and equal-key effects, immutable old snapshots, input mutation/reentry, uncoerced queries, deterministic source ordering, removal overflow and refused expiry. Browser presentation and device-specific usability are separate consumer acceptance.
