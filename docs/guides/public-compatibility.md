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
It was not a tagged GitHub release. Public main at `5a68f06` declares `0.2.0`,
while its changelog work remains **Unreleased**. A source commit, package manifest
version, passing PR, merged change and published release are distinct facts.
Do not label a source snapshot as a released compatibility baseline.

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
