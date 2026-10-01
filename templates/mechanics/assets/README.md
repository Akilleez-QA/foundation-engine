# Original animated fixture

`generate-fixture.mjs` deterministically creates `public/models/mechanics/beacon.glb`.
The fixture is original Foundation Engine test content, licensed under CC0-1.0. It contains one
cuboid, two joints, a named `hand` socket, and a one-second `pulse` translation clip.
No downloaded artwork, external buffers, textures, or copyrighted model data is used.

Regenerate with `node templates/mechanics/assets/generate-fixture.mjs`.

`generate-cube.mjs` creates six 16×16 original CC0 PNGs in +X, −X, +Y, −Y, +Z,
−Z order. Each has an orientation glyph and a distinct pale color. These are
small ownership/orientation fixtures, not production sky artwork.
