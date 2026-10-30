# Upgrading a game from 0.2.0 to candidate `7c26db7`

The authoritative list is the changelog's
[Upgrading from 0.2.0](../../../CHANGELOG.md#upgrading-from-020) section: each entry says what changed, who
is affected and what to do. This page is the order to work through it.

## 1. Update the source

Foundation is distributed as source. Merge or rebase your game's repository onto the candidate, or copy
your `game/` folder into a fresh clone of it. Then reinstall from the lockfile:

```sh
npm ci
```

Use Node 22.18 or newer (CI tests 22 and 26; see the [support matrix](support-matrix.md#nodejs)).

## 2. Run the checks that got stricter

```sh
npm run typecheck     # noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noImplicitReturns
npm run lint:types    # no explicit any; double casts need a reason
npm run lint:game     # Math.random() and literal UI text in game code
npm run lint:brief    # playtest scripts are validated
npm test              # testScene refuses unknown cue and sound ids
```

Each failure names the file, line and fix. The changelog entry for each check explains the change.
`npm run format` applies the new Prettier formatting.

## 3. Check behaviour that moved

- **`enter()` runs before systems step (#92).** Initialise state in `enter()`; guards that only existed
  for the early ticks can go.
- **Each game ships only its own static files (#59).** A game that loads `models/mechanics/…`,
  `textures/mechanics/…` or `sounds/mechanics/…` copies `templates/mechanics/game/public/` into its own
  `game/public/`.
- **Save import results (#77)** gain `orphan-conflict` and `orphan-failed`; handle them if you switch over
  the outcome.
- **`npm run check` (#67)** selects nothing on a clean committed branch; use `-- --base origin/main` or
  `-- --all`.

## 4. Confirm

```sh
npm run check
npm run gate
```

Saves written by the v0.2.0 store load unchanged: the retained v0.2.0 envelopes are checked on every test
run ([public compatibility](../../guides/public-compatibility.md#retained-v020-baseline)). That is
evidence for the retained arcade baseline and the stock store, not a guarantee for every game's own save
format; keep your own migration fixtures
([add a save section](../../recipes/add-a-save-section.md)).
