# Editable itinerary lab

Question: can two different consumers edit a bounded order list without accidentally
restarting its active task or accepting a retired task's completion?

This is an optional, headless prototype, not an exported kit. The controller owns
only order data, the active cursor and one in-process completion ticket. The patrol
fixture uses the existing navigation search; the delivery/service fixture supplies
different quantity and effect rules. Neither installs a clock, scheduler, worker,
navigation queue, storage owner or vehicle model.

See the [contract and evidence](../../docs/guides/itinerary-lab.md). Run from the root:

```sh
node --import tsx --test tools/itinerary-lab/itinerary.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p tools/itinerary-lab/tsconfig.json
```

Do not import lab code into a game. A future supported API would need real consumer
integration and its own adoption review. Current evidence is controller and headless
consumer testing, not saved custody atomicity, real movement or device performance.
