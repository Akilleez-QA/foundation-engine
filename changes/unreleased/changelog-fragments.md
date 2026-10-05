- **Changelog entries are one file per change.** A pull request adds `changes/unreleased/<name>.md` (one bullet in
  the changelog's style) instead of editing CHANGELOG.md, so changes merged in parallel no longer conflict at the top
  of Unreleased. `npm run changelog` previews the section, `npm run lint:changelog` (in `lint` and `check`) validates
  the fragments, and `npm run changelog -- --fold` moves them into CHANGELOG.md at release time
  ([changes/unreleased](changes/unreleased/README.md)).
