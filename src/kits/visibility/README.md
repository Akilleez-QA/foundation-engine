# Visibility contributions

Optional pure `createVisibility` from `@kits/visibility`. One scene-owned instance combines source contributions for one observer/team over integer cells. Current visibility means at least one accepted source covers a cell. Explored history remains after the last source leaves. Creators supply geometry, occlusion, relationships, source lifetimes, and authority; this helper does not decide what data may be disclosed to a client.

```ts
import {createVisibility} from '@kits/visibility';
const view = createVisibility({cellCount: 64, maxSources: 8, maxCellsPerSource: 16, maxDrain: 8});
const added = view.addSource();
if (added.status === 'added') {
  const calculation = view.begin(added.source);
  if (calculation.status === 'prepared') view.replace(calculation.ticket, [0, 1, 8]);
  view.removeSource(added.source);
}
view.cell(0); // {cell: 0, visible: false, explored: true}
view.dispose();
```

`begin(source)` retires the previous calculation while retaining accepted coverage. `replace(ticket, cells)` atomically publishes copied cells and consumes the exact ticket. Late, copied, foreign, removed-source and consumed tickets are stale. Generation numbers are diagnostic, not sufficient authority. `cancel(ticket)` revokes pending work without changing coverage; callers also cancel their actual worker/search. `removeSource` revokes both contribution and pending calculation. Recovery starts another calculation or source.

Replacement accepts dense plain arrays of distinct integer cells in `[0, cellCount)`, in any order. It reads own indexed data without invoking accessors or custom iterators; unrelated properties are ignored and never retained. Invalid cells/duplicates throw, an oversized array returns `saturated`, and both preserve accepted coverage and the pending ticket. A newer `begin` intentionally revokes an older ticket even if its eventual replacement fails. Configuration is captured by declared fields. Arbitrary getters/proxies in configuration and hostile proxy traps are outside this ordinary data contract; mutation reentrancy is refused.

`cell(id)` returns a detached frozen state. `resetExploration()` forgets only currently uncovered cells, so visible always implies explored. `drain(limit)` returns at most the requested bound of coalesced current cell states in first-change order, not an event history or a frame snapshot. Changes while a cell is pending overwrite its eventual reported state; draining a cell permits it to be queued again. Initial cells are all false and not dirty. One presentation consumer owns draining; multiple consumers must fan out its results or use independent mirrors. Queries remain coherent even when nothing drains.

Limits are required positive safe integers: `cellCount <= 2^20`, `maxSources <= 4096`, `maxCellsPerSource <= cellCount`, `maxSources * maxCellsPerSource <= 2^22`, and `maxDrain <= cellCount`. Counters cannot overflow because sources are bounded. Fixed arrays use 10 bytes per cell; retained accepted source arrays use at most 4 × sources × cells-per-source bytes, plus bounded object/map overhead. Each replacement allocates one additional bounded cell array and sorts it; work is O(k log k + old k). Reset and disposal scan the cell domain; drain is O(limit). Result and ticket allocations are bounded per call, not allocation-free hot-path promises. Caller-retained handles/results and instance count require scene-level budgets.

Source saturation is recoverable after removal. Generation exhaustion refuses new sources/calculations without revoking accepted state; removal, cancellation and disposal remain available. Dispose is terminal/idempotent, clears source/ticket maps and cell contents, and makes queries return undefined. Its fixed buffers remain allocated until the owner is garbage-collected. No timer, renderer, scheduler, RNG, save section, frame hierarchy, worker, networking or registration is installed.

Spatial interest still selects ranked entity relevance; navigation still owns routing; UI still presents state. Use creator geometry to map positions to cells. Persist exploration only through a creator-owned versioned save section if needed; no snapshot/restore contract or durable ticket is supplied. Do not infer collision, line of sight, security, playable quality, or device performance from this helper.

Evidence: overlap/refusal/lifetime/drain tests, a 600-command set-union/history model, and two headless consumers in `tools/visibility-lab`: sensors retain exploration, facilities require current service coverage. These are fixtures, not integrated game features. See [ADR 0081](../../../docs/adr/0081-visibility-contributions.md).
