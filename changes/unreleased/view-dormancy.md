- **Optional zone and view-volume dormancy.** `@kits/dormancy`: entities become dormant outside every active zone and
  camera-relative view volume and wake when they return, with wake/sleep margins and dwell steps against boundary
  flicker, per-entity policies, a bounded first-in-first-out wake budget with a stated maximum latency (`always`
  entities and `initial: 'awake'` bypass it), and woke/slept lists. Views follow the engine camera yaw convention.
  Zones can be region-activation regions; `dormantAsFar` feeds population update tiers (strict no-update needs `near`
  tiers or `isAwake`). Headless tests only; independent review findings fixed.
  See the [kit README](src/kits/dormancy/README.md) and [ADR 0161](docs/adr/0161-optional-view-dormancy.md).
