# ADR 0134: duplicate and near-duplicate detection as a read-only repo tool

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Area: Tooling / Assets

## Context

Games accumulate repeated assets: a texture copied into two folders, a model re-exported under a new name, source
copied between templates, files taken from another project. Source studies also found whole forks that were
byte-identical to other repositories, found only by comparing git blob ids. The creator asked for duplicate-source
detection as a repo tool.

## Decision

Add `npm run dupes` (`tools/dupes/`): a read-only scan reporting exact duplicates (SHA-256 with git blob ids), GLBs
with identical mesh data, similar PNGs (difference hash) and similar text (MinHash with banding), over the active
game's `public/` folder by default, any paths, or two trees with `--against`. Reports are candidates for a person;
`--fail-on` lets a creator make a check of it. It is not added to `npm run check`.

## Alternatives and consequences

- A perceptual-hash or similarity library: rejected; the needed parts are small, and owning them keeps bounds,
  determinism and refusal reasons explicit.
- Running it inside `npm run check`: rejected for now; deliberate repetition (licence files, generated textures) would
  turn into noise. A creator can add `npm run dupes -- --fail-on exact` to their own workflow.
- Consequences: JPEG/WebP/KTX2 and sounds get exact matching only; compressed GLB geometry is skipped with a reason.
