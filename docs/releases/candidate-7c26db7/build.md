# Reproducible build for candidate `7c26db7`

## Instructions

Requirements: Git, Node.js 22.18 or newer in the 22.x line (CI's primary version), npm from that Node.
No account, credential or paid tool is needed.

```sh
git clone https://github.com/Akilleez-QA/foundation-engine.git
cd foundation-engine
git checkout 7c26db7efa5634d1e32b2c18a1a2e63451157f89
npm ci
npm run build          # builds templates/blank/game, the default without a game/ folder
```

`dist/` then holds the static site, with `LICENSE.txt`, `COPYRIGHT.txt` and `THIRD_PARTY_NOTICES.txt`.
To build a template instead, set `GAME_DIR`, for example `GAME_DIR=templates/arcade/game npm run build`.

Use a full Git checkout. A `git archive` or ZIP of the same tree installs and builds, but the budget
ratchet in `npm run lint` compares against `origin/main` history and needs Git (see the
[release checklist](../../guides/release-checklist.md#a-new-checkout)).

The browser checks need Playwright's Chromium:
`npx --no-install playwright-core install --with-deps chromium`. `ENGINE_CHROMIUM` can name an existing
compatible executable instead. `npm run gate:ci` reproduces every CI command locally.

## Rehearsal on the candidate

Run on 2026-10-03 by a coding agent, from a fresh HTTPS clone of the public repository checked out at
`7c26db7efa5634d1e32b2c18a1a2e63451157f89` in a temporary directory (no shared `node_modules`, generated
files or build output). Host: Linux x86-64 (AMD Ryzen 9 7950X, 32 threads, 125 GiB RAM, under other load),
Node 22.23.3, npm 10.9.9, every command at `nice -n 15`. Wall times are for this machine only.

| Step | Command | Result |
|---|---|---|
| Clone | `git clone` + `git checkout 7c26db7` | Clean tree (`git status --porcelain` empty) |
| Install | `npm ci --no-audit --no-fund` | Pass: 37 packages, about 1 s (warm npm cache) |
| Focused check | `npm run check` | Pass in 11 s; typecheck and lints; clean tree, so 0 tests selected (expected, reported explicitly) |
| Lints | `npm run lint` | Pass in 15 s; format, layers, game, arch, types, css, generic, brief (8 games), budgets (104 numbers, 0 raises) |
| Tests | `npm test` | Pass in 87 s: **2,919 tests, 2,919 pass, 0 fail, 0 skipped** |
| Build | `npm run build` | Pass in 11 s; 37 files in `dist/` |

**Repeatability.** The same commit exported with `git archive` (no Git metadata) installed with `npm ci` and
built twice. All three `dist/` trees hash identically:

```text
sha256 over sorted per-file sha256 lines of dist/:
ac94b817923dfe74eb63e2ff43251896dca10e39bf9b82424cf46052390e5cf4
(cd dist && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)
```

This shows the build is deterministic on one machine and Node version. It was not repeated on another
operating system, CPU or Node major. No browser, `gate`, `gate:templates` or `gate:ci` ran in the
rehearsal; hosted CI on the same SHA is the browser and template-gate evidence ([CI evidence](README.md#ci-evidence)).
