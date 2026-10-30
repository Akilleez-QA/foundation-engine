# kits/camera

Camera poses as pure functions (`cameraPose(mode, target, options)`) and a frame system (`cameraSystem(mode, options)`) that eases `ctx.view.camera` towards the pose around a named entity. Modes: `follow`, `orbit`, `first-person`, `top-down`, `side-scroll`, `fixed`. No draws; the renderer redraws only while the camera moves.

Optional `obstruction(from, to)` returns first-hit distance along the finite segment, or null. Clearance runs after smoothing using the center and four offset rays (`clearanceRadius`, `clearancePadding`); this approximates a camera footprint, not a swept sphere. Clearance never brings the camera closer to the target than `clearanceMinDistance` (default `CAMERA_MIN_DISTANCE`, 0.05). If the requested distance is shorter, the requested distance is kept. This keeps a defined view direction when geometry touches the target; previously such a pose collapsed onto the target and the view orientation became undefined. The floor wins over the obstruction, so a camera inside the floor may sit within geometry. Hiding or fading that geometry is creator presentation. While the requested distance is at or below the floor, clearance does not move the camera, so a large floor turns wall clearance off for close zoom levels. The default is below the runtime near plane (0.1), which means a floored camera may clip its subject; the default only guarantees a defined direction. `cameraSystem` rejects a non-positive or non-finite `clearanceMinDistance` when the system is built. Supply geometry queries in the same frame as the camera. Invalid distances fail explicitly. `teleportDistance` snaps smoothing on target discontinuities. Both features are opt-in. Existing obstruction users see changed output only where clearance previously came closer than the floor.

Optional `resetRevision(ctx)` returns a safe integer identifying the creator's camera reset request. A changed revision snaps both position and target on the next successful pose publication, including small displacements. A missing target or throwing/invalid clearance query leaves that revision pending; retrying the same revision still snaps. Once applied, subsequent motion at that revision resumes ordinary smoothing. History is separate per world, and successful clearance is still required before publication.

## Support-anchored vertical framing

Optional `support(ctx, target)` returns the height of what the target stands on or
over (ground, water, a platform) or `null` when there is none; the creator supplies
the query, usually the same ground sampler as movement. The mode's pose is then
re-evaluated at anchored heights: inside `supportLimit` (default 2 world units, at
most 1e6) the height is `support * w + y * (1 - w)`, with `w = supportWeight`
(default 1) for the camera position and `supportTargetWeight` (default the position
weight) for the look target; beyond the limit it is the target height ± the limit.
A jump or a short drop therefore leaves the view on the support height, while a
lasting change of support level, or a fall beyond the limit, is followed through the
existing `smooth`. With weight 1 a still support gives an exactly still pose, so
nothing is redrawn.

Modes: `follow`, `orbit`, `top-down` and `side-scroll` move position and target.
`fixed` keeps its position; untracked it ignores support, tracked only its look
target is anchored. `first-person` would pin the eye to the support height during a
jump; use `supportWeight: 0` there or leave `support` out. Teleport detection
(`teleportDistance`) compares the target's own positions, so a change of support never
snaps; it eases like other motion. A `null` frame removes the offset at once (smoothing
still applies).

Weights outside `[0, 1]` or an invalid limit throw `RangeError` when the system is
built, even without `support`. Support settings are fixed at construction; the
per-frame `options(ctx)` callback does not change them. A non-finite support height
throws in that frame, publishes no pose and leaves a pending reset revision pending.
Without `support`, poses are unchanged. Cost: one creator query and up to two extra
pose evaluations per frame. The kit does not decide what counts as support and is not
a look-ahead, frustum fit or occlusion steering.

## Camera director (optional)

Pure helpers in `director.ts`, plus one optional frame system. The existing
`cameraSystem` is unchanged; use one or the other for a scene's camera.

- **Priority ladder.** `createCameraVolumes({volumes, fallback, stickiness})` holds
  authored trigger volumes: yawed boxes (center, half extents) or vertical cylinders
  standing on a `base` point, at most 1,024. Each has a
  priority (lower wins) and a setting name. `resolve(subject, overrides, key?)` picks the
  first active creator override (a scripted shot, a player state), else the containing
  volume with the lowest priority, else the fallback. The current volume keeps winning
  while the subject is inside its shape grown by `stickiness`; another volume takes
  over only with a strictly lower priority. Sticky state is kept per `key` (the director
  system uses the world), and `settings` lists every volume and fallback setting name.
