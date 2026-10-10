# ADR 0121: status effects with transforms on the fixed clock

- **Status:** Proposed (candidate implementation)
- **Date:** 2026-10-09
- **Area:** Optional kits / Rules

## Context

Timed contributions in the capabilities kit own expiring additive/multiplicative modifiers with a conflict policy.
Many games need more than an expiring modifier: stacks with a cap, re-application policies, independent per-stack
timers, decay of build-up, periodic pulses, thresholds that turn one status into another or fire a trigger,
exclusive groups, immunities (including immunity granted when a status ends) and a save format. Without an owner,
each game re-implements these timing rules with subtle order differences that break replays. The creator asked for
status effects as an optional, configurable starting point.

## Decision

Add an optional `status` kit with validated rules (`defineStatusRules`) and one owner per scene or world
(`createStatusEffects`) for many targets on an integer tick clock supplied by the caller. Mutations run on a copy
and publish only when complete; outcomes that refuse (`immune`, `blocked`, `capacity`) change nothing. Per-tick
order is fixed and documented, targets and statuses are processed in id order, and transform chains are validated
acyclic. The owner emits events and contribution rows; it does not change other owners' values or resolve
consequences. Snapshots are plain data tied to a rules signature and validated completely on restore.

## Consequences and evidence

Creators get reproducible status timing and can tune it as data; consequences (pulse amounts, trigger effects) stay
in game code or the formulas kit. Bounds are configured per owner (targets, statuses and immunities per target,
ticks per advance) and overload is an explicit outcome. Restoring under changed rules is refused rather than
guessed; migration is the creator's. Focused headless tests cover rule refusal, every duration policy, independent
timers, decay and transform, immunity paths, exclusive groups, capacity atomicity, snapshot continuation and
malformed restore. No game integration, browser or device acceptance is claimed.
