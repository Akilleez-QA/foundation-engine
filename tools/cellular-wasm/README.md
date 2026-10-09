# Optional cellular smoothing kernel

This original Foundation kernel is GPL-3.0-only, compiled from `kernel.rs` with
Rust 1.99.0 (`b940084d7`, 2026-09-28). It implements the existing procgen cellular
Moore-8 rule: outside cells count as solid, and open/solid cells compare their
neighbor count with birth/survival thresholds. Fill, seeded randomness, scheduling,
cancellation and output publication remain with the TypeScript job owner.

## ABI and bounds

The module imports only `env.memory`. It exports `__heap_base` (65536) and
`smooth_chunk(input, output, width, height, start, end, birth, survive) -> u32`.
All arguments are unsigned 32-bit integers; the host validates JavaScript inputs
before conversion. Input and output are distinct byte planes in the imported
memory above `__heap_base`, of length `width * height`. Valid input bytes are 0/1.
The half-open visit range is within the plane and contains at most 4096 cells.
Birth/survival thresholds are 0..9. A successful call returns 0; invalid bounds,
overlapping planes or thresholds return 1 before any write. A zero-length visit
range is valid for a nonempty plane. Each visit reads at most eight neighbors.

The kernel has no allocator, retained buffers, callbacks or memory growth. Its
stack reservation is 65536 bytes, placed first. The linker requires two initial
memory pages and declares no maximum, allowing each host job to supply its exact
fixed-size memory with `initial === maximum`:

```
pages = ceil((65536 + 2 * width * height) / 65536)
```

Page rounding and linker storage fit within a declared scratch allowance of
131072 bytes plus two bytes per plane cell. The module contains no owned memory;
retiring a job drops its instance and memory references; physical reclamation
is controlled by the browser collector. Cancellation occurs between
chunks under the existing TypeScript owner. Invalid calls write nothing; the
host treats nonzero status or a trap as failure and does not publish partial output.

## Reproduce and verify

Install the pinned Rust toolchain with `wasm32-unknown-unknown` in an isolated
compiler-tools directory when desired; no repository dependencies are required.
The local `rust-toolchain.toml` pins rustup invocations. The build also rejects any
compiler version/commit other than the recorded compiler. `CELLULAR_RUSTC` can
select an already installed compiler binary without changing a global toolchain.
`TMPDIR`, `CARGO_HOME` and `RUSTUP_HOME` can all point outside the repository.

```
node tools/cellular-wasm/build.mjs
node tools/cellular-wasm/build.mjs --check
node --test tools/cellular-wasm/kernel.test.mjs
```

The build uses no Cargo dependencies. It compiles into a temporary directory and
removes it, embedding only the binary bytes into
`src/kits/procgen/cellular-wasm-bytes.ts`. That generated file records source and
artifact SHA-256 hashes, the exact compiler and all build flags. `--check` rebuilds
and compares the entire generated file without modifying it. JavaScript consumers
need no Rust installation. The focused tests cover ABI/imports, source provenance,
fixed memory admission, all threshold combinations on small edge cases, larger
plane chunk parity, unchanged input, untouched future chunks and rejection without
writes. These are correctness checks, not browser performance or physical-device
acceptance evidence.
