#!/usr/bin/env node
// Advisory first-use observations through existing stock consumer contracts; no runtime instrumentation.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {serve, ROOT} from './lib.mjs';
import {gameDirLabel} from '../lib/game-dir.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out=resolve(process.argv[2]??'playtest/first-use');mkdirSync(out,{recursive:true});
const git=args=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();
const report={revision:git(['rev-parse','HEAD']),dirtyWorktree:!!git(['status','--porcelain']),game:gameDirLabel(),samples:[],resources:[],limitations:[
  'Advisory raw timings, no latency budget or statistical percentile claim. Three fresh contexts in one isolated Chromium process; browser/driver caches may remain warm.',
  'Vite development consumer, not a production bundle, download benchmark, hardware/device or thermal result. Same-page warm visits may still reconstruct renderer programs.',
  'MutationObserver timestamps observe batched DOM changes. Shell active follows the engine submitted-picture contract; it does not prove display presentation.',
  'Program readiness covers an aggregate preparation path including initial render and submitted-command fence. Compile, decode, GPU upload and first draw durations are unmeasured.',
  'Input time starts at the browser keydown handler and ends at a 10ms polling observation of changed player state; excludes dispatch IPC but includes observer delay. Not input-to-photon.',
  'No cancellation or unsettled-asset retention claim. Pool counts are sampled after successful arrival, not complete heap/listener accounting.',
]};
const evidence=diagnosticReport(report,resolve(out,'report.json'));
let server,browser,extraContext,currentPage;
try{
 assert.equal(gameDirLabel(),'templates/explorer/game');
 server=await serve();browser=await launch({width:1280,height:800,strictClose:true});
 report.environment={browser:browser.version,executable:browser.executable,arguments:browser.launchArguments,node:process.version,viewport:{width:1280,height:800}};
 for(let index=0;index<3;index++){
  const context=index===0?browser.context:(extraContext=await browser.browser.newContext({viewport:{width:1280,height:800},locale:'en-US',timezoneId:'UTC'}));
  assert.equal(browser.browser.contexts().length,1,'exactly one live context during each sample group');
  const page=index===0?browser.page:await context.newPage();currentPage=page;
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{
   performance.setResourceTimingBufferSize(1024);
   const marks=[],seen=new WeakMap();
   const add=(kind,value)=>{if(marks.length>=256)throw Error('first-use mark capacity exceeded');marks.push({atMs:performance.now(),kind,value,scene:document.querySelector('#app')?.dataset.scene??null});};
   const scan=()=>{
    const app=document.querySelector('#app');
    for(const node of [app,...document.querySelectorAll('[data-program-readiness]')]){
     if(!node)continue;
     const kind=node===app?'shell':'program';
     const value=node===app?`${node.dataset.scene}:${node.dataset.sceneState}`:node.dataset.programReadiness;
     if(seen.get(node)!==value){seen.set(node,value);add(kind,value);}
    }
   };
   new MutationObserver(scan).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-scene','data-scene-state','data-program-readiness']});
   window.firstUse={marks,input:null,resourceTimingTruncated:false,arm(){this.input={armed:true};}};
   performance.addEventListener('resourcetimingbufferfull',()=>{window.firstUse.resourceTimingTruncated=true;});
   window.addEventListener('keydown',event=>{
    if(event.code!=='ArrowRight'||!window.firstUse.input?.armed)return;
    const before=window.engine.state().world.named.player,started=performance.now();
    window.firstUse.input={armed:false,started};
    const poll=()=>{
     const current=window.engine.state().world.named.player;
     if(current.x!==before.x||current.z!==before.z){window.firstUse.input={started,observed:performance.now(),before,current};return;}
     if(performance.now()-started>5000){window.firstUse.input={started,error:'movement timeout'};return;}
     setTimeout(poll,10);
    };setTimeout(poll,10);
   },{capture:true});
  });
  await page.goto(`${server.url}/?flags=dev.silent&seed=1#scene/garden`);
  const visit=async(label,id,requestAtMs)=>{
   await page.waitForFunction(id=>window.engine&&document.querySelector('#app')?.dataset.scene===`scene.${id}`&&document.querySelector('#app')?.dataset.sceneState==='active',id);
   const arrival=await page.evaluate(({id,requestAtMs})=>{
    const marks=window.firstUse.marks.filter(m=>m.atMs>=requestAtMs);
    const active=marks.find(m=>m.kind==='shell'&&m.value===`scene.${id}:active`);
    return {marks,activeAtMs:active?.atMs??null,pool:window.engine.probe('render.pool')};
   },{id,requestAtMs});
   assert.notEqual(arrival.activeAtMs,null,'observed arrival marker');
   assert.ok(arrival.marks.some(m=>m.kind==='program'&&['ready','unsupported','degraded'].includes(m.value)),'observed aggregate readiness');
   assert.equal(arrival.pool.contexts,1);assert.equal(arrival.pool.overflows,0);
   await page.locator('.scene-view').focus();await page.evaluate(()=>window.firstUse.arm());
   await page.keyboard.down('ArrowRight');
   try{await page.waitForFunction(()=>window.firstUse.input?.observed||window.firstUse.input?.error);}
   finally{await page.keyboard.up('ArrowRight');}
   const input=await page.evaluate(()=>window.firstUse.input);
   assert.equal(input.error,undefined);assert.ok(input.observed>=input.started);
   report.samples.push({context:index+1,label,scene:id,requestAtMs,...arrival,arrivalMs:arrival.activeAtMs-requestAtMs,inputEventToObservedMovementMs:input.observed-input.started,input,
    unmeasured:{fetchMs:null,decodeMs:null,uploadMs:null,programCompileMs:null,gpuFirstDrawMs:null,presentationMs:null}});
  };
  await visit('context-cold entry','garden',0);
  for(const [label,id] of [['first transition','shed'],['first return','garden'],['repeat transition 1','shed'],['repeat return 1','garden'],['repeat transition 2','shed'],['repeat return 2','garden']]){
   const started=await page.evaluate(id=>{const at=performance.now();void window.engine.goto(id).catch(error=>{window.firstUse.routeError=String(error);});return at;},id);
   await visit(label,id,started);
   assert.equal(await page.evaluate(()=>window.firstUse.routeError),undefined);
  }
  report.resources.push({context:index+1,...await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),resource:performance.getEntriesByType('resource').slice(0,1024).map(e=>e.toJSON()),resourceCount:performance.getEntriesByType('resource').length,resourceTimingTruncated:window.firstUse.resourceTimingTruncated}))});
  assert.deepEqual(errors,[]);
  if(index===0)await page.screenshot({path:resolve(out,'first-context.png')});
  // Retire the first context too: no earlier app may keep running during the next sample.
  await context.close();extraContext=undefined;currentPage=undefined;
  assert.equal(browser.browser.contexts().length,0,'previous app retired before the next context');
 }
 assert.equal(report.samples.length,21);report.passed=true;
}catch(error){evidence.fail(error);try{await currentPage?.screenshot({path:resolve(out,'failure.png')});}catch(captureError){report.failureScreenshotError=String(captureError);}}
finally{await evidence.close(extraContext,'extra context cleanup');await evidence.close(browser,'browser cleanup');await evidence.close(server,'server cleanup');evidence.finish();}
console.log(`First-use observations: PASS (advisory timings); ${out}`);
