# ADR 0066: preparation and render resource ownership

Status: Proposed

## Context

Required data can arrive after navigation begins. Allocating the next render surface while retaining the previous surface would exceed the single-context contract. Presentation assets also need independent ownership and bounded replacement.

## Decision

Dispatch entries may prepare CPU/data dependencies before entering. During preparation the previous run remains available; rejection preserves it. Successful preparation releases the previous run before allocating the next render surface. First-render failure remains a failure-card path, not a rollback guarantee. Preparation receives visit cancellation and a restricted author context without input, entity mutation or render-surface APIs. Service access remains available to trusted author code; preparation must not commit gameplay effects. This is an API boundary, not a sandbox.

Each scene registers a dormant input layer with its activity owner, activating it after the first render. Owner-scoped input subscriptions therefore resolve to an actual layer and cannot receive events before activation.

Indexed meshes accept explicit normals. Render masks are unsigned 32-bit per-view channels, separate from global object visibility. Models retain animation clips, clone skeletal ownership, and release mixers, instances and leases with the visit. Pose overlays affect presentation independently of simulation transforms.

Cube backgrounds and reflection resources are separate optional bindings. Each aggregate retains six existing texture leases in canonical axis order. Replacement retains the previous cube until all faces are ready, rejects late results and releases partial failures. Dimensions must agree before decode admission; each binding permits one current and one pending aggregate with explicit byte limits. Bitmap orientation is normalized in an owned copy. These estimates do not claim total browser process memory bounds.

## Evidence

Router preflight, dependency cancellation, cube replacement/abort, model ownership and independent render-mask regressions accompany the implementation. Minimal templates demonstrate the real runtime paths. Templates are diagnostic consumers, not application content requirements.
