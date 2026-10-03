# Recipe: write a playtest script

A playtest script plays your game in a muted, isolated browser, step by step, and checks what the engine reports.
Use it for what a `testScene` test cannot show: real input timing, drawing, scene changes and **reloading the page**.

```sh
npm run play:script -- game/playtest/best-reload.json
```

Scripts live in `game/playtest/`. Evidence goes to `playtest/latest/<name>/`: one PNG per `snap` and `report.json`
with every step's result. The command exits 1 when an expectation fails or the page logs an error. A malformed script
exits 64 before any server or browser starts, with one line per problem:

```text
game/playtest/jump.json: 1 problem(s):
  step 4 (expect) has an unknown matcher "atMost" (use one of equals, contains, atLeast, exists)
  (format: docs/recipes/write-a-playtest-script.md)
```

`npm run check` (lint:brief) runs the same check on every `.json` file in `game/playtest/`. It also checks that the
`scene` and every `goto` name a scene the game has. A criterion with `how: 'playtest'` and a malformed script fails in
`npm run play:criteria` without starting a browser.

## 1. The file

The arcade template's `game/playtest/best-reload.json`:

```json
{
  "name": "best-reload",
  "description": "S4 in a browser: the best score is still there after the page reloads.",
  "scene": "play",
  "seed": 5,
  "steps": [
    {"expect": {"path": "world.state.best", "equals": 0}},
    {"waitUntil": {"path": "world.state.phase", "equals": "over"}, "ms": 40000},
    {"expect": {"path": "world.state.best", "atLeast": 1}},
    {"snap": "before-reload"},
    {"reload": true},
    {"expect": {"path": "world.state.phase", "equals": "playing"}},
    {"expect": {"path": "world.state.score", "equals": 0}},
    {"expect": {"path": "world.state.best", "atLeast": 1}},
    {"snap": "after-reload"}
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Letters, digits, `.`, `_`, `-`. The evidence folder is `playtest/latest/<name>/`. |
| `scene` | no | The scene the page opens on (default: the game's first scene). |
| `seed` | no | A whole number for `?seed=`; the same seed gives the same `ctx.random()` stream (default 1). |
| `description` | no | What the script shows, for people reading it. |
| `steps` | yes | A non-empty list. Each step has exactly one action from the table below. |

## 2. Steps

| Step | Optional fields | What it does |
|---|---|---|
| `{"goto": "level", "params": {"n": "2"}}` | `params` (string values) | Goes to a scene as a player would (`window.engine.goto`). |
| `{"key": "ArrowUp", "ms": 800}` | `ms` (default 0: one tap) | Holds a key down for `ms`. |
| `{"press": " "}` | | Taps a key. |
| `{"teleport": [3, -1.2], "name": "player"}` | `name` (default `player`) | Moves a named entity to `x`, `z`. Fails the run if there is no such entity. |
| `{"wait": 500}` | | Waits this many milliseconds. |
| `{"snap": "after-turn"}` | | Saves a screenshot `NN-after-turn.png`. |
| `{"expect": {"path": "world.state.score", "atLeast": 1}}` | | Checks `engine.state()` once (matchers below). |
| `{"waitUntil": {…matcher…}, "ms": 20000}` | `ms` (timeout, default 20000), `every` (poll, default 100) | Polls until the matcher holds; fails on timeout. |
| `{"pressUntil": "Enter", "until": {…matcher…}, "every": 500, "ms": 60000}` | `ms`, `every` | Presses the key every `every` ms until the matcher holds. |
| `{"holdUntil": "]", "until": {…matcher…}, "ms": 15000}` | `ms`, `every` | Holds the key down until the matcher holds, then releases it. |
| `{"reload": true}` | `ms` (timeout for the scene to be active again, default 20000) | Reloads the page, as a player pressing reload would. |

**Matchers.** `path` is a dotted path into `window.engine.state()`, for example `world.state.score`,
`world.named.player.y` or `scene.scene` (the active scene, as `scene.<id>`). Use exactly one matcher:

| Matcher | Holds when |
|---|---|
| `"equals": v` | the value is `v` (compared as JSON) |
| `"contains": v` | the value is a list containing `v` |
| `"atLeast": n` | the value is a number ≥ `n` |
| `"exists": true` / `false` | the value is (or is not) present and not null |

There is no `atMost` or `below`. To check an upper bound, assert on a value the game computes, such as a
`ctx.state.tooHigh` flag.

## 3. Reloading

`{"reload": true}` reloads the page with the same address. That address keeps the current scene, `?seed=` and the
silent test flag. Before unloading, the page flushes the save store at its `pagehide` flush point, as it does for a
player. The step passes once a scene is active again, and `report.json` records which one. After it, saves come from
the browser's storage, so what you `expect` next is what a returning player would see. The reloaded page keeps that
storage for the rest of the run, and every run starts with empty storage.

To test the same thing without a browser, use `createTestSaves()` in a game test
([add a save section](add-a-save-section.md#5-test-the-same-save-path)).

## 4. Timing

- A step after a `press` sees the state one frame late. Wait for something the press changes, such as a caption or a
  scene (`waitUntil`), before you `snap` or `expect`. A fixed `wait` works on your machine and fails on a slower one.
- `key` returns before the held key has moved anything. Follow it with a `waitUntil` on what it should change
  (`world.named.player.y`), not a `snap`.
- Prefer `waitUntil`, `pressUntil` and `holdUntil` to fixed waits. Their `ms` is a timeout, not a delay.

## Limits

- The test browser is muted and uses software rendering. It is not physical-device evidence, and a `snap` is not an
  experience check ([device experience](../policy/DEVICE-EXPERIENCE.md)).
- `reload` keeps the same tab's storage. It does not test a new tab, another browser, cleared site data or a storage
  failure. The engine's own save store tests cover storage failures (with failure-injecting memory storage that game
  tests cannot reach).
- A script asserts on `engine.state()` only. It cannot read the DOM or audio.
