#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
import {fixture,expectedVertices} from '../../tools/weighted-appearance/fixtures.mjs';
const out=resolve(process.argv[2]??'playtest/weighted-appearance');mkdirSync(out,{recursive:true});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),dirtyWorktree:!!execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],consoleErrors:[],screenshots:[],limitations:['Desktop Chromium 1440×960 keyboard/pointer diagnostic only; phone/tablet and physical hardware unverified.','Independent scalar three-vertex oracle observes actual adopted GLB skinning. No arbitrary retargeting, shared palette or skeleton fusion claim.','Delayed transport may abort before decode; runtime adversarial tests cover stale decoded adoption.']};
const evidence=diagnosticReport(report,resolve(out,'report.json'));let held=[],browser;const release=()=>{for(const send of held.splice(0))send();};
const server=await createServer({root:ROOT,logLevel:'error',plugins:[{name:'weighted-original-fixtures',configureServer(s){s.middlewares.use((req,res,next)=>{const match=/^\/__weighted-appearance\/([a-z]+)\.glb$/.exec(req.url??'');if(!match)return next();const send=()=>{if(res.destroyed)return;if(match[1]==='failed'){res.statusCode=503;res.end('Injected unavailable model');return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','model/gltf-binary');res.end(match[1]==='failed'?Buffer.from('intentional invalid GLB'):fixture(match[1]));};if(match[1]==='slow')held.push(send);else send();});}}],server:{host:'127.0.0.1',port:0}});
const snapshots={};
try{
 await server.listen();browser=await launch({width:1440,height:960,strictClose:true});const page=browser.page;
 page.on('pageerror',error=>report.errors.push(String(error)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push({text:m.text(),url:m.location().url});});
 const read=()=>page.evaluate(()=>weightedAppearance.read()),click=id=>page.locator('#'+id).click();
 const ready=()=>page.waitForFunction(()=>window.weightedAppearance?.read().accepted?.link.status==='ready');
 const waitCandidate=()=>page.waitForFunction(()=>weightedAppearance.read().candidate?.link.status==='ready');
 const open=async()=>{if(await page.locator('#panel').isHidden()){await page.locator('#open').focus();await page.keyboard.press('Enter');await page.locator('#panel').waitFor({state:'visible'});}};
 const preview=async id=>{await open();await page.locator('#part').selectOption(id);await click('preview');};
 const shot=async name=>{const path=resolve(out,name+'.png');await page.screenshot({path});report.screenshots.push(path);};
 const reload=async()=>{await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('reload')]);};
 // Existing loop counters describe whole-engine work; the pool probe is lifetime accounting,
 // not renderer draw counts or isolated skeleton/palette timings. Sampling never advances pose.
 const sampleCost=async label=>{
  const sample=await page.evaluate(async()=>{
   const before={loop:engine.loop(),pool:engine.probe('render.pool'),models:weightedAppearance.read().resources};
   const intervals=await new Promise(resolve=>{const values=[];let previous;const tick=time=>{if(previous!==undefined)values.push(time-previous);previous=time;if(values.length===30)resolve(values);else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
   const after={loop:engine.loop(),pool:engine.probe('render.pool'),models:weightedAppearance.read().resources};
   return {before,after,intervals};
  });
  assert.ok(sample.before.models.instances<=4&&sample.after.models.instances<=4,'accepted plus candidate residency stays within four-instance consumer bound');
  const sorted=[...sample.intervals].sort((a,b)=>a-b);
  const loopDelta=Object.fromEntries(Object.keys(sample.before.loop).map(key=>[key,sample.after.loop[key]-sample.before.loop[key]]));
  return {label,window:'30 consecutive requestAnimationFrame intervals',frameIntervalsMs:sample.intervals,elapsedRafMs:sample.intervals.reduce((a,b)=>a+b,0),medianFrameMs:sorted[15],p95FrameMs:sorted[28],loopDelta,before:sample.before,after:sample.after};
 };
 const check=async(angle,x,which='accepted')=>{const inspection=await page.evaluate(which=>weightedAppearance.inspect(which),which);const rows=inspection.model.skinVertices;assert.equal(rows.length,3);const expected=expectedVertices(angle,x);for(let i=0;i<3;i++){assert.equal(rows[i].status,'ready');for(let axis=0;axis<3;axis++)assert.ok(Math.abs(rows[i].position[axis]-expected[i][axis])<2e-5,`vertex${i}/${axis} ${rows[i].position} expected ${expected[i]}`);}return inspection;};
 await page.goto(server.resolvedUrls.local[0]+'tools/weighted-appearance/index.html?flags=dev.silent');await ready();assert.equal(await page.locator('#panel').isHidden(),true);snapshots.initial=await read();await check(0,-2);await shot('closed-world');
 await open();await page.locator('#bend').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>weightedAppearance.inspect().model.skinVertices[1].position[1]>.9);snapshots.bent=await check(Math.PI/2,-2);await shot('weighted-bend');
 await preview('reversed');await waitCandidate();await check(Math.PI/2,.8,'candidate');await shot('candidate-comparison');const before=await read();await click('commit');await ready();await page.waitForFunction(()=>Math.abs(weightedAppearance.inspect().model.skinVertices[0].position[0]+2)<1e-6);assert.equal((await read()).value.parts.surface,'reversed');await check(Math.PI/2,-2);assert.equal((await read()).resources.instances,2);await shot('reversed-palette');
 await click('save');assert.equal((await read()).save,'saved');await reload();await ready();await open();assert.equal((await read()).value.parts.surface,'reversed');await check(0,-2);
 for(const id of ['missing','badbind']){const old=(await read()).accepted;await preview(id);await page.waitForFunction(()=>weightedAppearance.read().candidate?.link.status==='incompatible');assert.equal((await read()).accepted.part,old.part);assert.equal(await page.locator('#commit').isDisabled(),true);await check(0,-2);await shot(id);await click('cancel');}
 const accepted=(await read()).accepted;await preview('failed');await page.waitForFunction(()=>weightedAppearance.read().candidate?.partState.status==='failed');assert.equal((await read()).accepted.part,accepted.part);assert.equal(await page.locator('#commit').isDisabled(),true);await click('cancel');
 await preview('slow');await page.waitForFunction(()=>weightedAppearance.read().candidate!==null);await page.evaluate(()=>weightedAppearance.keep());await click('cancel');release();await page.waitForTimeout(100);assert.equal((await read()).candidate,null);assert.equal(await page.evaluate(()=>weightedAppearance.previous().status),'absent');assert.equal((await read()).accepted.part,accepted.part);
 // Refused persistence must be visible and preserve the exact last durable envelope.
 const durable=()=>page.evaluate(()=>localStorage.getItem('weighted-appearance|device|appearance.profile'));
 const assertUnsaved=async()=>{
  assert.match(await page.locator('#summary').innerText(),/^unsaved/);
  assert.match(await page.locator('#persistence').innerText(),/^Persistence: unsaved/);
  assert.equal(await page.locator('#save').isVisible(),true);
  assert.equal(await page.locator('#save').isEnabled(),true,'a refused write remains retryable');
 };
 const reversedRaw=await durable();assert.equal(JSON.parse(reversedRaw).data.parts.surface,'reversed');
 await preview('cyan');await waitCandidate();await click('commit');await click('fail-save');await click('save');
 await assertUnsaved();assert.equal(await durable(),reversedRaw);snapshots.failedSave=await read();await shot('save-refused');
 await reload();await ready();await open();assert.equal((await read()).value.parts.surface,'reversed');await check(0,-2);
 assert.equal(await durable(),reversedRaw,'reload retains the old durable record');
 // Refuse again, then recover in the same live page. No reload may hide the failed state before retry.
 await preview('cyan');await waitCandidate();await click('commit');await click('fail-save');await click('save');
 await assertUnsaved();assert.equal(await durable(),reversedRaw);snapshots.retryRefused=await read();
 await click('restore-save');assert.match(await page.locator('#message').innerText(),/^Writes restored; choose Save to retry\./);
 await assertUnsaved();await click('save');
 assert.equal(await page.locator('#summary').innerText(),'saved');
 assert.equal(await page.locator('#persistence').innerText(),'Persistence: saved');
 assert.equal(JSON.parse(await durable()).data.parts.surface,'cyan');snapshots.retrySaved=await read();await shot('save-recovered');
 await reload();await ready();await open();assert.equal((await read()).value.parts.surface,'cyan');
 assert.equal((await read()).accepted.part,'cyan');assert.equal(await page.locator('#summary').innerText(),'saved');
 await check(0,-2);snapshots.retryReloaded=await read();await shot('recovered-reload');
 // A reload deliberately clears history. Create fresh edits before exercising the existing undo branch.
 await preview('reversed');await waitCandidate();await click('commit');
 await preview('cyan');await waitCandidate();await click('commit');
 await click('undo');await waitCandidate();await click('commit');assert.equal((await read()).value.parts.surface,'reversed');
 await click('save');await reload();await ready();await open();assert.equal((await read()).value.parts.surface,'reversed');
 await click('animate');await page.waitForFunction(()=>weightedAppearance.source().model.playback.time>.2);await click('pause');await page.waitForTimeout(50);const playback=await page.evaluate(()=>weightedAppearance.source().model.playback.time);await check((playback<=1?playback:2-playback)*Math.PI/2,-2);snapshots.animated=await read();await shot('native-animated');
 // Same bounded window with native animation active, first accepted group alone,
 // then accepted plus a separately owned candidate. Keep the panel open in both.
 await click('animate');
 const singleCost=await sampleCost('one accepted source/module group');
 assert.equal(singleCost.before.models.instances,2);assert.equal(singleCost.after.models.instances,2);
 await preview('cyan');await waitCandidate();await click('animate');
 const dualCost=await sampleCost('accepted plus candidate source/module groups');
 assert.equal(dualCost.before.models.instances,4);assert.equal(dualCost.after.models.instances,4);
 report.costEvidence={environment:'Headless Chromium on this host; development modules and diagnostic DOM included. Not physical-device certification or a timing gate.',single:singleCost,dual:dualCost,attribution:'These windows observe aggregate scheduling/frame intervals and actual model residency for independently owned animated skeletons. render.pool records context/lease lifetimes only. No available probe isolates palette updates, GPU time or mapped-pose CPU cost; differences cannot be attributed solely to duplicated palette work.'};
 await click('cancel');await click('pause');
 await click('close');assert.equal(await page.locator('#panel').isHidden(),true);assert.equal(await page.evaluate(()=>document.activeElement.id),'open');await open();
 // Schema-valid changed asset revalidates on restore; never silently substitute another part.
 await page.evaluate(()=>{const key='weighted-appearance|device|appearance.profile',v=JSON.parse(localStorage.getItem(key));v.data.parts.surface='badbind';localStorage.setItem(key,JSON.stringify(v));});await reload();await page.waitForFunction(()=>weightedAppearance.read().accepted?.link.status==='incompatible');assert.equal((await read()).value.parts.surface,'badbind');await open();assert.equal(await page.locator('#save').isDisabled(),true);await shot('incompatible-restore');
 await page.evaluate(()=>{const key='weighted-appearance|device|appearance.profile',v=JSON.parse(localStorage.getItem(key));v.v=99;localStorage.setItem(key,JSON.stringify(v));});const newerRaw=await page.evaluate(()=>localStorage.getItem('weighted-appearance|device|appearance.profile'));await reload();await page.waitForFunction(()=>window.weightedAppearance?.read().blocked);await open();assert.equal((await read()).accepted,null);assert.equal(await page.locator('#save').isDisabled(),true);await click('preview');assert.equal((await read()).candidate,null);assert.equal(await page.evaluate(()=>localStorage.getItem('weighted-appearance|device|appearance.profile')),newerRaw);await shot('newer-restore');
 await page.evaluate(()=>localStorage.setItem('weighted-appearance|device|appearance.profile','{broken'));await reload();await page.waitForFunction(()=>window.weightedAppearance?.read().blocked);await open();assert.equal((await read()).accepted,null);assert.equal(await page.locator('#save').isDisabled(),true);await shot('corrupt-restore');await click('reset');await ready();assert.equal((await read()).value.parts.surface,'amber');
 await page.evaluate(()=>weightedAppearance.dispose());await page.waitForTimeout(50);const disposed=await read();assert.equal(disposed.retired,true);assert.equal(disposed.resources.instances,0);assert.equal(disposed.resources.residentMiB,0);snapshots.disposed=disposed;
 assert.deepEqual(report.errors,[]);const expectedErrors=report.consoleErrors.filter(e=>(e.url.endsWith('/__weighted-appearance/failed.glb')&&/^Failed to load resource:.*503/.test(e.text))||e.text.startsWith('[feature.sample] sample: model failed Error: [assets] /__weighted-appearance/failed.glb: HTTP 503'));assert.equal(expectedErrors.length,2);assert.equal(report.consoleErrors.length,2,'only injected unavailable-model errors permitted');writeFileSync(resolve(out,'snapshots.json'),JSON.stringify({before,...snapshots},null,2));report.passed=true;
}catch(error){evidence.fail(error);}finally{release();await evidence.close(browser,'browser close');await evidence.close(server,'server close');evidence.finish();}
console.log(`Weighted appearance passed; evidence ${out}`);
