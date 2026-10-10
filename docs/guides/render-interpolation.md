# Render interpolation of fixed-step Transforms

Simulation in Foundation advances in fixed 60 Hz steps (STD-SIM-11), while a display can refresh at 90,
120 or 144 Hz. Without interpolation a moving entity is drawn where the latest step left it. On a
144 Hz display it holds still for some frames and jumps a whole step on others. That judder is most
visible on a followed character and its camera.

This is an opt-in: add `Interpolated()` to an entity, and the engine draws it between the pose before
the latest step and the pose after it.

```ts
import { Interpolated, Transform, Shape } from '@engine';

entities: [[Name({ name: 'player' }), Transform(), Shape({ kind: 'capsule' }), Interpolated()]],
```

## Inputs and outputs

- **Inputs:**
  - `Interpolated({ revision?, teleport? })` on an entity with `Transform`.
  - `ctx.time.alpha`: the fraction of the next fixed step already elapsed, in `[0, 1)`.
- **Outputs:**
  - The built-in drawing (`Shape`, `Mesh`, `Model`) draws opted-in entities at
    `presentTransform(transform, interpolated, alpha)`.
  - `cameraSystem` follows an opted-in target at that same drawn pose, so the camera and the
    entity it follows move together.
  - Point and spot lights held by an opted-in entity are placed at the drawn pose.
- **For creator frame systems:** `presentedTransform(world, entity, ctx.time.alpha)` returns the same pose.
- **Simulation state is unchanged.** `Transform` is never written by interpolation. Fixed systems,
  collision, saves, replay digests and networking keep reading the simulation's own values.

## Ownership

The scene runtime owns capture. Before every fixed step (the runner's `beforeStep`, after input is
addressed to that step) it copies each opted-in entity's Transform into the component's `previous*`
fields. Frames then blend by `alpha`. There is no new scheduler, clock or registry, and `testScene`
captures the same way.

## Behaviour and bounds

- **Lag:** presentation lags the simulation by less than one step (at most 1/60 s). At `alpha` 0 the
  pose before the latest step is drawn.
- **Position and scale:** blended linearly.
- **Rotation:** each Euler angle is blended along its shorter arc. That is exact for a single-axis turn
  (heading) and an approximation for combined rotations.
- **Discontinuities:** when an entity is placed rather than moved (a respawn, a teleport, a cut),
  change `revision`. The entity is then drawn exactly at its Transform until the next step captures
  the new revision. A non-zero `teleport` distance does the same automatically for any step that
  moves farther than it.
- **Moves outside the fixed lane:** a Transform changed in a frame system or by a tool is blended from
  the last captured pose. Change `revision` for such moves, or do not opt that entity in.
- **Snapping:**
  - Not-yet-captured entities, non-finite values and `alpha` outside `[0, 1]` draw the Transform itself.
  - At a whole 60 Hz frame rate `alpha` stays 0, so motion is smooth but one step behind.
- **Cost:**
  - Per fixed step: one 7-number copy per opted-in entity.
  - Per sync (update and render each sync once) and per camera read: one blend and one small pose
    object per opted-in entity.
  - Every drawn entity pays one extra component lookup per sync.
  - On high-refresh displays an opted-in moving entity changes every frame, so those frames redraw.
    That redraw is the point of the feature.
  - Entities without `Interpolated` are drawn exactly as before (same values, no allocation).

## Limits

- **`ctx.time.alpha` in fixed systems:** it is meaningful only in frame systems and drawing. During
  fixed steps it can exceed 1, so do not read it there.
- **Camera snapping:** `cameraSystem` compares consecutive drawn targets, and a blended jump arrives
  over several frames. Set `Interpolated.teleport` no higher than the camera's `teleportDistance`, and
  on a cut bump `Interpolated.revision` together with the camera's `resetRevision`.
- **Sockets:** `ctx.modelSocket` reports the drawn root's sockets, which depend on `alpha`. Do not use
  them as simulation input.
- **Platforms:** a rider and the platform it stands on should both opt in, or one is drawn sliding
  against the other.
- **Spawning:** create the component with `Interpolated({ revision, teleport })`. Never copy another
  entity's value, because its captured fields would carry over.
- **Tools:** the dev `teleport` tool bumps `revision`. Your own placement code should do the same.
- **Pictures:** where an opted-in entity is drawn depends on frame timing, so screenshots of such a
  scene can differ by up to one step between runs.

- **Particles:** emitters are still drawn at the latest step.
- **Model attachments and pose links:** they follow their parent model's drawn root.
- **Other readers:** spatial audio and kits other than the camera keep using the simulation Transform.
- **Remote network entities:** these need their own playout/interpolation owner (separate work). This
  feature only smooths the local fixed step.
- **Evidence:** headless tests cover the runner composition at 144 Hz, revision snapping, the angle
  seam and camera following. Browser, physical high-refresh display and template evidence are not
  established.
