# Medium volumes

`@kits/media` handles water, mud, lava, low-gravity zones and similar regions that a body moves through rather
than stands on. It has three parts:

- **A bounded set of volumes.** Each is a box with a floor and a surface height.
- **A per-actor tracker.** It sorts each actor into `dry`, `wade`, `swim` or `under`, with hysteresis, and reports
  `enter`, `exit` and `state` events.
- **`mediumAcceleration`.** It turns submersion into buoyancy, drag and current accelerations.

There is no clock, entity binding, physics world or registration. The creator moves the bodies and decides what each
state does to controls, animation and camera.

```ts
import { createMediumVolumes, createMediumTracker, mediumAcceleration } from '@kits/media';

const water = createMediumVolumes({ maxVolumes: 32 });
water.set(1, { minX: 0, maxX: 40, minZ: 0, maxZ: 25, floor: -6, surface: 0, kind: 'water', density: 1.05, drag: 1.2 });
water.set(2, { ...river, kind: 'water', current: [2, 0, 0], priority: 1 });   // a flowing channel inside the lake
const tracker = createMediumTracker(water, { maxActors: 64, wadeDepth: 0.4, swimDepth: 1.2, hysteresis: 0.05 });

// fixed-step system, before your own movement integration:
const r = tracker.update(player, { x: tr.x, y: tr.y, z: tr.z, height: 1.8 });   // feet position
for (const e of r.events) { /* splash on enter, switch controls on state 'swim', drown timer on 'under' */ }
const a = mediumAcceleration({ probe: r.probe, velocity, gravity: 9.81 });
velocity = add(velocity, scale(add(a, [0, -9.81, 0]), dt));
// tides or a draining pool: water.set(1, { ...pool, surface: tideHeight }) every step
```

## Inputs and outputs

- **Volumes.** Each volume covers `x ∈ [minX, maxX)` and `z ∈ [minZ, maxZ)`. The intervals are half-open, so two
  volumes placed flush leave no seam between them.
  - Heights: `floor` < `surface`.
  - `kind`: a creator tag.
  - `priority`: decides which volume wins where volumes overlap. Ties go to the higher surface, then the lower id.
  - `density`, `drag`, `current`: inputs to the acceleration helper.
  - `enabled`: switches the volume on or off.
  - Calling `set()` again replaces a volume. Use this for moving water, tides and drained pools. `revision` counts
    every change.
- **Probe.** `probe({x, y, z, height})` returns the winning volume around a body whose feet are at `(x, y, z)`,
  together with:
  - `depth`: `surface - feet`;
  - `submerged`: the fraction of the body's height inside the medium, from 0 to 1.
- **Tracker.**
  - The states:
    - `wade` starts at `depth >= wadeDepth`.
    - `swim` starts at `depth >= swimDepth`.
    - `under` means the whole body is below the surface.
  - Each threshold has hysteresis. An actor crosses upward only at `threshold + hysteresis` and back only below
    `threshold - hysteresis`, so an actor bobbing at a boundary does not flicker.
  - Entering or leaving a volume is reported separately from state changes. An actor moving between volumes gets
    an `exit` before the `enter`.
  - `remove(actor)` reports a final `exit`.
  - `snapshot()` / `restore()` save the per-actor state.
- **`mediumAcceleration`.** Pure. Buoyancy is `gravity * density * submerged`, acting upward; a fully submerged body
  with density 1 is neutral. Drag is `-drag * submerged * (velocity - current)`. Outside a medium the result is
  zero. The creator adds its own gravity and controls.

## Ownership, bounds and failure

- **Limits.**
  - Volumes: 1–4096.
  - Tracked actors: 1–65536.
  - Coordinates: finite, magnitude at most 1e9.
  - Tracker thresholds: `0 < wadeDepth < swimDepth`. Hysteresis must be smaller than the gaps.
- **Cost.**
  - A probe is O(volumes); a creator with many volumes can pre-filter with `@kits/spatial`.
  - `update` is one probe.
- **Failure.** Malformed input throws `RangeError` before any change. Every input field is copied once.

## Composition

- **Character movement.** Feed the tracker the character's feet position after `@kits/character` or
  `@kits/locomotion` moves it. Switch the controller when the state is `swim`.
- **Volume queries.** Where `@kits/volume-query` is available, it handles solid geometry, and this kit handles the
  medium.
- **Effects.** Splashes, wakes, sounds and camera underwater effects are presentation driven by the events.

## Limits

- Volumes are axis-aligned boxes with flat surfaces. Waves or ripples are a surface height the creator updates.
- The body is a vertical extent at one horizontal point: `submerged` uses feet and height, not a full shape.
- Buoyancy has no torque and no per-point control. Rigid-body floating needs a physics owner.
- Results are floating-point. No cross-engine bit-identity is claimed.

## Evidence

`media.test.ts` covers:

- probe selection: edges, flush seams, priority, surface tie-break and disabled volumes;
- tracker states with hysteresis in both directions;
- `under`;
- enter, exit and state ordering, including moving between volumes and removal;
- buoyancy, drag and current values;
- snapshot replay and validation;
- a `testScene` consumer in which a fixed-step body falls in, floats at the equilibrium the density predicts and is
  carried by the current.

These are headless tests only. No template uses the kit yet.
