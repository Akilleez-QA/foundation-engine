# ADR 0155: companion recovery on breadcrumb trails

- **Status:** Proposed
- **Date:** 2026-10-10
- **Area:** Optional kits

## Context

Companions that retrace a leader's path get stranded. Doors close behind them, they fall into pits, they snag on
geometry or are left behind by fast travel. Games recover them by catching up faster, and as a last resort by
teleporting them somewhere safe and out of view behind the leader. The breadcrumbs kit gives followers the exact
path but has no stranding policy.

## Decision

Add `createCompanionRecovery(trail, options)` to `@kits/breadcrumbs`. It is a per-follower decision function:

- `follow` within the catch-up distance;
- `catch-up` beyond it, with a distance-scaled boost;
- `teleport` when the follower is beyond the teleport distance or has made no progress for a set time. The landing
  point is the first configured trail distance behind the newest crumb that passes the creator's `canLand`. Segment
  cuts are respected, and teleports have a cooldown;
- `stranded` when no landing point is allowed yet.

There is no movement, collision or visibility logic, and no clock.

## Consequences

The creator owns movement, collision, visibility checks and what happens when a follower stays stranded. The landing
search is bounded by the configured distances.
