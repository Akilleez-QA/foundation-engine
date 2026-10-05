# Support matrix for candidate `ffa8c6a`

This matrix records what was actually exercised for the release candidate. It is not a support policy:
**which targets a release claims as supported is the author's decision** (see the
[bundle](README.md#only-the-author-can-do-these)). Nothing here was run on a physical device.

## Evidence classes

| Class | Meaning |
|---|---|
| **CI (headless)** | Exercised by hosted CI on the candidate SHA: Linux runner, headless Chromium with software rendering (SwiftShader), muted. Proves the check ran, not that the experience is acceptable on hardware. |
| **Emulated** | A Chromium viewport with device-scale and touch emulation. **Emulated (CI)** ran in CI on the candidate; **emulated (local)** ran on a developer machine on the candidate (`play:snap`, see [build](build.md#emulated-views-on-the-candidate)) and is not part of CI; **emulated (earlier)** is a receipt at an older revision. |
| **Manual** | A person checked it by hand on real hardware. **No cell in this matrix is manual.** |
| **Unverified** | No evidence for this candidate. |
| **Not a target** | The template's `build.brief.ts` does not declare this device class or input. |

The CI profiles are fixed: desktop 1280×800 (`play:snap`, playtests and the bench, at the `reference`
preset) and phone 390×844 with mobile emulation at the phone tier `medium` (`gate:templates --phone`: one
smoke screenshot plus a budget sample per template; no taps). The tier a real phone starts on is chosen by GPU
detection (ADR 0079), which a headless browser never runs; the phone smoke pins the tier that a
minimum-class phone would get.

## Templates × device classes

Every stock brief declares desktop, laptop, tablet and phone with keyboard, pointer, touch and gamepad, except
`shared-world` (desktop and laptop; keyboard, pointer and gamepad). Learn declares minimum `tablet`; the
others minimum `phone` (`shared-world`: `laptop`).

| Template | Desktop | Laptop | Tablet | Phone |
|---|---|---|---|---|
| blank | CI (headless): gate with playtest `turn`, snap, bench | Unverified | Emulated (CI): Settings sound journey, 820×1180 touch (`test:capture-browser`) | Emulated (CI): phone smoke at `medium`; Settings sound journey 390×844 touch. Emulated (local): `--mobile` |
| arcade | CI (headless): gate with playtests `restart`, `best-reload`; bench with restart; native controls; replay | Unverified | Unverified | Emulated (CI): phone smoke at `medium`. Emulated (local): `--mobile` |
| explorer | CI (headless): gate with playtest `door`; creator journey; first use on dev and production builds. New look (#154): lights, sky, scatter benched in the gate | Unverified | Unverified | Emulated (CI): phone smoke at `medium`. Emulated (local): `--mobile`, `--calm` (motion and emitters stopped) |
| learn | CI (headless): gate with playtest `lesson` | Unverified | Emulated (earlier): 820×1180 lesson layout, [stock-device-20261002](../../verification/stock-device-20261002/README.md) | Emulated (CI): phone smoke at `medium`. Emulated (earlier): 320×568, 390×844, 844×390 layout repair. Emulated (local): `--mobile` |
| expedition | CI (headless): gate, 12 framework and workbench browser checks | Unverified | Emulated (earlier): 820×1180 touch targets, [stock-device-20261001](../../verification/stock-device-20261001/README.md) | Emulated (CI): phone smoke at `medium`. Emulated (earlier): touch targets. Emulated (local): `--mobile` |
| mechanics | CI (headless): gate | Unverified | Emulated (earlier): 820×1180 touch targets | Emulated (CI): phone smoke at `medium`. Emulated (earlier): touch targets. Emulated (local): `--mobile` |
| terrain | CI (headless): gate | Unverified | Unverified | Emulated (CI): phone smoke at `medium`. Emulated (local): `--mobile` |
| shared-world | CI (headless): gate with playtest `paint`; two-tab session on loopback (MP-01) | Unverified | Not a target | Not a target (the phone smoke still runs and passes) |
| showcase | CI (headless): gate (no playtests), bench of both scenes with lights, shadow, sky, scatter and bloom at `reference` | Unverified | Unverified | Emulated (CI): phone smoke at `medium` (4 of 8 point lights, 1 post pass). Emulated (local): `--mobile`, `--calm`, `--quality low` |

**Laptop** has no separate profile anywhere: no trackpad, narrow-window, battery or integrated-GPU evidence.
The 1280×800 desktop run is the nearest proxy, but it does not accept laptops. **Tablet** has no CI profile
except blank's Settings journey. No CI view renders a template at `high` or `low`; those presets are covered by unit tests
and, for showcase `low`, by a local snap.

## Templates × input

| Template | Keyboard | Pointer (mouse) | Touch | Gamepad |
|---|---|---|---|---|
| blank | CI (headless): Settings focus journey; playtest key press | Unverified | Emulated (CI): Settings tap | Unverified |
| arcade | CI (headless): steering, restart playtests, native controls | CI (headless): native UI click only; held-pointer steering unverified | Unverified | Unverified |
| explorer | CI (headless): movement, interaction, doors, reload; `door` playtest | CI (headless): native UI click only; held-pointer movement unverified | Unverified | Unverified |
| learn | CI (headless): `lesson` playtest (8 key presses) | Unverified | Emulated (earlier): lesson controls | Unverified |
| expedition | CI (headless): workbench journeys | CI (headless): DOM button clicks in workbench checks | Emulated (earlier): Begin, shelter return | Unverified |
| mechanics | Unverified in a browser on the candidate | Unverified | Emulated (earlier): Ride | Unverified |
| terrain | Unverified in a browser on the candidate | Unverified | Unverified | Unverified |
| shared-world | CI (headless): two-tab painting; `paint` playtest | Unverified | Not a target | Unverified |
| showcase | Unverified in a browser on the candidate (no playtest; the gate's snap and bench hold no keys that act) | Unverified | Unverified | Unverified |

Every template's actions are also exercised headlessly by its Node tests (`testScene`), which drive actions,
not devices. Pad bindings exist for every action and are lint-checked, but no browser check emulates a
gamepad. Simultaneous touch is covered only by the engine-level `touch-sources` fixture, not by a template.

## Node.js

| Version | Evidence |
|---|---|
| 22.x (22.18 minimum, `engines: >=22.18`) | CI (headless): `browser`, `templates-1`, `templates-2` and `check` run Node 22. Clean-checkout rehearsal on Node @NODE22@ (see [build](build.md)). |
| 26.x | CI (headless): the `node-current` job runs `npm test` and `npm run check` on Node 26. No browser checks and no template gates on 26. |
| 23–25 | Unverified. The Node 23+ test-reporter change is handled (#108), but these majors are not run. |
| < 22.18 | Not supported; npm scripts stop with a version message. |

## Browsers

| Browser | Evidence |
|---|---|
| Chromium (Playwright's build in CI; Chromium locally) | CI (headless) with software GL |
| Chrome, Edge (desktop, hardware GPU) | Unverified |
| Firefox | Unverified |
| Safari, iOS Safari | Unverified |
| Android Chrome | Unverified (phone rows are Chromium emulation, not Android; GPU tier detection is unit-tested on reported strings only) |

WebGL2 is the only render backend. Audio is muted in every test browser, so nothing audible is verified.

## Operating systems

CI and the rehearsal ran on Linux x86-64 only. Windows-safe scripts are unit-tested, but nothing ran on
Windows or macOS for this candidate.
