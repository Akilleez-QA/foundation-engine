---
name: new-game
description: Start a new game with the author. Interview them, fill the build brief, pick the template from the genre, propose a milestone plan with a vertical slice first, and get to a first play:snap. Use when the author wants to make a new game or has no game/ folder yet.
---

# New game

The brief is the contract (AGENTS.md). Nothing is built before the author agrees to it.

## 1. Interview (short; one message, then follow-ups only where needed)

Ask, in plain words:
1. **Pitch**: what is the game in one or two sentences? What does the player do again and again (the core loop)?
2. **Genre**: which template is closest? `blank` (anything), `arcade` (score, fail, restart), `explorer` (move around, use things, doors), `learn` (a lesson: teacher, board, sim, quiz; kid-safe), `terrain` (a character on authored hills), `expedition` (routes, objectives, inventory: many kits), `mechanics` (riding, equipment, a loaded model: many kits), `showcase` (a good-looking world: palette, light presets, baked light, low-poly forms), or another genre (start from `blank`). Each has a README in `templates/<name>/README.md`: what is in it, controls, what to change first.
3. **Audience**: who plays? Ages? Is it for children (`kids: true` turns on the kid-safe profile, docs/policy/KID-SAFE.md)?
4. **Devices**: which devices must it run on, and which is the weakest (the minimum sets every budget ceiling)? Keyboard, touch, gamepad?
5. **Success**: how will we know the first version works? Turn each answer into a checkable criterion (what is observed, where, the pass condition, and how: test, playtest, gate or manual).
6. **Constraints**: content or IP rules (no violence, original art only, …).

## 2. Start from the template

```
npm run new-game -- --template <genre> --id <game-id> --title "<Title>"
```

The id is the save namespace: choose it once. Then edit `game/build.brief.ts` with the answers and mirror it at the top of `GAME.md` (Brief block and success table). `npm run lint:brief` checks they agree.

Run it in the checkout the author is working in (never a fresh worktree from `origin/main`: it has no `game/`, so every command would build `templates/blank/game`). If `./game` already exists, stop and ask; `--force` replaces it. Then put the game on its own branch and commit it:

```
git switch -c <game-id>
git add game GAME.md
git commit -m "Start <Title> from the <genre> template"
```

Commit again after each step that passes `npm run check`. The worktree, serial-integration and production rules in AGENTS.md are for engine contributions; see "Building your own game" there.

## 3. Propose the milestone plan in GAME.md

1. **Vertical slice**: one scene, the core loop playable end to end, with its success criteria checked. Smallest possible.
2. Then one milestone per addition, each small enough to show in one playtest round.

Show the plan and ask the author to confirm before building.

## 4. First round

`npm run check`, then `npm run play:snap -- --mobile` (if phones are targets). Show the screenshots from `playtest/latest/` and the probe line, and ask what to change.
