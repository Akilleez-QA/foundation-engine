# Intended-use route dependency diagnostic

This finite example exercises the existing navigation dependency and portal APIs
through `createApp`, `compileGame`, the Shape ECS renderer, and actual Transform
movement. It adds no runtime abstraction or required game mechanic. The creator
requirement is observable movement safety after an accepted scope change, with
independent routes continuing and explicit recovery by replanning.

The prediction recorded before implementation is: accepting a west change stops
west's copied old route while east continues; preparation or rejection alone does
not invalidate either route; explicit replanning moves west through a handwritten
detour; readiness loss stops west; crossing checks the current portal revision.

## Run and evidence

Root runs this serially with other browser/gate work, after reviewing the files:

```sh
node scripts/play/route-dependencies-check.mjs
# Optional output directory:
node scripts/play/route-dependencies-check.mjs /tmp/route-dependencies-evidence
```

The runner starts a local Vite server and uses the existing isolated Chromium
launcher, always muted, with `?flags=dev.silent`. It does not install dependencies,
change audio settings, or use the user's browser session. It writes a report and
seven screenshots under `playtest/diagnostics/route-dependencies` by default.
The report includes git revision, working-tree status, browser version/executable/
arguments, configuration, every commanded observation, errors, and cleanup failures.
A failed assertion or browser error fails the diagnostic. The output directory is
not cleared: only filenames listed in the current report belong to that run.

Native buttons are clicked through Playwright; Reset is also activated with native
keyboard Enter. The test API only holds/steps the existing frame loop and reads
observations. Actions are consumed once by an authored frame system. Idle browser
frames do not move actors. One Step moves at most half a world unit along each
actor's adopted path. This deliberately finite movement is diagnostic stepping,
not a real-time locomotion controller.

The runner owns independent expected coordinates and an axis-aligned swept-contact
oracle. It does not derive expected movement from the fixture's graph or validity
flags. The obstacle occupies x = [-1, 1], z = [-0.5, 0.5]; actors have horizontal
half extent 0.2. The oracle expands the obstacle by that extent and checks every
detour segment, including the stationary west position after invalidation via exact
coordinate assertions. No generic collision engine is inferred from this example.

The orange west actor begins at (-4, 0), blue east at (-4, 4). Preparing and then
rejecting a west revision permits both to advance to x = -3. Acceptance installs
the red obstacle and notifies only west. Two further movement commands leave west
at (-3, 0) while east reaches (-2, 4). Replan explicitly offers a replacement path:
(-3, 0), (-3, 2), (3, 2), (3, 0), (4, 0). All 22 half-unit positions are checked;
east independently finishes at (4, 4). A fresh run makes west unavailable during
its detour; repeated steps leave its Transform unchanged while east moves.

The purple traveler is a separate crossing subject at (-1, -3). A portal revision
changes from 0 to 1 without a route-dependency notification. Crossing with the
cached revision 0 must return `stale` and leave its Transform unchanged. Refreshing
the expected revision permits `ready` and applies the returned destination (1, -3).
The fixture passes the **current portal object** and **cached expected revision** to
existing `crossPortal`; it does not validate an obsolete portal object against itself.
Its one identity frame and authored clear lane keep this case deliberately narrow.
It does not test arbitrary mutations during callbacks or claim generic atomicity.

## Ownership, limits and recovery

The scene owns one `createLifetimeRouteQueue` (one owner, two retained requests,
ten nodes), one borrowed owner, and one `createRouteDependencies` adapter (two
scopes, two routes, two dependency references, sixteen UTF-16 units per identity).
Both actor requests use distinct IDs at owner generation zero; advancing the shared
owner generation would supersede both and is intentionally not used for west replan.
Graphs are handwritten directed chains with at most five nodes, prepared at offer
time. Each offer pumps at most 128 logical work units through the existing queue.
This is a work count, not a CPU-time guarantee or an additional scheduler.

The fixture keeps one copied path per actor and at most 128 diagnostic history
entries; pending UI commands occupy one slot. Unexpected route admission, incomplete
search, invalid scenario ordering, or a second pending command throws and fails the
browser report. It neither retries forever nor silently drops admission failures.
Reset disposes the adapter, retires its borrowed owner, disposes the queue, resets
Transforms, and opens a fresh bounded cohort. Scene exit performs the same route
cleanup and removes controls. There is no persistence or background worker.

Replanning releases west's previous ticket before offering its replacement. An
unavailable route stays stopped; Reset is this example's explicit recovery. Scope
readiness loss advances the revision. The consumer checks the exact opaque ticket
before copying a completed route and **before every movement using that copy**.
Scope invalidation releases queue records but does not write actor Transforms.

## Headless contract and consumer boundary

The [navigation README](../../src/kits/navigation/README.md) describes the headless
API; [dependency tests](../../src/kits/navigation/dependencies.test.ts) exercise
its finite consumer contract. Creators define scope identities, accepted revisions,
readiness and which routes depend on each scope. There is no automatic scene
partitioning, coordinate inference, spatial overlap analysis, or route generation.
West and east are authored dependency names here, not built-in geographical regions.

Calling `acceptScope` is mandatory only when the chosen consumer publishes an
accepted dependency change. Preparation/rejection does not call it while the old
world remains usable. If the old data becomes unusable, publish readiness loss.
The consumer must establish its own publication consistency before notification;
a ticket adapter cannot roll back partial external render/contact installation.
Mandatory per-motion ticket checks and immediate portal revalidation remain the
consumer's responsibility. A completed planner result describes a path, not actual
actor arrival. The headless APIs never move or physically stop actors themselves.

## Verification scope

The isolated 1280×800 Chromium workflow passed native pointer and keyboard
commands, all 22 independently specified detour positions, unaffected-scope movement,
readiness loss, stale/current portal crossing and disposal of routes and controls.
The captured rendered detour was visually reviewed; controls remain outside the
world. A separate headless consumer review uses the actual World/navigation APIs.

Run the browser script above to reproduce the workflow. This diagnostic establishes
finite consumer behavior in browser emulation, not physical-device performance.
Laptop, phone, tablet, touch, sustained timing and thermal behavior remain unverified.
It changes no application's supported device targets. The integration gate and
remote CI are separate checks; no screenshot certifies them.
