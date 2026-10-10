- **Optional zone and view-volume dormancy.** `@kits/dormancy`: entities become dormant outside every active zone and
  camera-relative view volume and wake when they return, with wake/sleep margins and dwell steps against boundary
  flicker, per-entity policies, a bounded first-in-first-out wake budget with a stated maximum latency, and woke/slept
  lists. Zones can be region-activation regions; `dormantAsFar` feeds population update tiers. Headless tests only.
  See the [kit README](src/kits/dormancy/README.md) and [ADR 0161](docs/adr/0161-optional-view-dormancy.md).
