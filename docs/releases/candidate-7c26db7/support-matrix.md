# Support matrix for candidate `7c26db7`

This matrix records what was actually exercised for the release candidate. It is not a support policy:
**which targets a release claims as supported is the author's decision** (see the
[bundle](README.md#only-the-author-can-do-these)). Nothing here was run on a physical device.

## Evidence classes

| Class | Meaning |
|---|---|
| **CI (headless)** | Exercised by hosted CI on the candidate SHA: Linux runner, headless Chromium with software rendering (SwiftShader), muted. Proves the check ran, not that the experience is acceptable on hardware. |
| **Emulated** | A Chromium viewport, device-scale and touch emulation. **Emulated (CI)** ran on the candidate; **emulated (earlier)** is a receipt at an older revision and has not been repeated on the candidate. |
| **Manual** | A person checked it by hand on real hardware. **No cell in this matrix is manual.** |
| **Unverified** | No evidence for this candidate. |
| **Not a target** | The template's `build.brief.ts` does not declare this device class. |

The CI profiles are fixed: desktop 1280×800 (`play:snap` and the bench), phone 390×844 with mobile emulation
(`gate:templates --phone`, one smoke screenshot plus a budget sample per template; keys only, no taps).

## Templates × device classes

Every stock brief declares desktop, laptop, tablet and phone with keyboard, pointer, touch and gamepad,
except `shared-world` (desktop and laptop; keyboard, pointer and gamepad). Learn declares minimum `tablet`;
the others minimum `phone` (`shared-world`: `laptop`).

| Template | Desktop | Laptop | Tablet | Phone |
|---|---|---|---|---|
| blank | CI (headless): gate, snap, bench | Unverified | Emulated (CI): Settings sound journey, 820×1180 touch (`test:capture-browser`) | Emulated (CI): phone smoke; Settings sound journey 390×844 touch |
| arcade | CI (headless): gate, bench with restart (#75), native controls, replay | Unverified | Unverified | Emulated (CI): phone smoke |
| explorer | CI (headless): gate, creator journey (#72, #98), first use on dev and production builds (#73, #104) | Unverified | Unverified | Emulated (CI): phone smoke |
| learn | CI (headless): gate | Unverified | Emulated (earlier): 820×1180 lesson layout, receipt [stock-device-20261002](../../verification/stock-device-20261002/README.md) | Emulated (CI): phone smoke. Emulated (earlier): 320×568, 390×844, 844×390 layout repair |
| expedition | CI (headless): gate, 12 framework and workbench browser checks | Unverified | Emulated (earlier): 820×1180 touch targets, [stock-device-20261001](../../verification/stock-device-20261001/README.md) | Emulated (CI): phone smoke. Emulated (earlier): touch targets |
| mechanics | CI (headless): gate | Unverified | Emulated (earlier): 820×1180 touch targets | Emulated (CI): phone smoke. Emulated (earlier): touch targets |
| terrain | CI (headless): gate | Unverified | Unverified | Emulated (CI): phone smoke |
| shared-world | CI (headless): gate, two-tab session on loopback (#61, #97) | Unverified | Not a target | Not a target (the phone smoke still runs and passes) |

**Laptop** has no separate profile anywhere: no trackpad, narrow-window, battery or integrated-GPU
evidence. The 1280×800 desktop run is the nearest proxy, but it does not accept laptops.

## Templates × input

| Template | Keyboard | Pointer (mouse) | Touch | Gamepad |
|---|---|---|---|---|
| blank | CI (headless): Settings focus journey | Unverified | Emulated (CI): Settings tap | Unverified |
| arcade | CI (headless): steering, restart, native controls | CI (headless): native UI click only; held-pointer steering unverified | Unverified | Unverified |
| explorer | CI (headless): movement, interaction, doors, reload | CI (headless): native UI click only; held-pointer movement unverified | Unverified | Unverified |
| learn | Unverified in a browser on the candidate | Unverified | Emulated (earlier): lesson controls | Unverified |
| expedition | CI (headless): workbench journeys | CI (headless): DOM button clicks in workbench checks | Emulated (earlier): Begin, shelter return | Unverified |
| mechanics | Unverified in a browser on the candidate | Unverified | Emulated (earlier): Ride | Unverified |
| terrain | Unverified in a browser on the candidate | Unverified | Unverified | Unverified |
| shared-world | CI (headless): two-tab painting | Unverified | Not a target | Unverified |

Every template's actions are also exercised headlessly by its Node tests (`testScene`), which drive actions,
not devices. Pad bindings exist for every action and are lint-checked, but no browser check emulates a
gamepad. Simultaneous touch is covered only by the engine-level `touch-sources` fixture, not by a template.

## Node.js

| Version | Evidence |
|---|---|
| 22.x (22.18 minimum, `engines: >=22.18`) | CI (headless): every job runs Node 22 (`browser`, `templates-1`, `templates-2`, `check`). Clean-checkout rehearsal on Node 22.23.3 (see [build](build.md)). |
| 26.x | CI (headless): the `node-current` job runs `npm test` and `npm run check` on Node 26 (#108). No browser checks and no template gates on 26. |
| 23–25 | Unverified. The Node 23+ test-reporter change is handled (#108), but these majors are not run. |
| < 22.18 | Not supported; `npm` scripts stop with a version message. |

## Browsers

| Browser | Evidence |
|---|---|
| Chromium (Playwright's build in CI; Chromium 152 locally) | CI (headless) with software GL |
| Chrome, Edge (desktop, hardware GPU) | Unverified |
| Firefox | Unverified |
| Safari, iOS Safari | Unverified |
| Android Chrome | Unverified (phone rows are Chromium emulation, not Android) |

WebGL2 is the only render backend (#118). Audio is muted in every test browser, so nothing audible is
verified.

## Operating systems

CI and the rehearsal ran on Linux x86-64 only. Windows-safe scripts are unit-tested (v0.2.0), but nothing
ran on Windows or macOS for this candidate.
