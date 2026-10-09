# kits/camera

Camera poses as pure functions (`cameraPose(mode, target, options)`) and a frame system (`cameraSystem(mode, options)`) that eases `ctx.view.camera` towards the pose around a named entity. Modes: `follow`, `orbit`, `first-person`, `top-down`, `side-scroll`, `fixed`. No draws; the renderer redraws only while the camera moves.

Optional `obstruction(from, to)` returns first-hit distance along the finite segment, or null. Clearance runs after smoothing using the center and four offset rays (`clearanceRadius`, `clearancePadding`); this approximates a camera footprint, not a swept sphere. Supply geometry queries in the same frame as the camera. Invalid distances fail explicitly. `teleportDistance` snaps smoothing on target discontinuities. Both features are opt-in so existing scenes retain their camera behavior.

Optional `resetRevision(ctx)` returns a safe integer identifying the creator's camera reset request. A changed revision snaps both position and target on the next successful pose publication, including small displacements. A missing target or throwing/invalid clearance query leaves that revision pending; retrying the same revision still snaps. Once applied, subsequent motion at that revision resumes ordinary smoothing. History is separate per world, and successful clearance is still required before publication.
