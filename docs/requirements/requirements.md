# Requirements

This register extracts the stock engine and repository obligations from the
[architecture standard](../STANDARD.md), [creator contract](../CREATOR-CONTRACT.md)
and [capability inventory](../capabilities.md). It does not replace their detailed
clauses or impose mechanics on independently authored games. Capability availability
is distinct from application acceptance.

Verification methods: T = executable test, A = automated analysis, I = inspection,
D = demonstration. Commands run from the repository root. A command listed here
is a verification method, not a claim that it has passed on every revision.

| ID | Requirement | Rationale and source | Verification method |
|---|---|---|---|
| REQ-ARCH-001 | Engine dependencies shall respect the declared layer boundaries. | Downward dependencies preserve replaceable owners; STANDARD, architecture layers. | A: `npm run lint:layers` and `npm run lint:arch`. |
| REQ-BOOT-001 | Modules shall follow the declared boot phases and reject invalid dependency graphs. | Validation precedes installation; STANDARD, module system. | T: `node --import tsx --test src/core/module.test.ts`. |
| REQ-DATA-001 | Open content sets shall use validated registries that freeze before consumption. | Consumers need stable registered definitions; STANDARD, registries. | T: `node --import tsx --test src/core/registry.test.ts`. |
| REQ-SAVE-001 | The save store shall preserve typed section ownership, migrations and invalid-data recovery. | Persisted state must not bypass section contracts; STANDARD, persistence. | T: `node --import tsx --test src/core/save/store.test.ts`. |
| REQ-LOOP-001 | Activities shall share the engine loop and request rendering when needed. | One scheduler owns activity timing; STANDARD, runtime and rendering. | T: `node --import tsx --test src/core/activity/loop.test.ts`. |
| REQ-GAME-001 | Game systems shall use registered actions, keyed text and seeded engine randomness. | Input portability, localization and replay need explicit APIs; STANDARD, authoring contracts. | A: `npm run lint:game`. |
| REQ-PERF-001 | Scene budget increases shall have an explicit reviewed budget-change record. | Quality constraints must not change silently; STANDARD, performance budgets. | A: `npm run lint:budgets`. |
| REQ-EVID-001 | Acceptance records shall distinguish runtime enforcement, automated checks and manual device evidence. | A software gate cannot certify a physical device; creator contract, What enforcement proves. | I: inspect `docs/guides/upgrade-acceptance-ledger.md` and `docs/policy/DEVICE-EXPERIENCE.md` with `git show HEAD:docs/guides/upgrade-acceptance-ledger.md` and `git show HEAD:docs/policy/DEVICE-EXPERIENCE.md`. |

## Scope and change control

This is a selected traceability baseline, not an exhaustive renumbering of every
standard clause or kit-specific contract. Existing STD identifiers remain normative.
Creator-selected replacements describe their own guarantees and evidence. An
unperformed verification remains unverified; requirement wording does not supply a
passing result. Detailed configured limits and supported-device evidence remain in
the linked standard, application records and acceptance ledger.

Changes to these obligations follow [contribution review](../../CONTRIBUTING.md)
and [governance](../../GOVERNANCE.md). Preserve identifiers when wording is clarified;
retire identifiers explicitly when their obligations are removed.
