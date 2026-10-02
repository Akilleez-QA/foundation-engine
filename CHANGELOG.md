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
- Toolchain: TypeScript 6.0 (from 5.9). `tsconfig.json` drops the deprecated
  `baseUrl`; the `@engine`, `@kits/*` and `@game/*` paths were already relative
  and resolve to the same files. TypeScript 7 is not adopted.

See the [acceptance ledger](docs/guides/upgrade-acceptance-ledger.md) for precise
integration evidence and limits. Physical-device acceptance remains incomplete;
compact lesson UI repairs are underway. No universal game/device certification,
public deployment or production multiplayer readiness is claimed.
