# Status effects

Optional kit (`status()`, no dependencies, no systems, no rendering). One owner holds the active statuses and
immunities of many targets on one fixed clock: stacks, durations, decay, periodic pulses, thresholds that transform
one status into another or fire a trigger, exclusive groups, immunities and save/restore. The creator owns what a
status means (damage per pulse, speed changes, what a trigger does); the kit owns timing, order and bounds.

```ts
import {createStatusEffects, defineStatusRules, statusPresets} from '@kits/status';

const rules = defineStatusRules([...statusPresets.buildup, ...statusPresets.damageOverTime]);
const statuses = createStatusEffects(rules, {maxTargets: 256, maxPerTarget: 16});

// A fixed system (60 Hz): one tick per run. Events tell the game what to resolve.
for (const event of statuses.advance(1)) {
  if (event.kind === 'periodic' && event.id === 'poison') hurt(event.target, 3 * event.stacks);
  if (event.kind === 'triggered' && event.trigger === 'ignite') burst(event.target);
}
statuses.apply('crate-7', 'chill', {stacks: 25, source: 'frost-trap'}); // { outcome, events }
statuses.flags('crate-7'); // ['disarmed', 'immobile'] while frozen
statuses.contributions('crate-7'); // [{key: 'moveSpeed', value: -0.1, source: 'status:chill'}]
```

## Rules (`defineStatusRules`)

Each definition: `id`; `maxStacks` (1–65,535; 1–256 with independent timers); `duration` in ticks or `null`
(until removed); `policy` for re-application — `refresh` (reset to now + duration), `extend` (add duration, capped
at `maxDuration`), `keep` (first expiry stands) or `independent` (each stack its own timer; at the cap a new
application refreshes the oldest timer); `decay` (`{every, stacks}`: lose stacks every N ticks since the last
change, removed at zero); `period` (a `periodic` event every N ticks after first application); `threshold`
(`{stacks, become?, becomeStacks?, trigger?, consume?}`); `tags`; exclusive `group` with `groupPolicy` `block`
(default) or `replace`; `flags`; `contributes` rows (`{key, value, perStack?}`); `afterImmunity`
(`{ids?, tags?, ticks}` granted when the status ends by expiry, decay or threshold consumption, not by manual
removal or replacement). Up to 256 definitions. Unknown `become`/immunity targets and transform cycles are refused.
`rules.signature` identifies the normalised rules.

## The owner (`createStatusEffects`)

- `apply(target, id, {stacks?, source?})` returns `{outcome, events}`. `immune`, `blocked` (exclusive group) and
  `capacity` change nothing. A threshold fires on reaching its stack count: it emits `triggered`, removes the status
  when `consume` (default), emits `transformed` and applies `become`. If the target is immune to `become`, nothing
  transforms and the stacks stay capped. With `consume: false` the threshold fires again on each later application
  at or above it.
- `advance(ticks = 1)` (≤ `maxAdvance`, default 600) moves the clock. Per tick, targets and statuses in id order:
  periodic pulse, independent timers, decay, expiry, then immunity expiry. A pulse and the expiry on the same tick
  both happen (pulse first). The whole advance is applied to a copy and published only if it completes.
- `remove(target, id, stacks?)`, `cleanse(target, tag)`, `setImmunity(target, {key, ids?, tags?, ticks | null})`,
  `clearImmunity`, `removeTarget` (cancellation: no events, no after-immunity).
- Reads: `stacks`, `has`, `list`, `immunities`, `isImmune`, `flags`, `contributions`, `targets`, `now`.
- `snapshot()` is detached plain data (version, rules signature, clock, every target); `restore(raw)` validates all
  of it (rules signature, fields, ranges, timer order, groups, bounds) before replacing anything.

## Composition

- Contributions map onto the formulas kit's stacking (`{stage: row.key, value: row.value, source: row.source}`) or
  the capabilities kit's modifiers. The status owner never changes another owner's values.
- Periodic and trigger events are facts for the game to resolve (damage through a formulas model, an area query,
  a sound). Persist the snapshot in the same save section as the state those consequences changed.
- Time is the caller's tick count: drive `advance(1)` from a `fixed` system so `?seed=` replays line up.

## Bounds, overload and failure

Defaults: 1,024 targets (≤ 65,536), 32 statuses and 32 immunities per target (≤ 256), 600 ticks per advance
(≤ 3,600). Work per tick is O(active statuses + immunities); events per tick are at most four per active status
(a transform chain adds at most one per definition). Overload is explicit: `capacity` outcomes or `false` from
`setImmunity`; after-immunities that would exceed the per-target bound are skipped. Invalid ids, stacks, ticks and
unknown statuses throw `StatusError` without changing state. A target with no statuses and no immunities is
forgotten.

## Presets

`statusPresets.damageOverTime` (independent poison stacks), `buildup` (chill → frozen transform with after-immunity,
burn → `ignite` trigger), `exclusiveAilments` (one major ailment at a time, collectible-RPG archetype) and
`controlImmunity` (stun with diminishing-returns immunity, extendable haste). Ticks assume 60 Hz. Copy and rename the
vocabulary to the game's. The numbers are tuning starting points, not any game's tables.

## Limitations

No rendering, UI or networking. Turn-based games can call `advance(1)` per turn; random durations (a sleep lasting
1–7 turns) are the caller's draw passed as an application followed by `remove`, not a built-in rule. A snapshot
restores only into an owner with identical rules; migrating saved statuses across rule changes is the game's job.
Evidence is headless tests; no game, browser or device acceptance is claimed.
