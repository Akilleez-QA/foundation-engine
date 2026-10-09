# Editable itinerary lab

Question: can two different consumers edit a bounded order list without accidentally
restarting its active task or accepting a retired task's completion?

This optional headless lab now consumes the public candidate @kits/itinerary. The controller owns
only order data, the active cursor and one in-process completion ticket. The patrol
fixture uses the existing navigation search; the delivery/service fixture supplies
different quantity and effect rules. Neither installs a clock, scheduler, worker,
navigation queue, storage owner or vehicle model.

See the [contract and evidence](../../docs/guides/itinerary-lab.md). Run from the root:

```sh
node --import tsx --test src/kits/itinerary/itinerary.test.ts tools/itinerary-lab/itinerary.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p tools/itinerary-lab/tsconfig.json
```

Games import @kits/itinerary, never lab fixtures. Patrol and delivery/service now
live in separate consumer files. Current evidence is controller/headless testing
and a real SaveStore round trip, not saved custody atomicity, real movement or device
performance. The public helper remains a candidate pending integration review.
