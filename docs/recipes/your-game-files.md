# Recipe: where your game's files go

Everything that belongs to your game lives in its folder (`game/`, or the folder `GAME_DIR` names), in three kinds:

| Folder | What | Rules |
|---|---|---|
| `game/` (everything else) | game code: scenes, systems, components, assets declared with `defineAsset`, strings, tests | imports only `@engine`, `@kits/<name>`, its own files and JSON (`npm run lint:layers`) |
| `game/public/` | static files the game serves as they are: `.glb` models, textures, sounds, a decoder | `game/public/models/ship.glb` is the URL `/models/ship.glb`; a build copies the folder and nothing from other games |
| `game/tools/` | build-time Node scripts: asset generators, converters, data importers | run on your machine (`node game/tools/<script>.mjs`), never in the game; may import `node:` modules and packages; no game file may import them |

`npm run new-game` copies all three with the template. The mechanics template is an example: its `game/tools/` scripts write its model, sky, panel texture and chime into `game/public/`.

## 1. Write a tool

A tool is a plain Node script. Write its output into `../public/`, relative to the script, so it works the same in `game/` and in a template folder:

```js
// game/tools/make-tile.mjs: writes game/public/textures/tile.png, an 8×8 checker (CC0, made here).
import {mkdirSync, writeFileSync} from 'node:fs';
import {deflateSync, crc32} from 'node:zlib';

const out = new URL('../public/textures/', import.meta.url);
mkdirSync(out, {recursive: true});
const size = 8, rows = [];
for (let y = 0; y < size; y++) {
  const row = [0]; // PNG filter: none
  for (let x = 0; x < size; x++) { const v = (x + y) % 2 ? 230 : 90; row.push(v, v, v); }
  rows.push(...row);
}
const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])));
  return Buffer.concat([head, data, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(new URL('tile.png', out), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]));
```

```
node game/tools/make-tile.mjs
```

(`crc32` from `node:zlib` needs Node 22.2 or later; the engine requires 22.18.)

## 2. Declare what it made

The output is an ordinary static file. Declare it like any other, naming the tool as its source:

```ts
// game/tile.asset.ts
import { defineAsset } from '@engine';

export default defineAsset({
  id: 'tile', type: 'texture', url: '/textures/tile.png', width: 8, height: 8,
  licence: 'CC0-1.0', author: 'My name', source: 'game/tools/make-tile.mjs',
});
```

Commit the tool and what it wrote (`git add game`): the build reads `game/public/`, it does not run your tools. Run a tool again when you change it.

## Rules and limits

- **Game code never imports a tool.** `npm run lint:layers` reports `game-imports-no-tools` if a scene or system imports from `game/tools/`: a tool's `node:` imports cannot run in a browser. Share data through JSON (both may import it) or through the files in `public/`.
- **Tools are not checked like game code.** `lint:layers` does not apply the `@engine`-only rule to them, the build ignores them, and the game's definitions never include them. A tool's own tests (`game/tools/*.test.mjs` or `*.test.ts`) still run with `npm test`.
- **One public folder per build.** `game/public/` is Vite's public folder, so `npm run dev` serves exactly what the build copies, the same way (range requests, `?url`). A game without `game/public/` uses the repository's root `public/` instead (older games kept their files there; the engine keeps nothing there). When `game/public/` exists, files left in the root `public/` would ship with no one, so the dev server and the build both stop and name them: move them into `game/public/`.
- **Reserved names and links.** The build writes `index.html`, `LICENSE.txt`, `COPYRIGHT.txt` and `THIRD_PARTY_NOTICES.txt` itself, so a file with one of those names at the top of `game/public/` stops the dev server and the build (put it in a subfolder or rename it). Symbolic links stop them too: the dev server would follow a link but the build copies the link itself, so copy the file in.
- **Provenance is yours to keep.** Name each file's licence, author and source in its `defineAsset`; files made from third-party inputs keep those inputs' licences and notices.

## Check it

```
npm run check
npm run build      # dist/ holds your game/public/ files at the same paths
npm run play:snap
```

A 404 for the file in the snap's console means the `url` does not match a path under `game/public/`.
