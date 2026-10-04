# Native model presentation attachments

`ModelAttachment` is optional. A creator chooses the parent entity, named socket,
offset and unavailable/visibility policies. It attaches a separately owned rigid
`Model` presentation to another model's current native pose. It does not alter
simulation `Transform`, physics, inventory, entity lifetime or game rules.

```ts
import { Model, ModelAttachment, Transform } from '@engine';

const parent = ctx.world.spawn(Transform(), Model({ asset: 'mechanism' }));
const child = ctx.world.spawn(Transform({ x: 4 }), Model({ asset: 'indicator' }));
ctx.world.add(child, ModelAttachment({
  parent, socket: 'mount', unavailable: 'hide', inheritVisibility: true,
  // Optional column-major affine matrix; omitted means identity.
  offset: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.2, 0, 1],
}));
```

## Inputs and ownership

Supply `parent`, `socket`, `unavailable` and `inheritVisibility` explicitly.
Parents are positive safe integer entity IDs in the current scene world; socket
names contain 1–256 characters. The offset contains exactly 16 finite numbers
and an affine final row `[0, 0, 0, 1]`. Captured input and offset are detached and
frozen. No supplied array methods are invoked. Replace the relation with
`world.add(child, ModelAttachment({...}))` to edit it, then `world.touch()` as
appropriate for authored updates. Prefab spawning clones component data, so the
model owner also validates and captures the live relation on reconciliation.

The existing scene model owner owns attachment metadata alongside its admitted
model slots. It adds no loader, leases, renderer parenting, independent scheduler
or persistence store. Relation count cannot exceed the existing admitted model
count (`maxInstances`, default 64, permitted 1–1024 in the scene owner). Genuine
model overload still throws; attachments do not increase resource admission.
Graph work is O(N+E), with one parent per child and E≤N. Matrix work adds constant
size affine composition per relation plus existing native node matrix updates;
this work bound is not a physical CPU deadline.

### Loading: the model chunk

The scene model owner and everything it uses (instances, rig capture,
attachments, pose links, material looks, playback) is a lazy chunk,
`scene-model-chunk`, that only a scene with a `Model` entity loads. A scene whose
own entities include a `Model` loads it while it prepares, before its first frame,
so its models start as before. A scene that spawns its first `Model` from a system
requests the chunk on that frame. Until it arrives, `ctx.modelState` reports
`loading`, attachments and pose links `unresolved` and sockets `null`, the same
answers as for a model the owner has not admitted yet (`model-pending.ts`); if the
chunk fails to load, the visit reports it once and models report `failed`. After
the first load every later visit starts its models synchronously. Blank template
build: the `runtime` chunk fell from 484,661 to 460,268 bytes (126,020 to 118,007
gzip); the model chunk is 26,019 bytes (8,988 gzip).

## Ordering and exact presentation

The owner advances native animation and applies explicit node pose overrides
before resolving attachments parent-first. The child root receives the full
socket-world × offset matrix, converted to its scene container's local frame.
It does not decompose the result into uniform scale or Euler angles. Nonuniform
scale, reflection and shear remain representable. Nonfinite output and a singular
scene-container transform are unresolved invalid presentation, never silently
clamped. A model can itself be a parent regardless of allocation order.

Newly loaded attached roots remain hidden until reconciliation. Unattached model
loading behavior and resource `modelState()` are unchanged. Attachment readiness
is a separate query:

```ts
const resource = ctx.modelState(child);          // asset ownership/readiness
const presentation = ctx.modelAttachmentState(child); // last observed relation
```

The attachment query is frozen metadata only. It does not request assets, advance
animation, recompute matrices, retry, invalidate or inspect geometry. Replacing a
component produces `unresolved` until the next reconciliation. Raw direct
mutation outside the constructor is observed on the next reconciliation, not by
the query. Headless `testScene` reports `unresolved` for present relations; it does
not fabricate native pose readiness.

## Unavailability and replacement

| Status | Meaning |
| --- | --- |
| `absent` | Owner closed, or child lacks Model/Transform. |
| `unattached` | Child has no relation. |
| `unresolved` | No current captured observation, or capture was superseded. |
| `waiting` | Current child or parent model is not ready or parent is absent. |
| `missing-socket` / `ambiguous-socket` | Named node absent or duplicated. |
| `cycle` | Child belongs to a cyclic relation, including a self-link. |
| `blocked` | Upstream attachment is not currently resolved. |
| `invalid` | Invalid live input or unrepresentable finite output. |
| `ready` | Current relation resolved against the current adopted parent asset. |

`hide` hides an unavailable child. `hold` retains its last valid scene-local root
presentation and prior inherited visibility; before the first successful resolve
it also hides. The child's own `Model.visible` always applies. `held: true` is
historical presentation, not ready dependency state: descendants apply their own
unavailable policies rather than using the held ancestor as a current socket.

`inheritVisibility: false` allows a valid invisible parent to be a transform
anchor; it cannot bypass missing or blocked ancestry. Parent asset replacement
cannot resolve against the retired asset. Child asset replacement creates a fresh
slot with no held history. Changing any relation field resets held history.
Removing the component restores the child's current authored Transform and
visibility. Removing a parent never silently despawns its children.

Input captures are bounded snapshots. If a later capture supersedes an earlier
component, its previous readiness is discarded and replacement stays hidden until
fresh reconciliation; removed relations restore ordinary presentation. Existing
slot identity/cancellation checks prevent late loads or callback reentry from
reviving a retired owner. Scene exit releases every native instance and lease
through the same existing owner. Numeric entity IDs are scene-local: retain the
correct scene context rather than treating an integer as a cross-visit identity.

## Evidence and scope

Focused model-owner tests exercise current-frame animation, authored movement,
explicit pose overrides, independent affine matrix values, reversed chains,
cycle/dependency handling, hide/hold, visibility, missing/ambiguous sockets,
finite-output rejection, transformed scene containers, replacement and late
completion, capture supersession, disposal reentry, and idle dirty suppression.
Resource, readiness and inspection regressions remain separate tests.

Run `npm run test:model-attachment-browser` for the opt-in original-GLB desktop
consumer. It checks current-pose rigid geometry, native controls and owner lifetime
with browser screenshots. Inspect the report for the tested revision; a committed
runner alone is not a passing result or hardware certification. Cached
rigid geometry bounds can provide a numeric matrix oracle; they are not pixel
measurements and do not cover skinned/morphed vertex bounds. This framework does
not implement skeletal fusion, retargeting, welded meshes, shared skeletons or
physics parenting. Independent rigid attachments do not establish those contracts.
