# Verification matrix

This matrix traces the selected REQ identifiers from the companion requirements
register prepared on `fem/20261030-fe-5-requirements`. That branch and this branch
start independently from the same source baseline; integrate both to publish the
register and its evidence together. No other standard clauses are claimed covered.

Evidence baseline: `294dfa96394e208c4d53d78caaeb79f071e28143`. Documentation
changes on these branches do not change the tested implementation. T = executable
test, A = automated analysis, I = inspection. Commands run from the repository root.

| Requirement | Method | Test file or command | Result | Source commit |
|---|---|---|---|---|
| REQ-ARCH-001 | A | `npm run lint:layers`; `npm run lint:arch` (included in `npm run lint`) | Passed locally as part of lint | `294dfa9` |
| REQ-BOOT-001 | T | `node --import tsx --test src/core/module.test.ts` | Passed locally in the combined test command below | `294dfa9` |
| REQ-DATA-001 | T | `node --import tsx --test src/core/registry.test.ts` | Passed locally in the combined test command below | `294dfa9` |
| REQ-SAVE-001 | T | `node --import tsx --test src/core/save/store.test.ts` | Passed locally in the combined test command below | `294dfa9` |
| REQ-LOOP-001 | T | `node --import tsx --test src/core/activity/loop.test.ts` | Passed locally in the combined test command below | `294dfa9` |
| REQ-GAME-001 | A | `npm run lint:game` (included in `npm run lint`) | Passed locally as part of lint | `294dfa9` |
| REQ-PERF-001 | A | `npm run lint:budgets` (included in `npm run lint`) | Passed locally against `origin/main` at this baseline | `294dfa9` |
| REQ-EVID-001 | I | `git show HEAD:docs/guides/upgrade-acceptance-ledger.md`; `git show HEAD:docs/policy/DEVICE-EXPERIENCE.md` | Inspection found explicit unverified device scope; not device acceptance | `294dfa9` |

## Reproduction and limits

The combined invocation passed all selected tests locally:

```sh
node --import tsx --test src/core/module.test.ts src/core/registry.test.ts src/core/save/store.test.ts src/core/activity/loop.test.ts
npm run lint
```

These results apply to the checked files and configured lint rules, not arbitrary
extensions or every standard clause. Documentation-only `npm run check` can select
no tests. Full integration CI, browser behavior, physical devices and sustained
performance were not verified by this documentation pass. Existing broader evidence
and its limitations remain in the [acceptance ledger](../guides/upgrade-acceptance-ledger.md).
