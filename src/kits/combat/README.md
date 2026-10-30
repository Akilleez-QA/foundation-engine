# Combat mechanisms

`sweep` tests relative linear motion of projectile and target spheres, including projectile thickness, initial overlap and deterministic nearest-hit ties. It admits at most 4,096 candidates; spatial broad phase belongs to the caller. Curved trajectories, convex meshes and moving rotations require subdivided simulation or another query. Positions must share a coordinate frame.

`resolveAction` separates eligibility, hit, mitigation and committed consequence. Effects are consumers of the result; disabling them cannot change resolution. A caller's authoritative commit must handle action idempotency and resource consumption in the same state transition. This helper does not charge inventory or grant seat authority itself.

`createShots` prevents duplicate resolution, expiry hits and owner-deletion hits. It retains terminal IDs until the bounded session ends, saturating rather than forgetting identity. Use a new generation/session for another lifetime. No server authority, aiming UI, damage formula, weapon content or age policy is supplied.
