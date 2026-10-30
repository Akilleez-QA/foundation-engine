# 0065 — Owned optional systems

Status: Proposed

The implementation extends existing lifecycle, output, scene and persistence owners. New optional kits hold domain state and expose explicit cancellation, bounded admission and detached snapshots. They do not create another frame loop, output context, input listener registry or save backend.

The author view may carry an environment description whose background, illumination and haze are independent. Each view owns its rendering resources. Publication replaces the description; the renderer validates and consumes it without changing another view. Directional point backgrounds remove camera translation and use persistent buffers. This does not establish a textured background or reflection pipeline.

Asynchronous completion is distinct from visible publication. Replacement retains the old valid representation until admission and publication succeed. Cancellation retains running reservations until completion; late results cannot revive a disposed owner.

Saved operations have stable identities with explicit retry results. Atomicity is local to a validated state transition. Independently persisted sections do not become a distributed transaction. New kits must document these boundaries and integrate through the existing section protocol.

Acceptance includes isolated unit cases, a playable consuming template, existing-template regression checks, ownership cleanup, and unchanged budget ceilings. Proposed status remains until integration review; no production release is implied.
