# Stock explorer creator journey — 2026-10-03

## Scope and revision

The new `npm run test:creator-journey-browser` composes the existing explorer template, settings service, input lifecycle, scene router, save store and pooled renderer. CI now runs this command. No engine runtime or template behavior changed.

Passed locally at **2026-10-03T17:33:32.914154+00:00**, on base `1be7ba7c7d61e11126d0f6959d68155b67a987fd` with the new test/command/CI files uncommitted (`dirtyWorktree: true` in the report). The exact tested script was committed unchanged in `6d7b20f686c61729ee8fc9d18381e5c9f9da3084`. Script SHA-256: `0caf3535d9a5c8e88ea558bfb58167ef7426a0c5710274ed77a9dd78e2b45581`. This is working-tree evidence tied to exact test content, not a claim that a full gate ran on that commit.

Environment: Linux, Node 26.8.1, Chromium 152.0.7977.82, 1280×800 isolated headless software-GL context, muted by the standard browser launcher and `dev.silent`, seed 1. Run at niceness 15; no other task browser was active. Local regenerable artifacts: `playtest/creator-journey/report.json` and `start.png`, `discovered.png`, `reloaded.png` (not committed). The reloaded screenshot was inspected: readable Found 3 of 3, completion banner, garden and player rendered.

## Acceptance established

- Real keyboard movement changes player position.
- Emulated window blur clears held input. The stock character retains its authored 0.1-second deceleration, then stays stationary when focus returns until a fresh press.
- The real shell sound setting is activated using native Space; the menu closes and the actual settings owner records muted=true. Test sound remains silenced independently.
- Bench, lamp and crate interactions run through real E input. Teleports position fixtures; this does not claim complete traversal using continuous movement.
- Garden → shed → garden uses authored doors and checks arrival positions. All three discoveries are reflected in the HUD.
- Three additional round trips retain one live pooled context and zero overflows. Lease count progresses 1 → 3 → 5 → 7 → 9; release audits are present. The last audit reports zero textures/geometries/programs and seven GL objects handled by the pool's release sweep. This is not a claim of zero sweep work or complete heap/listener leak freedom.
- The test waits for actual localStorage envelopes containing all three discoveries and the setting, then reloads the same context and checks HUD plus sound setting.
- Nine recorded states, no page errors, and no browser/server cleanup failures.

## Validation

Passed:

```sh
nice -n 15 npm run test:creator-journey-browser
node --import tsx --test src/author/save-handle.test.ts src/platform/input/keyboard.test.ts src/kits/explore/explore.test.ts scripts/gate-ci.test.mjs
```

The focused source run passed **25 tests**, zero failures/skips. It includes refused-save preservation and retry through the existing author adapter/testScene, explicit fresh-store reload, future-format distinction, lifecycle failure cleanup, keyboard interruption, explore progress/doors, and CI workflow parser selection.

During development, two test assumptions failed before the passing run: expecting instantaneous stop ignored authored deceleration; holding the manual frame clock during asynchronous scene activation prevented presentation readiness. The test now bounds the authored coast and resumes real frames during routing before holding the clock for deterministic interaction assertions. No production behavior or existing tolerance was weakened.

## Remaining acceptance

This does not close physical-device, OS suspension, gamepad, touch, auditory, accessibility or newcomer trials. It does not exercise actual quota exhaustion or rendered refused-save/retry UI; existing headless save tests remain that limited evidence. It does not certify full application disposal, heap/listener retention, WAN sessions, production-bundle behavior or combined-candidate full gates. Lamp visual state and player position are not promised persisted state. Public API and save formats are unchanged.

## Review follow-up

Strengthened startup and first-return assertions require exactly one live context and zero overflows, so a leak already present before repeated visits cannot become an accepted baseline. Rerun passed at 2026-10-03T17:37:27.471526+00:00 on base `45c8171` plus the reviewed assertions; 9 states, no failures. Exact tested script SHA-256: `9b940508dd0e41f78198102a8aa5d4854fa50cb118efea3a1d6bc6fe8b55edae`. The source is committed unchanged with this receipt. Browser and server closed successfully; no full integration gate was run.
