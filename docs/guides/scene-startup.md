# Scene startup and fallback routing

A creator's `defineGame({ firstScene })` selects where an empty or unresolved hash
opens. The stock `layerModules` assembly passes that scene to the existing router;
module registration order does not override it. Compilation validates that the
scene exists. Its canonical registered route is the fallback, including that
route's fixed parameters.

An exact route or successful redirect takes precedence. Shared links keep their
scene and query parameters. Falling back alone does not rewrite browser history;
redirect rows retain their existing `replace`/`keep` address policy. Unresolved
addresses retain the resolver's existing behavior of discarding their query when
selecting fallback parameters.

Low-level consumers may configure `routerModule({ fallbackScene: 'scene.start' })`
or pass a scene ID as the third argument to `createHashRouter(tables, win, scene)`.
Omitting the option preserves the first registered route fallback. An explicitly
configured missing scene, or one without a route, fails router construction rather
than silently selecting an unrelated scene.

This is configuration of the existing router, not another navigation owner. Route
resolution retains its existing four-redirect-hop bound and registry ownership.
Scene cancellation, loading failures, retry and teardown remain owned by the scene
shell and handover. The shell's `home` continues to provide its failure-card return
route and fallback when a resolved scene has no dispatch entry.

Focused regression coverage in `src/app/first-scene.test.ts` composes actual game
compilation, stock layer assembly, kernel registration, router service and scene
shell with inert scene bodies. It proves activation with alphabetically reordered
scene registration, empty/unknown hashes, valid deep links and redirects. Router
tests additionally cover canonical fixed parameters, omitted configuration and
invalid configuration. Browser rendering and physical-device performance are not
established by these Node tests. Integration gates remain required before merging.

The native action and crafting browser workflows passed at `7c58763` after removing
their forced startup hashes. The initial full gate failed when the existing learn
isolation test's build child returned no exit status; the isolated test subsequently
passed. The cause was not established, so the failure is retained and subprocess
diagnostics now include status, signal and error. Final-head gate rerun remains
required; browser success alone does not close integration acceptance.

Final candidate `7673d74` passed both native browser workflows with no page/console
errors and all seven template gates (1,873 tests;129 performance checks;zero enforced
breaches/regressions/inconclusive,four advisory software-GL heap warnings). It
integrated in PR #119 at `a3d1516`; combined main tests/build passed. This closes
the named routing acceptance, not physical-device or general networking acceptance.
