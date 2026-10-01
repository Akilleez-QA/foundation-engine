# kits/camera

Camera poses as pure functions (`cameraPose(mode, target, options)`) and a frame system (`cameraSystem(mode, options)`) that eases `ctx.view.camera` towards the pose around a named entity. Modes: `follow`, `orbit`, `first-person`, `top-down`, `side-scroll`, `fixed`. No draws; the renderer redraws only while the camera moves.

Optional `obstruction(from, to)` returns first-hit distance along the finite segment, or null. Clearance runs after smoothing using the center and four offset rays (`clearanceRadius`, `clearancePadding`); this approximates a camera footprint, not a swept sphere. Supply geometry queries in the same frame as the camera. Invalid distances fail explicitly. `teleportDistance` snaps smoothing on target discontinuities. Both features are opt-in so existing scenes retain their camera behavior.
