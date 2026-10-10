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
tick and aborts a running child that a higher-priority child pre-empts), `parallel` (`succeed` / `fail`: `all` or
`any`; failure wins a tie; all children finished without meeting `succeed` is failure), `shuffle` (a selector whose
order is drawn from the tick's random source at activation, optionally weighted). Decorators: `invert`, `succeed`,
`fail`, `repeat` (`times`, or `null` = until the child fails, then success; one child run per tick), `retry`
(`times`; one attempt per tick), `timeout` (`ticks` since activation, then abort the child and fail), `cooldown`
(fails for `ticks` after its child finishes), `guard` (a condition checked every tick; false aborts the child and
fails). Leaves: `action` (handler returns `success` / `failure` / `running`; optional `abort`), `condition`
(handler returns a boolean), `wait` (`ticks`), `set` (write a blackboard key), `check` (compare a blackboard key:
`eq`, `ne`, `lt`, `le`, `gt`, `ge`, `exists`, `missing`). Any node may have a `name` for traces; leaves may carry
one scalar `args` value.

## Runtime

- `tick({now, random?, trace?})`: `now` is a non-negative integer tick that never decreases (the kit does not
  read clocks). Each node is visited at most once per tick, so the work is bounded by the tree size plus handler
  cost. Handlers see `ctx.first` (true when the leaf starts, false when it resumes), `ctx.get/set/delete` on the
  blackboard and `ctx.random()` (the tick's source; `ctx.random` from the scene gives replayable runs).
- Memory and blackboard changes of a tick publish only when it completes. A throwing handler restores both and
  rethrows; side effects the handlers already made (including abort handlers) are theirs. Calling the runtime from
  inside a handler throws (no reentry).
- `abort(now)` stops everything running (scene exit, despawn, new orders), calling abort handlers depth-first.
- `set/get/delete/blackboard()` let sensors and orders write the blackboard between ticks. Values are JSON
  scalars (finite numbers, strings ≤ 1,024, booleans, null); keys are names; at most `maxKeys` (default 256).
- `running()` lists the remembered nodes (the resume chain). `trace` lists every node completed, still running or
  aborted this tick, in completion order.
- `snapshot()` / `restore(raw)`: plain data with the tree signature, agent, clock, blackboard, per-node memory
  (cursor, counts, activation tick, shuffle order, parallel results) and cooldowns. Restore validates all of it,
  including that remembered nodes form ancestor chains, before replacing anything. Handlers keep any state of their
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
