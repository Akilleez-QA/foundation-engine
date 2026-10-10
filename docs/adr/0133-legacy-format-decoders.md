# ADR 0133: legacy game and multimedia format decoders in the converter toolchain

- Status: Proposed for this implementation; depends on ADR 0130 (offline converters); integration is gated by full CI.
- Date: 2026-10-09
- Area: Tooling / Assets

## Context

Creators recreating or extending older games, or reusing assets they own from them, hold data in formats that only
the original programs read: packed archives, palette sprite frame sets, planar screens, console textures and ADPCM
sound, multimedia-authoring movies and early video. Community reconstructions and emulators document these formats.
The creator decided that decoders for such formats, written independently from that documentation, are in scope, as long
as no third-party code is included without its licence.

## Decision

Add seven kinds to `npm run convert` (ADR 0130): `archive`, `frames`, `planar`, `tim`, `vag`, `director` and
`cinepak`. Each is an independent implementation from the documented format facts, outputs PNG or WAV (plus a
`.meta.json` sidecar for animation rectangles, registration points or loop points) and writes the same provenance
receipt as the other kinds, recording every input it read (archive, palette). Every decompressor is bounded by the
declared output size, and every fixture is created by the tests themselves; no game data is committed.

## Alternatives and consequences

- Depending on an emulator or media library: rejected; large dependencies for a handful of formats, and their licences
  vary. ffmpeg is used only as an optional test oracle where it is installed.
- Runtime loaders for these formats: rejected; the engine keeps glTF, PNG and browser audio at runtime.
- Where references disagree (ADPCM prediction rounding), both forms are offered and documented; the default follows the
  hardware model emulators use.
- No decoder bypasses encryption or copy protection. Converted files keep their source's licence; the receipt records
  where they came from, not whether their use is permitted.
