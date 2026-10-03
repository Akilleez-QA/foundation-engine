#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { ROOT } from './lib.mjs';
import { launch } from '../perf/bench-browser.mjs';
import { diagnosticReport } from './diagnostic-report.mjs';
const out=resolve(process.argv[2]??'playtest/framework/dpr-redraw');mkdirSync(out,{recursive:true});
const git=args=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();
const report={revision:git(['rev-parse','HEAD']),dirtyWorktree:git(['status','--porcelain']).length>0,passed:false,
 limitations:['One desktop Chromium software-GL run; native successful render calls, not GPU completion or physical display quality.']};
const evidence=diagnosticReport(report,resolve(out,'report.json'));let server,browser;
const deadline=setTimeout(()=>{evidence.fail(Error('DPR redraw check exceeded 90 seconds'));void browser?.close().catch(error=>evidence.fail(error,'deadline browser cleanup'));void server?.close().catch(error=>evidence.fail(error,'deadline server cleanup'));},90000);deadline.unref();
try{
 server=await createServer({root:ROOT,logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'dpr-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
  if(!req.url?.startsWith('/__dpr-redraw.html'))return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="icon" href="data:,"><title>DPR redraw</title><style>body{margin:0}#app{height:85vh;position:relative}</style><main id="app"></main><script type="module" src="/scripts/play/fixtures/dpr-redraw.ts"></script>');
 });}}]});
 await server.listen();browser=await launch({width:800,height:600,strictClose:true});report.browser=browser.version;
 const page=browser.page;page.setDefaultTimeout(15000);
 await page.goto(`${server.resolvedUrls.local[0]}__dpr-redraw.html?flags=dev.silent#scene/dpr-redraw`);
 await page.waitForFunction(()=>window.dprFixture?.read().ready&&window.dprFixture.read().renders>0);
 await page.evaluate(()=>{window.engine.clock.hold();for(let i=0;i<4;i++)window.engine.clock.step(1000/60);});
 // Let any initial CSS ResizeObserver delivery finish before the controlled baseline.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const sample=await page.evaluate(async()=>{
  const engine=window.engine,fixture=window.dprFixture;
  engine.clock.step(1000/60);const before=fixture.read();fixture.change();await Promise.resolve();
  const resized=fixture.read();engine.clock.step(1000/60);const drawn=fixture.read();
  for(let i=0;i<8;i++)engine.clock.step(1000/60);return {before,resized,drawn,idle:fixture.read()};
 });
 report.sample=sample;
 assert.notEqual(sample.resized.buffer.ratio,sample.before.buffer.ratio);assert.deepEqual(sample.resized.css,sample.before.css);
 assert.equal(sample.drawn.renders,sample.before.renders+1,'DPR-only change requests exactly one native redraw');
 assert.equal(sample.idle.renders,sample.drawn.renders,'static scene returns to idle');
 assert.deepEqual(sample.idle.world,sample.before.world);assert.equal(sample.idle.epoch,sample.before.epoch);
 assert.ok(sample.drawn.buffer.width<sample.before.buffer.width);
 await page.screenshot({path:resolve(out,'redrawn.png')});await page.evaluate(()=>window.dprFixture.dispose());
 report.passed=true;
}catch(error){evidence.fail(error);}finally{clearTimeout(deadline);await evidence.close(browser,'browser cleanup');await evidence.close(server,'server cleanup');report.errors=browser?.errors??[];if(report.errors.length)evidence.fail(Error(JSON.stringify(report.errors)),'browser errors');evidence.finish();}
console.log(`DPR redraw: PASS; ${out}`);
