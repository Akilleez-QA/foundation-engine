# L4 `app/`: the composition root

Compiles the game (`@game`: GAME_DIR, else ./game, else templates/blank/game) with the author layer, lists the core and platform modules (`layer-modules.ts`), discovers feature and pack manifests by folder, installs the platform ports and boots the kernel. Nothing imports `app/`; it imports features only through their manifests (`app-imports-manifests-only`).
