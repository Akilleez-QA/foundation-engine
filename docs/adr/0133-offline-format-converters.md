# ADR 0133: offline format converters with provenance receipts

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Area: Tooling / Assets

## Context

The engine loads models only as glTF/GLB and textures as browser images. Creators often hold motion capture (BVH),
scans and simple meshes (PLY, OBJ) and palette art (PCX, BMP, raw indices with a palette). Until now they had to
find and run a third-party converter, and nothing recorded what was converted or from which files, so
`lint:provenance` reported the results as unrecorded. The creator asked for converters and dataset importers as repo
tools, including formats documented only by other software.

## Decision

Add `npm run convert` (`tools/convert/`): one module per format, written independently from public format
descriptions, converting OBJ/MTL, PLY and BVH to GLB and palette images to PNG, with BVH retargeting by a bone map
that folds unmapped joints. Each conversion writes the output and a provenance receipt (origin, author, licence,
source, output and input hashes, tool, generator options) that `lint:provenance` and `asset:verify` accept. The tool
is offline only; the runtime model loader and its formats are unchanged.

## Alternatives and consequences

- Depending on a general converter library: rejected; it would add a large dependency for a few formats, and the
  receipts and refusals need to be ours.
- Runtime loaders for these formats: rejected; glTF stays the single runtime model format (bounded, validated,
  meshopt-compressible), and conversion happens once, offline.
- Consequences: each new format is one module with oracle tests. Rest-pose retargeting is out of scope (documented).
  Output PNG bytes depend on Node's zlib build.
