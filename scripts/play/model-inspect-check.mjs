#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out=resolve(process.argv[2]??'/tmp/foundation-model-inspect-browser');mkdirSync(out,{recursive:true});
const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Model inspection</title><style>body{margin:0}.workspace{display:grid;grid-template-columns:2fr 1fr;height:85vh}#app{position:relative;min-width:0}aside{padding:12px;overflow:auto;background:#eee;color:#111}button{padding:10px;margin:3px}pre{white-space:pre-wrap;font-size:12px}</style></head><body><header class="shell-header"><div class="header-left">Original beacon · cached model diagnostics</div><div class="header-right"></div></header><main class="workspace"><div id="app" class="app-root"></div><aside>${['inspect','play','pause','restart','replace','pose','clear-pose'].map(id=>`<button id="${id}">${id}</button>`).join('')}<pre id="inspection"></pre></aside></main><script type="module" src="/scripts/play/fixtures/model-inspect-entry.mjs"></script></body></html>`;
const server=await createServer({root:ROOT,logLevel:'error',publicDir:resolve(ROOT,'templates/mechanics/game/public'),plugins:[{name:'model-inspect-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
  if(req.url?.startsWith('/__model-inspect-check.html')){res.setHeader('Content-Type','text/html');res.end(html);return;}
  // Second registered variant path, identical original bytes; the real loader still parses both.
  if(req.url==='/__model-inspect/beacon.glb'){res.setHeader('Content-Type','model/gltf-binary');res.end(readFileSync(resolve(ROOT,'templates/mechanics/game/public/models/mechanics/beacon.glb')));return;}
  next();
});}}],server:{host:'127.0.0.1',port:0}});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],screenshots:[],limitations:['Desktop Chromium emulation only; no physical device or performance acceptance.','Both paths serve the same original GLB; no visual difference between asset variants is asserted.','Bounds intentionally exclude skinned geometry; they are not animated silhouette bounds.']};
const evidence=diagnosticReport(report,resolve(out,'report.json'));let browser;
try{
 await server.listen();browser=await launch({width:1280,height:800,strictClose:true});const page=browser.page;
 page.on('pageerror',error=>report.errors.push(String(error)));
 await page.goto(`${server.resolvedUrls.local[0]}__model-inspect-check.html?flags=dev.silent#scene/sample`);
 await page.waitForFunction(()=>window.engine?.state().scene?.scene==='scene.sample'&&window.modelInspect?.read().model?.state==='ready');
 await page.locator('#app canvas').waitFor();await page.evaluate(()=>engine.clock.hold());
 const read=()=>page.evaluate(()=>window.modelInspect.read());const click=id=>page.locator('#'+id).click();const step=ms=>page.evaluate(ms=>engine.clock.step(ms),ms);
 const initial=await read();assert.equal(initial.status,'ready');const epoch=initial.epoch;
 assert.equal(initial.model.adopted.asset.value,'first');assert.match(initial.model.adopted.path.value,/models\/mechanics\/beacon\.glb$/);
 assert.equal(initial.model.playback.clip.value,'pulse');assert.equal(initial.model.playback.appliedRestartRevision,0);assert.equal(initial.model.playback.paused,true);
 assert.equal(initial.model.clips.total,1);assert.equal(initial.model.clips.items[0].name.value,'pulse');assert.equal(initial.model.clips.items[0].duration,1);
 assert.deepEqual(initial.model.sockets.map(s=>s.status),['ready','ready','absent']);
 assert.equal(initial.model.bounds.basis,'cached-geometry-and-world-matrices');assert.ok(initial.model.bounds.skipped.skinned>0);assert.equal(initial.model.bounds.status,'unavailable');assert.equal(initial.model.bounds.min,null);
 await click('play');await step(200);const moving=await read();assert.ok(moving.model.playback.time>0);assert.notEqual(moving.model.sockets[1].matrix[13],initial.model.sockets[1].matrix[13]);
 await click('pause');await step(1);const paused=await read();await step(200);assert.equal((await read()).model.playback.time,paused.model.playback.time);
 await page.locator('#restart').focus();await page.keyboard.press('Enter');await step(1);const reset=await read();assert.equal(reset.model.playback.appliedRestartRevision,1);assert.equal(reset.model.playback.time,0);
 await click('pose');await step(1);const posed=await read();assert.equal(posed.model.pose.complete,true);assert.equal(posed.model.pose.applied,1);assert.ok(posed.model.sockets[0].matrix[13]>initial.model.sockets[0].matrix[13]);
 await click('clear-pose');await step(1);assert.equal((await read()).model.pose.applied,0);
 await click('replace');const pending=await page.evaluate(()=>window.modelInspect.last());assert.equal(pending.model.replacementPending,true);assert.equal(pending.model.requested.asset.value,'second');assert.equal(pending.model.adopted.asset.value,'first');
 await step(1);await page.waitForFunction(()=>window.modelInspect.read().model?.adopted?.asset.value==='second');await step(1);const adopted=await read();assert.equal(adopted.model.replacementPending,false);assert.match(adopted.model.adopted.path.value,/__model-inspect\/beacon\.glb$/);
 const before=await page.evaluate(()=>engine.probe('models'));for(let i=0;i<5;i++)await read();const after=await page.evaluate(()=>engine.probe('models'));assert.deepEqual(after,before);
 await click('inspect');const path=resolve(out,'adopted.png');await page.screenshot({path,fullPage:true});report.screenshots.push(path);
 // Activation waits for two app frames. Resume for navigation, and require a new epoch:
 // goto's scene-name condition alone cannot distinguish a same-scene replacement.
 await page.evaluate(()=>{window.modelInspect.keepHandle();engine.clock.resume();});
 await page.evaluate(()=>engine.goto('sample',{reload:'replacement'}));
 await page.waitForFunction(epoch=>engine.state().scene?.epoch!==epoch&&window.modelInspect.read().model?.state==='ready',epoch);
 await page.evaluate(()=>engine.clock.hold());
 const replacement=await read();assert.equal(replacement.status,'ready');assert.notEqual(replacement.epoch,epoch);
 assert.equal(replacement.model.adopted.asset.value,'first');assert.equal(replacement.model.playback.clip.value,'pulse');
 assert.equal(await page.evaluate(epoch=>window.modelInspect.previous(epoch).status,epoch),'unavailable');
 assert.equal(await page.evaluate(epoch=>engine.model({entity:1,expectedEpoch:epoch}).status,epoch),'stale');
 await page.evaluate(()=>window.modelInspect.dispose());assert.equal((await read()).status,'unavailable');assert.deepEqual(report.errors,[]);
 writeFileSync(resolve(out,'snapshots.json'),JSON.stringify({initial,moving,paused,reset,posed,pending,adopted,before,after,replacement},null,2));report.passed=true;
}catch(error){evidence.fail(error);}finally{await evidence.close(browser,'browser close');await evidence.close(server,'server close');evidence.finish();}
console.log(`Model inspection passed; evidence ${out}`);
