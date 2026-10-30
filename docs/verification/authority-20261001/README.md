# Durable authority native acceptance

Clean candidate `8317c69e01b5bf64891aa9ec3353fe68b218585f` passed the
[saved report](report.json). The runner recorded `workingTreeDirty: false`, seven
observations and no page or console errors. Screenshots were inspected. This is
local desktop Chromium with software rendering, two isolated contexts and a
separate Node 26.8.1 loopback host, not a physical-device or WAN test.

The saved report preserves original local screenshot paths; selected durable
copies are linked below. Those local paths are evidence provenance, not commands.

- [Visible correction and suffix replay](02-visible-correction.png): confirmed 3,
  predicted 6, one pending command and one replayed input, following an independent
  operator commit through the same authority.
- [Restart after COMMIT before reply](04-restarted-after-commit-before-reply.png):
  process SIGKILL, independent SQL readback, fresh connection and recovered prefix 3;
  committed value 7 survives without repeating its operation.
- [Shared scale](06-explicit-shared-scale.png): confirmed 17 and predicted 19 remain
  distinct, with the scale explicitly labelled.

The runner also checks duplicate/reordered baselines, exact retry without a new
revision, covering/scene retirement, cleared ECS markers and recovery from an
impossible first baseline. UI values and ECS transforms are checked independently
of the predictor's returned state. The host database is read through an independent
SQLite connection. Successful renders do not prove GPU completion or performance
on actual supported devices.

Pure/storage/host tests pass separately: 53 on Node 26.8.1, and 17 storage/host tests
on Node 22.13.0 / SQLite 3.47.2. The 12 adapter tests also passed on Node 22.23.3 /
SQLite 3.51.3. Real process races and SIGKILL do not certify physical power loss,
backup correctness, arbitrary disks or a production identity service.

An earlier exploratory run failed at the scene-exit predicate, which incorrectly
queried `engine.state().scene.id`. The actual API exposes `scene.scene`; the predicate
was corrected without changing the runtime. The exploratory retry and this clean
run passed.

NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed. These later gate/integration results do not change the saved browser report's candidate revision. DV-01 remains open, with minimum phone, tablet and laptop/desktop profiles pending creator selection. No public release or physical-device certification is claimed.
