# ADR 0122: deterministic resumable behaviour trees

- **Status:** Proposed (candidate implementation)
- **Date:** 2026-10-09
- **Area:** Optional kits / Rules

## Context

Agents in many games choose actions with behaviour trees. Hand-written trees tend to re-run finished branches,
forget which leaf was running, leak running work when a higher-priority branch takes over, read wall-clock time and
cannot be saved mid-action. The creator asked for behaviour trees as an optional starting point with a bounded tick,
a blackboard, decorators, running-node resume, saveable state and a debug trace.

## Decision

Add an optional `behavior` kit. Trees are plain data validated into a frozen flat node table with a signature.
Each agent runtime keeps a blackboard of JSON scalars and per-node memory for running nodes only. A tick takes the
caller's integer tick and optional random source, visits each node at most once, resumes non-reactive composites at
their running child, aborts pre-empted or abandoned running children through creator abort handlers, and publishes
memory and blackboard changes only when the tick completes. Snapshots carry the tree signature and are validated
completely, including that remembered nodes form ancestor chains. Leaf behaviour stays in creator handlers.

## Consequences and evidence

Creators get reproducible decisions with `?seed=` replays, explicit resume and abort, and save/load mid-action.
Handlers remain unbounded creator code, and their own state must live in the blackboard or saved game state. The
runtime copies small per-tick state, so many agents need a think schedule. Focused headless tests cover definition
refusal, resume, reactive pre-emption with abort, every decorator, blackboard bounds, failure atomicity and
reentry, seeded shuffle order and mid-run snapshot continuation. No game integration, browser or device acceptance is
claimed.
