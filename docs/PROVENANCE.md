# Provenance

This engine was extracted from a production browser game. Only the engineering came across: the module kernel and registries, the frame loop and render-on-change, the save store and its migrations, the renderer pool and quality presets, the input action map, workers, i18n machinery, the performance budgets with their ratchet, the gate, bench, quality and deploy guards, and the standard's laws.

No content and no gameplay model came across: no art, strings, names, scenes or mechanics of the original game, and no genre assumptions. Genre patterns are optional kits chosen by a game; the core, platform and author layers are checked for genre vocabulary by `npm run lint:generic`.
