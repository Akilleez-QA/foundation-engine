# Lantern courtyard (fixture)

The visual-capability trial's night courtyard as a fixture game (`tools/visual-courtyard/game`), a consumer of the
author API and of `@kits/three`:

| Scene | What |
|---|---|
| `courtyard` | "Before": author API only. No local lights, so each lantern paints stacked transparent discs on the ground and fakes its glow with an additive particle halo. |
| `courtyard-lit` | "After": the same courtyard; lanterns are `customObject`s with real point lights (two cast shadows), the moon casts a shadow, and an EffectComposer with UnrealBloomPass draws every frame (`look.ts`). |
| `glow` | A still scene for the browser check: one lantern through the composer, nothing animating. |

`recipes.ts` holds the remaining examples of [use three.js directly](../../docs/recipes/use-three-directly.md) so
`npm run typecheck` compiles them against the engine's three.js on every change, a three.js upgrade included.

```
npm run test:three-kit-browser            # generates the textures, checks the brief, runs browser.mjs
node tools/visual-courtyard/game/tools/make-textures.mjs
GAME_DIR=tools/visual-courtyard/game npm run play:snap -- --scene courtyard-lit --mobile
```

The textures are generated (`game/tools/make-textures.mjs`, CC0) and not committed. Budgets are the fixture's declared
desktop caps checked in software GL, not performance certification.
