# kits/camera

Camera poses as pure functions (`cameraPose(mode, target, options)`) and a frame system (`cameraSystem(mode, options)`) that eases `ctx.view.camera` towards the pose around a named entity. Modes: `follow`, `orbit`, `first-person`, `top-down`, `side-scroll`, `fixed`. No draws; the renderer redraws only while the camera moves.

Optional `obstruction(from, to)` returns first-hit distance along the finite segment, or null. Clearance runs after smoothing using the center and four offset rays (`clearanceRadius`, `clearancePadding`); this approximates a camera footprint, not a swept sphere. Supply geometry queries in the same frame as the camera. Invalid distances fail explicitly. `teleportDistance` snaps smoothing on target discontinuities. Both features are opt-in so existing scenes retain their camera behavior.

Optional `resetRevision(ctx)` returns a safe integer identifying the creator's camera reset request. A changed revision snaps both position and target on the next successful pose publication, including small displacements. A missing target or throwing/invalid clearance query leaves that revision pending; retrying the same revision still snaps. Once applied, subsequent motion at that revision resumes ordinary smoothing. History is separate per world, and successful clearance is still required before publication.

## Support-anchored vertical framing

Optional `support(ctx, target)` returns the height of what the target stands on or
over (ground, water, a platform) or `null` when there is none; the creator supplies
the query, usually the same ground sampler as movement. The pose's camera position
and look target then shift by `clamp((support - target.y) * weight, ±supportLimit)`
(`supportWeight` for the position, default 1; `supportTargetWeight` for the look
target, default the position weight; `supportLimit` default 2 world units, at most
1e6). A jump or a short drop therefore leaves the view on the support height, while
a lasting change of support level, or a fall beyond the limit, is followed. The
shift is applied to the mode's pose before smoothing, teleport detection and
clearance, so those behave as before. `null` frames follow the target's own height.

Weights outside `[0, 1]` or an invalid limit throw `RangeError` when the system is
built; a non-finite support height throws in that frame, publishes no pose and
leaves a pending reset revision pending. Without `support`, poses are unchanged.
Cost: one creator query per frame. The kit does not decide what counts as support,
does not lag or ease the offset separately (the existing `smooth` applies), and is
not a look-ahead, frustum fit or occlusion steering.
