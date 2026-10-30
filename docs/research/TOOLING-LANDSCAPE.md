# Foundation Engine tooling landscape: source-led expansion of the research lane

Original research snapshot 2026-09-30: that source-study change added proposals only, with no implementations, libraries, assets or native dependencies. This extends the Bevy/Godot import-pipeline study across terrain authoring, navigation, animation and causal profiling. Audio is not the organizing theme. Editor inspection and replay/testing are cross-cutting priorities, not byproducts of an audio editor.

## Implementation follow-up

Implementation inventory reviewed against `b5933b7` on 2026-09-30. The original
research snapshot below remains a proposal record. Four bounded portions now
have implementation: [authored-system timing](../guides/system-timing.md), [synchronous event timing export](../guides/event-trace.md),
[bounded entity metadata inspection](../guides/entity-inspection.md) and [on-demand terrain inspection](../../src/kits/terrain/README.md#optional-on-demand-inspection).
Terrain inspection reuses generation ownership and returns detached metadata;
displayed variants are explicitly supplied by the consumer. Its finite diagnostic
covers pending/publication/closure, not editor observer demand, mesh export,
painting or navigation generation. The source-derived Godot Voxel lesson remains
that inspection demand must have explicit ownership; this slice creates no demand
or observer at all. Entity inspection supplies IDs and bounded component labels, not arbitrary value
serialization or editing. Replay, cross-owner/worker tracing, resource inspection
and the remaining authoring proposals below are not established by these slices.

## Needs identified in the original source review

The original parallel architecture review identified the following gaps at that time (the implementation ledger above supersedes the entity/system inspection status): navigation/search.ts operates on authored graphs and follower.ts consumes externally resolved positions; camera/clearance.ts documents five rays, not swept volume; domain/sim/host.ts owns tick-addressed input but controls-trace.ts is a bounded diagnostic rather than a portable replay; author/play.ts and dev/test-api.ts expose counts, named positions and probes rather than a paged generic component inspector; ecs/systems.ts and perf/perf-run.ts aggregate execution/performance rather than recording per-system causal spans. The existing finite terrain surface, worker patch jobs, shared residency, animation/IK/root-motion, and staged publisher are foundations to extend, not absent systems to replace.

The following mechanisms were inspected directly in four official open-source repositories. Source snapshots are research downloads under `/tmp/foundation-tooling-study/`; no repository checkout or vendoring was necessary.

## 1. Terrain and content authoring: Godot Voxel

Pin: `Zylann/godot_voxel@fa52579ec97a93c915663a55330e4ea57e6a728a`.

**Observed:** `TimeSpreadTaskRunner::process` runs queued tasks within an elapsed-time budget, always attempts at least one, and keeps postponed tasks out of the queues until the pass ends. Higher priorities are consumed first. `flush` repeatedly processes until empty, assuming producers have stopped. This is not a hard upper bound on an individual task, and strict priority has starvation implications. [time_spread_task_runner.cpp](https://github.com/Zylann/godot_voxel/blob/fa52579ec97a93c915663a55330e4ea57e6a728a/util/tasks/time_spread_task_runner.cpp)

**Observed:** `PriorityDependency::evaluate` combines observer distance and LOD priority bands. Comments explicitly describe historical scheduling choices making cracks more likely. Scheduling order alone is therefore not a trustworthy seam-correctness guarantee. [priority_dependency.cpp](https://github.com/Zylann/godot_voxel/blob/fa52579ec97a93c915663a55330e4ea57e6a728a/engine/priority_dependency.cpp)

**Observed:** the terrain editor adds/removes its own observer with plugin lifetime; that observer can follow the editor camera and explicitly does not require collision. Debug terrain export uses `debug_dump_as_scene`. Mesh update requests carry visual/collision needs and cancellation tokens. [editor plugin](https://github.com/Zylann/godot_voxel/blob/fa52579ec97a93c915663a55330e4ea57e6a728a/editor/terrain/voxel_terrain_editor_plugin.cpp), [send_mesh_requests](https://github.com/Zylann/godot_voxel/blob/fa52579ec97a93c915663a55330e4ea57e6a728a/terrain/variable_lod/voxel_lod_terrain_update_task.cpp#L292)

**Foundation proposal:** build a terrain inspection/authoring diagnostic before adding a volumetric runtime. Show canonical surface, contact triangles, chunk LOD, seam dependencies, revision and queued/resident byte claims. Represent an editor observer as an owned request source using existing residency admission. Keep gameplay contact readiness authoritative; editor preview demand must not silently reduce the authored runtime quality floor. Preserve shared canonical data and atomic revision publication. A postponed job should not monopolize one frame; logical work limits and fairness remain necessary even if a soft time budget is also measured.

**Acceptance:** move the editor observer rapidly while cancelling patches; no stale mesh/contact combination publishes; closing inspector returns observer/job/resource counts to baseline; stress alternating LOD arrivals and verify shared boundary coordinates; inspector disabled creates no continuous rendering. Edit/export/reload must preserve the canonical Float32 surface and material IDs.

**Defer:** voxels, caves, volumetric painting and a native editor. Those are distinct product requirements, not prerequisites for good heightfield terrain.

## 2. Navigation and physics boundaries: Recast/Detour

Pin: `recastnavigation/recastnavigation@9f4ce64458dfae86e1239c525ddc219c4e9e06f1`.

**Observed:** `dtNavMeshQuery` separates sliced initialization, bounded `updateSlicedFindPath(maxIter, doneIters)`, and finalization. It retains query/filter state across slices and warns against interleaving unrelated query methods on that object. Start/end polygon references are validated again during updates. Query results expose partial paths and out-of-node/buffer conditions instead of claiming a complete route. [DetourNavMeshQuery.cpp](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/Detour/Source/DetourNavMeshQuery.cpp#L1208)

**Observed:** `dtTileCache` bounds obstacle requests and reports saturation. `update` rebuilds one queued tile, tracks outstanding tiles per obstacle, and marks obstacles processed only after their pending set empties. Removed obstacle slots change salt before reuse, preventing stale identity reuse. One tile per update still does not establish a millisecond bound for the rebuild. [DetourTileCache.cpp](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/DetourTileCache/Source/DetourTileCache.cpp#L523)

**Foundation proposal:** prioritize a geometry-to-navigation adapter using existing revisioned queue/portal/follower contracts. Immutable geometry revision, agent clearance settings and route-query ownership should be explicit inputs. Runtime query state must not leak between consumers. A partial path is not arrival. Navigation constraints and physical contact remain separate; a generated polygon path does not replace movement resolution or provide continuous camera collision.

**Build/reuse decision:** specify the adapter and independent correctness oracle first. Evaluate an existing maintained browser/WASM binding only after measuring output quality, bundle bytes, query latency, memory and cancellation behavior. This source pass did not inspect such a binding, so it does not recommend installing one. Avoid porting the whole native crowd stack or replacing the existing route queue.

**Acceptance:** derive a route around a finite obstacle from the same geometry revision used for collision; remove/change that geometry while a sliced query is pending and reject stale completion; expose saturated/partial/error separately; no accepted route violates radius/height clearance; budget exhausted work resumes fairly. Camera clearance needs its own swept-volume experiment with a thin diagonal blocker between the existing probes.

## 3. Animation tooling and quality: ozz-animation

Pin: `guillaumeblanc/ozz-animation@744eb9d99f606eda849acb0b1204f7a3dc20bca1`.

**Observed:** `SamplingJob::Context::Resize` allocates its sampling context in one allocation; `Step` invalidates cache when animation identity changes and retains previous sampling ratio. This separates immutable animation data from mutable per-playback acceleration state. It is not evidence that sharing one cache among independent instances is safe. [sampling_job.cc](https://github.com/guillaumeblanc/ozz-animation/blob/744eb9d99f606eda849acb0b1204f7a3dc20bca1/src/animation/runtime/sampling_job.cc#L531)

**Observed:** `AnimationOptimizer` computes hierarchical scale forward and maximum influenced length/minimum tolerance backward. Per-joint settings influence translation, rotation and scale track decimation. Rotational error is evaluated through the affected radius; deleting keys merely because local quaternion error is small would miss visible endpoint error. [animation_optimizer.cc](https://github.com/guillaumeblanc/ozz-animation/blob/744eb9d99f606eda849acb0b1204f7a3dc20bca1/src/animation/offline/animation_optimizer.cc#L64)

**Foundation proposal:** add an offline animation inspection/validation pass to the import pipeline, showing joint/track counts, duration, sampled endpoint error, marker/root-motion continuity and estimated runtime cost. Only then consider an optional bounded reduction transform with authored error tolerances. Keep the current Three.js native clip path and existing optional pose/IK systems. A new SIMD/WASM runtime and another animation file format are unjustified until profiling shows a material bottleneck.

**Acceptance:** long scaled bone chains expose optimizer endpoint error; seeks, reverse playback, looping and clip replacement cannot reuse stale sample state; separate instances with different times remain independent; reference and transformed animation pass sampled world-space joint/attachment error limits plus visual guards. Marker timing and root-motion integrated displacement must remain within explicitly defined tolerances. Do not weaken existing quality budgets to make compression pass.

## 4. Profiling and debugging: Tracy

Pin: `wolfpld/tracy@6dae06535c0c8af1e5ff7604a9cd29145fa8258c`.

**Observed:** disabled `TRACY_ENABLE` expands zone/frame macros to no-ops. Enabled instrumentation supplies named scopes and frame markers. The client has asynchronous queue draining, connection state and on-demand connection metadata; these separate recorded events from the profiler transport. This inspection does not establish that Tracy's total buffering is bounded for Foundation's workload. [Tracy.hpp](https://github.com/wolfpld/tracy/blob/6dae06535c0c8af1e5ff7604a9cd29145fa8258c/public/tracy/Tracy.hpp), [TracyProfiler.cpp](https://github.com/wolfpld/tracy/blob/6dae06535c0c8af1e5ff7604a9cd29145fa8258c/public/client/TracyProfiler.cpp#L2090)

**Foundation proposal:** build dev-only causal spans at existing owner boundaries: system execution, worker queue wait/run/delivery, asset acquisition/decode/publication and scene preparation. Carry stable operation/parent IDs, route epoch and worker identity. Store a fixed-capacity local ring with explicit dropped-event counts and export a documented trace format readable by an existing trace viewer. Use browser tooling first; do not install Tracy's native collector into the production browser runtime.

**Acceptance:** one deliberately slow system is identifiable independently of worker wait; exported intervals never assign worker time to main-thread execution; clearing/closing recorder frees retained payloads; sustained saturation produces counted drops rather than memory growth; production bundles exclude hooks and labels. Existing GPU/count/quality gates remain unchanged. Cross-worker clock alignment needs a specified capture convention and validation rather than subtracting unrelated clocks.

## Cross-cutting tooling priorities

1. **Causal diagnostics and replay artifact, then an entity/resource inspector.** Profiling establishes where cost originates. A replay records schema/build ID, seed, tick-addressed actions and digest checkpoints; first-divergence reporting makes bug reports reproducible. Expose entity inspection through bounded immutable pages and scene-epoch handles, including unnamed entities. No mutable internal component references. These are proposed Foundation mechanisms, not features established by the four source inspections.
2. **Terrain authoring/inspection and navigation geometry adapter.** These directly address current scene-quality and spatial-control limitations. Reuse canonical terrain, worker ownership and existing navigation contracts. Pair navigation with a separate camera swept-clearance study.
3. **Incremental imports and animation inspection.** Keep the earlier Bevy/Godot compiler work, but as one lane in this broader engine-tooling programme. Recipes, editor UI, runtime leasing and profiling should communicate through existing public boundaries.
4. **Thin extensible editor.** Compose inspectors, graph/debug views, replay and import recipes. Build stable schema/command interfaces first; avoid an all-purpose native application framework until an actual author workflow needs it.

A small set of heterogeneous diagnostics should prove these tools: a finite edited surface, an obstacle route, a scaled animated hierarchy and a captured timing/replay scenario. These are engine verification consumers, not commitments to authored game systems.

## License metadata and scope limits

At the pins above, Recast's root [License.txt](https://github.com/recastnavigation/recastnavigation/blob/9f4ce64458dfae86e1239c525ddc219c4e9e06f1/License.txt) contains the zlib-style terms; ozz [LICENSE.md](https://github.com/guillaumeblanc/ozz-animation/blob/744eb9d99f606eda849acb0b1204f7a3dc20bca1/LICENSE.md) identifies MIT; Tracy [LICENSE](https://github.com/wolfpld/tracy/blob/6dae06535c0c8af1e5ff7604a9cd29145fa8258c/LICENSE) identifies BSD-3-Clause; Godot Voxel [LICENSE.md](https://github.com/Zylann/godot_voxel/blob/fa52579ec97a93c915663a55330e4ea57e6a728a/LICENSE.md) identifies MIT. These are observed root-license metadata, not legal conclusions or audits of bundled dependencies/examples/assets.

This original study comprises four representative source inspections, not exhaustive comparison or certification. It measured no Foundation performance benefit; subsequent diagnostic implementation does not by itself claim a runtime speed improvement. Native physics engines, general visual scripting, shader/material authoring, accessibility authoring and cross-device automated visual inspection remain candidates for subsequent focused research; this report does not claim those areas are covered.
