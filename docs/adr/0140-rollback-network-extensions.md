# ADR 0140: optional lossy-link, delay, departure, spectator, resume and evidence extensions for rollback sessions

- Status: Proposed
- Tracking: discussion issue linked from the pull request
- Date: 2026-10-10
- Area: Optional kits / Networking

## Context

`@kits/rollback` sessions require a reliable, ordered link and a fixed input delay and player set. They offer no
spectators, no restart from an agreed state and no way to see why peers diverged. Creators who want rollback play
over unreliable channels, with players who leave, or with viewers had to build those protocols themselves, on top of
the session's strict contiguous-input rule.

## Decision

Add opt-in mechanisms to the same kit, reusing the session as the single owner of input history, snapshots and
checksums:

- `createRollbackExchange`: redundant resend of unacknowledged inputs, acknowledgement vectors, round-trip echoes,
  advantage exchange with a pacing recommendation, silence timeouts, relays of a departing player's inputs, and
  service of spectators.
- `adaptiveDelay`: one authority's decisions ride on its input stream and apply from a frame no peer can have reached.
  They are bounded by range, step and spacing. `recommendInputDelay` and `recommendPacing` are pure helpers.
- `departure`: survivors report and gossip what they hold, decide only with a quorum (default a strict majority),
  agree on the largest report, relay missing inputs and fix
  the departed input by a creator rule.
- `createRollbackSpectator`: confirmed-only stepping with a bounded buffer, catch-up and checksum comparison.
- `start` and spectator `join`: begin from a checksum-validated state.
- `evidence` and `createDesyncEvidenceStore`: bounded, chunked per-frame evidence. JSON texts are explained with the
  replay kit's `explainDivergence`.
- `createLossyLink`: a seeded test link that any kit's tests can import.

All of it is caller-driven: no timers, sockets or new scheduler.

## Alternatives and consequences

- A separate kit: rejected. It would duplicate the session's ownership of input history and checksums.
- Deciding without a quorum: rejected as the default. A false timeout or partition would let both sides decide and
  keep running with different states. A lower quorum stays available as an explicit, documented creator choice
  (two players need it).
- Consensus that survives overlapping departures: rejected for now. A gossiped decision that fails closed on conflict
  is simpler and honest about the remaining case.
- Allowing out-of-order delivery inside the session: rejected. Ordering is the exchange's job, and the session keeps
  its strict, auditable contiguous-input rule.
- Consequences:
  - Sessions without the new options are unchanged (same `config`, results and faults).
  - Retained input history and evidence states cost memory within their configured bounds.
  - A new player joining a running match, frame stretching and authentication remain outside the kit.