- **Rigs** (pure pose functions; all return `{position, target, fov}`):
  - `stringPose` keeps the eye where it was and drags it to stay within
    [min, max] distance, blending height, look offset and fov across the band.
  - `railPose` rides an authored polyline (2–256 points, open or closed) at the point
    nearest the subject.
  - `closeUpPose` orbits a subject sphere at the distance that fits it in the vertical
    field of view (a portrait view can still crop it horizontally), for inspection or
    photo modes; pitch is clamped to ±1.5.
  - `shotPose` moves from one pose to another over N ticks with smoothstep, either
    straight or orbiting the interpolated look target so the camera swings rather
    than cutting through the subject; it returns exactly the destination at the end. Drive it with a sequence cue's elapsed ticks.
- **Transitions.** `createCameraTransition` sizes a transition from the pose change:
  `ceil(k × sqrt(|Δeye| + |Δtarget| + fovWeight × |Δfov|))`, clamped to
  [minTicks, maxTicks]; changes below `skipBelow` cut. Each `step(goal)` moves by
  remaining/(1 + … + remaining), a decelerating schedule that lands exactly on the live
  goal after that many ticks even while the goal moves. Leaving a scripted override is
  the event exit blend: the transition runs from the shot to the live gameplay pose,
  which already includes how far the subject moved. `carry(delta, yaw, pivot)` rotates
  the in-progress pose about the support point before this frame's move (yaw positive
  as three.js `rotation.y`) and then translates it, so riding a platform does not lag
  or swing.
- **Letterbox.** `createLetterbox(rate)` eases an amount in [0, 1] and reports whether
  it changed. Draw the bars in your UI or post layer.
- **`cameraDirectorSystem({volumes, settings, overrides?, carry?, transition?})`**
  resolves the setting for the named subject each frame and asks the rig for that
  setting's goal. It starts a sized transition when the setting changes and writes
  `ctx.view.camera` (position, target and fov) only when the pose moved by more than
  1e-9. Rigs are checked against every volume and fallback setting when the system is
  built; an override setting without a rig throws in its frame. Ladder stickiness and
  transitions are kept per world. The scene camera's fov must stay within (1, 170)
  degrees while the director runs. `stringPose` can differ by a few ulp between calls
  at the band edge; the director's threshold absorbs this, and direct callers should
  not compare poses exactly.

Bounds and failure: shapes, overrides, rigs, poses (finite coordinates, fov in
(1, 170)) and shot paths are validated with single reads and returned poses are
frozen; invalid input throws `RangeError`. Work per frame is the number of volumes plus one rig
evaluation. Not provided: occlusion steering, corner or wall-climb solving,
multi-subject framing, lock-on, shake, splines through more than a polyline, or a
renderer letterbox. Headless evidence only.

### More director rigs (`rigs-2d.ts`)

- `createLookAhead({lead, maxLead, catchUp})` leads the focus in the subject's horizontal
  direction of travel by up to `maxLead` (`lead` seconds of travel). The focus is a
  world point that moves at no more than the subject's speed plus `catchUp`, so the
  lead builds up at `catchUp`, and stopping or turning swings the focus at that bounded
  world speed. It never trails the subject by more than `maxLead`.
- `createAreaCamera({areas, panTicks})` holds the framing of the area (a horizontal
  rectangle) containing the subject. Entering another area pans from the pose on screen
  with smoothstep, reaching the new pose on the `panTicks`-th step (`panning` is true for
  `panTicks − 1` steps; 0 and 1 both cut), so a game can hold the player meanwhile.
  Overlaps keep the current area. Before any step, or if the first step is outside
  every area, the first area is used; after that, outside every area the last one is
  kept. Up to 1,024 areas.
- `createEasedBounds(bounds, {rate, fastRate})` eases camera limits edge by edge
  toward newly set limits, faster when `step(dt, true)` is used (for example while the
  subject is airborne). `set(bounds, true)` snaps at a cut. `clamp(point)` keeps a
  position or focus inside. Every edge moves toward its own ordered target at the same
  rate, so min ≤ max always holds.

All three are pure, validate their input and return frozen values. They compose as
rig functions for `cameraDirectorSystem` or standalone with `cameraSystem` options.
