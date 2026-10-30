# Host a build under a sub-path (GitHub Pages, itch.io)

By default a build expects to be served from the site root (`https://example.org/`). Many static hosts serve a game
from a folder instead: a GitHub Pages project site lives under `/<repository>/`, and itch.io unpacks an HTML upload
into a folder whose name you do not choose. Tell the build where it will live with Vite's `--base`:

```sh
npm run build -- --base ./              # any folder: itch.io, a zip, a USB stick behind a local server
npm run build -- --base /my-game/       # a known sub-path: https://<user>.github.io/my-game/
```

The output is in `dist/`. Upload its contents (with `index.html` at the top of the folder). Open the folder URL with
its trailing slash (`/my-game/`, or `/my-game/index.html`); without the slash the browser treats `my-game` as a file.

## What the engine does with it

- **Inputs:** the build's `base` (`import.meta.env.BASE_URL`, `/` when omitted) and the page's `document.baseURI`.
- **Owner:** `platform/assets/public-base.ts`. The texture library (`platform.assets`) and the model library
  (`platform.models`) prefix every asset path from `defineAsset({ url })` with it. A root-relative base (`/`,
  `/my-game/`) is used as it is; a relative base (`./`) is made absolute against the page, so a decode worker, the
  model fetch and the image loader all ask for the same file.
- **Asset URLs stay as you wrote them:** keep writing `url: '/models/my-game/ship.glb'` (or without the leading `/`).
  The URL names a file under the game's `public/` folder (`game/public/`); the build's base decides where it is served.
- **Bounds and failure:** nothing new is admitted or retried; a missing file fails as before (the library reports it
  and the scene draws its fallback). A base on another site (`https://cdn…`, `//cdn…`) fails the boot when the texture and model modules install: assets
  are served with the game.
- **Music:** `music('/music/theme.m4a')` on the audio service resolves the same way; full URLs pass unchanged.
- **Not covered:** the scene address is a hash (`#scene/<id>`), so no server rewrite rules are needed. The dev server
  (`npm run dev`, `npm run play`) always serves at `/`.

## Check it

`npm run test:subpath-browser` builds every template with `--base ./` (and, when it ships asset files, also with
`--base /sub/<template>/`), serves each build only under `/sub/<template>/`, opens the first scene in the muted test browser and fails on any request outside
the sub-path, any 4xx/5xx, any page error, or any declared asset that is missing or not served from the sub-path.
Add `-- --template <name>` (repeatable) to check some templates only.

This is desktop Chromium against a local static server. It is not evidence for a real Pages or itch.io upload, a CDN,
or physical devices: open the uploaded build once on each supported device.
