- **Optional cellular WASM worker kernel.** `prepareCellularGridWasm` in `@kits/procgen` runs cellular smoothing in a
  small WebAssembly kernel inside the existing worker host, with fixed per-job memory and unchanged seeded output; the
  JavaScript job stays the default and the fallback. See the [guide](docs/guides/cellular-wasm.md) and
  [ADR 0101](docs/adr/0101-optional-cellular-wasm.md).
