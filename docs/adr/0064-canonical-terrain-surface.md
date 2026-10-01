# ADR 0064: Canonical fixed-resolution terrain surfaces

Status: Proposed

## Context

Terrain research identified divergent visual/contact geometry, coordinate ownership and unbounded generation as avoidable risks. The engine currently renders primitives and the optional character kit moves on an X/Z plane. A usable first upgrade must connect a rendered landform to queries without introducing terrain policy into core.

## Decision

Add an optional terrain kit producing immutable, bounded, seeded fixed-resolution surface snapshots. Authored radial layers, coordinate noise and feathered level pads resolve once into the sampled grid. Triangle interpolation and normals define contact; indexed render data uses that same diagonal. Queries outside the finite region return null. IDs/revisions identify content snapshots, not render-camera state. Material/exclusion channels share the sampling lattice.

Add a genre-neutral indexed Mesh component and validated defineMesh helper to the author API. Its renderer owns buffers/materials through replacement, removal and scene exit. Geometry changes require replaced arrays or an explicit revision. Transform-only updates do not rebuild geometry. Core and author do not import the terrain kit.

Character grounding is an optional query callback with an explicit center-to-feet offset. A missing candidate surface blocks movement; idle grounding also handles spawns and teleports. Nonflat pointer control supplies an explicit triangle-hit resolver. Existing flat-plane callers retain their behavior.

## Limits and consequences

This slice does not introduce LOD, streaming, workers, terrain editing, planetary frames or physics. Surface allocation is bounded; synchronous generation is intended for small authored regions. Ray picking is bounded but linear in triangle count, so large regions need an acceleration structure before adoption. Slope traversal is kinematic, not a slope/friction model. Render normals may be smoothly shaded while contact normals describe exact triangles.

The terrain template demonstrates the contract and supplies behavior tests and measured counts. Existing templates are retained. No game deployment or merge is implied by this proposed change. Next terrain work must preserve contact independent of visual LOD and define error budgets explicitly.
