# kits/camera

Camera poses as pure functions (`cameraPose(mode, target, options)`) and a frame system (`cameraSystem(mode, options)`) that eases `ctx.view.camera` towards the pose around a named entity. Modes: `follow`, `orbit`, `first-person`, `top-down`, `side-scroll`, `fixed`. No draws; the renderer redraws only while the camera moves.

Optional `obstruction(from, to)` returns first-hit distance along the finite segment, or null. Clearance runs after smoothing using the center and four offset rays (`clearanceRadius`, `clearancePadding`); this approximates a camera footprint, not a swept sphere. Supply geometry queries in the same frame as the camera. Invalid distances fail explicitly. `teleportDistance` snaps smoothing on target discontinuities. Both features are opt-in so existing scenes retain their camera behavior.

Optional `resetRevision(ctx)` returns a safe integer identifying the creator's camera reset request. A changed revision snaps both position and target on the next successful pose publication, including small displacements. A missing target or throwing/invalid clearance query leaves that revision pending; retrying the same revision still snaps. Once applied, subsequent motion at that revision resumes ordinary smoothing. History is separate per world, and successful clearance is still required before publication.

## Camera director (optional)

Pure helpers in `director.ts`, plus one optional frame system. The existing
`cameraSystem` is unchanged; use one or the other for a scene's camera.

- **Priority ladder.** `createCameraVolumes({volumes, fallback, stickiness})` holds
  authored trigger volumes: yawed boxes or cylinders, at most 1,024. Each has a
  priority (lower wins) and a setting name. `resolve(subject, overrides)` picks the
  first active creator override (a scripted shot, a player state), else the containing
  volume with the lowest priority, else the fallback. The current volume keeps winning
  while the subject is inside its shape grown by `stickiness`; another volume takes
  over only with a strictly lower priority.
- **Rigs** (pure pose functions; all return `{position, target, fov}`):
  - `stringPose` keeps the eye where it was and drags it to stay within
    [min, max] distance, blending height, look offset and fov across the band.
  - `railPose` rides an authored polyline (2–256 points, open or closed) at the point
    nearest the subject.
  - `closeUpPose` orbits a subject sphere at the distance that fits it in the field of
    view, for inspection or photo modes; pitch is clamped to ±1.5.
  - `shotPose` moves from one pose to another over N ticks with smoothstep, either
    straight or orbiting the destination's look target so the camera swings rather
    than cutting through the subject. Drive it with a sequence cue's elapsed ticks.
- **Transitions.** `createCameraTransition` sizes a transition from the pose change:
  `ceil(k × sqrt(|Δeye| + |Δtarget| + fovWeight × |Δfov|))`, clamped to
  [minTicks, maxTicks]; changes below `skipBelow` cut. Each `step(goal)` moves by
  remaining/(1 + … + remaining), a decelerating schedule that lands exactly on the live
  goal after that many ticks even while the goal moves. Leaving a scripted override is
  the event exit blend: the transition runs from the shot to the live gameplay pose,
  which already includes how far the subject moved. `carry(delta, yaw, pivot)` moves
  the in-progress pose with a moving or turning support so riding a platform does not
  lag or swing.
- **Letterbox.** `createLetterbox(rate)` eases an amount in [0, 1] and reports whether
  it changed. Draw the bars in your UI or post layer.
- **`cameraDirectorSystem({volumes, settings, overrides?, carry?, transition?})`**
  resolves the setting for the named subject each frame and asks the rig for that
  setting's goal. It starts a sized transition when the setting changes and writes
  `ctx.view.camera` (position, target and fov) only when the pose moved. A missing rig
  for a resolved setting throws.

Bounds and failure: inputs are validated and copied, and invalid shapes, rigs or
poses throw `RangeError`. Work per frame is the number of volumes plus one rig
evaluation. Not provided: occlusion steering, corner or wall-climb solving,
multi-subject framing, lock-on, shake, splines through more than a polyline, or a
renderer letterbox. Headless evidence only.
