# Contact layer

`@kits/contact` answers "who touches whom" for trigger volumes, pickups, hurtboxes, interaction zones and sensors.
It does not do physics response. Bodies are simple volumes, each with a layer and a mask:

- **vertical cylinders:** the common character hitbox;
- **spheres;**
- **axis-aligned boxes.**

Once per fixed step, `update()` finds the overlapping pairs and reports what changed. The report lists `exit`
events, then `enter` events, then `stay` events, each group ordered by `(a, b)`. The kit owns its bodies only.
There is no clock, no ECS binding, no callback and no registration.

```ts
import { createContactLayer } from '@kits/contact';

const PLAYER = 1, PICKUP = 2, ENEMY = 4;
const contacts = createContactLayer({ maxBodies: 512, maxPairs: 1024, maxPerBody: 4 });
contacts.set(player, { shape: { kind: 'cylinder', radius: 0.4, height: 1.8 }, position: [x, y, z], layer: PLAYER, mask: PICKUP | ENEMY });
contacts.set(coin, { shape: { kind: 'sphere', radius: 0.3 }, position: [cx, cy, cz], layer: PICKUP, mask: 0 });
// fixed-step system, after movement:
contacts.move(player, [tr.x, tr.y, tr.z]);
for (const e of contacts.update().events) {
  if (e.kind === 'enter' && contacts.has(e.b)) collect(e.b);   // check liveness: earlier handlers may remove bodies
}
contacts.setEnabled(player, false);   // intangible (e.g. invulnerability frames): pairs exit with removed: true
```

## Inputs and outputs

- **Pairs.** A pair forms when either body senses the other: `a.mask & b.layer` or `b.mask & a.layer`. Each event
  says which side senses (`aSenses`, `bSenses`), so a pickup can stay passive while the player senses it.
- **Overlap is exact and strict.** Touching surfaces are not a contact.
  - Cylinders need overlapping height and horizontal circles.
  - Spheres and boxes use true distance; box corners are not treated as spheres.
- **Identity.** A body keeps its identity while it stays registered: disabling and re-enabling it, moving it,
  or replacing its shape with `set()` all keep it. An id that is removed and then added again, even within one
  step, is a new body. Its old pairs exit and new ones enter.
- **Exits.** A pair exits with `removed: true` when, at the next update, one of its bodies is gone, disabled or a
  new incarnation of its id. Otherwise the exit is an ordinary separation with `removed: false`.
- **Snapshots.** `snapshot()` / `restore()` save and restore bodies, current pairs and incarnation counters for
  saves and rollback. A snapshot taken at any point, including between a removal and the next update, restores, and
  the next update then reports the same events as the original layer. Restored pairs are trusted as the last
  update's result. A pair that no longer overlaps or senses simply exits on the next update. The snapshot object
  is frozen at the top level; its nested values are detached copies.

## Ownership, bounds and overload

- **Limits:** `maxBodies` 1–65536 and `maxPairs` 1–1,048,576. `maxPerBody` (1–1024, default 1024 and always
  enforced) caps simultaneous contacts per body, like a fixed per-object collision list.
- **Admission when a bound is reached:**
  - Pairs already in contact keep priority. A newcomer never displaces an existing contact.
  - New pairs are admitted in `(a, b)` order.
  - The rest are refused and produce no events. `update().refused` counts them.
  - Results do not depend on insertion order.
- **Cost.** `update()` sorts enabled bodies along x and sweeps them: O(n log n + candidate pairs). It allocates
  its event list. `set`, `move`, `setEnabled` and `remove` are O(1). `touching(id)` lists contacts as of the last update and is O(current pairs).
- **Reentrancy.** Calling back into the layer during an operation throws.
- **Validation.** Malformed input throws `RangeError` before any change. Fields are copied once.
- **Events.** Events are frozen values; dispatch is the creator's. A handler that removes a body cannot corrupt
  the list. Check `has(id)` before acting on a body an earlier handler may have removed.

## Limits

- **Positions are sampled per update, with no swept or time-of-impact test.** A fast body can pass through a thin
  volume between steps. Use `@kits/combat` `sweep` or a volume query for that.
- **Boxes are axis-aligned and cylinders are vertical.**
- **One sweep axis.** Thousands of bodies spread along y and z but stacked in x degrade toward O(n²).
- **No physics response.** Contacts are facts. Pushing apart, damage and pickup are creator effects.

## Evidence

`contact.test.ts` covers:

- the enter, stay and exit lifecycle with strict touching;
- layer and mask sensing;
- exact shape pairs: cylinder height, the sphere-against-box corner, cylinder against sphere, cylinder against box;
- removal and intangibility exits;
- bounded admission priority and insertion-order independence;
- event grouping order;
- snapshot replay and validation;
- input validation;
- independent review regressions: snapshots between a departure and the next update, id reuse within a step,
  undone departures and linear mass removal;
- a `testScene` pickup consumer that collects each pickup exactly once while removing bodies during dispatch.

The tests are headless only. No template uses the kit yet.
