- **Actor day schedules.** `@kits/schedules`: authored time windows on the game clock naming an anchor and an
  activity, with travel segments, weekday patterns and conditional variants chosen by flags read once per evaluation.
  An O(log n) placement for any actor at any time whose `windowEnd` always advances, and a bounded, ordered catch-up
  of skipped windows that agrees with placement and returns the exact current entry. A roster with an anchor index
  composes with region activation; orders feed the itinerary controller. See the
  [kit README](src/kits/schedules/README.md) and [ADR 0117](docs/adr/0117-actor-day-schedules.md).
