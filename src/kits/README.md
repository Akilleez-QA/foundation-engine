# `kits/`: optional genre kits

Genre patterns built on the author API (`src/author`, `@engine`): a game chooses them in `defineGame({ kits })` and imports them as `@kits/<name>`. The engine runs with none. A kit may import the author API, core, platform, domain and the kits it declares in `requires`; core, platform and the author layer never import a kit (`npm run lint:layers`). Genre vocabulary is at home here, not in the core (`npm run lint:generic`). How to add one: [docs/recipes/add-a-kit.md](../../docs/recipes/add-a-kit.md); candidates: [docs/ROADMAP.md](../../docs/ROADMAP.md).
