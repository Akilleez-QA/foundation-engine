# Recipe: share your build

Turn your game into static files and put them on any static web host. You do not need `npm run deploy:production` for this: that guard releases this repository's `main` (it requires a clean `main` equal to `origin/main` and a `deploy.config.mjs` provider hook), so a game on a branch of a clone cannot and need not satisfy it.

## 1. Build

```
npm run check            # types, lints, tests
npm run build            # writes dist/
npm run preview          # serves dist/ at http://127.0.0.1:4173/ to try the real build
```

`dist/` holds `index.html`, `assets/` (scripts, styles, workers), everything from `public/` (models, images), and `LICENSE.txt`, `COPYRIGHT.txt` and `THIRD_PARTY_NOTICES.txt`. Production builds leave out the test API (`window.engine`). Scenes are addressed by the hash (`#scene/<id>`), so the host needs no rewrite rules.

## 2. Pick where it will live

Today the build assumes it is served from the **root of a domain or subdomain** (`https://my-game.example/`, not `https://example.com/my-game/`). This decides which hosts work without extra steps:

| Host | Address | Works as built? |
|---|---|---|
| Netlify (drag `dist/` onto *Deploys*), Cloudflare Pages, Vercel | `https://<name>.netlify.app/` and similar | yes |
| GitHub Pages, user or organisation site (`<user>.github.io` repository), or any site with a custom domain | `https://<user>.github.io/` | yes |
| GitHub Pages, project site | `https://<user>.github.io/<repo>/` | only with step 3, and without models or textures |
| itch.io (*HTML* project, upload a zip of the *contents* of `dist/`) | served from a sub-path on itch's own domain | only with step 3, and without models or textures |

## 3. Hosting under a sub-path (current behaviour)

With the default build, a page served from a sub-path shows nothing: `index.html` asks for `/assets/…` at the domain root and gets 404s.

Building with a relative base fixes the scripts and styles:

```
npm run build -- --base ./
```

The game then starts under any sub-path. **Models and textures declared with `defineAsset` are still fetched from the domain root** (`/models/…`), so they fail with a 404 and the console shows `[assets] /models/…: HTTP 404`. Games made only of `Shape`s, `Mesh`es, HUD text and synthesised sound work; games with models or a cube sky need a root-hosted address for now. Sub-path support for assets is being worked on; this page will change when it lands.

## 4. Check the uploaded copy

Open the public address in a fresh browser window, open the developer console, and look for:

- the first scene appearing, and no red errors;
- no 404s in the network panel (a 404 for `/assets/…` or `/models/…` is the sub-path problem above);
- each scene you link to (`#scene/<id>`) opening directly.

Then try it on the devices your brief names. A phone emulator in a desktop browser is not the same as a phone.

## Licence reminder

The engine is GPL-3.0-only, so a build that includes it is distributed under the GPL too: the build already carries the licence and notices, and you need to offer the corresponding source (for example a link to the public repository and the commit you built). Assets keep their own licences, which is why `defineAsset` records them. This is a summary, not legal advice; read [LICENSE](../../LICENSE) and [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
