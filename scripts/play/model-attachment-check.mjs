#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out=resolve(process.argv[2]??'playtest/model-attachment');mkdirSync(out,{recursive:true});
const source=readFileSync(resolve(ROOT,'templates/mechanics/game/public/models/mechanics/beacon.glb'));
function variant(kind){
  const length=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+length));
  if(kind==='rigid'||kind==='tail'){
    delete json.skins;delete json.animations;
    delete json.meshes[0].primitives[0].attributes.JOINTS_0;delete json.meshes[0].primitives[0].attributes.WEIGHTS_0;
    json.nodes=[{name:'rigid-root',children:[1,2]},{name:'rigid-geometry',mesh:0,scale:[.5,.25,.5]},{name:'tip',translation:[0,.3,0]}];
    json.materials[0].pbrMetallicRoughness.baseColorFactor=kind==='rigid'?[.1,.85,.95,1]:[.8,.35,.95,1];
  }else{
    json.nodes.find(n=>n.name==='hand').scale=[2,1,1];
    if(kind==='missing')json.nodes.find(n=>n.name==='hand').name='other';
  }
  const encoded=Buffer.from(JSON.stringify(json)),padded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]),rest=source.subarray(20+length);
  const header=Buffer.from(source.subarray(0,20));header.writeUInt32LE(20+padded.length+rest.length,8);header.writeUInt32LE(padded.length,12);return Buffer.concat([header,padded,rest]);
}
const variants=Object.fromEntries(['parent','missing','rigid','tail'].map(id=>[id,variant(id)]));
let held=[];const release=()=>{for(const send of held.splice(0))send();};
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Native model attachment evidence</title><style>body{margin:0;background:#172332;color:#fff;font:16px sans-serif}.workspace{display:grid;grid-template-columns:2fr 1fr;height:88vh}#app{position:relative;min-width:0}aside{padding:12px;overflow:auto;background:#eee;color:#111}button,select{padding:10px;margin:3px}pre{white-space:pre-wrap;font-size:12px}header,footer{padding:12px}</style></head><body><header class="shell-header"><div class="header-left">Native pose · yellow parent / cyan child / violet dependent</div></header><main class="workspace"><div id="app" class="app-root"></div><aside><label for="asset">Parent asset</label><select id="asset">${['parent','missing','slow-parent','slow-exit'].map(id=>`<option>${id}</option>`).join('')}</select><label for="policy">Unavailable</label><select id="policy"><option>hide</option><option>hold</option></select>${['inspect','play','pause','move','replace','attach','detach','cycle','clear-cycle','pose','clear-pose'].map(id=>`<button id="${id}">${id}</button>`).join('')}<pre id="state" role="status"></pre></aside></main><footer>Desktop keyboard + pointer · original GLB variants · presentation only, simulation transforms retained</footer><script type="module" src="/scripts/play/fixtures/model-attachment-entry.mjs"></script></body></html>`;
const server=await createServer({root:ROOT,logLevel:'error',plugins:[{name:'model-attachment-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
 if(req.url?.startsWith('/__model-attachment.html')){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const match=/^\/__model-attachment\/(parent|missing|slow-parent|slow-exit|rigid|tail)\.glb$/.exec(req.url??'');if(!match){next();return;}
 const send=()=>{if(res.destroyed)return;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','model/gltf-binary');res.end(variants[match[1]]??variants.parent);};
 if(match[1].startsWith('slow-'))held.push(send);else send();
});}}],server:{host:'127.0.0.1',port:0}});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],consoleErrors:[],screenshots:[],limitations:['Desktop Chromium keyboard/pointer only; no physical-device, touch or full accessibility acceptance.','Numeric bounds use actual cached rigid geometry/world matrices, not pixels or skinned-vertex bounds.','Original derived fixtures; no skeleton fusion, retargeting or simulation parenting claim.','Delayed HTTP response is released after the old context ends; transport may abort it before decode. Screenshots accompany cached rigid bounds, not pixel or skinned-silhouette proof.']};
const evidence=diagnosticReport(report,resolve(out,'report.json'));let browser;
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} vs ${b}`);
// Independent scalar corner oracle from the original GLB vertices and declared transforms.
// Tail adds child-local socket [0,.3,0] and its own offset [.2,0,0] before the affine parent.
function expectedChild(parentX,time,handY=.6,tail=false){
 const c=Math.SQRT1_2,travel=(time<=.5?time:1-time)*.6000000238418579,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const x of [-.05,.05])for(const y of [0,.3])for(const z of [-.05,.05]){
  const localX=x+(tail ? 0.2 : 0),localY=y+(tail ? 0.3 : 0);
  const p=[parentX+.8+2*c*localX-2*c*localY,.7+handY+travel+c*localX+c*localY,z];for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
 }
 return {min,max};
}
function checkBounds(actual,expected,label){
 assert.equal(actual.status,'available',label+' available');
 for(let i=0;i<3;i++){near(actual.min[i],expected.min[i],label+' min '+i);near(actual.max[i],expected.max[i],label+' max '+i);}
}
try{
 await server.listen();browser=await launch({width:1440,height:960,strictClose:true});const page=browser.page;
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 await page.addInitScript(()=>{window.__attachmentDraws=0;for(const ctor of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){if(!ctor)continue;for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const original=ctor.prototype[name];if(original)ctor.prototype[name]=function(...args){window.__attachmentDraws++;return original.apply(this,args);};}}});
 const read=()=>page.evaluate(()=>modelAttachment.read()),click=id=>page.locator('#'+id).click(),step=ms=>page.evaluate(ms=>engine.clock.step(ms),ms);
 const shot=async name=>{await page.evaluate(()=>modelAttachment.show());const path=resolve(out,name+'.png');await page.screenshot({path,fullPage:true});report.screenshots.push(path);};
 const ready=()=>page.waitForFunction(()=>window.modelAttachment?.read().models?.tail.attachment.status==='ready');
 const replace=async id=>{await page.locator('#asset').selectOption(id);await click('replace');await step(1);};
 const waitHeld=async()=>{const until=Date.now()+5000;while(!held.length){assert.ok(Date.now()<until,'delayed request arrived');await new Promise(r=>setTimeout(r,10));}};
 await page.goto(server.resolvedUrls.local[0]+'__model-attachment.html?flags=dev.silent');await ready();await page.evaluate(()=>engine.clock.hold());await step(1); // first held tick establishes the manual time origin
 const initial=await read();assert.equal(initial.models.child.transform.x,1.4);assert.equal(initial.models.child.inspection.model.bounds.status,'available');await shot('initial');
 await click('play');await page.locator('#move').focus();await page.keyboard.press('Enter');await step(50);
 const moving=await read(),time=moving.models.parent.inspection.model.playback.time,expected=expectedChild(moving.models.parent.transform.x,time),actual=moving.models.child.inspection.model.bounds;
 assert.ok(time>0);checkBounds(actual,expected,'animated child');
 const expectedTail=expectedChild(moving.models.parent.transform.x,time,.6,true);checkBounds(moving.models.tail.inspection.model.bounds,expectedTail,'animated tail');
 const old=expectedChild(initial.models.parent.transform.x,0);assert.ok(Math.abs(actual.min[0]-old.min[0])>.3);assert.ok(Math.abs(actual.min[1]-old.min[1])>.005);
 assert.deepEqual(moving.models.child.transform,initial.models.child.transform);assert.equal(moving.models.tail.attachment.status,'ready');await shot('current-affine');
 await click('pause');await step(1);
 await page.locator('#pose').focus();await page.keyboard.press('Enter');await step(1);
 const posed=await read(),poseTime=posed.models.parent.inspection.model.playback.time;
 checkBounds(posed.models.child.inspection.model.bounds,expectedChild(posed.models.parent.transform.x,poseTime,.9),'posed child');
 checkBounds(posed.models.tail.inspection.model.bounds,expectedChild(posed.models.parent.transform.x,poseTime,.9,true),'posed tail');
 near(posed.models.child.inspection.model.bounds.min[1]-moving.models.child.inspection.model.bounds.min[1],.3,'authored hand override');await shot('pose-override');
 await click('clear-pose');await step(1);const cleared=await read();
 checkBounds(cleared.models.child.inspection.model.bounds,expectedChild(cleared.models.parent.transform.x,cleared.models.parent.inspection.model.playback.time),'cleared child');
 checkBounds(cleared.models.tail.inspection.model.bounds,expectedChild(cleared.models.parent.transform.x,cleared.models.parent.inspection.model.playback.time,.6,true),'cleared tail');await shot('pose-cleared');
 await click('cycle');await step(1);const cycle=await read();assert.equal(cycle.models.parent.attachment.status,'cycle');assert.equal(cycle.models.child.attachment.status,'cycle');assert.equal(cycle.models.tail.attachment.status,'blocked');assert.equal(cycle.models.child.inspection.model.adopted.visible,false);assert.equal(cycle.models.tail.inspection.model.adopted.visible,false);await shot('cycle');
 await click('clear-cycle');await step(1);assert.equal((await read()).models.tail.attachment.status,'ready');
 await click('detach');await step(1);assert.equal((await read()).models.child.attachment.status,'unattached');near((await read()).models.child.inspection.model.bounds.min[0],1.35,'detached base');await click('attach');await step(1);
 await replace('missing');await page.waitForFunction(()=>modelAttachment.read().models.parent.resource.status==='ready');await step(1);assert.equal((await read()).models.child.attachment.status,'missing-socket');assert.equal((await read()).models.tail.attachment.status,'blocked');assert.equal((await read()).models.child.inspection.model.adopted.visible,false);await shot('missing');
 await replace('parent');await page.waitForFunction(()=>modelAttachment.read().models.parent.resource.status==='ready');await step(1);
 await page.locator('#policy').selectOption('hold');await step(1);const beforeHold=await read();await replace('slow-parent');await waitHeld();const pending=await read();assert.deepEqual(pending.models.child.attachment,{status:'waiting',held:true});assert.equal(pending.models.tail.attachment.status,'blocked');assert.deepEqual(pending.models.child.inspection.model.bounds,beforeHold.models.child.inspection.model.bounds);assert.equal(pending.models.child.inspection.model.adopted.visible,true);assert.equal(pending.models.tail.inspection.model.adopted.visible,false);await shot('held');
 await replace('parent');await page.waitForFunction(()=>modelAttachment.read().models.parent.resource.status==='ready');await step(1);release();await page.waitForTimeout(80);await step(1);assert.equal((await read()).models.parent.resource.adoptedAsset,'parent');assert.equal((await read()).resources.instances,3);
 const before=await page.evaluate(()=>({stats:modelAttachment.resources(),draws:window.__attachmentDraws}));await page.evaluate(()=>modelAttachment.queryRepeated());await step(50);const after=await page.evaluate(()=>({stats:modelAttachment.resources(),draws:window.__attachmentDraws}));assert.deepEqual(after,before);
 await replace('slow-exit');await waitHeld();const previousEpoch=await page.evaluate(()=>engine.state().scene.epoch);await page.evaluate(()=>{modelAttachment.keepContext();engine.clock.resume();});
 const navigation=page.evaluate(()=>engine.goto('sample',{visit:'replacement'}));
 // Prove retirement and replacement while the old response is still held server-side.
 await page.waitForFunction(epoch=>modelAttachment.previous()?.status==='absent'&&engine.state().scene?.epoch!==epoch&&modelAttachment.read().models.tail.attachment.status==='ready',previousEpoch);
 assert.ok(held.length>0,'old response remains held through retirement');const replacementBeforeRelease=await read();
 assert.equal(replacementBeforeRelease.models.parent.resource.adoptedAsset,'parent');assert.equal(replacementBeforeRelease.resources.instances,3);
 release();await navigation;await page.waitForTimeout(80); // navigation resumed natural frames
 const replacementAfterRelease=await read();assert.equal(await page.evaluate(()=>modelAttachment.previous().status),'absent');
 assert.deepEqual(replacementAfterRelease.entities,replacementBeforeRelease.entities);assert.equal(replacementAfterRelease.models.parent.resource.adoptedAsset,'parent');
 assert.equal(replacementAfterRelease.models.tail.attachment.status,'ready');assert.equal(replacementAfterRelease.resources.instances,3);await page.evaluate(()=>modelAttachment.dispose());await page.waitForTimeout(80);const disposed=await read();assert.equal(disposed.retired,true);assert.equal(disposed.models.child.attachment.status,'absent');assert.equal(disposed.resources.instances,0);assert.equal(disposed.resources.residentMiB,0);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);writeFileSync(resolve(out,'snapshots.json'),JSON.stringify({initial,moving,expected,expectedTail,posed,cleared,cycle,pending,before,after,replacementBeforeRelease,replacementAfterRelease,disposed},null,2));report.passed=true;
}catch(error){evidence.fail(error);}finally{release();await evidence.close(browser,'browser close');await evidence.close(server,'server close');evidence.finish();}
console.log(`Model attachments passed; evidence ${out}`);
