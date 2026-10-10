- **Actor day schedules.** `@kits/schedules`: authored time windows on the game clock naming an anchor and an
  activity, with travel segments, weekday patterns and conditional variants chosen by flags read once per evaluation.
  An O(log n) placement for any actor at any time, and a bounded, ordered catch-up of skipped windows that always
  returns the exact current entry. Composes with the core clock, itineraries and region activation. See the
  [kit README](src/kits/schedules/README.md) and [ADR 0117](docs/adr/0117-actor-day-schedules.md).
