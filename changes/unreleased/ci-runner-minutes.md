- **CI still reports `check` when only docs change.** Pull requests and pushes to `main` always start the
  workflow. A `changes` job skips `browser`, `templates-1`, `templates-2` and, on a push, `node-current` when
  every path is under `docs/` or is Markdown, and the required `check` job still runs and passes. The Node 26
  `node-current` job runs on a code push to `main` and on a Monday 06:00 UTC schedule. That schedule also runs
  `changes` with code set, so `node-current` is not skipped behind it. In-progress runs are
  cancelled only for pull requests. No workflow uploads an artifact.
