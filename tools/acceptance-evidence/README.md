# Acceptance evidence prototype

Development-only, unexported reporting helper. It checks whether a runner supplied every predeclared case with enough observations and a passing outcome. It does not run, authenticate, or replace the oracle, and it adds no runtime work or engine owner.

Use cases demonstrated by `consumers.test.mjs`:
- A real replay comparison: exact four-sample agreement, actual divergence, empty trace, and malformed retained history.
- A real SaveStore migration from retained historical bytes, followed by fresh-owner reopen; omitting reopen fails admission.

## Contract

The contract and report both use `format: 'acceptance/1'` and an identical `identity` containing nonempty `artifact`, `configuration`, `oracle`, and `environment` labels. Labels are at most 512 characters. The creator/runner chooses and records their actual meaning; matching strings are not proof of provenance. A commit alone does not identify dirty files or a generated binary.

The contract has 1–256 unique `required` rows: `{id, minSamples}`, with a positive safe-integer minimum. The report supplies at most 256 unique `cases`: `{id, status, samples}`. Status is passed, failed, or skipped; samples is a nonnegative safe integer. Unknown or duplicate cases, invalid counts and foreign identities are invalid. Missing, skipped, failed and under-sampled required cases fail. Zero required cases is invalid.

Each case should correspond to an explicitly named invariant or required observation channel, not merely “suite passed.” Count actual paired observations, not the number of available records. An independent oracle must determine status. Keep golden inputs immutable and preserve exclusions in the runner documentation.

`assessEvidence(contract, report)` returns a detached frozen result with status passed, failed or invalid. Each input collection and the result contain at most 256 rows; work is linear in cases. No timers, asynchronous jobs, persistence or cancellation machinery is created. Disposal is ordinary caller lifetime. Malformed supplied data returns invalid; hostile JavaScript getters/proxies are outside this JSON-oriented contract.

## CLI

```sh
node tools/acceptance-evidence/cli.mjs contract.json report.json
```

Each input is read with a 1 MiB cap. Exit status: 0 passed, 1 failed acceptance, 2 invalid input or I/O failure. The JSON result names missing/insufficient cases. This executable is an opt-in diagnostic; it is not inserted into every existing gate.

The repository's existing test glob discovers `*.test.mjs` here. Run focused checks with:

```sh
node --import tsx --test tools/acceptance-evidence/*.test.mjs
```

Tests exercise real CLI exit statuses for missing files, malformed JSON, absent cases, explicit failure and oversize input. This proves failure routing for those fixtures, not the correctness of a creator's oracle. No browser, physical-device, performance, or kernel equivalence acceptance is implied.

## Extension boundary

No engine API, schema or renderer changes. Existing replay comparison already refuses empty overlap, and decoded snapshots already validate sample coverage; the prototype composes these checks rather than weakening or replacing them. Generated-kernel runners can adopt the same envelope later with artifact digests and their actual comparison/error/lifecycle results. This branch does not depend on an unmerged kernel implementation.
