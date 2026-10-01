#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out=resolve(process.argv[2]??'playtest/stage-journal');mkdirSync(out,{recursive:true});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],screenshots:[],
 limitations:['Desktop 1440x960 Chromium emulation; no phone, physical device or full accessibility acceptance.',
  'One pinned authored run and one local save envelope; no reward service, multiplayer, external reward delivery or concurrent-writer isolation.',
  'Pending actions are visit-owned and intentionally not restored.']};
const evidence=diagnosticReport(report,resolve(out,'report.json'));
const server=await createServer({root:ROOT,logLevel:'error',server:{host:'127.0.0.1',port:0}});let browser;
const key='stage-journal|device|journal.session';
try{
 await server.listen();browser=await launch({width:1440,height:960,strictClose:true});report.browser=browser.version;
 const page=browser.page;page.on('pageerror',e=>report.errors.push(String(e)));
 const ready=async()=>{await page.waitForFunction(()=>window.journal?.state()&&window.engine?.state().scene?.scene==='scene.sample');await page.evaluate(()=>engine.clock.hold());};
 const state=()=>page.evaluate(()=>journal.state()),click=id=>page.locator('#'+id).click();
 const step=async(ms)=>{for(let remaining=ms;remaining>0;remaining-=50)await page.evaluate(dt=>engine.clock.step(dt),Math.min(50,remaining));};
 const shot=async(name)=>{const path=resolve(out,name+'.png');await page.screenshot({path,fullPage:true});report.screenshots.push(path);};
 const bytes=()=>page.evaluate(k=>localStorage.getItem(k),key);
 await page.goto(server.resolvedUrls.local[0]+'tools/stage-journal/index.html?flags=dev.silent');await ready();
 assert.equal((await state()).persistence,'Not saved yet');assert.equal((await state()).view.progress[0].count,0);
 const canvas=await page.locator('#app canvas').boundingBox(),panel=await page.locator('#editor').boundingBox();
 assert.ok(canvas&&panel&&canvas.x+canvas.width<=panel.x,'desktop controls preserve the scene viewport');
 await page.locator('#start').focus();await page.keyboard.press('Enter');
 assert.equal((await state()).view.progress[0].count,0);await step(200);assert.equal((await state()).view.ready,false);
 // The existing reading layer pauses scene work, rather than a second journal timer.
 await page.locator('.hud-details-trigger').click();await page.locator('.hud-details-sheet').waitFor();await step(600);
 assert.equal((await state()).view.progress[0].count,0);assert.equal((await state()).pending.state,'pending');await shot('journal-pending');
 await page.locator('.hud-details-close').click();await page.waitForFunction(()=>!document.querySelector('.hud-details-sheet'));
 await step(350);assert.equal((await state()).view.ready,true);assert.equal((await state()).view.status,'active');
 assert.match(await page.locator('#completion').textContent(),/explicit choice/);assert.equal(await page.locator('#deliver').isDisabled(),true);await shot('requirements-ready');
 await click('choose');assert.equal((await state()).view.stage,'confirm');assert.equal((await state()).view.progress[0].count,0);
 await click('reload');await ready();assert.equal((await state()).view.stage,'confirm');assert.equal((await state()).pending,null);
 await click('start');await step(500);assert.equal((await state()).view.ready,true);assert.equal((await state()).view.status,'active');
 await click('choose');assert.equal((await state()).view.status,'complete');assert.equal((await state()).reward,0);
 await click('deliver');assert.match((await state()).message,/capacity/);assert.equal((await state()).reward,0);assert.equal((await state()).capability,false);assert.equal((await state()).receipt,null);await shot('capacity-pending');
 await click('free');const before=await bytes();await page.evaluate(()=>journal.failure(true));await click('deliver');
 assert.equal((await state()).reward,1);assert.equal((await state()).capability,true);assert.ok((await state()).receipt);assert.match((await state()).persistence,/Unsaved/);assert.equal(await bytes(),before);await shot('accepted-unsaved');
 await click('deliver');assert.equal((await state()).reward,1);await page.evaluate(()=>journal.failure(false));await click('save');
 assert.equal((await state()).persistence,'Saved locally');const persisted=JSON.parse(await bytes()).data;assert.ok(persisted.receipt);assert.equal(persisted.capabilities.grants.length,1);
 await click('reload');await ready();assert.equal((await state()).view.status,'complete');assert.equal((await state()).reward,1);assert.equal((await state()).capability,true);
 await click('deliver');assert.equal((await state()).reward,1);await shot('restored-completion');
 // Restore refuses a separated acknowledgement, rather than presenting a false completion delivery.
 await page.evaluate(k=>{const saved=JSON.parse(localStorage.getItem(k));saved.data.receipt=null;localStorage.setItem(k,JSON.stringify(saved));},key);
 await click('reload');await ready();assert.equal((await state()).reward,0);assert.equal((await state()).capability,false);assert.match((await state()).persistence,/quarantined/);
 await click('start');await click('cancel');await step(1500);assert.equal((await state()).pending,null);assert.equal((await state()).view.status,'cancelled');assert.equal((await state()).view.progress[0].count,0);
 await click('reload');await ready();assert.equal((await state()).view.status,'cancelled');assert.equal((await state()).reward,0);await shot('restored-cancellation');
 // Scene retirement while pending also rejects old work; no pending action is persisted.
 await page.evaluate(k=>localStorage.removeItem(k),key);await click('reload');await ready();await click('start');
 const epoch=await page.evaluate(()=>engine.state().scene.epoch);await page.evaluate(()=>{engine.clock.resume();engine.goto('sample');});
 await page.waitForFunction(previous=>engine.state().scene.epoch>previous&&journal.state()?.pending===null,epoch);await page.evaluate(()=>engine.clock.hold());await step(1000);
 assert.equal((await state()).view.progress[0].count,0);assert.equal((await state()).pending,null);
 await page.evaluate(()=>journal.dispose());assert.equal((await state()).retired,true);
 assert.deepEqual(browser.errors,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){evidence.fail(error);}
finally{await evidence.close(browser,'browser close');await evidence.close(server,'server close');evidence.finish();writeFileSync(resolve(out,'summary.txt'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
