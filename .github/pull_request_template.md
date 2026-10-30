## Problem and resulting behavior

Describe the concrete problem, what this changes, and the issue/reproduction if applicable.

## Contract and scope

Identify the engine layer or optional kit. Explain ownership/cancellation, bounds, and API/save compatibility where relevant. Keep game-specific content separate.

## Validation

List commands and results, affected GAME_DIR values, and any checks not run. For visible/runtime changes, include inspected screenshots and measured budget evidence. `npm run check` on a clean tree is not a full regression run; the integration gate remains required.

For UI/input/camera/quality changes, include affected phone/tablet/laptop/desktop
profiles, active-world visibility and touch/keyboard interaction evidence. Separate
emulation from physical-device measurements and name unverified combinations.
See docs/policy/DEVICE-EXPERIENCE.md. Standards-only edits do not certify runtime UI.

## Contribution checks

- [ ] I followed CONTRIBUTING.md, AGENTS.md, and the relevant architecture recipe.
- [ ] I described systems and patterns instead of external game names or source-project references, while preserving required attribution and reproducible identifiers.
- [ ] Tests/docs cover the behavior changed, or I explained why they are not applicable.
- [ ] I did not weaken budgets, tolerances, or tests to make checks pass.
- [ ] New original contributions are submitted under GPL-3.0-only; third-party material is identified with its license and necessary notices.
- [ ] No secrets or private data are included.
