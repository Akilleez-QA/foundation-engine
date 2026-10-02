# Original animated fixture

`generate-fixture.mjs` deterministically creates `public/models/mechanics/beacon.glb`.
The fixture is original Foundation Engine test content, licensed under CC0-1.0. It contains one
cuboid, two joints, a named `hand` socket, and a one-second `pulse` translation clip.
No downloaded artwork, external buffers, textures, or copyrighted model data is used.

Regenerate with `node templates/mechanics/assets/generate-fixture.mjs`.

`generate-cube.mjs` creates six 64×64 original CC0 PNGs in +X, −X, +Y, −Y, +Z,
−Z order: one seamless vertical sky gradient (flat +Y and −Y caps that match the
side faces' edges) with a small, low-contrast orientation glyph per face. 64 px
keeps the cube near 0.1 MiB and smooth when a phone magnifies it (16 px faces with
large glyphs looked blurry). These are small ownership/orientation fixtures, not
production sky artwork. Regenerate with `node templates/mechanics/assets/generate-cube.mjs`.

`generate-panel.mjs` creates `public/textures/mechanics/panel.png`, a 32×32 original CC0
riveted panel (RGBA) that the lab tiles across its floor and kiosk to demonstrate
`defineMaterial`. Regenerate with `node templates/mechanics/assets/generate-panel.mjs`.

`generate-chime.mjs` synthesises `public/sounds/mechanics/chime.wav` (0.45 s, 22 050 Hz mono, two soft
partials, about −10 dBFS peak), an original CC0 sound for the `ctx.play` sound-file demonstration.
Regenerate with `node templates/mechanics/assets/generate-chime.mjs`.
