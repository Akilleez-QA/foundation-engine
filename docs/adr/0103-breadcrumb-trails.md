# ADR 0103: optional breadcrumb trails for followers

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits

## Context

Companions, party lines, escorts, carriage trains and delayed partner AI all need a follower to go exactly where a leader went, not take the shortest path there. Independent studies of classic games show two shapes of the same mechanism: a small ring of leader positions recorded only while the leader moves, with a follower index that waits, keeps pace and catches up; and a per-frame ring of positions and inputs read at a fixed delay. Foundation's navigation follower plans its own path, so it cannot retrace. Nothing records a path for followers.

## Decision

Add an optional pure `@kits/breadcrumbs`. It provides a bounded ring (2–65536 crumbs) with `every-tick` or `moved` recording, exact lag lookups, interpolated path-distance lookups that never cross a segment cut, validated snapshots, and a pure lag controller for wait, keep-pace and catch-up followers. It has no clock, entity, collision or registration.

## Consequences

The creator owns placement, collision for followers and what crumb flags mean. Distance lookups are O(segment) and linear between crumbs. Each leader owns one trail, and followers share it.
