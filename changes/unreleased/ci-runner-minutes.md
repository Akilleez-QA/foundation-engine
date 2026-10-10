- **CI spends fewer hosted minutes.** Pull requests and pushes to `main` skip runs whose changes are only
  `docs/**` or Markdown. The Node 22 `browser`, `templates-1`, `templates-2` and aggregate `check` jobs still
  run on pull requests. The Node 26 `node-current` job runs on a push to `main` and on a Monday 06:00 UTC
  schedule, and `check` accepts that skip on a pull request. The schedule does not start the Node 22 jobs.
  No workflow uploads an artifact.
