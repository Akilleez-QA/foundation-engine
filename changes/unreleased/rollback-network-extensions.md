- **Rollback over lossy links (ROLLBACK-NET-01).** Resend, agreed delay, departures, spectators, resume and desync
  evidence: `@kits/rollback` gains opt-in, caller-driven mechanisms; sessions without them are unchanged.
  `createRollbackExchange` resends unacknowledged inputs with acknowledgements, round-trip echoes, a pacing
  recommendation, timeouts and relays. `adaptiveDelay` applies bounded delay changes, decided by one authority, at a
  frame every peer knows in time (`recommendInputDelay` sizes them). `departure` makes survivors agree, with a quorum
  (default a strict majority), on a leaver's last frame (the largest report) and fix its later input by a creator
  rule. `createRollbackSpectator` steps only
  confirmed frames, with a bounded buffer and catch-up. `start` and spectator `join` begin from a checksum-validated
  state. `evidence` and `createDesyncEvidenceStore` keep bounded, chunked desync evidence, and `createLossyLink` is a
  seeded test link. Seeded randomized 3- and 4-peer runs over lossy links, with spectators, delay changes, a departure
  and a late join, agree checksum for checksum with a reference replay (headless, local). Real transports, a new
  player joining a running match and device acceptance are not established
  ([guide](docs/guides/rollback-network.md), [ADR 0140](docs/adr/0140-rollback-network-extensions.md)).
