// Actual stock-loader consumer; one isolated muted browser, no Blender process.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {launch} from '../../scripts/perf/bench-browser.mjs';
import {diagnosticReport} from '../../scripts/play/diagnostic-report.mjs';
import {serve, open, measure, budgetStatus} from '../../scripts/play/lib.mjs';
const out = resolve(process.argv[2] ?? 'playtest/blender-export');
mkdirSync(out,{recursive:true});
const report = {passed:false, errors:[], limitations:['Desktop software GL only; no physical-device, textured asset, animation, Blender GUI or MCP acceptance.']};
const evidence = diagnosticReport(report, resolve(out,'report.json'));
let server,browser;
try {
 server=await serve(); browser=await launch({strictClose:true});
 browser.page.on('pageerror',e=>report.errors.push(e.message));
 browser.page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 const requests=[]; browser.page.on('response',r=>{if(new URL(r.url()).pathname.endsWith('.glb'))requests.push({url:new URL(r.url()).pathname,status:r.status()});});
 await open(browser,server.url,'main');
 await browser.page.waitForFunction(()=>window.engine.state().world.state.modelStatus==='ready');
 report.before=await browser.evaluate('window.engine.state().world.state');
 assert.equal(report.before.turns,0,'no input applied before the test press');
 assert.equal(report.before.rotation,0,'initial rotation is zero');
 await browser.page.screenshot({path:resolve(out,'loaded.png')});
 await browser.page.keyboard.press('Space');
 await browser.page.waitForFunction(()=>window.engine.state().world.state.turns===1);
 report.after=await browser.evaluate('window.engine.state().world.state');
 assert.ok(Math.abs(report.after.rotation - Math.PI / 2) < 1e-6);
 report.modelResponses=requests;
 assert.equal(requests.length,1); assert.equal(requests[0].status,200);
 await browser.page.screenshot({path:resolve(out,'turned.png')});
 report.renderCounts=await measure(browser,async()=>{
   for(let i=0;i<3;i++){ await browser.evaluate('window.engine.redraw()'); await browser.page.waitForTimeout(100); }
 },500);
 report.budget=budgetStatus('main',report.renderCounts);
 assert.ok(report.renderCounts.renders>0,'count budget requires actual rendered frames');
 assert.equal(report.budget.status,'within budget');
 assert.deepEqual(report.errors,[]); report.passed=true;
} catch (error) {
 evidence.fail(error);
} finally {
 await evidence.close(browser,'browser cleanup');
 await evidence.close(server,'server cleanup');
 evidence.finish();
}
console.log(JSON.stringify(report,null,2));
