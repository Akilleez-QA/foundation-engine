# DPR-only author scene redraw — 2026-10-03

Base: public `5a68f06cc6b180780bced73a0444b8b704b8a378`.
Fixed browser source: clean `422975c43904037e7895a5ebe96a4a9913f45b4c`.
This receipt follows that source commit; it changes no runtime or diagnostic code.
The five-line runtime correction is isolated from preserved candidate `08c695c`;
no interpolation, locale, liveness or snapshot API changes are included.

## Reproduction and correction

The existing quality pixel-ratio owner clears/resizes the drawing buffer and emits
a coalesced window resize. Author scenes previously subscribed only to CSS
ResizeObserver delivery. With unchanged CSS, a static scene did not redraw.

On unchanged public runtime source, the focused DPR invalidation and retired-visit
regressions failed (two failed, one passed). The browser diagnostic then failed:
DPR changed 1→0.5 but native render count remained 2 instead of reaching 3. This
was an expected defect reproduction, not a passing baseline. The diagnostic files
were added but runtime source was still public main; raw report records that dirty
worktree scope. Both browser and server were closed through diagnosticReport.

The fix uses the existing guarded visit resize callback for both window and CSS
resize events. Aborted/leaving visits reject late callbacks; ownership cleanup
removes the listener and disconnects the observer. Zero-area sizing remains clamped
to one pixel, with finite camera aspect. No new scheduler, continuous rendering,
quality floor or device target is introduced.

## Commands and results

All commands used Node 22.23.3 and reduced priority (`nice -n 15`). Fresh worktree
installed its own dependencies with `npm ci --no-audit --no-fund` (33 packages).

- `node --import tsx --test src/author/scene-resize.test.ts scripts/play/diagnostic-report.test.mjs`: 8/8 pass (four resize/lifetime tests and four existing cleanup/report tests).
- `npm run check`: pass in 13 seconds; generation, typecheck, lints and 44 selected test files. This is focused-check evidence, not the full integration gate.
- `node scripts/generate.mjs`, then `node -r ./scripts/silent-browser.cjs scripts/play/dpr-redraw-check.mjs`: pass on the clean fixed source above. The diagnostic is appended to the existing CI framework-browser command.
- `git diff --check`: pass.

Chromium 152.0.7977.82, isolated muted desktop software GL, viewport 800×600:

| State | Native renders | Buffer | DPR | CSS box | Scene epoch |
| --- | ---: | --- | ---: | --- | ---: |
| Before | 2 | 800×510 | 1 | 800×510 | 1 |
| Ratio changed | 2 | 400×255 | 0.5 | 800×510 | 1 |
| Next delivered step | 3 | 400×255 | 0.5 | 800×510 | 1 |
| Eight further steps | 3 | 400×255 | 0.5 | 800×510 | 1 |

Authoritative world data remained identical. Screenshot inspection confirmed the
blue subject remained visible. Report: zero errors and failures, passed true;
browser/server cleanup completed. Console/page errors are checked after both
cleanup attempts so late errors cannot leave a passing report.

Raw local evidence is retained under ignored `playtest/framework/dpr-before/`
and `playtest/framework/dpr-redraw/` (`report.json`, fixed `redrawn.png`). Counts
observe successful native render calls, not GPU completion. This is an existing
quality-setting transition, not physical monitor hotplug, a hardware-DPR change,
physical-device quality or human acceptance. No full local integration gate ran.
