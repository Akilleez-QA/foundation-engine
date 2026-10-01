# Objectives

Optional count-based objectives with run identity, event deduplication, cancellation and separate reward delivery. `objectives()` registers the kit; `createObjectiveRun` is a pure helper with no frame system, rendering, inputs or storage. It complements `learn` lessons and `explore` interactions: the game translates meaningful completed actions into objective events. It does not count button presses as evidence of learning automatically.

```ts
import { createObjectiveRun, objectives } from '@kits/objectives';
const options = {
  runId: 'survey-session-17',
  requirements: [{ id: 'samples', event: 'sample-collected', target: 3 }],
};
const run = createObjectiveRun(options);
run.record({ runId: options.runId, eventId: 'sample-42', event: 'sample-collected', amount: 1 });
```

Use a fresh stable run ID when restarting. Each event has a stable ID across delivery retries. The same ID with changed data reports `conflict`; another run reports `stale`; an unknown event reports `unmatched`. Counts saturate at their targets. A cancelled run cannot progress or award a reward; a complete run cannot be cancelled. `progress()` returns detached requirement/count records. No age, difficulty, reward or penalty policy is embedded.

`claimReward(attemptId)` returns `{claimId, attemptId}` only after completion. The claim ID stays the same across retries and reloads. Supply a fresh attempt ID for each delivery attempt. After delivery, `acknowledgeReward(attemptId)` accepts only the currently pending attempt; late acknowledgements do not finish newer attempts. Use `claimId` as the idempotency key in the reward sink (for example an inventory transaction ID). Delivery is not atomic with this helper or with external services. An acknowledged claim cannot be claimed again.

## Existing save integration

Store `snapshot()` in a game-owned `defineSaveSection` alongside the relevant run definition, and restore through `createObjectiveRun(options, raw)`. Its constructor validates version, requirements, event history, cancellation and reward eligibility, and copies accepted data. In a section's `parse`, return `createObjectiveRun(options, raw).snapshot()`. No additional save store or global progress section is created. Keep IDs stable and version/migrate changed requirements explicitly; a snapshot for a different definition is rejected.

When reward inventory and acknowledgement must be coherent, keep both snapshots in **one existing save envelope** and update that envelope together. `SaveStore.batch` is scheduling, not cross-section atomicity. Inspect save status; successful in-memory completion does not prove durable storage. A remote reward sink must enforce claim deduplication itself.

Cost: zero draws/triangles and no idle work. Recording is O(requirements), snapshots and restores are O(events × requirements) in the worst case; accepted event IDs are retained for retry protection. This initial helper is for bounded game sessions, not an unbounded analytics log. Retire whole completed runs under an explicit save retention policy; do not discard event IDs while late retries remain possible. No quest graph, dialogue interpreter, UI or network authority is implied.

`maxEvents` defaults to 10,000 accepted events per run. Admission returns `saturated` at the bound while existing retries remain deduplicated. Choose run sizes within this limit; do not prune event IDs during a run. A snapshot exceeding the configured bound is rejected.

For explicit finite multi-stage composition, see [staged objectives](../../../docs/guides/staged-objectives.md).

Input capture reads each supplied event/requirement field once and uses indexed
array entries, ignoring caller-overridden array methods. Invalid array lengths
reject before iteration; event history still uses the configured `maxEvents`.
Reentrant mutation from caller getters throws without changing accepted run state.
The original flat requirement-definition API has no separate count cap; creators
should bound their definitions. Staged definitions retain their existing explicit
stage, requirement, choice and event limits. These checks are not a sandbox for
arbitrary getter side effects or a CPU deadline.
