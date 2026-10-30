# ADR 0113: optional perception kit feeding a blackboard

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / AI
- **Tracking:** linked from the pull request

## Context

Agents need to notice targets by sight and sound and build up suspicion rather than
switching instantly. They need to remember where a target was last known, share that
with nearby allies, pick cover and choose among actions. Each game re-implements
these, often coupling them to a decision system. A behaviour tree kit is being added
separately and expects sensors to write a blackboard.

## Decision

Add an optional `perception` kit of pure helpers:

- sight and hearing strengths whose occlusion, path distance and attenuation are
  creator queries;
- per-agent awareness with rates, impulses, decay, hysteretic alert levels, bounded
  memory and flat blackboard facts;
- squad knowledge with newest-wins reports and fading report stimuli;
- cover selection with bounded line-of-sight checks and reservations;
- compensated utility scoring with momentum.

It installs no system and builds no decision tree.

## Consequences

Creators choose when agents think and which queries define occlusion. Awareness is not
saved. Geometry is not owned. Evidence is headless tests; no game, browser or device
acceptance.
