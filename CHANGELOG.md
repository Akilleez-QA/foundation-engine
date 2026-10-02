# Changelog

## Unreleased

Foundation Engine is preparing its first public source release. Package version
`0.1.0` does not itself establish that a public release exists.

- Genre-neutral TypeScript/three.js runtime, author API, owned lifetimes, input,
  persistence, assets, workers and engineering checks.
- Seven stock starting templates and optional frameworks for terrain, authored
  content, state composition, diagnostics and network authority/prediction.
- GPL-3.0-only engine license and separately documented third-party/asset licenses.
- Contributor, security, governance and release preparation documentation.
- Newcomer documentation: a getting-started guide, a cookbook of checked recipes
  (models, HUD and buttons, collision and picking, camera and lighting, sharing a
  build), a README per template, a "Not here yet" list, and the solo-game workflow
  in AGENTS.md and the agent skills.
- Newcomer toolchain: Node.js 22.18+ is required and checked up front (`.nvmrc`,
  `.node-version`); a missing test browser stops with the install command and
  installed Chrome/Chromium is found per OS; tools start without `npx` or shell
  quoting so check, gate and tests can run on native Windows (not yet verified on
  Windows hardware); `--game <dir>` selects a game on any shell; `npm run play --
  --host` serves on the local network for phone testing; a wrong `GAME_DIR` is one
  line listing the templates.
- three.js and `@types/three` upgraded from 0.183 to 0.186 as a deliberate migration.
  The version-checked adapters (batch state for the change trackers, the private
  shadow-pass cache) are re-verified and pinned to r186; any other revision still
  falls back to observed/full-quality paths. Engine world-matrix reads keep r183
  results under r185's `updateWorldMatrix` change, and the trackers now force on
  camera-fitted `SunLight` cascades and observe `LightProbeGridWebGL`. Upstream
  rendering changes (for example multi-scattering energy compensation for
  `MeshStandardMaterial`) slightly alter shading.
- Toolchain: TypeScript 6.0 (from 5.9). `tsconfig.json` drops the deprecated
  `baseUrl`; the `@engine`, `@kits/*` and `@game/*` paths were already relative
  and resolve to the same files. TypeScript 7 is not adopted.

See the [acceptance ledger](docs/guides/upgrade-acceptance-ledger.md) for precise
integration evidence and limits. Physical-device acceptance remains incomplete;
compact lesson UI repairs are underway. No universal game/device certification,
public deployment or production multiplayer readiness is claimed.
