#!/usr/bin/env node
// Advisory first-use observations through existing stock consumer contracts; no runtime instrumentation.
//
//   node -r ./scripts/silent-browser.cjs scripts/play/first-use-check.mjs [outDir]                 Vite development consumer
//   node -r ./scripts/silent-browser.cjs scripts/play/first-use-check.mjs [outDir] --production    static production build
//
// Each of three fresh browser contexts records a context-cold entry, six transitions, then a warm entry: a second
// navigation in the same context after about:blank, so the context's HTTP cache is primed. `--production` builds the
// template with `--base /first-use/` into a scratch directory and serves it only under that prefix (any request outside
// it fails). The production bundle has no `window.engine`, so it observes DOM shell attributes only and requests
// transitions through the hash route; input timing and pool counts are unobservable there and stay null.
// Timings are advisory: no threshold, budget or percentile is asserted.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {createServer} from 'node:http';
import {cpus,getPriority,loadavg,platform,release,tmpdir,totalmem} from 'node:os';
import {extname,join,normalize,resolve,sep} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {serve, ROOT} from './lib.mjs';
import {gameDirLabel} from '../lib/game-dir.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const production=process.argv.includes('--production');
const out=resolve(process.argv.slice(2).find(a=>!a.startsWith('--'))??(production?'playtest/first-use-production':'playtest/first-use'));mkdirSync(out,{recursive:true});
const PREFIX='/first-use/';
const git=args=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();
const report={revision:git(['rev-parse','HEAD']),dirtyWorktree:!!git(['status','--porcelain']),game:gameDirLabel(),mode:production?'production':'development',samples:[],resources:[],browserErrors:[],limitations:[
  'Advisory raw timings, no latency budget or statistical percentile claim. Three fresh contexts in one isolated Chromium process; browser/driver caches may remain warm.',
  production
   ?'Static production build served by a local loopback host under /first-use/ (hashed assets immutable, other files no-cache with ETag revalidation). No CDN, network latency, compression, download benchmark, hardware/device or thermal result.'
   :'Vite development consumer, not a production bundle, download benchmark, hardware/device or thermal result. Same-page warm visits may still reconstruct renderer programs.',
  'Warm entry: a second navigation (after about:blank) in the same context with its HTTP cache primed by the cold visit. Renderer processes, compiled scripts and GPU shader caches may also be warm; it is not a cross-session repeat-visit claim.',
  'MutationObserver timestamps observe batched DOM changes. Shell active follows the engine submitted-picture contract; it does not prove display presentation.',
  'Program readiness covers an aggregate preparation path including initial render and submitted-command fence. Compile, decode, GPU upload and first draw durations are unmeasured.',
  production
   ?'Production builds have no window.engine: input-to-movement time and renderer pool counts are unobservable (null); transitions are requested through the hash route.'
   :'Input time starts at the browser keydown handler and ends at a 10ms polling observation of changed player state; excludes dispatch IPC but includes observer delay. Not input-to-photon.',
  'No cancellation or unsettled-asset retention claim. Pool counts are sampled after successful arrival, not complete heap/listener accounting.',
]};
const evidence=diagnosticReport(report,resolve(out,'report.json'));

const TYPES={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.glb':'model/gltf-binary','.wav':'audio/wav','.ogg':'audio/ogg','.mp3':'audio/mpeg','.txt':'text/plain','.wasm':'application/wasm'};
/** A static host serving `dir` only under PREFIX, logging every request; hashed build assets are immutable, the rest revalidate. */
function host(dir,log){
 const server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://x').pathname);
  const entry={path,status:404};log.push(entry);
  if(!path.startsWith(PREFIX)){entry.outside=true;res.statusCode=404;res.end('outside the prefix');return;}
  const rel=path.slice(PREFIX.length)||'index.html',file=normalize(join(dir,rel));
  if(!file.startsWith(dir+sep)||!existsSync(file)||!statSync(file).isFile()){res.statusCode=404;res.end('not found');return;}
  const body=readFileSync(file),etag=`"${createHash('sha1').update(body).digest('hex')}"`;
  res.setHeader('Content-Type',TYPES[extname(file)]??'application/octet-stream');res.setHeader('ETag',etag);
  res.setHeader('Cache-Control',rel.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache');
  if(req.headers['if-none-match']===etag){entry.status=304;res.statusCode=304;res.end();return;}
  entry.status=200;entry.bytes=body.length;res.end(body);
 });
 return new Promise(done=>server.listen(0,'127.0.0.1',()=>done({url:`http://127.0.0.1:${server.address().port}${PREFIX.slice(0,-1)}`,close:()=>new Promise(r=>{server.close(()=>r());server.closeAllConnections();})})));
}
function build(dir){
 const env={...process.env,GAME_DIR:'templates/explorer/game'},started=performance.now();
 for(const argv of [['scripts/generate.mjs'],['node_modules/vite/bin/vite.js','build','--base',PREFIX,'--outDir',dir,'--emptyOutDir','--logLevel','error']]){
  const r=spawnSync(process.execPath,argv,{cwd:ROOT,env,encoding:'utf8'});
  if(r.status!==0)throw Error(`${argv.join(' ')} failed\n${r.stdout}\n${r.stderr}`);
 }
 return performance.now()-started;
}
const summarize=entries=>({count:entries.length,cacheServed:entries.filter(e=>e.transferSize===0&&e.decodedBodySize>0).length,transferBytes:entries.reduce((s,e)=>s+(e.transferSize??0),0),decodedBytes:entries.reduce((s,e)=>s+(e.decodedBodySize??0),0)});

