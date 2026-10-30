# Planar alignment

Optional `@kits/alignment` helper for a bounded target-relative approach followed by explicit acceptance. Import the pure helpers directly; no kit registration is required. Frames identity validation is borrowed as a pure helper, without installing a frame registry. No installed system, pose writer, input, rendering, collision, inventory, save section or effect callback. Navigation plans routes, character motion applies movement policy, frames resolve hierarchy, and exploration selects nearby interactions; this kit only prepares a local interaction and verifies its acknowledgment.

```ts
import {createAlignment, type AlignmentTarget} from '@kits/alignment';

const target: AlignmentTarget = {
  identity: {id: 'anchor', generation: 1}, revision: 0,
  frame: {x: 10, z: 20, yaw: Math.PI / 2},
};
const attempt = createAlignment(target, {x: 0, z: -1, yaw: 0}, {
  maxDistance: 4, maxAngle: Math.PI,
  distanceTolerance: 0.01, angleTolerance: 0.01,
  speed: 2, angularSpeed: Math.PI,
  maxStepSeconds: 0.25, timeoutSeconds: 8, maxSteps: 40,
  maxIdentityLength: 64,
});
// Called by the existing clock/interaction owner, using fresh observed state:
const sample = {target, actor: {x: 10, z: 20, yaw: 0}, eligible: true, clear: true};
const result = attempt.step(sample, 0.1);
// proposal: the creator validates/applies movement; it is never applied here.
// prepared: preserve the exact result.ticket and acknowledge with a fresh sample.
// Only an accepted acknowledgment admits the creator's effect.
attempt.dispose(); // scene or interaction owner ends
```

`alignmentDestination(frame, local)` composes planar rigid poses. Positive yaw rotates +Z toward +X, matching author `Transform.ry`. Supply an already resolved target frame; no second frame hierarchy is maintained. No height, scale, pitch or roll is supported. Coordinates and composed destinations must be finite. Unrepresentable composed coordinates or relative distances throw before progress; no world-scale ceiling is imposed. Proposal arithmetic is validated before time/work counters change. Finite yaw is normalized before composition and comparison; extremely large angles lose authored precision through platform trigonometry. Platform `Math` is used, with no cross-runtime bitwise determinism claim.

`createAlignment(target, local, limits)` captures detached snapshots of declared fields. The target uses the frames kit's generation-qualified identity plus a creator revision. Every sample rechecks identity, revision, normalized frame, eligibility and clearance. `clear` asserts creator-approved clearance from the observed actor through the destination, not merely a clear endpoint. The kit neither performs nor verifies a collision query. Target removal or unavailable evidence requires cancellation or a refused sample; never continue with an old snapshot. A changed target, failed eligibility/clearance or exceeded approach limit retires the attempt.

Each `step` performs constant-size math, proposing at most speed × seconds of translation and angularSpeed × seconds of shortest-angle turn. It does not claim acceleration, sliding, pathfinding or actual arrival. The creator retains the sole pose writer. A prepared ticket appears only when **observed** position and heading meet tolerances. `acknowledge(ticket, freshSample, paused)` rechecks alignment and policy, consumes the exact object once and returns `accepted`. Copied, foreign and consumed tickets are stale. Prepared drift retires the ticket even on paused or zero-time calls; returning to the goal does not revive it.

All bounds are explicit positive finite numbers; `maxSteps` and `maxIdentityLength` are safe integers, the latter counting UTF-16 code units. Angle limits cannot exceed π, and tolerances cannot exceed approach limits. Invalid configuration, poses or duration throw. Retention is O(maxIdentityLength) plus fixed-size numeric state and one ticket; no history/queue grows. Each positive unpaused step counts once, including waiting for acknowledgment. At most `maxSteps` work steps are admitted; elapsed time at or beyond `timeoutSeconds` retires the attempt. There are zero draws, listeners, timers, worker jobs, or reservations. Creator-retained attempts and snapshots need their own scene-level count limit.

The creator's existing clock supplies **all** active intervals, including pending acknowledgment, and the current pause state to step and acknowledge. Paused/zero-time steps consume no time or work; invalidation remains active. This is an active-simulation timeout: missing clock calls and incorrect pause values cannot be detected. No independent time owner is installed. `cancel()`/`dispose()` are idempotent retirement; create a fresh attempt to recover. One attempt belongs to one actor interaction lifetime, and the owner must dispose it on actor loss or replacement.

Acceptance is in-memory admission, not an effect transaction, reward or inventory transfer. The creator applies effects only after acceptance and composes existing receipt/persistence services if crash recovery matters. Tickets cannot be serialized or restored. Cancellation does not undo creator movement already applied. Callback failures, stale external state and caller-retained tickets remain the creator's responsibility.

Evidence: public tests cover frames-convention agreement, input snapshots, numeric extremes, retained identity limits and adversarial lifecycle cases. Two distinct headless lab consumers cover console activation and socket placement. Tests apply proposals through a test-only pose owner. No runtime physics, browser playability, save composition, physical-device or performance acceptance is claimed. See [the lab guide](../../../docs/guides/interaction-alignment-lab.md).
