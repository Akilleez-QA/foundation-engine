# Upgrading a game from 0.2.0 to candidate `ffa8c6a`

The authoritative list is the changelog's
[Upgrading from 0.2.0](../../../CHANGELOG.md#upgrading-from-020) section: each entry says what changed, who
is affected and what to do. This page is the order to work through it. A game already on the earlier
candidate `7c26db7` starts at step 3.

## 1. Update the source

Foundation is distributed as source. Merge or rebase your game's repository onto the candidate, or copy
your `game/` folder into a fresh clone of it. Then reinstall from the lockfile:

```sh
npm ci
```

Use Node 22.18 or newer (CI tests 22 and 26; see the [support matrix](support-matrix.md#nodejs)).

## 2. Run the checks that got stricter (since 0.2.0)

```sh
npm run typecheck     # noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noImplicitReturns
npm run lint:types    # no explicit any; double casts need a reason
npm run lint:game     # Math.random(), literal UI text, removed three.js APIs (with @kits/three)
npm run lint:brief    # playtest scripts are validated; budget rows within the brief's ceilings
npm test              # testScene refuses unknown cue and sound ids
```

Each failure names the file, line and fix. `npm run format` applies the Prettier formatting; a failed
`format:check` now prints that command.

## 3. Check behaviour that moved since 0.2.0

- **`enter()` runs before systems step (#92).** Initialise state in `enter()`.
- **Each game ships only its own static files (#59).** Copy any `templates/mechanics/game/public/` files you
  load into your own `game/public/`.
- **Save import results (#77)** gain `orphan-conflict` and `orphan-failed`.
- **`npm run check` (#67)** selects nothing on a clean committed branch; use `-- --base origin/main` or
  `-- --all`.

## 4. New since `7c26db7`: what a game can notice

- **Phones start on a lighter preset (#155, #164).** Without `quality.tier` in the brief, a first run on a
  mobile GPU starts on `low`, `medium` or at most `high`. If your game needs every device on one tier, declare
  `quality: { tier: '…' }`. Check your phone view: `npm run play:snap -- --mobile` now snaps at `medium`.
- **The gate runs your playtests (#165).** A failing `playtest/*.json` or `how: 'playtest'` criterion now
  fails `npm run gate`. Run `npm run play:playtests` and fix what fails; never delete the playtest.
- **Calm stops non-essential particles (#171).** An emitter that must show under Calm (feedback the player
  needs) gets `essential: true`.
- **Light refusals (#158, #172).** `refused` counters count lights, not reports. A light the tier has no slot
  for is `refused.tier` (info); an essential one refused is still an error.
- **Budget rows (#158, #161, #167).** Budgets gain `postDraws`, `shadowPasses` and `shadowCasters`. Re-measure
  with `npm run bench` and `npm run perf:derive`; a scene that adds a shadowed point light or post-processing
  needs a measured row. Raises still need a `Perf-Budget:` line (anywhere in the commit message) and the
  author's agreement.
- **Model presentation is a lazy chunk (#160).** A scene whose first `Model` is spawned by a system sees its
  models one chunk fetch later; `ctx.modelState` reports `loading` until then.
- **Asset provenance (#137).** Files in `game/public/` without a provenance record are warnings in
  `npm run check`; nothing fails unless the brief sets `assets: { provenance: 'required' }`.
- **Capabilities (#156).** If you change the engine (add an export, kit, knob, template or script), run
  `npm run capabilities` and commit the result, or `lint:docs-claims` fails.

None of the look features (tone mapping, lights, shadows, sky, materials, scatter, post, `@kits/three`) is on
unless a scene asks for it; see the [art-direction recipe](../../recipes/art-direction.md) to adopt them.

## 5. Confirm

```sh
npm run check
npm run gate
```

Saves written by the v0.2.0 store load unchanged: the retained v0.2.0 envelopes are checked on every test
run ([public compatibility](../../guides/public-compatibility.md#retained-v020-baseline)). That is evidence
for the retained arcade baseline and the stock store, not a guarantee for every game's own save format; keep
your own migration fixtures ([add a save section](../../recipes/add-a-save-section.md)).
