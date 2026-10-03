# Creator onboarding rehearsal — 2026-10-03

## Scope and environment

Agent rehearsal against engine candidate `1be7ba7c7d61e11126d0f6959d68155b67a987fd` in a disposable, independent local clone with its own `node_modules`. No existing creator game was moved, deleted or replaced. The candidate was cloned locally because it is not published; this does **not** establish that cloning current public main yields the same implementation.

Reference machine: Linux 7.2.5-3-omarchy, AMD Ryzen 9 7950X, Node 26.8.1, npm 12.0.2. Automated browser: the repository's isolated, muted Chromium launcher at 1280×800 using its default software GL. A preinstalled browser and warm npm package cache were used. No browser download, first-time system dependency installation, fresh OS, Windows/macOS, CI Node 22 or physical device was exercised.

This is one agent trial, not a human newcomer trial or a complete release gate. Setup familiarity and cached downloads prevent a credible time-to-first-play comparison with the proposed 15-minute newcomer target. No end-to-end stopwatch was recorded.

## Commands and observed results

Commands ran in the disposable clone. Timings are elapsed shell `time` measurements, rounded, not universal performance promises.

| Command/action | Result |
| --- | --- |
| Local clone at the candidate revision | Clean independent checkout; Git and Node were already installed |
| `npm ci --no-audit --no-fund` | 33 packages installed, 0.86 seconds; npm 12 warned that esbuild's install script was blocked; subsequent build succeeded without overriding that policy |
| `npm run new-game -- --template arcade --id my-game --title "My game"` | Created `game/`, `GAME.md` and `game/playtest/restart.json` |
| `git switch -c my-game`, `git add game GAME.md`, `git commit -m "Start my game from the arcade template"` | Game saved on its own branch (Git identity was already configured) |
| `nice -n 15 npm run check` on that clean commit | PASS, 7.50 seconds; **zero tests selected** |
| Change ball colour in `game/components.ts` from `0xffcc33` to `0x66ddff` | Only the disposable game's component file changed |
| `nice -n 15 npm run check` after edit | PASS, 8.48 seconds; one game test file selected |
| `node --import tsx --test game/play.test.ts` | 4 tests pass, 0 fail/skip: steering, collision/restart, saved best and deterministic replay |
| `nice -n 15 npm run build -- --base /my-game/` | PASS, 8.04 seconds; static output and license notices produced |
| `nice -n 15 npm run play:script -- game/playtest/restart.json` with the preinstalled browser selected through `ENGINE_CHROMIUM` | PASS: playing → collision → restart; score resets to 0 and best is 3 |
| Serve that production output only under `/my-game/`, then open `/my-game/?flags=dev.silent#scene/play` | Active play scene, no console/page errors, no 4xx/5xx, no requests outside prefix, `window.engine` absent |

The scripted playtest starts and stops its own dev server. All automated browsers and the static server were closed. No deployment or remote write occurred. The standalone interactive `npm run play` / `npm run preview` terminal experience was not separately timed or manually operated; their underlying dev/static workflows were exercised by automation.

## Visual and interaction evidence

The generated game's existing scripted playtest sends an actual steering key, waits for game over, presses restart and asserts state. Its start screenshot was inspected: cyan ball, dark lane, readable score/best counters, Settings and steering hint. The production subpath screenshot was also inspected at full-scene scale: cyan ball and a falling red block are present with the same HUD. The screenshot renderer initially displayed only changed image content; inspecting a resized full image resolved that observation. No graphics defect was established.

The fixed-seed scripted restart is a narrow consumer check; it does not prove every input method, settings, focus loss, save reload across tabs, device profile or first-use performance budget. Browser storage was disposable. The Node saved-best check and browser restart are not cross-process durability evidence.

## Documentation changes justified by the rehearsal

- Put explicit Make a game / Contribute paths before the architecture catalog.
- Include the clone step in README and distinguish first play from optional automated-browser setup.
- Give an exact first edit with an observable result, plus an explicit four-test command that still runs on a clean commit.
- Explain that the dev server remains running, how to use a second terminal and what a zero-test focused check means.
- Give a concrete arcade scene/script and subpath build/preview route; preserve existing games rather than recommending replacement as setup repair.

