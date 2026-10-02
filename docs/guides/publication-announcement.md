# Discord announcement draft

The repository is public at the link below (first public commit `c0e73c9`).
The author has posted the announcement on Discord; this file keeps the
draft text for reference.

---

**Introducing Foundation Engine — an open-source engine for browser games**

Foundation is a TypeScript + three.js framework built around four goals: quality,
performance, maintainability and extensibility.

You decide what your game should be. Use, change, replace or leave out the provided
frameworks. Choose mobile, tablet, desktop or separate editions with different
quality targets—the smallest device doesn't have to define every version.

**What's included?**
• A scene/entity/system author API, input actions, saved progress, asset management
  and owned resource lifetimes.
• Optional terrain, inventory/equipment, objectives, progression, crafting and
  networking frameworks.
• Starting templates, generators, diagnostics, tests and performance-budget checks.
• Documented contracts for working yourself, with contributors or with coding agents.

**Try it locally** — install Node.js 22.13+ and Git, then:
```sh
git clone https://github.com/Akilleez-QA/foundation-engine.git
cd foundation-engine
npm ci
npm run new-game -- --template blank --id my-game --title "My Game"
npm run dev
```
Open the local URL printed by Vite. Your game code lives in `game/`.

Start with `README.md`, `docs/CREATOR-CONTRACT.md` and `docs/recipes/`.
Coding agents should also read `AGENTS.md`. Run `npm run check` as you develop;
the release checklist explains the full tests and Chromium-backed gates.

**Status:** early development. Device-specific usability and performance still
need testing; this isn't a promise that every template or game is production-ready.
Bug reports, focused examples and documentation contributions are welcome.

Engine license: **GPL-3.0-only**. Read `LICENSE` and `THIRD_PARTY_NOTICES.md` before
redistributing your build.

Source: https://github.com/Akilleez-QA/foundation-engine
