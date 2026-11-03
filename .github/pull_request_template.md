## Why

Describe the concrete problem, expected behavior, and reproduction or issue.

## What

Describe the resulting behavior and affected layer, kit or documentation.
Explain ownership, cancellation, bounds and API/save compatibility where relevant.
Keep the change to one concern, aiming for fewer than 400 changed lines.

## Verification

Record the head and base SHAs, commands and results, and checks not run.
Name affected GAME_DIR values. Focused checks are not full regression acceptance.
For UI/input/camera/quality changes, include inspected screenshots, budget evidence,
affected device profiles and interaction checks. Separate browser emulation from
physical-device evidence; name unverified combinations.
See [device experience policy](../docs/policy/DEVICE-EXPERIENCE.md).

## Requirements touched

List REQ IDs from docs/requirements/requirements.md, or explain why none apply.
Identify relevant contract or acceptance records and any compatibility change.

## AI checklist

- [ ] I followed CONTRIBUTING.md, AGENTS.md and the relevant recipe.
- [ ] I described systems and patterns, preserving required attribution and reproduction identifiers.
- [ ] I recorded assisted work in commit trailers, or no assisted work was used.
- [ ] Tests/docs cover the change, or I explained why they do not apply.
- [ ] I did not weaken budgets, tolerances, tests or expected results to pass checks.
- [ ] I added no code comments or docstrings except machine-required directives.
- [ ] New original contributions use GPL-3.0-only; third-party terms are identified.
- [ ] No secrets or private data are included.