No engine capability or support guarantee changed. Remaining acceptance: a second clean setup, actual unfamiliar-human trial when available, other supported operating systems, minimum declared devices and integrated-candidate CI.

## Reproduce the production subpath probe

After generating/editing the arcade game and building with `/my-game/`, save the following as `onboarding-subpath.mjs` in the disposable checkout. It uses the project's existing browser owner and a static host that rejects paths outside the build prefix. Create `evidence/`, then run `node -r ./scripts/silent-browser.cjs onboarding-subpath.mjs`; select `ENGINE_CHROMIUM` only if using an existing browser. The file and evidence are trial artifacts, not engine source changes.

```js
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname,join,normalize,sep,resolve} from 'node:path';
import {launch} from './scripts/perf/bench-browser.mjs';
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.txt':'text/plain'};
function host(dir, prefix) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(prefix)) { res.statusCode = 404; res.end('outside the sub-path'); return; }
    const rel = path.slice(prefix.length) || 'index.html', file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done({origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { server.close(() => r()); server.closeAllConnections(); })})));
}

const server=await host(resolve('dist'),'/my-game/');
let browser;
const report={errors:[],badResponses:[],outside:[]};
try {
 browser=await launch({strictClose:true}); const page=browser.page;
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)report.badResponses.push([r.url(),r.status()]);});
 page.on('request',r=>{if(!new URL(r.url()).pathname.startsWith('/my-game/'))report.outside.push(r.url());});
 await page.goto(server.origin+'/my-game/?flags=dev.silent#scene/play');
 await page.waitForSelector('#app[data-scene="scene.play"][data-scene-state="active"]');
 await page.waitForLoadState('networkidle');
 report.layout=await page.evaluate(()=>[...document.querySelectorAll('canvas,#app,button')].map(e=>({tag:e.tagName,rect:JSON.stringify(e.getBoundingClientRect()),visibility:getComputedStyle(e).visibility,display:getComputedStyle(e).display})));
 report.testApiAbsent=await page.evaluate(()=>!window.engine);
 report.text=await page.locator('body').innerText();
 await page.waitForTimeout(1500);
 await page.screenshot({path:'evidence/production-subpath.png'});
 assert.equal(report.testApiAbsent,true);
 assert.equal(report.errors.length+report.badResponses.length+report.outside.length,0);
 report.passed=true;
}finally{await browser?.close();await server.close();writeFileSync('evidence/production-subpath.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
```

## Public-main follow-up rehearsal

The standalone onboarding documentation was rebased onto public main
`2fb6e6918e1a5e647260854daa4c8f4b871e1b47`, without the unpublished engine
candidate changes. A fresh, independent local clone of documentation head
`aafa158` was exercised with Node **22.23.3** and npm **10.9.9**, its own
`node_modules`, a warm package cache and the existing isolated browser. The
clone's `origin/main` comparison ref was set to that exact public-main commit.
This verifies the documented workflow on public-main engine code; it is still
an agent rehearsal, not a first-time human or cold-download timing trial.

Passed in that disposable clone:

- `npm ci --no-audit --no-fund`; generate arcade using the documented command
  and commit `game/` plus `GAME.md` on the new `my-game` branch.
- `npm run check` on the clean game commit: PASS, zero tests selected.
- Change the ball colour to cyan; `npm run check`: PASS, one test file selected.
- `node --import tsx --test game/play.test.ts`: four tests passed, none skipped.
- `npm run build -- --base /my-game/`: PASS, including license notices.
- `npm run play:script -- game/playtest/restart.json`: PASS; collision then
  restart, score zero and best score three.
- The production subpath probe above: active play scene, no page/console errors,
  no failed responses or requests outside `/my-game/`, and no `window.engine`.

The start and production screenshots were inspected: cyan ball, dark lane and
readable counters/hint; the production capture also showed a red obstacle.
Both automated runs were serial, muted and used the existing 1280×800
software-GL launcher. Browser and server processes exited normally.
No public deployment, physical-device trial, manual terminal play/preview trial
or complete integration gate was performed. The earlier candidate-specific
receipt remains separate evidence and is not relabeled as public-main coverage.
