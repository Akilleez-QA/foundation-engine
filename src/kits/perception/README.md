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
| Sight | `sightStrength(spec, eye, target, clear)` returns 0 outside `range` or the `fov` cone, unless within `near`. It also returns 0 when the creator's `clear(from, to)` reports an obstruction (for example a volume-query sweep or a ray). Otherwise it returns (1 − d/range) × an angle factor that falls from 1 at the centre to `edge` at the cone boundary. `clear` is called at most once, and only inside range and cone. |
| Hearing | `hearingStrength(listener, sound, {distance?, attenuation?})` returns (1 − d/loudness) × attenuation. `distance` may return a travel distance (for example from a navigation field), or null when the sound cannot reach the listener. `attenuation` returns [0, 1] (for example per closed door). Sounds beyond loudness in a straight line return 0 without calling either query. |
| Awareness | `createAwareness(options)` keeps up to `maxTargets` (default 32, max 256) per agent. **Inputs:** `update(now, stimuli)` takes nondecreasing seconds and at most 256 stimuli. **Growth and decay:** sight adds `sightRate × strength × elapsed`; sounds and squad reports add an impulse; unseen targets lose `decay × elapsed`. **Levels:** `unaware`, `suspicious` and `alerted`, each with separate enter and leave thresholds (hysteresis). **Memory:** last-known position, last stimulus and last-seen times. Unaware targets with zero awareness are forgotten after `forgetAfter`. When memory is full, a newcomer replaces the least aware target only if it would be more aware; otherwise it is dropped and counted. **Outputs:** `facts(prefix)` and `write(sink, prefix)` give flat scalar facts for a blackboard: alert, target, awareness, visible, x/y/z and seenAgo. |
| Squad | `createSquadKnowledge({maxTargets, maxAge})` keeps the newest report per target. `share(reporter, awareness)` copies suspicious and alerted targets. `inform(member, now)` returns `report` stimuli for reports others made, scaled by confidence and fading to 0 at `maxAge`. `expire(now)` drops old reports. |
| Cover | `chooseCover(points, {agent, threat, protects, minDistance, maxDistance, prefer, reserved, maxChecks})` tries points in the distance band nearest first (or farthest from the threat), ties by id. It skips points reserved by others and makes at most `maxChecks` creator `protects(point, threat)` checks. `createCoverReservations()` gives exclusive claims with `takenFor(agent)` for the `reserved` filter. |
| Utility | `chooseUtility(options, input, {current, momentum, minScore})` scores each option as the compensated product of its considerations (each in [0, 1], else it throws) times its weight. The current choice gets a `momentum` bonus; ties go to declaration order; below `minScore` there is no choice. |
| Owner | The creator: which agents think when, which queries count as occlusion, path distance and attenuation, what to do with facts. Pair with the behaviour kit by writing facts into its runtime's blackboard. |
| Bounds | Validated inputs (single reads), at most 256 stimuli per update, 256 targets per agent, 1,024 squad targets, 4,096 cover points with bounded checks, and 256 utility options with 32 considerations each. |
| Not provided | No navigation, steering or decision tree; no automatic sensing loop; no saving of awareness (persist your own facts if needed); no team or faction logic. Headless evidence only. |
