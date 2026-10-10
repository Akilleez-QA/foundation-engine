- **Coherent multi-key save generations.** `@kits/save-generations` (candidate): one writer per save commits a whole
  set of keys to the older of two alternating slots and writes a checksummed commit record last; load returns the
  newest fully valid generation or falls back to the older one, never a mix, with explicit `recovered`, `empty`,
  `corrupt`, `conflict`, `busy` and `cancelled` statuses. It runs on the save store's existing storage port inside its
  reset prefixes. Evidence is headless fault injection only; STD-SAV-16 stays Provisional. See the
  [kit README](src/kits/save-generations/README.md) and [ADR 0116](docs/adr/0116-save-generations.md).
