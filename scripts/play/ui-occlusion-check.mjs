#!/usr/bin/env node
// Synthetic DOM diagnostic only: not game usability or physical-device acceptance.
// Run: node -r ./scripts/silent-browser.cjs scripts/play/ui-occlusion-check.mjs [output-directory]
import assert from 'node:assert/strict';
import {diagnosticReport} from './diagnostic-report.mjs';
import {mkdirSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {launch} from '../perf/bench-browser.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = resolve(process.argv[2] ?? '/tmp/foundation-ui-evidence');
mkdirSync(output, {recursive: true});
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI geometry diagnostic</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#142232;color:#fff;font:16px system-ui;overflow:hidden;position:relative;width:100vw;height:100vh}
#world{position:absolute;inset:0;background:linear-gradient(140deg,#142232,#304963)}
#panel{position:absolute;top:16px;left:16px;width:min(320px,calc(100vw - 32px));padding:16px;background:#17202c;border:2px solid #a8c8ed;z-index:2}
h1{font-size:1.1em;margin:0 0 8px}p{margin:0}button{font:inherit;min-width:80px;min-height:48px;background:#ffe799;color:#171e26;border:2px solid white}
#target{position:absolute;left:calc(50% - 40px);top:60%;z-index:1}
#blocker{position:absolute;left:calc(50% - 40px);top:60%;width:80px;height:48px;opacity:0;z-index:3}
#partial{position:absolute;right:-60px;bottom:16px;width:80px;height:48px;background:#36a6aa}
</style><main style="position:fixed;inset:0;overflow:hidden"><div id="world"></div><section id="panel"><h1>Geometry test fixture</h1><p>Long instructions reflow when text is enlarged. This panel is a measured footprint, not accepted game UI.</p></section>
<button id="target">Act</button><div id="blocker"></div><div id="partial"></div></main>
<script type="module">
import {measureUiOcclusion} from '/src/platform/ui/occlusion.ts';
window.hits={target:0,blocker:0};
for(const id of ['target','blocker'])document.getElementById(id).addEventListener('click',()=>window.hits[id]++);
const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
window.sample=()=>{const viewport={x:0,y:0,width:innerWidth,height:innerHeight},target=rect('target'),partial=rect('partial'),panel=rect('panel'),blocker=rect('blocker');
 const report=measureUiOcclusion(viewport,[panel,blocker],[target,partial]);
 return {viewport,rectangles:{panel,blocker,target,partial},report,partialVisibleFraction:report.criticalRegions[1].area/(partial.width*partial.height),hitElement:document.elementFromPoint(target.x+target.width/2,target.y+target.height/2)?.id,hits:{...window.hits}};
};
window.ready=true;
</script>`;
const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: {noDiscovery: true, entries: []},
  logLevel: 'error',
  server: {host: '127.0.0.1', port: 0},
});
const report = {
  kind: 'synthetic-dom-geometry',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirtyWorktree: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim().length > 0,
  sourceSha256: Object.fromEntries(
    ['src/platform/ui/occlusion.ts', 'scripts/play/ui-occlusion-check.mjs'].map(path => [
      path,
      createHash('sha256')
        .update(readFileSync(resolve(root, path)))
        .digest('hex'),
    ]),
  ),
  limitations: [
    'Not a game layout',
    'Not physical-device evidence',
    'No thermal, hand obstruction, comprehension or comfort claim',
    'Text enlargement is CSS font scaling, not browser zoom',
  ],
  cases: [],
};
const evidence = diagnosticReport(report, resolve(output, 'report.json'));
try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  for (const profile of [
    {name: 'phone', width: 390, height: 844, mobile: true},
    {name: 'tablet', width: 820, height: 1180, mobile: true},
    {name: 'desktop', width: 1280, height: 800},
  ]) {
    const b = await launch({...profile, strictClose: true});
    try {
      await b.page.route('**/ui-occlusion-fixture*', route => route.fulfill({contentType: 'text/html', body: html}));
      await b.goto(`${url}ui-occlusion-fixture?flags=dev.silent`);
      await b.wait('window.ready === true');
      const record = {profile, browser: b.version, launchArguments: b.launchArguments, states: []};
      for (const state of ['normal', 'text-200', 'resized']) {
        if (state === 'text-200') await b.page.evaluate(() => (document.body.style.fontSize = '32px'));
        if (state === 'resized') await b.page.setViewportSize({width: profile.height, height: profile.width});
        await b.page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        const sample = await b.page.evaluate(() => window.sample());
        assert.equal(sample.report.criticalRegions[0].occupiedRatio, 1, 'transparent blocker must cover target');
        assert.equal(sample.hitElement, 'blocker');
        assert.equal(sample.report.criticalRegions[1].occupiedRatio, 0);
        assert.equal(sample.partialVisibleFraction, 0.25, 'zero obstruction still leaves target mostly offscreen');
        const r = sample.rectangles.target;
        const prior = sample.hits.blocker;
        await b.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
        const hits = await b.page.evaluate(() => ({...window.hits}));
        assert.equal(hits.blocker, prior + 1);
        assert.equal(hits.target, 0);
        const screenshot = resolve(output, `${profile.name}-${state}.png`);
        await b.page.screenshot({path: screenshot});
        record.states.push({state, ...sample, hitsAfterClick: hits, screenshot});
      }
      assert.ok(
        record.states[1].rectangles.panel.height > record.states[0].rectangles.panel.height,
        'enlarged text must reflow',
      );
      await b.page.evaluate(() => (document.getElementById('blocker').style.pointerEvents = 'none'));
      const final = await b.page.evaluate(() => window.sample());
      const r = final.rectangles.target;
      assert.equal(final.hitElement, 'target');
      await b.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
      assert.equal(
        await b.page.evaluate(() => window.hits.target),
        1,
        'pointer route restored without changing visual footprint',
      );
      assert.deepEqual(b.errors, []);
      record.errors = b.errors;
      record.pointerRecovery = true;
      report.cases.push(record);
    } finally {
      await evidence.close(b, `${profile.name} browser cleanup`);
    }
  }
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(`UI geometry diagnostic: ${report.cases.length} profiles, 9 states passed. Evidence: ${output}`);
