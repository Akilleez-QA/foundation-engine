# Optional entity metadata inspection

The existing dev/test API can inspect unnamed entities in the currently attached
authored scene. It does not expose component values or create an editor:

```js
const epoch = engine.state().scene.epoch;
const result = engine.entities({expectedEpoch: epoch, afterId: 0, limit: 32, maxChecks: 512});
if (result.status === 'ready') console.log(result.page);
```

`expectedEpoch` is the existing router visit epoch. `unavailable` means no current
scene provides this optional capability, or its visit/activity has ended.
`stale` supplies the current epoch when the requested one no longer matches.
The stock scene handle checks its original visit signal, activity signal and
`visit.current()` before inspection. Retaining an old handle cannot inspect a
replacement. Entity numbers are local to a world and may repeat on the next
scene visit. Epochs are scoped to this app instance, not durable IDs across app
replacement, reloads, sessions or saved files.

Ready results provide `{epoch, page}`. A page contains `version`, live entity
`total`, budget `checks` consumed, `entities` and `nextAfterId`. Every row has its
numeric `id`, component labels, `componentStoresExamined` and `componentsComplete`.
Rows include entities without a `Name` or any components. Returned arrays and
objects are detached. Inspection reads membership and component-type keys only;
it does not read component values, invoke their getters, serialize resources,
copy geometry or expose mutable ECS internals.

## Bounded observation, not a retained world snapshot

Defaults are `afterId: 0`, `limit: 32`, `maxChecks: 512` and
`maxLabelLength: 120`. Bounds are configurable safe integers; row/check limits
may be zero, while label length is positive. Numeric entity-ID probes—including
deleted gaps—and component-store membership checks share the same check budget.
The helper never allocates a full list of world entities or component keys first.
At most the budgeted work is attempted; output rows are additionally capped by
`limit`, and each output label is bounded by `maxLabelLength` code units.

An empty page can advance through a deleted-ID gap. Use its `nextAfterId`, not the
last returned row. A null cursor means no further allocated IDs existed at this
observation. Zero budgets/row limits intentionally may return an unchanged cursor;
do not loop on such a request expecting progress. `componentsComplete: false`
means this entity's component-store scan exhausted the shared budget. There is
no within-entity continuation in this first slice: retry from `afterId: id - 1`
with a larger budget when a complete component list is needed. Labels have
`truncated` flags and are presentation only; truncated labels can collide and must
not be used as component identities or edit commands.

Pages observe a mutable world. They neither pin its version nor reject later
structural mutations: new entities can appear, removed entities disappear and
components can change between pages. Compare `version` to detect reported world
changes. Authors must still call `world.touch()` after direct value mutations as usual;
version is not a deep-content hash. Stable tooling can hold the existing dev clock
while paging; the inspector adds no scheduler, registry, cache or automatic pause.
It is not a security boundary for arbitrary proxy-backed request objects.

## Ownership and production boundary

`World.inspectMetadata()` is a reusable core metadata primitive. The stock runtime
adds the optional `SceneHandle.entities` bridge only when `TEST_API` is true;
`engine.entities` is in the existing injected dev/test API. Independent renderers
may omit that bridge. The core World method may remain in production JavaScript:
this is not a claim that all inspection bytes are stripped or that invoking the
primitive is forbidden outside dev builds. Production bundle measurement remains
part of validation. No collection occurs unless inspection is called.

The browser diagnostic composes real authored scenes, includes unnamed custom
components with throwing value getters, pages through the installed scene handle,
and navigates to a replacement with the same local entity number. It asserts
stale-epoch rejection, old-handle expiry and application-disposal unavailability.
`test:diagnostics-browser` runs it in CI alongside event and terrain diagnostics.
This verifies metadata access, not a finished entity editor, arbitrary value
serialization, live editing, resource inspection or a replay mechanism.
