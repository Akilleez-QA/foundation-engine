# Optional volume queries

`@kits/volume-query` answers three questions about a sphere or capsule body against
static collision shapes the creator supplies: does the body overlap anything here
(`overlapVolume`), how far can it translate before contact (`sweepVolume`), and how
much room is there to extend one end of a capsule (`headroom`). It is a pure helper:
no kit registration, physics world, broad-phase owner, clock, worker, callback or
movement policy. The creator owns the collision data, decides what a result means
and applies every effect.

Rays, endpoint checks and planar body circles are not volume evidence. A camera's
few parallel rays can pass either side of a thin lip; two clear endpoint overlaps
can straddle a thin wall; a centre ray straight up misses an overhang that a body's
shoulder would strike. `query.test.ts` keeps each of those discriminating cases.

```ts
import {defineVolumeSet, headroom, overlapVolume, sweepVolume} from '@kits/volume-query';

const set = defineVolumeSet({
  revision: collisionRevision, // the creator's own revision of this collision data
  maxColliders: 256,
  colliders: [
    {id: 'floor', kind: 'box', center: [0, -0.5, 0], halfExtents: [20, 0.5, 20]},
    {id: 'beam', kind: 'box', center: [2, 1.6, 0], halfExtents: [0.1, 0.1, 3], rotation: [0, 0, 0, 1]},
    {id: 'post', kind: 'capsule', a: [4, 0, 1], b: [4, 2, 1], radius: 0.2},
  ],
});
const body = {kind: 'capsule', a: [0, 0.3, 0], b: [0, 1.5, 0], radius: 0.3} as const;
const move = sweepVolume(set, body, [3, 0, 0], {margin: 0.01});
if (move.status === 'clear' && move.revision === collisionRevision) {
  // Apply the whole move. On 'hit', move.fraction is safe and move.normal faces the body.
}
const room = headroom(set, body, [0, 0.6, 0]); // fraction of the rise available above `b`
```

## Inputs and outputs

**Snapshot.** `defineVolumeSet({revision, maxColliders, colliders})` copies and
validates everything once and returns a frozen handle; later changes to the
caller's arrays do not affect it. Colliders are spheres (`center`, `radius`),
capsules (`a`, `b`, `radius`) and boxes (`center`, `halfExtents`, optional unit
quaternion `rotation` `[x, y, z, w]`). IDs are nonempty strings of at most 256
UTF-16 code units, unique within the set. Coordinates and sizes are finite with
magnitude at most `VOLUME_MAX_EXTENT` (1e6 m); radii and half extents are
positive. A quaternion whose length differs from 1 by more than 1e-6 is refused.
Each collider has an optional unsigned 32-bit `mask` (default all bits); a mask of 0
never matches any query.
`maxColliders` is required, in [1, `VOLUME_MAX_COLLIDERS` = 16384]. Colliders
are stored in ID order, so results never depend on input order. Only handles
returned by `defineVolumeSet` are accepted; a lookalike object throws.

**Body.** `{kind: 'sphere', center, radius}` or `{kind: 'capsule', a, b, radius}`
with a positive radius. A capsule keeps its orientation during a sweep; rotation
while moving, scaling and shear are not represented by this API.

**Options.** `mask` (default all bits; a collider counts when it shares a bit),
`margin` [0, 1000] m (default 0), `tolerance` [1e-9, 0.01] m (default 1e-6),
`maxEvaluations` [1, 2^20] per query (default 4096), `maxIterations` [1, 256]
distance evaluations per collider in a sweep, fallback steps included (default 32), and `maxResults` [1, 1024] reported IDs
(default 16). Invalid input throws `RangeError` before any work.

**Overlap.** Status `overlap` lists, in ID order, colliders whose separation from
the body is below `margin` (penetration when `margin` is 0); `clear` otherwise.
`truncated` says more matched than `maxResults`.

**Sweep.** Translates the body by `displacement`:

| Status | Meaning |
|---|---|
| `clear` | The whole move keeps separation at least `min(margin, starting separation) - tolerance` from every collider. |
| `hit` | First contact: at `fraction` the separation from collider `id` is within `tolerance` of that floor, and no earlier fraction violates it. `normal` points from the collider to the body. Equal fractions go to the lower ID. |
| `start-overlap` | The body already penetrates the listed colliders. No sweep is attempted; resolving penetration is the creator's choice. |
| `unresolved` | A collider needed more than `maxIterations` refinements (a near-tangent pass). `fraction` is a proven safe prefix, never a clear claim. |
| `over-budget` | `maxEvaluations` ran out. `fraction` is 0: nothing is proven. |

