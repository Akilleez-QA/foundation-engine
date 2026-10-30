- **Interior reflection (#183).** `defineEnvironment({ reflection: { kind: 'interior', size, eyeHeight, wall, floor, ceiling,
  lights } })` gives metal, glass and wet surfaces a dim procedural interior to reflect (surface colours and intensities,
  at most 8 glowing lights) instead of nothing or a bright studio. Validated at definition, built once per distinct
  interior as one 1 MiB half-float equirectangular texture in a lazy chunk, prefiltered once by the renderer, disposed on
  change or exit; no per-frame cost on any preset. Cube reflections are unchanged. Unit tests; the browser check
  `npm run test:interior-reflection-browser` passed 2026-10-05 in local software GL on the reference and low presets (mirror sphere centre 255,255,255, rim 8,8,8; relit after one change; draws 1/1; idle 0)
  ([scene look guide](docs/guides/scene-look.md#interior-reflection)).
