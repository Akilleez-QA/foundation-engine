# Unreleased changes

One file per change, so pull requests that land in parallel never edit the same lines of
[CHANGELOG.md](../../CHANGELOG.md).

Add `changes/unreleased/<kebab-name>.md` in the same pull request as the change. It holds exactly one bullet in the
changelog's style: a bold title, then how things behave now, with continuation lines indented two spaces:

```md
- **Blob shadows.** Scenes can opt in to soft ground shadows drawn in one instanced draw; see the
  [guide](docs/guides/blob-shadows.md).
```

Links are written as they will read from CHANGELOG.md (relative to the repository root). Do not add new entries to
CHANGELOG.md's Unreleased section directly.

- `npm run changelog` prints the Unreleased section as it will read: these fragments, newest first, above the entries
  already in CHANGELOG.md.
- `npm run lint:changelog` (part of `npm run lint` and `npm run check`) validates them: a kebab-case name, one
  bold-titled bullet, a final newline, at most 24 lines.
- At release time, `npm run changelog -- --fold` moves every fragment into CHANGELOG.md and deletes the files
  ([release readiness](../../docs/guides/release-checklist.md#before-making-a-release)).
