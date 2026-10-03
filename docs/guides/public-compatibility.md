# Public API compatibility and upgrades

Use `@engine` for author definitions and scene contracts, and documented `@kits/*`
entry points for optional kits. These are the source checkout's supported author
boundaries. Deep imports into `src/core`, `src/platform`, generated files or kit
implementation files are internal dependencies; their presence is not a public
compatibility promise. A creator can replace infrastructure deliberately, but owns
the resulting integration and its verification.

The separately built `@foundation-engine/pure` artifact has a different boundary:
only the subpaths in its generated package `exports` map are consumable contracts.
It does not provide the scene runtime or all source-checkout aliases. Retain the
artifact integrity, revision and source digest from its metadata when upgrading.
The current packaging test checks a freshly written consumer, not a historical
consumer or every prior artifact.

## Version and source identity

The first public source snapshot was `c0e73c9`, with package version `0.1.0`.
It was not a tagged GitHub release. **v0.2.0 is released**: the GitHub release
`v0.2.0` tags `071e3c2` (2026-10-03), and it is the first released compatibility
baseline. Later work on main is listed under **Unreleased** in the changelog until
the next tag. A source commit, package manifest version, passing PR, merged change
and published release are distinct facts. Do not label an untagged source snapshot
as a released compatibility baseline.

Before 1.0, a minor version may introduce a documented breaking change; a patch
should preserve the declared public contract. A minor version is not permission
to omit migration guidance. An added required field or method on a structural
TypeScript adapter can break consumers even if existing callers compile. Review
implementers as well as callers, including return types, callback variance, defaults,
serialized data and ownership/disposal behavior. An optional framework should not
silently change a consumer that does not select it.

## Review an upgrade

1. Record the old and proposed source revisions or artifact digests. List the
   public exports, adapters, saved data and devices the consumer actually uses.
2. Document changed contracts in the changelog: prior behavior, new behavior,
   affected consumers and the smallest migration. Preserve older fixtures rather
   than rewriting them to hide a break; add a separate migrated consumer when needed.
3. Compile retained consumer code against the new entry points and run behavioral
   smoke tests. Type compatibility alone does not establish matching behavior.
4. For persisted data, retain an old envelope and prove migration, refused-write
   recovery and reload of the accepted result. Preserve recoverable old bytes when
   migration or persistence fails; make recovery visible to the consumer.
5. Run the affected consumer's browser/device acceptance and record missing scope.
   A passing unit fixture does not certify rendering, input delivery, performance,
   third-party adapters or every historical game.

## Retained source consumer

The compatibility test retains the original blank scene, input definition and two
behavior tests from `c0e73c9`. Its manifest records exact source paths and hashes.
It compiles those bytes against today's `@engine` and runs the original scene tests.
Run it with Node 22:

```sh
node --test scripts/compatibility.test.mjs
```

Its scope is scene/component/entity/system definitions, built-in components,
world query/touch, pressed input, state updates, cue recording and `testScene`:
a turn reaches its target, and an idle scene leaves the world version unchanged.
This is a retained **public source** consumer, not a release certification. It does
not cover kits, storage, renderer/browser lifecycle or packaged exports. Add focused
fixtures when expanding those promises; do not infer blanket backward compatibility
from this small test.

## Retained v0.2.0 baseline

Two fixtures are retained from the released tag `v0.2.0` (`071e3c2`). Each has a
manifest that pins the revision and the sha256 of every file. A changed byte fails
the manifest check.

- **Consumer:** `scripts/fixtures/compatibility/v0.2.0/` holds the arcade template's
  game files (`game.ts`, `best.ts`, `components.ts`, `play.ts`, `restart.ts`,
  `steer.ts`, `build.brief.ts`, `play.test.ts`) exactly as tagged. The
  compatibility test compiles them against today's `@engine` and `@kits/ui` and runs
  their released tests (S1, S2, S4 and the same-seed replay).
- **Saves:** `src/core/save/fixtures/v0.2.0/` holds envelopes that the v0.2.0 store
  code wrote: the arcade best score (player scope), device settings (device scope),
  the explore kit's progress (player scope), and an `engine-profile` v2 export.
  `generate.mjs` in that folder made them by running the tag's own code, and its
  header gives the command. The manifest records the generator's hash and the Node
  version. `src/core/save/released-v0.2.0.test.ts` loads each envelope with current
  code and checks that the bytes are not rewritten across a flush and a reload. It
  also imports the profile export, quarantines a corrupted envelope with its
  original bytes kept, and leaves a future-version envelope read-only.

```sh
node --test scripts/compatibility.test.mjs
npx tsx --test src/core/save/released-v0.2.0.test.ts
```

**When a retained check fails.** Do not edit the retained bytes or their hashes.
Either fix the engine, or document the break: add a changelog migration note
(what changed, who is affected, what to do) and retain a separate migrated
consumer beside the original. For saves, the recovery route that players already
have still applies:

- An unreadable envelope moves to `<namespace>-q|<key>` with its exact bytes.
- A migrated envelope keeps one copy of its old bytes at `<namespace>-bak|<key>|v<n>`.
- An envelope from a newer build is never overwritten (status `newer`).
- A profile export from v0.2.0 imports with `importPlayer`.

**Limits.** These fixtures cover one template, three sections and one export,
under Node with in-memory storage. They do not certify browsers, real Web Storage
quotas, other templates, kits beyond `ui` and `explore`, or games made before
`c0e73c9`.
