# kits/character

A kinematic character controller: `Character` (speed, radius) on an entity with a `Transform`, moved by `characterSystem()` from the kit's `character-x` / `character-z` axes (WASD, arrows, stick, d-pad) or a held pointer on the ground, camera-relative by default. It accelerates and stops at fixed rates (frame-rate independent), turns to face its way, and slides along `Walls` and `Solid`s. Pure helpers: `slide`, `standable`, `createMotion`, `turnToward`. Cost: one pass over characters × solids per fixed step; no draws.

For non-flat surfaces, pass `ground: (x, z) => ({ height, normal? })` to `characterSystem`. Samples use world coordinates. Set `groundOffset` to the Transform centre's height above the surface (default `0`; this is not inferred from the character radius). Idle actors and externally teleported actors ground on the next enabled system tick. A null or non-finite height leaves their existing height unchanged and rejects a movement candidate there; there is no fallback to height zero.

With a ground query, pointer movement requires an explicit `pointerTarget(ctx)` returning a world `{ x, z }` or null. Without one it is disabled, so the default flat y=0 pick cannot move a character toward the wrong location. Keyboard/pad movement is unaffected. `pointer: false` disables pointer movement altogether. Without `ground`, existing flat-plane picking and movement retain their behavior.

Surface validation checks the character centre at the endpoint after wall/solid sliding. It is not a swept terrain collision, radius support test, slope limit, gravity or jump simulation; a narrow hole between valid endpoints is not detected. Normals are accepted for compatible surface providers but are not used to tilt the actor or restrict movement. Cost adds one current-surface sample per enabled tick and one candidate sample when moving, per character.

Optional appearance configuration uses `createAppearanceDocument`: creator-named
part identifiers and finite numeric parameters in a bounded, frozen, versioned
JSON document. The creator supplies allowed selections, ranges and compatibility.
It reuses the authoring document owner and edit session for candidate preview,
commit, cancel and history; it installs no movement inputs or renderer.
See [appearance documents](../../../docs/guides/appearance-documents.md) for the
full lifecycle, restoration and consumer contract.
