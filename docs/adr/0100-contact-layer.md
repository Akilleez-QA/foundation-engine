# ADR 0100: optional contact layer and touch events

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits

## Context

Pickups, hurtboxes, trigger zones, interaction prompts and sensors all need to know which simple volumes overlap, and when that starts or stops. Classic action games show the common shapes of this mechanism:

- cylinder hitboxes with interaction-type bit sets and a fixed per-object contact list;
- a deferred touch list dispatched after the step, which must survive one handler destroying another participant.

Foundation has swept-sphere combat queries, a spatial index and pending volume queries, but nothing that reports pair transitions.

## Decision

Add an optional `@kits/contact`:

- bodies are vertical cylinders, spheres or axis-aligned boxes, with layer and mask bits;
- overlap tests are exact and strict;
- a sort-and-sweep broad phase, deterministic in id order;
- each update emits frozen events: exits, then enters, then stays;
- admission is bounded, and existing contacts keep priority;
- intangibility and removal produce explicit exits, and a re-added id is a new body;
- snapshots are validated on restore.

There is no physics response, clock, ECS binding or callback.

## Consequences

The creator owns positions, what a contact means and the order of effects. Contacts are sampled per step rather than swept. Oriented boxes and meshes are out of scope; heavy clustering along the sweep axis degrades performance.
