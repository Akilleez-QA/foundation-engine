# Lazy scene body evidence

The opt-in generator uses the existing `SceneBody` contract. Ordinary `.ts`
discovery is unchanged. The learn day/night implementation was renamed without
changing its simulation code.

Production Vite builds of the learn template were compared on the review-fix
base (`e0e4985`, incorporated in main `9232e6f`) and the rebased lazy-body change
(`c939fa2`). Both builds use the same dependency installation and build options.
The sum of emitted JavaScript in the HTML entry's recursive **static** import
closure changed from 679,706 to 678,584 bytes: 1,122 fewer startup bytes.
The manifest now lists `templates/learn/game/day-night.body.mts` as a dynamic
entry with a 1,099-byte chunk, outside that static closure. The original build
had no separate day/night chunk. These are minified, uncompressed sizes, not
network transfer sizes or measured latency improvements.

The node discovery test proves a body evaluation sentinel remains untouched
while ordinary definitions and helpers load, then executes once through
`bodyOf`. Existing lesson tests verify the unchanged behavior. Generator tests
exercise both inline and lazy output, compile and run the generated scene, and
reject collisions before partially writing the lazy scene files. Independent
review checked browser/node discovery parity and that `.mts` retains type and
game import checks.

Shared static dependencies remain eager. This small example does not establish
large-game load-time savings, device performance, or a reason to move every
scene into a separate chunk. First-entry latency and application-specific
prefetch policy remain separate measurements and decisions.
