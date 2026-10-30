# Update cadence

Choose `@kits/cadence` when not every member of a large population needs work every fixed step: distant agents can
think every eighth tick, idle ones every sixty-fourth, while the near and the busy run every tick. The
[kit contract](../../src/kits/cadence/README.md) lists inputs, outputs, bounds, overload and evidence. The helper is
optional and installs nothing.

## Choose the existing owners

- Time: drive it from an ordinary fixed-lane system with your own integer tick counter. It never reads a clock, so
  replays and `?seed=` runs stay deterministic. Integrate motion or needs by `elapsed` ticks, not by one step.
- Policy: periods are creator choices. Change them with `setPeriod` when a member crosses a distance band or changes
  state. For jitter, draw from `ctx.random()` and pass the result as a period or phase.
- Population: add members when entities spawn, become relevant ([interest sets](interest-sets.md)) or wake, and
  remove them when they despawn or sleep. Removing a member is the cancellation.
- Persistence: store `snapshot()` in a save section and `restore` it after loading to continue the exact schedule, or
  re-add members to start fresh. Runtime results are not save data.

## Choosing limits

`maxDuePerTake` bounds the work of one step. A `deferred` status means more members were due than the budget allowed;
they are served first next time and their `late` grows. If it persists, lengthen periods or raise the budget with
the author's agreement. Phases default to the id, so a batch spawned together, or switched to a new period together, does not wake together.

## Evidence and limits

Headless tests only: an independent per-tick scan model comparison, an ECS fixed-step consumer and an interest-set
consumer. Integer ticks, per-member periods, earliest-due-first order. No browser, device or multiplayer acceptance.
