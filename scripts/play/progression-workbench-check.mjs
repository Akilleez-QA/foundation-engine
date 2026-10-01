#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out=resolve(process.argv[2]??'playtest/progression-workbench');mkdirSync(out,{recursive:true});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],screenshots:[],limitations:['Desktop 1440x960 keyboard/pointer only; no physical phone/tablet or assistive-technology certification.','Optional authored four-choice example; no prescribed classes, progression curve or multiplayer authority.','Single local writer and one physical save envelope; accepted memory is distinct from durable storage.']};
const evidence=diagnosticReport(report,resolve(out,'report.json')),server=await createServer({root:ROOT,logLevel:'error',server:{host:'127.0.0.1',port:0}});let browser;
const key='progression-workbench|device|workbench.session';
try{
 await server.listen();browser=await launch({width:1440,height:960,strictClose:true});report.browser=browser.version;
 const page=browser.page;page.on('pageerror',error=>report.errors.push(String(error)));
 const ready=async()=>{try{await page.waitForFunction(()=>window.workbench?.read()&&window.engine?.state().scene?.scene==='scene.sample');}catch(error){report.startup=await page.evaluate(()=>({url:location.href,body:document.body.innerText,engine:window.engine?.state(),workbench:window.workbench?.read(),ui:window.workbench?.ui()}));throw error;}};
 const state=()=>page.evaluate(()=>workbench.read()),ui=()=>page.evaluate(()=>workbench.ui()),click=id=>page.locator('#'+id).click();
 // A native reload must finish navigation before ready() may inspect the new document.
 const reload=async()=>{await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('reload')]);await ready();};
 const open=async()=>{await click('open');await page.locator('#details').waitFor();await page.waitForFunction(()=>document.querySelector('#choice')===document.activeElement);};
 const select=skill=>page.locator('#choice').selectOption(skill);
 const preview=async(kind,skill)=>{await select(skill);await click(kind);return ui();};
 const learn=async skill=>{await preview('learn',skill);assert.ok((await ui()).preview);await click('commit');assert.ok((await state()).envelope.progression.learned.includes(skill));};
 const sources=s=>s.view.grants.find(g=>g.kind==='certificate'&&g.id==='access')?.sources??[];
 const bytes=()=>page.evaluate(k=>localStorage.getItem(k),key);
 const shot=async name=>{const path=resolve(out,name+'.png');await page.screenshot({path});report.screenshots.push(path);};
 await page.goto(server.resolvedUrls.local[0]+'tools/progression-workbench/index.html?flags=dev.silent');await ready();
 const initial=await state();assert.equal(initial.durable,false);assert.equal(await page.locator('#details').count(),0);
 const canvas=await page.locator('#app canvas').boundingBox();assert.ok(canvas&&canvas.width>=1438&&canvas.height>=958,'world must fill viewport');
 assert.equal(await page.evaluate(()=>document.elementFromPoint(innerWidth/2,innerHeight/2)?.tagName),'CANVAS');await shot('world-closed');
 await page.locator('#open').focus();await page.keyboard.press('Enter');await page.locator('#details').waitFor();assert.equal(await page.locator('#details').getAttribute('aria-modal'),'true');
 await page.keyboard.press('Escape');await page.locator('#details').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.activeElement?.id),'open');await open();
 const blockedBefore=(await state()).envelope;await preview('learn','alpha');assert.equal((await ui()).preview,null);assert.deepEqual((await state()).envelope,blockedBefore);assert.match(await page.locator('#message').textContent(),/capacity/i);await shot('capacity-refused');
 await click('free');await preview('learn','alpha');assert.equal((await ui()).preview.request.payload.skill,'alpha');await select('beta');assert.equal((await ui()).preview,null);assert.equal(await page.locator('#commit').isDisabled(),true);assert.deepEqual((await state()).envelope.progression.learned,[]);await learn('alpha');await learn('beta');const overlapping=await state();assert.equal(sources(overlapping).length,3);assert.equal(overlapping.view.capacity,15);
 await preview('surrender','alpha');assert.equal((await ui()).preview,null);assert.match(await page.locator('#message').textContent(),/voucher|insufficient/i);
 await click('voucher');await preview('surrender','alpha');assert.ok((await ui()).preview);await click('earn');assert.match(await page.locator('#preview').textContent(),/Stale preview/);await click('commit');assert.match((await ui()).lastResult.status,/stale/);assert.ok((await state()).envelope.progression.learned.includes('alpha'));await shot('stale-preview');
 await preview('surrender','alpha');assert.ok((await ui()).preview);await click('cancel');assert.ok((await state()).envelope.progression.learned.includes('alpha'));
 const durableBefore=await bytes();await page.locator('#fail-storage').check();await preview('surrender','alpha');await click('commit');const unsaved=await state();assert.equal(unsaved.durable,false);assert.equal(sources(unsaved).length,2);assert.equal(unsaved.view.capacity,13);assert.equal(await bytes(),durableBefore);await shot('accepted-unsaved');
 // Injection persists through teardown/reload, including SaveStore automatic retry.
 await reload();await open();assert.equal(sources(await state()).length,3);await page.locator('#fail-storage').uncheck();
 await preview('surrender','alpha');await click('commit');await click('save');const saved=await state();assert.equal(saved.durable,true);assert.equal(sources(saved).length,2);
 await reload();await open();assert.deepEqual((await state()).envelope,saved.envelope);
 await click('voucher');await preview('surrender','beta');await click('commit');assert.equal(sources(await state()).length,1);assert.equal((await state()).view.capacity,10);
 await click('use');await click('fraction');const resources=await state();assert.equal(resources.envelope.resources.capacity.current,7);assert.equal(resources.envelope.resources.continuous.current,.625);
 await learn('alpha');await learn('advanced');const dependentBefore=(await state()).envelope;await preview('surrender','alpha');assert.equal((await ui()).preview,null);assert.deepEqual((await state()).envelope,dependentBefore);assert.match(await page.locator('#message').textContent(),/dependent/);await shot('dependent-refused');
 await click('save');await reload();await open();await shot('restored');
 // A controller's authentic candidate cannot commit after its visit owner retires.
 await preview('learn','beta');assert.ok((await ui()).preview);const retired=await page.evaluate(()=>workbench.retirePreview());assert.equal(retired.reason,'retired');
 await page.reload();await ready();await open();const acceptedBeforeCorrupt=await bytes();assert.ok(acceptedBeforeCorrupt);
 await page.evaluate(k=>{const value=JSON.parse(localStorage.getItem(k));value.data.revision+=1;localStorage.setItem(k,JSON.stringify(value));},key);
 await page.reload();await ready();await open();assert.ok((await state()).blocked);assert.equal(await page.locator('#learn').isDisabled(),true);assert.match(await page.locator('#persistence').textContent(),/refused/i);await shot('corrupt-refused');
 assert.deepEqual(report.errors,[]);assert.deepEqual(browser.errors,[]);report.passed=true;
}catch(error){evidence.fail(error);}finally{report.browserErrors=[...(browser?.errors??[])];await evidence.close(browser,'browser close');await evidence.close(server,'server close');evidence.finish();writeFileSync(resolve(out,'summary.txt'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
