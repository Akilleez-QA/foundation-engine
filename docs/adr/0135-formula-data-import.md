# ADR 0135: spreadsheet import for formula sheets and lookup tables

- Status: Proposed for this implementation; depends on ADR 0124 (the formulas kit); integration is gated by full CI.
- Date: 2026-10-09
- Area: Optional kits / Rules / Tooling

## Context

The formulas kit (ADR 0124) evaluates creator-owned rules but leaves lookup tables as "creator data the caller reads
into inputs". Creators keep that data, and often the formulas themselves, in spreadsheets, or recover them from an
original game's data. Hand-copying a 200-row table into TypeScript is error-prone and loses where the numbers came
from.

## Decision

Add to the kit a CSV/TSV parser, `importFormulaSheet` (rows `kind,id,value`), `importFormulaTable`/
`defineFormulaTable` (keyed tables and matrices, frozen, with `tableValue` and `tableRow`), and the command `npm run
formulas:import` that writes the JSON a game commits, with `meta` (source, input hash, author, licence, note). Loading
runs the same checks as importing; refusals name the spreadsheet row and column.

## Alternatives and consequences

- Reading spreadsheets at runtime: rejected; the committed JSON is reviewed data with a fixed hash, and games load it
  like any other module.
- Spreadsheet formats beyond CSV/TSV (XLSX, ODS): out of scope; every spreadsheet exports CSV.
- Consequences: tables stay data (no formulas inside cells); the importer does not judge whether recovered numbers
  are faithful to their original, only that they are well formed and attributable.
