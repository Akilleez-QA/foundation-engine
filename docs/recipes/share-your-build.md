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

A default build is served from the **root of a domain or subdomain** (`https://my-game.example/`). To serve it from a
folder (`https://example.com/my-game/`), build it for that folder (step 3).

| Host | Address | Build |
|---|---|---|
| Netlify (drag `dist/` onto *Deploys*), Cloudflare Pages, Vercel | `https://<name>.netlify.app/` and similar | `npm run build` |
| GitHub Pages, user or organisation site (`<user>.github.io` repository), or any site with a custom domain | `https://<user>.github.io/` | `npm run build` |
| GitHub Pages, project site | `https://<user>.github.io/<repo>/` | step 3 |
| itch.io (*HTML* project, upload a zip of the *contents* of `dist/`) | served from a sub-path on itch's own domain | step 3 |

## 3. Hosting under a sub-path

```
npm run build -- --base ./              # any folder (itch.io, a zip)
npm run build -- --base /my-repo/       # a known folder (a GitHub Pages project site)
```

Scripts, styles, workers and every file declared with `defineAsset` (models, textures, cube skies) are then fetched
from that folder. Open the folder address with its trailing slash. Details, limits and the automated check:
[host a build under a sub-path](host-under-a-sub-path.md).

## 4. Check the uploaded copy

Open the public address in a fresh browser window, open the developer console, and look for:

- the first scene appearing, and no red errors;
- no 404s in the network panel (a 404 for `/assets/…` or `/models/…` at the domain root means the build was not made for its folder: step 3);
- each scene you link to (`#scene/<id>`) opening directly.

Then try it on the devices your brief names. A phone emulator in a desktop browser is not the same as a phone.

## Licence reminder

The engine is GPL-3.0-only, so a build that includes it is distributed under the GPL too: the build already carries the licence and notices, and you need to offer the corresponding source (for example a link to the public repository and the commit you built). Assets keep their own licences, which is why `defineAsset` records them. This is a summary, not legal advice; read [LICENSE](../../LICENSE) and [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
