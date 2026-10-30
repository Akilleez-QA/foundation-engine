# kits/perception

Optional perception helpers that feed decisions without making them: sight and
hearing strengths, per-agent awareness with alert levels and memory, squad shared
knowledge, cover selection and utility scoring. Pure functions and small stateful
objects: no system, timer, geometry, renderer or behaviour tree. A behaviour tree,
state machine or system reads the facts they produce. Guide:
[perception](../../../docs/guides/perception.md).

```ts
import { createAwareness, sightStrength, hearingStrength } from '@kits/perception';
const mind = createAwareness();
// Each think step (seconds):
const s = sightStrength({ range: 20, fov: 2 }, eye, player, (a, b) => !blocked(a, b));
mind.update(now, [{ target: 'player', kind: 'sight', strength: s, position: player }]);
mind.write(runtime); // any { set(key, value) }: perception.alert, perception.target, perception.x, ...
```

| Contract | Definition |
|---|---|
| Sight | `sightStrength(spec, eye, target, clear)` returns 0 at or beyond `range` and outside the `fov` cone. A target within `near` is noticed even outside the cone, at `edge` strength. It also returns 0 when the creator's `clear(from, to)` reports an obstruction (for example a volume-query sweep or a ray). Otherwise it returns (1 − d/range) × an angle factor that falls from 1 at the centre to `edge` at the cone boundary. `clear` is called at most once, and only when the result would otherwise be above 0. |
| Hearing | `hearingStrength(listener, sound, {distance?, attenuation?})` returns (1 − d/loudness) × attenuation. `distance` may return a travel distance (for example from a navigation field), or null when the sound cannot reach the listener; an answer shorter than the straight line is treated as the straight line. `attenuation` returns [0, 1] (for example per closed door). Sounds beyond loudness in a straight line return 0 without calling either query. |
| Awareness | `createAwareness(options)` keeps up to `maxTargets` (default 32, max 256) per agent. **Inputs:** `update(now, stimuli)` takes nondecreasing seconds and at most 256 stimuli. **Growth and decay:** sight adds `sightRate × strength × elapsed` and squad reports `reportRate × confidence × elapsed` (the strongest of each per target, so several eyes or reporters do not add up). Each sound adds an impulse, so submit a sound once, when it happens. At most `maxStep` seconds (default 1) of rate gain are credited per update, so update at least that often for rate-independent gains. Unseen targets lose `decay × elapsed`. An invalid stimulus refuses the whole update with no change. **Levels:** `unaware`, `suspicious` and `alerted`, each with separate enter and leave thresholds (hysteresis). **Memory:** last-known position (sight first, then the loudest sound; a report only when its `time` is newer than the agent's own last direct perception), where and how strongly it was last perceived directly, and the times of the last stimulus, the last direct perception (sight or sound) and the last sight. Unaware targets are forgotten `forgetAfter` seconds after their last stimulus. When memory is full, a newcomer replaces the least aware target only if it would be more aware; otherwise it is dropped. `update` returns how many targets were lost either way. **Outputs:** `facts(prefix)` and `write(sink, prefix)` give flat scalar facts for a blackboard: alert, target, awareness, visible, x/y/z and seenAgo. |
| Squad | `createSquadKnowledge({maxTargets, maxAge})` keeps the newest report per target (newest wins even when weaker). `share(reporter, awareness)` copies suspicious and alerted targets that the agent perceived directly, with the time, position and strength (as confidence) of that perception, so knowledge never refreshes itself by being re-shared. `inform(member, now)` returns `report` stimuli for reports others made, scaled by confidence and fading to 0 at `maxAge`. Reports act as a rate, so calling `inform` every update is independent of the update rate. A full board first drops reports that are stale relative to the incoming one; `expire(now)` drops old reports. |
| Cover | `chooseCover(points, {agent, threat, protects, minDistance, maxDistance, prefer, reserved, maxChecks})` tries points in the distance band nearest first (or farthest from the threat), ties by id. It skips points reserved by others and makes at most `maxChecks` creator `protects(point, threat)` checks. `createCoverReservations()` gives one point per agent and one agent per point, with `takenFor(agent)` for the `reserved` filter. |
| Utility | `chooseUtility(options, input, {current, momentum, minScore})` scores each option as the compensated product of its considerations (each in [0, 1], else it throws) times its weight. The current choice gets a `momentum` bonus; ties go to declaration order; below `minScore`, or when every score is 0, there is no choice. |
| Owner | The creator: which agents think when, which queries count as occlusion, path distance and attenuation, what to do with facts. Pair with any blackboard, such as a behaviour tree runtime's `set` (a behaviour kit is pending in another pull request), by writing facts into it. |
| Bounds | Validated inputs (single reads), at most 256 stimuli per update, 256 targets per agent, 1,024 squad targets, 4,096 cover points with bounded checks, and 256 utility options with 32 considerations each. |
| Not provided | No navigation, steering or decision tree; no automatic sensing loop; no saving of awareness (persist your own facts if needed); no team or faction logic. Headless evidence only. |
