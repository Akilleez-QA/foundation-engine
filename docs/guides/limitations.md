# Limitations and safety-relevant use

This page lists what Foundation Engine does not do and the constraints a game author
should know before relying on it. It is the user-manual home for assumptions and
limitations (SWEHB 5.12) and stands in for a hazard report, which does not apply
because the software is not safety-critical
([SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)).

## What the engine is not

- Not a safety, engineering or regulatory tool. It controls no hardware and makes no
  determinations about the physical world. Its physics and maths kits are for games.
- Not a published library or hosted service. It is source; `package.json` is
  `private: true`. There are no hosted accounts, matchmaking or public Internet
  multiplayer infrastructure ([README](../../README.md#not-included)).
- Not a guarantee of device support. Framework checks and CI phone smoke are emulation.
  Phone, tablet, laptop and desktop acceptance are separate, manual, per-game
  activities ([device experience policy](../policy/DEVICE-EXPERIENCE.md)).

## Security assumptions

- Browser clients are untrusted. Client-side anti-cheat is not a security boundary.
  Networked games keep authority on the host; see the [integrity guide](integrity.md).
- The local session host (`npm run host`) is for local sessions. It closes a client
  with a wrong join code and refuses weak codes, but it is not hardened for exposure as
  a public Internet service.
- `ENGINE_HOST` makes the development server reachable from the network, including its
  development test API. Leave it unset unless you mean to share the dev server.
- Dependency install scripts run only with a reviewed `allowScripts` entry.

## Data and persistence

- Saves live in the player's browser storage (localStorage and IndexedDB). The browser
  or the player can clear them. The store quarantines unreadable bytes instead of
  overwriting them, but it cannot recover data the browser deleted.
- Released v0.2.0 save fixtures load with current code. Saves from a future engine
  version are read-only.
- The default player protection never destroys saved progress. Games for young players
  can opt in to the stricter [kid-safe profile](../policy/KID-SAFE.md).

## Determinism and performance

- Bit-identical results across engines are proven only for the optional deterministic
  maths module (`src/core/dmath.ts`) and the numeric kit, in Node and Chromium. Ordinary
  `Math.*` results differ between engines.
- Performance budgets are contracts checked by the gate on a reference configuration.
  They are not a measurement of any player's device. Measured results and their limits
  are in the [acceptance ledger](upgrade-acceptance-ledger.md).

## Verification limits

- A passing `npm run check` on a clean tree can select zero tests.
- Documentation-only pull requests skip the CI work jobs by design.
- Behavior with no test is listed as a gap in the
  [requirements specification](../requirements/requirements.md#7-untested-behavior-requirement-gaps).