A body resting on a surface may slide along it or leave it; only motion that would
reduce separation below the floor is a hit. A start closer than `margin` may move
away. Every result echoes the snapshot `revision` and its `evaluations` count.

**Headroom.** For a capsule, `headroom(set, body, rise)` reports how much of `rise`
the `b` end can move while `a` stays put. `rise` must be parallel to `b - a`
(relative cross product at most 1e-9; any direction for a zero-length capsule);
a sideways rise throws, because the extended capsule would sweep a triangle. For a
parallel rise the extended capsule is exactly the current capsule plus the sphere
at `b` swept by `rise`, so it checks the current
capsule for penetration, then sweeps that sphere. The result uses the sweep
statuses; `fraction` is the available share of `rise`. Whether to stand, crouch,
partly extend or refuse is creator policy.

## Method and limits

Each kernel computes the exact distance between body and collider cores (a point
or segment against a point, segment or oriented box). For disjoint convex shapes
the closest pair is an endpoint against the box or the segment against one of the
box's 12 edges, so 14 candidates are exhaustive. Near-parallel segment pairs take
the best of the four boundary solutions, so the result is exact in either endpoint
order. Along a straight translation the
separation is a convex function of the fraction; the sweep takes tangent-line
steps, which cannot pass the first contact, and stops early once the tangent line
proves the rest of the move clear. A Lipschitz step replaces any tangent step that
rounding lands below the floor. Only +, -, *, / and square root are used, which
IEEE-754 rounds identically on conforming engines; results are reproducible for
identical inputs. That is not a guarantee about other code a creator runs.

Work is bounded and counted: each query first rejects colliders outside the swept
body's bounds at no evaluation cost, then performs at most `maxEvaluations` pair
distance evaluations. A box evaluation is one slab test, two point-box distances
and twelve segment distances; the others are one segment distance. A query
allocates its result and does not allocate per evaluation. There is no acceleration
structure: with many colliders, build smaller snapshots from an existing index
(for example the spatial kit's grid) for the region a query needs. Native time is
not bounded by these counts and has not been measured on devices.

Queries are synchronous and run to completion; there is nothing to cancel
mid-call. Spread work across ticks by issuing fewer queries. No callback runs, so
nothing can reenter or change the snapshot during a query.

Not provided: depenetration, moving or deforming colliders (build a new snapshot
with a new revision), triangle meshes, heightfields, convex hulls, rotation during
a sweep, a character controller, step or slope policy, pushing, persistence, or
a physics world. Box bodies are not
supported. Terrain height queries remain with the terrain kit.

## Ownership and recovery

The snapshot is immutable and holds no reference to creator objects. Results are
observations: the creator compares `revision` with its current collision data and
rechecks its own actor/target identity immediately before applying an effect.
Existing owners keep their authority: portal crossing in the navigation kit still
re-resolves frames after its clearance callback, alignment still takes creator
clearance evidence, and the camera kit's obstruction port still accepts any
segment query. A failed query (thrown on invalid input) changes nothing; correct
the input and retry. Snapshots are ordinary garbage-collected values; drop the
reference to release them. Runtime handles are not saved; rebuild after loading.

## Evidence

`oracle.test.ts` compares the kernels with a separately written sampled oracle
(different point-box formula and quaternion rotation), compares sphere sweeps with
the combat kit's closed-form relative sweep across 400 seeded cases including ID
ties, checks near-parallel long segments in both endpoint orders, and checks capsule sweeps against rotated boxes, capsules and spheres with a
sampled separation oracle. `query.test.ts` keeps the ray, endpoint and centre-ray
discriminators, resting contact, margins, masks, order independence, refusal,
iteration and evaluation caps. `consumers.test.ts` drives navigation portal
crossing with a swept body as its clearance evidence, and a body-height system on
the existing World and fixed runner that grows only on a complete result for the
current collision revision and keeps its feet in place. These are headless
contract tests, not gameplay, browser or physical-device acceptance.
