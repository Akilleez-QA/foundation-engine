# ADR 0087: Bounded optional volume queries

Status: Proposed

## Context

Authored traversal needs volumetric evidence: whether a body fits where it stands,
whether a straight move clears thin geometry, and how much clearance exists above a
crouched body. Existing contracts are narrower by design. The camera kit casts five
parallel rays, character collision tests a planar circle at endpoints, combat sweeps
relative spheres, terrain answers height samples and rays, platforms use support
footprints, and the spatial kit indexes 2D points. Portal crossing and alignment
already accept creator clearance evidence through callbacks but compute no geometry.
Rigid-body physics is not shipped and no physics dependency is installed.

## Decision

Add an optional pure `@kits/volume-query`: overlap, fixed-orientation sweep and a
headroom helper for a sphere or capsule body against an immutable, validated
snapshot of static spheres, capsules and oriented boxes. Exact core distances with
tangent-line steps on the convex separation function give conservative first
contacts without a general convex solver. The snapshot carries the creator's
revision; every query has a creator-configured evaluation and iteration ceiling and
reports `unresolved` or `over-budget` rather than claiming clear.

No physics world, broad-phase owner, controller, slope/step policy, clock, worker or
kit registration is installed. Results are observations that existing owners
(portals, alignment, camera obstruction, creator systems) consume under their own
authority. No dependency is added.

Rejected alternatives include more rays, heightfield headroom, extruded occupancy,
sphere chains, a general GJK/EPA solver, mesh BVH sweeps, endpoint-only overlap
sampling, a mandatory or optional physics engine kit, a worker query service, and a
controller framework. A thin adapter over a creator-owned third-party physics world
remains a valid application recipe when that dependency is the creator's choice.

## Consequences

Creators supply collision data in three primitive kinds and rebuild snapshots when
it changes. Mesh, heightfield and moving-collider coverage, rotation during motion
and depenetration stay out of scope. There is no acceleration structure; large
scenes need smaller snapshots built from an existing index. Logical evaluation
counts bound work but not measured device time. Tests use independent sampled and
closed-form oracles and two real consumers; they are headless contract evidence,
not gameplay or physical-device acceptance.
