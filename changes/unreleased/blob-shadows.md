- **Blob (contact) shadows (VIS-10).** `defineScene({ blobShadows: sceneBlobShadows({ max, ground, crossfade,
  distance }) })` and a `BlobShadow({ width, depth, opacity, ground, visible })` per entity draw soft ground ellipses,
  all of a scene in one instanced draw (+1 draw, +2 triangles per blob, no shadow pass, no texture). A blob stands in
  where an entity has no real sun shadow: beyond the sun's shadow box (crossfading across its edge), in a scene
  without `sceneShadows()`, with the player's `shadows.quality: off`, or for a `Model` or non-caster. Bounded by `max`
  (default 64, cap 1024); over it the nearest to the camera are kept and the overload is reported once. Buffers are
  allocated once and upload only on change; leaving disposes them; the drawing is a lazy chunk. Unit tests; browser
  acceptance `npm run test:blob-shadows-browser` passed 2026-10-05 in local software GL on the reference and low presets (7 candidates, 4 drawn in 1 draw, +8 triangles, 1 dropped; shadows off 4 drawn, 3 dropped; idle 0 frames; a move uploads once; disposed on exit). No template uses it, so no budget changed
  ([guide](docs/guides/blob-shadows.md)).