let server,browser,extraContext,currentPage,buildDir;const serverLog=[];
try{
 assert.equal(gameDirLabel(),'templates/explorer/game');
 const cpu=cpus();
 report.environment={node:process.version,platform:`${platform()} ${release()}`,cpuModel:cpu[0]?.model??null,logicalCpus:cpu.length,totalMemoryGiB:+(totalmem()/2**30).toFixed(1),niceness:getPriority(),loadAverage:loadavg().map(n=>+n.toFixed(2))};
 if(production){
  buildDir=mkdtempSync(join(tmpdir(),'engine-first-use-'));
  report.buildMs=build(buildDir);
  server=await host(buildDir,serverLog);
 }else server=await serve();
 browser=await launch({width:1280,height:800,strictClose:true});
 Object.assign(report.environment,{browser:browser.version,executable:browser.executable,arguments:browser.launchArguments,viewport:{width:1280,height:800},server:production?`static ${PREFIX} (loopback)`:'vite dev (loopback)'});
 const entryUrl=production?`${server.url}/index.html?flags=dev.silent&seed=1#scene/garden`:`${server.url}/?flags=dev.silent&seed=1#scene/garden`;
 for(let index=0;index<3;index++){
  const context=index===0?browser.context:(extraContext=await browser.browser.newContext({viewport:{width:1280,height:800},locale:'en-US',timezoneId:'UTC'}));
  assert.equal(browser.browser.contexts().length,1,'exactly one live context during each sample group');
  const page=index===0?browser.page:await context.newPage();currentPage=page;
  const errors=[],badResponses=[];report.browserErrors.push({context:index+1,errors,badResponses});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()});});
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
    if(event.code!=='ArrowRight'||!window.firstUse.input?.armed||!window.engine)return;
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
  const visit=async(label,id,requestAtMs,logFrom)=>{
   await page.waitForFunction(({id,production})=>(production||window.engine)&&document.querySelector('#app')?.dataset.scene===`scene.${id}`&&document.querySelector('#app')?.dataset.sceneState==='active',{id,production});
   const arrival=await page.evaluate(({id,requestAtMs})=>{
    const marks=window.firstUse.marks.filter(m=>m.atMs>=requestAtMs);
    const active=marks.find(m=>m.kind==='shell'&&m.value===`scene.${id}:active`);
    return {marks,activeAtMs:active?.atMs??null,pool:window.engine?.probe('render.pool')??null,testApi:'engine' in window};
   },{id,requestAtMs});
   assert.notEqual(arrival.activeAtMs,null,`${label}: observed arrival marker`);
   assert.ok(arrival.marks.some(m=>m.kind==='program'&&['ready','unsupported','degraded'].includes(m.value)),`${label}: observed aggregate readiness`);
   let input=null;
   if(production){
    assert.equal(arrival.testApi,false,'production build exposes no test API');
   }else{
    assert.equal(arrival.pool.contexts,1);assert.equal(arrival.pool.overflows,0);
    await page.locator('.scene-view').focus();await page.evaluate(()=>window.firstUse.arm());
    await page.keyboard.down('ArrowRight');
    try{await page.waitForFunction(()=>window.firstUse.input?.observed||window.firstUse.input?.error);}
    finally{await page.keyboard.up('ArrowRight');}
    input=await page.evaluate(()=>window.firstUse.input);
    assert.equal(input.error,undefined);assert.ok(input.observed>=input.started);
   }
   const requests=production?serverLog.slice(logFrom):null;
   report.samples.push({context:index+1,label,scene:id,requestAtMs,...arrival,arrivalMs:arrival.activeAtMs-requestAtMs,inputEventToObservedMovementMs:input?input.observed-input.started:null,input,
    serverRequests:requests&&{total:requests.length,ok:requests.filter(r=>r.status===200).length,notModified:requests.filter(r=>r.status===304).length,bytes:requests.reduce((s,r)=>s+(r.bytes??0),0)},
    unmeasured:{fetchMs:null,decodeMs:null,uploadMs:null,programCompileMs:null,gpuFirstDrawMs:null,presentationMs:null,...(production?{inputEventToObservedMovementMs:null,pool:null}:{})}});
  };
  const resources=async label=>{
   const r=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),resource:performance.getEntriesByType('resource').slice(0,1024).map(e=>e.toJSON()),resourceCount:performance.getEntriesByType('resource').length,resourceTimingTruncated:window.firstUse.resourceTimingTruncated}));
   report.resources.push({context:index+1,visit:label,summary:summarize([...r.navigation,...r.resource]),...r});
  };
  let logFrom=serverLog.length;
  await page.goto(entryUrl);
  await visit('context-cold entry','garden',0,logFrom);
  const request=async id=>page.evaluate(({id,production})=>{const at=performance.now();if(production)location.hash=`#scene/${id}`;else void window.engine.goto(id).catch(error=>{window.firstUse.routeError=String(error);});return at;},{id,production});
  for(const [label,id] of [['first transition','shed'],['first return','garden'],['repeat transition 1','shed'],['repeat return 1','garden'],['repeat transition 2','shed'],['repeat return 2','garden']]){
   logFrom=serverLog.length;
   await visit(label,id,await request(id),logFrom);
   assert.equal(await page.evaluate(()=>window.firstUse.routeError),undefined);
  }
  await resources('cold');
  if(index===0)await page.screenshot({path:resolve(out,'first-context.png')});
  // Warm entry: the same context, its HTTP cache primed by the cold visit; a new document after about:blank.
  await page.goto('about:blank');
  logFrom=serverLog.length;
  await page.goto(entryUrl);
  await visit('context-warm entry','garden',0,logFrom);
  await resources('warm');
  if(index===0)await page.screenshot({path:resolve(out,'first-context-warm.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[],'no 4xx/5xx responses');
  // Retire the first context too: no earlier app may keep running during the next sample.
  await context.close();extraContext=undefined;currentPage=undefined;
  assert.equal(browser.browser.contexts().length,0,'previous app retired before the next context');
  assert.deepEqual(errors,[],'no page errors through context retirement');
 }
 assert.equal(report.samples.length,24);
 if(production){
  report.outsidePrefix=serverLog.filter(r=>r.outside).map(r=>r.path);
  assert.deepEqual(report.outsidePrefix,[],`no request outside ${PREFIX}`);
 }
 report.passed=true;
}catch(error){evidence.fail(error);try{await currentPage?.screenshot({path:resolve(out,'failure.png')});}catch(captureError){report.failureScreenshotError=String(captureError);}}
finally{await evidence.close(extraContext,'extra context cleanup');await evidence.close(browser,'browser cleanup');await evidence.close(server,'server cleanup');
 if(buildDir)rmSync(buildDir,{recursive:true,force:true});
 for(const {context,errors,badResponses} of report.browserErrors){if(errors.length)evidence.fail(new Error(`context ${context} browser errors: ${errors.join('; ')}`));if(badResponses.length)evidence.fail(new Error(`context ${context} failed responses: ${JSON.stringify(badResponses)}`));}
 if(production&&serverLog.some(r=>r.outside))evidence.fail(new Error(`requests outside ${PREFIX}: ${serverLog.filter(r=>r.outside).map(r=>r.path).join(', ')}`));
 evidence.finish();}
const row=s=>`${s.context} ${s.label.padEnd(20)} ${s.arrivalMs.toFixed(1).padStart(7)}ms${s.serverRequests?` server ${s.serverRequests.ok}x200 ${s.serverRequests.notModified}x304`:''}`;
console.log(report.samples.filter(s=>/entry|first transition/.test(s.label)).map(row).join('\n'));
console.log(`First-use observations (${report.mode}): PASS (advisory timings); ${out}`);
