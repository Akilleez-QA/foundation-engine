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
