# Refused save and durable retry consumer evidence — 2026-10-03

The existing weighted-appearance browser check now verifies user-visible persistence
feedback and a complete refusal → retry → reload sequence. Only the browser test
and this receipt change; runtime behavior and save formats are unchanged.

## Exact source and result

`nice -n 15 npm run test:weighted-appearance-browser` passed at
2026-10-03T18:12:12.993844Z on clean
`6a2263997fd82b077444a5baab59a185e9738a27`, based on public main `2fb6e69`.
Test script SHA-256:
`e9e3285762945c0572a5b8d9dde296ec950c591a46c77b5e655cde131af768b2`.
This receipt is a documentation-only follow-up to the tested source.

Environment: Linux, Node 26.8.1, isolated muted desktop Chromium with software GL,
1440×960. The existing fixture injects storage refusal through its storage adapter;
this is not actual browser quota exhaustion or power-loss testing.

## Consumer assertions

1. Save a valid selection and capture its exact durable localStorage envelope.
2. Accept another selection, inject a refused Save, and verify actual DOM status
   starts with `unsaved`, the persistence line starts with `Persistence: unsaved`,
   and Save remains visible and enabled. Durable bytes must remain unchanged.
3. Reload and verify the prior durable selection and its skinning oracle return.
4. Repeat the failed save in a fresh page, then restore writes without reloading.
   Verify the visible instruction to choose Save to retry and the still-unsaved
   state before retrying.
5. Choose Save; verify both visible status fields report saved and the stored
   envelope contains the new selection.
6. Reload again; verify the recovered selection is actually adopted, reports saved,
   and passes the existing independent three-vertex skinning oracle.
7. Rebuild local edit history after reload before running the pre-existing undo,
   animation, incompatible/newer/corrupt restore and disposal checks.

Recorded states were `unsaved:session` for both refusals, then `saved` after retry
and after reload, with the recovered selection retained. The refusal and recovered
reload screenshots were inspected: status text and enabled Save control were
visible alongside the adopted model. Local regenerable artifacts are under
`playtest/weighted-appearance/` (`report.json`, `snapshots.json`, `save-refused.png`,
`save-recovered.png`, `recovered-reload.png`).

The existing unavailable-model branch still emits exactly its two expected error
messages; no additional page errors or scenario/cleanup failures occurred. During
initial test development, an assertion confused the numeric entity handle with the
asset identity; the corrected assertion reads `accepted.asset`. No production
change was needed.

## Supporting checks and limits

```sh
node --import tsx --test src/author/save-handle.test.ts scripts/play/diagnostic-report.test.mjs
node scripts/lint/genericity.mjs
```

Nine focused tests passed, covering storage refusal/retry and diagnostic cleanup.
Script syntax, final-document genericity and diff checks passed. Existing CI already
runs the weighted-appearance browser command, so no workflow expansion is needed.

No full local gate, remote CI, physical-device, multi-writer transaction, actual
storage exhaustion or power-loss acceptance is claimed. This establishes recovery
through one existing diagnostic consumer, not every authored game's recovery UI.
