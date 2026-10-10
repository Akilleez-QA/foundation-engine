# Behaviour trees

Optional kit (`behavior()`, no dependencies, no systems). A tree is plain data validated into a frozen node table;
each agent gets its own runtime with a blackboard and resumable memory. The creator supplies leaf handlers
(actions and conditions) and decides when an agent thinks; the kit owns evaluation order, resume, abort, bounds and
saveable state.

```ts
import {createBehavior, defineBehaviorTree} from '@kits/behavior';

const tree = defineBehaviorTree({
  type: 'selector',
  reactive: true, // re-check higher-priority branches every tick
  children: [
    {type: 'sequence', name: 'respond', children: [
      {type: 'check', key: 'alert', op: 'eq', value: true},
      {type: 'timeout', ticks: 300, child: {type: 'action', action: 'approach'}},
    ]},
    {type: 'repeat', times: null, child: {type: 'sequence', children: [
      {type: 'action', action: 'moveToNextPoint'},
      {type: 'wait', ticks: 60},
    ]}},
  ],
});
const agent = createBehavior(tree, {
  actions: {
    approach: {tick: ctx => (arrived(ctx.agent) ? 'success' : 'running'), abort: ctx => stop(ctx.agent)},
    moveToNextPoint: ctx => (ctx.first ? start(ctx.agent) : moving(ctx.agent) ? 'running' : 'success'),
  },
}, {agent: 'guard-3'});

// In a fixed system, on the creator's think schedule:
agent.set('alert', sensed);
const {status, trace} = agent.tick({now: tickCount, random: ctx.random, trace: debugging});
```

## Nodes

Composites: `sequence`, `selector` (resume at the running child; `reactive: true` restarts from the first child each
tick; when a higher-priority child pre-empts a running one, the new child is ticked first and the old one is aborted
after it, in the same tick), `parallel` (`succeed` / `fail`: `all` or
`any`; the policy is checked after each child, so once it is decided no later child starts that tick; failure wins a
tie; all children finished without meeting `succeed` is failure), `shuffle` (a selector whose
order is drawn from the tick's random source at activation, optionally weighted). Decorators: `invert`, `succeed`,
`fail`, `repeat` (`times`, or `null` = until the child fails, then success; one child run per tick, so a finished
run leaves a `running` gap tick before the next), `retry` (`times` is the total number of attempts, one per tick),
`timeout` (`ticks` since activation, then abort the child and fail), `cooldown` (after its child finishes on tick
T, fails without ticking the child on ticks T+1 … T+`ticks`; `ticks` ≥ 1), `guard` (a condition checked every tick; false aborts the child and
fails). Leaves: `action` (handler returns `success` / `failure` / `running`; optional `abort`), `condition`
(handler returns a boolean), `wait` (`ticks`), `set` (write a blackboard key), `check` (compare a blackboard key:
`eq`, `ne`, `lt`, `le`, `gt`, `ge`, `exists`, `missing`). Any node may have a `name` for traces; leaves may carry
one scalar `args` value.

## Runtime

- `tick({now, random?, trace?})`: `now` is an integer tick in 0..2^52 that never decreases (the kit does not
  read clocks). Each node is visited at most once per tick, so the work is bounded by the tree size plus handler
  cost. Handlers see `ctx.first` (true when the leaf starts, false when it resumes), `ctx.get/set/delete` on the
  blackboard and `ctx.random()` (the tick's source; `ctx.random` from the scene gives replayable runs).
- Memory and blackboard changes of a tick publish only when it completes. A throwing handler restores both and
  rethrows; side effects the handlers already made are theirs. Abort handlers are queued during the tick and called
  only after it commits (against the committed blackboard), so a rolled-back tick never stops work that it then
  resumes; if an abort handler throws, the others still run and the first error is rethrown after the commit.
  Calling the runtime (including its reads) from inside a handler throws: use the leaf context. A context only works
  during its own tick or abort phase; a stashed context throws afterwards.
- `abort(now)` stops everything running (scene exit, despawn, new orders), calling abort handlers depth-first.
- `set/get/delete/blackboard()` let sensors and orders write the blackboard between ticks. Values are JSON
  scalars (finite numbers, -0 stored as 0, strings ≤ 1,024, booleans, null); keys are names; at most `maxKeys` (default 256).
- `running()` lists the remembered nodes (the resume chain). `trace` lists every node completed, still running or
  aborted this tick, in completion order.
- `snapshot()` / `restore(raw)`: plain data with the tree signature, agent, clock, blackboard, per-node memory
  (cursor, counts, activation tick, shuffle order, parallel results) and cooldowns. Restore validates all of it
  before replacing anything, including that it is a state a tick can leave: remembered nodes form ancestor chains,
  a composite remembers exactly the child at its cursor, a running parallel remembers exactly its pending children
  and is undecided, decorators remember their child, only actions and waits stay running as leaves. Handlers keep any state of their
  own in the blackboard or in the game's own saved state.

## Bounds and cost

Trees: ≤ 1,024 nodes by default (≤ 16,384), depth ≤ 64 (≤ 256), ≤ 64 children per composite. Repeat/retry counts ≤
1,000,000. A tick allocates small per-tick copies of the memory and blackboard; budget agents per tick with a think
schedule (for example a per-member update cadence) rather than ticking thousands of agents every frame. No
pathfinding, perception or steering: those are handlers over the navigation, spatial and character kits.

## Limitations

Handlers are creator code: the kit cannot bound their CPU, memory or side effects. The tree is static per runtime
(rebuild the runtime for a new tree; restore refuses a snapshot of a different tree). No utility scoring, planning
or goal decomposition is built in; a utility selector can be an action that writes a choice to the blackboard.
Evidence is headless tests; no game, browser or device acceptance is claimed.
