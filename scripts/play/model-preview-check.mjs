#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out=resolve(process.argv[2]??'playtest/model-preview');mkdirSync(out,{recursive:true});
const original=readFileSync(resolve(ROOT,'templates/mechanics/game/public/models/mechanics/beacon.glb'));
// Derive visibly distinct original variants without changing shared asset files.
function variant(missing=false){
  const length=original.readUInt32LE(12),json=JSON.parse(original.subarray(20,20+length).toString());
  json.materials[0].pbrMetallicRoughness.baseColorFactor=[.15,.8,.95,1];
  json.nodes[0].scale=[2,1,2];if(missing)json.nodes.find(n=>n.name==='hand').name='alternate';
  const encoded=Buffer.from(JSON.stringify(json)),padded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]),rest=original.subarray(20+length);
  const header=Buffer.from(original.subarray(0,20));header.writeUInt32LE(20+padded.length+rest.length,8);header.writeUInt32LE(padded.length,12);
  return Buffer.concat([header,padded,rest]);
}
const second=variant(),missing=variant(true);assert.notDeepEqual(second,original);
let secondUnavailable=false,secondMissing=false,held=[];const release=()=>{for(const respond of held.splice(0))respond();};
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Model candidate preview</title><style>body{margin:0;background:#172332;color:white;font:16px sans-serif}.workspace{display:grid;grid-template-columns:2fr 1fr;height:88vh}#app{position:relative;min-width:0}aside{padding:16px;overflow:auto;background:#eee;color:#111}button,select{padding:10px;margin:4px}pre{white-space:pre-wrap;font-size:13px}header,footer{padding:12px}</style></head><body><header class="shell-header"><div class="header-left">Model candidates · accepted left / preview right</div></header><main class="workspace"><div id="app" class="app-root"></div><aside><label for="form">Candidate</label><select id="form">${['first','second','slow','failed','missing'].map(id=>`<option>${id}</option>`).join('')}</select>${['preview','cancel','commit','save','retry','reload'].map(id=>`<button id="${id}">${id}</button>`).join('')}<pre id="state" role="status"></pre></aside></main><footer>Desktop keyboard + pointer · original GLB assets · local saves</footer><script type="module" src="/scripts/play/fixtures/model-preview-entry.mjs"></script></body></html>`;
const server=await createServer({root:ROOT,logLevel:'error',plugins:[{name:'model-preview-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
  if(req.url?.startsWith('/__model-preview.html')){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const match=/^\/__model-preview\/(first|second|slow|failed|missing)\.glb$/.exec(req.url??'');if(!match){next();return;}
  const id=match[1];if(id==='failed'||(id==='second'&&secondUnavailable)){res.statusCode=503;res.end('Injected unavailable model');return;}
  res.setHeader('Cache-Control','no-store');
  const respond=()=>{if(res.destroyed)return;res.setHeader('Content-Type','model/gltf-binary');res.end(id==='first'?original:id==='missing'||(id==='second'&&secondMissing)?missing:second);};
  if(id==='slow')held.push(respond);else respond();
});}}],server:{host:'127.0.0.1',port:0}});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],consoleErrors:[],screenshots:[],limitations:['Desktop Chromium emulation only; no physical-device, phone or full accessibility acceptance.','Two original fixture variants; no skeletal fusion or retargeting claim.','Single-writer local save; readiness is separate from durable publication.']};
const evidence=diagnosticReport(report,resolve(out,'report.json'));let browser;
try{
 await server.listen();browser=await launch({width:1440,height:960,strictClose:true});const page=browser.page;page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push({text:m.text(),url:m.location().url});});
 await page.addInitScript(()=>{window.__modelDraws=0;for(const ctor of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){if(!ctor)continue;for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const original=ctor.prototype[name];if(original)ctor.prototype[name]=function(...args){window.__modelDraws++;return original.apply(this,args);};}}});
 const read=()=>page.evaluate(()=>modelPreview.read());const click=id=>page.locator('#'+id).click();
 const choose=async id=>{await page.locator('#form').selectOption(id);await click('preview');};
 const heldRequest=async()=>{const end=Date.now()+5000;while(!held.length){assert.ok(Date.now()<end,'delayed model request reached server');await new Promise(r=>setTimeout(r,10));}};
 const candidateReady=()=>page.waitForFunction(()=>modelPreview.read().candidate?.status==='ready'&&modelPreview.read().candidate?.visible);
 const acceptedReady=()=>page.waitForFunction(()=>window.modelPreview?.read().accepted?.status==='ready'&&modelPreview.read().accepted?.visible);
 const shot=async name=>{const path=resolve(out,name+'.png');await page.screenshot({path,fullPage:true});report.screenshots.push(path);};
 await page.goto(server.resolvedUrls.local[0]+'__model-preview.html?flags=dev.silent');await acceptedReady();
 const initial=await read();assert.equal(initial.value.parts.form,'first');assert.equal(initial.count,1);assert.equal(initial.save,'not-saved');
 await choose('slow');await heldRequest();await page.waitForFunction(()=>modelPreview.read().candidate?.status==='loading');
 const pending=await read();assert.equal(pending.candidate.visible,false);assert.equal(pending.accepted.entity,initial.accepted.entity);assert.equal(pending.count,2);assert.equal(await page.locator('#commit').isDisabled(),true);await shot('pending');
 await click('cancel');assert.equal((await read()).count,1);release();
 await choose('second');await candidateReady();const preview=await read();assert.equal(preview.value.parts.form,'first');assert.equal(preview.accepted.entity,initial.accepted.entity);await shot('preview');
 await page.locator('#commit').focus();await page.keyboard.press('Enter');assert.equal((await read()).value.parts.form,'second');assert.equal((await read()).count,1);assert.equal((await read()).save,'unsaved');
 await click('save');assert.equal((await read()).save,'saved');await click('reload');await acceptedReady();assert.equal((await read()).accepted.adoptedAsset,'second');await page.waitForFunction(()=>modelPreview.read().message==='Accepted model ready.');assert.equal(await page.locator('#form').inputValue(),'second');await shot('restored');
 // A schema-valid stored selection can still be incompatible with its actual model.
 const storageKey='model-preview|device|model.profile';
 const savedBytes=await page.evaluate(key=>localStorage.getItem(key),storageKey);assert.ok(savedBytes);
 await page.evaluate(key=>{const envelope=JSON.parse(localStorage.getItem(key));envelope.data.parts.form='missing';localStorage.setItem(key,JSON.stringify(envelope));},storageKey);
 await click('reload');await page.waitForFunction(()=>window.modelPreview?.read().message.includes('Accepted model is incompatible'));
 assert.equal((await read()).accepted.status,'ready');assert.equal((await read()).accepted.visible,false);assert.equal((await read()).value.parts.form,'missing');assert.equal(await page.locator('#save').isDisabled(),true);
 const missingBytes=await page.evaluate(key=>localStorage.getItem(key),storageKey);assert.equal(await page.locator('#retry').isDisabled(),true);assert.match((await read()).message,/Reload after fixing the asset/);await click('reload');await page.waitForFunction(()=>window.modelPreview?.read().message.includes('Accepted model is incompatible'));assert.equal((await read()).accepted.visible,false);assert.equal(await page.evaluate(key=>localStorage.getItem(key),storageKey),missingBytes);await shot('restore-incompatible');
 await page.evaluate(({key,bytes})=>localStorage.setItem(key,bytes),{key:storageKey,bytes:savedBytes});
 secondMissing=true;await click('reload');await page.waitForFunction(()=>window.modelPreview?.read().message.includes('Accepted model is incompatible'));assert.equal((await read()).value.parts.form,'second');assert.equal((await read()).accepted.visible,false);assert.equal(await page.evaluate(key=>localStorage.getItem(key),storageKey),savedBytes);
 assert.match((await read()).message,/Reload after fixing the asset/);assert.equal(await page.locator('#retry').isDisabled(),true);secondMissing=false;await click('reload');await acceptedReady();
 const accepted=(await read()).accepted.entity;
 await choose('failed');await page.waitForFunction(()=>modelPreview.read().candidate?.status==='failed');assert.equal((await read()).accepted.entity,accepted);assert.equal((await read()).value.parts.form,'second');assert.equal(await page.locator('#commit').isDisabled(),true);await click('cancel');
 await choose('missing');await page.waitForFunction(()=>modelPreview.read().message.includes('socket missing'));assert.equal((await read()).candidate.visible,false);assert.equal((await read()).value.parts.form,'second');await click('cancel');
 // Supersede a pending candidate. Its later network completion cannot adopt it.
 await choose('slow');await heldRequest();await page.waitForFunction(()=>modelPreview.read().candidate?.status==='loading');const stale=(await read()).candidate.entity;
 await choose('first');await candidateReady();release();await page.waitForTimeout(100);assert.notEqual((await read()).candidate.entity,stale);assert.equal((await read()).candidate.adoptedAsset,'first');assert.equal((await read()).accepted.adoptedAsset,'second');await click('cancel');
 await page.waitForTimeout(100);const before=await page.evaluate(()=>({models:engine.probe('models'),draws:window.__modelDraws}));await page.evaluate(()=>modelPreview.queryRepeated());await page.waitForTimeout(100);const after=await page.evaluate(()=>({models:engine.probe('models'),draws:window.__modelDraws}));assert.deepEqual(after,before);
 secondUnavailable=true;await click('reload');await page.waitForFunction(()=>window.modelPreview?.read().accepted?.status==='failed');assert.equal((await read()).value.parts.form,'second');assert.equal((await read()).accepted.visible,false);await shot('restore-failed');
 secondUnavailable=false;await click('retry');await acceptedReady();assert.equal((await read()).value.parts.form,'second');
 await choose('slow');await heldRequest();await page.waitForFunction(()=>modelPreview.read().candidate?.status==='loading');
 const epoch=await page.evaluate(()=>engine.state().scene.epoch);await page.evaluate(()=>engine.goto('sample',{again:'replacement'}));release();
 await page.waitForFunction(epoch=>engine.state().scene?.epoch!==epoch&&modelPreview.read().accepted?.status==='ready',epoch);
 assert.equal((await read()).candidate,null);assert.equal((await read()).count,1);assert.equal((await read()).accepted.adoptedAsset,'second');
 await choose('slow');await heldRequest();await page.waitForFunction(()=>modelPreview.read().candidate?.status==='loading');await page.evaluate(()=>modelPreview.dispose());release();await page.waitForTimeout(100);assert.equal((await read()).retired,true);assert.equal((await read()).count,0);
 const released=await page.evaluate(()=>modelPreview.resources());assert.equal(released.instances,0);assert.equal(released.residentMiB,0);
 assert.deepEqual(report.errors,[]);
 for(const id of ['failed','second']){
   const resource=report.consoleErrors.filter(e=>e.url.endsWith(`/__model-preview/${id}.glb`)&&/^Failed to load resource:.*503/.test(e.text));
   const runtime=report.consoleErrors.filter(e=>e.text.startsWith(`[feature.sample] sample: model failed Error: [assets] /__model-preview/${id}.glb: HTTP 503`));
   assert.equal(resource.length,1,`${id} expected browser HTTP failure`);assert.equal(runtime.length,1,`${id} expected owned failure report`);
 }
 assert.equal(report.consoleErrors.length,4,'only the four explicit injected error reports are allowed');
 writeFileSync(resolve(out,'snapshots.json'),JSON.stringify({initial,pending,preview,before,after,released},null,2));report.passed=true;
}catch(error){evidence.fail(error);}finally{release();await evidence.close(browser,'browser close');await evidence.close(server,'server close');evidence.finish();}
console.log(`Model preview passed; evidence ${out}`);
