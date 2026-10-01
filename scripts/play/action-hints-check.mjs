#!/usr/bin/env node
// Real composition fixture, not shipped application/device acceptance.
// node -r ./scripts/silent-browser.cjs scripts/play/action-hints-check.mjs [output-directory]
import assert from 'node:assert/strict';
import {diagnosticReport} from './diagnostic-report.mjs';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out=resolve(process.argv[2]??'playtest/action-hints');mkdirSync(out,{recursive:true});
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Action hints diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/action-hints-entry.mjs"></script></body></html>';
const server=await createServer({root:ROOT,logLevel:'error',plugins:[{name:'action-hints-diagnostic',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.startsWith('/__action-hints-check.html')){res.setHeader('Content-Type','text/html');res.end(html);}else next();});}}],server:{host:'127.0.0.1',port:0}});

const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),dirtyWorktree:execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim().length>0,passed:false,profiles:[],limitations:['Chromium emulation only','Controller edges injected through real dispatcher','Saved-control scenario opts into player-scoped module; fixture uses service commands rather than a finished Controls UI','Browser-context isolation is not cross-device or account synchronization evidence','Fixture assumes a keyboard layout with I and U on KeyI and KeyU physical codes','Fixture labels use standard controller positions, not hardware-family glyphs']};
const evidence=diagnosticReport(report,resolve(out,'report.json'));
try {
 await server.listen();const url=server.resolvedUrls.local[0];
 for(const [name,view]of Object.entries({phone:{width:390,height:844,mobile:true},tablet:{width:820,height:1180,mobile:true},desktop:{width:1280,height:800}})){
  const b=await launch({...view,strictClose:true}),p=b.page;
  try{
   await p.goto(`${url}__action-hints-check.html?flags=dev.silent&quality=reference#scene/sample`);
   await p.waitForFunction(()=>window.hintCheck&&window.hudCheck.state().world?.state.frames>2);
   const initial=await p.evaluate(()=>window.hintCheck.describe());
   assert.deepEqual(initial.keys,['code:KeyI']);assert.deepEqual(initial.pad,['y']);assert.equal(initial.inContext,true);
   assert.equal(await p.evaluate(()=>window.hintCheck.unknown()),null);assert.equal(await p.evaluate(()=>window.hintCheck.axis()),null);
   await p.evaluate(()=>window.hintCheck.remap());const remapped=await p.evaluate(()=>window.hintCheck.describe());
   assert.deepEqual(remapped.keys,['code:KeyU']);assert.deepEqual(remapped.pad,['x']);
   assert.match(await p.locator('.action-hint-diagnostic').innerText(),/U.*West face button/);
   await p.screenshot({path:resolve(out,`${name}-remapped.png`)});
   await p.locator('.scene-view').focus();await p.keyboard.press('i');await p.waitForTimeout(80);
   assert.equal(await p.locator('.hud-details-sheet').count(),0,'old key no longer activates action');
   await p.keyboard.press('u');await p.locator('.hud-details-sheet').waitFor();
   assert.equal((await p.evaluate(()=>window.hintCheck.describe())).inContext,false);
   await p.keyboard.press('Escape');await p.locator('.hud-details-sheet').waitFor({state:'detached'});
   assert.equal((await p.evaluate(()=>window.hintCheck.describe())).inContext,true);
   await p.locator('.scene-view').focus();
   await p.evaluate(()=>{window.hudCheck.pad('y',true);window.hudCheck.pad('y',false);});await p.waitForTimeout(80);
   assert.equal(await p.locator('.hud-details-sheet').count(),0,'old pad binding no longer activates action');
   await p.evaluate(()=>{window.hudCheck.pad('x',true);window.hudCheck.pad('x',false);});await p.locator('.hud-details-sheet').waitFor();
   await p.locator('.hud-details-close').click();await p.locator('.hud-details-sheet').waitFor({state:'detached'});
   await p.evaluate(()=>window.hintCheck.reset());assert.deepEqual((await p.evaluate(()=>window.hintCheck.describe())).keys,['code:KeyI']);
   assert.deepEqual(b.errors,[]);report.profiles.push({name,view,initial,remapped,errors:b.errors});
  }finally{await evidence.close(b,`${name} browser cleanup`);}
 }
 // Optional saved-controls composition uses the normal browser SaveStore, with no seeded storage or forced flush.
 const savedBrowser = await launch({width:1280,height:800,strictClose:true});
 const savedPage = savedBrowser.page;
 const savedUrl = `${url}__action-hints-check.html?flags=dev.silent&quality=reference&savedControls=player#scene/sample`;
 const ready = page => page.waitForFunction(() => window.hintCheck && window.hudCheck.state().world?.state.frames > 2);
 const saved = page => page.waitForFunction(() => window.hintCheck.savedStatus() === 'saved', {}, {timeout:10000});
 const describe = page => page.evaluate(() => window.hintCheck.describe());
 try {
  await savedPage.goto(savedUrl);
  await ready(savedPage);
  const initial = await describe(savedPage);
  const originalPlayer = await savedPage.evaluate(() => window.hintCheck.player());
  assert.deepEqual(initial.keys, ['code:KeyI']);
  await savedPage.evaluate(() => window.hintCheck.remap());
  await saved(savedPage);
  await savedPage.reload();
  await ready(savedPage);
  const reloaded = await describe(savedPage);
  assert.deepEqual(reloaded.keys, ['code:KeyU']);
  assert.deepEqual(reloaded.pad, ['x']);
  assert.match(await savedPage.locator('.action-hint-diagnostic').innerText(), /U.*West face button/);
  await savedPage.locator('.scene-view').focus();
  await savedPage.keyboard.press('i');
  await savedPage.waitForTimeout(80);
  assert.equal(await savedPage.locator('.hud-details-sheet').count(), 0);
  await savedPage.keyboard.press('u');
  await savedPage.locator('.hud-details-sheet').waitFor();
  await savedPage.keyboard.press('Escape');
  await savedPage.locator('.hud-details-sheet').waitFor({state:'detached'});
  await savedPage.screenshot({path:resolve(out,'saved-controls-reloaded.png')});

  const isolated = await savedBrowser.browser.newContext({viewport:{width:1280,height:800}});
  const isolatedPage = await isolated.newPage();
  const isolatedErrors = [];
  isolatedPage.on('pageerror', error => isolatedErrors.push(String(error)));
  isolatedPage.on('console', message => {if(message.type()==='error')isolatedErrors.push(message.text());});
  let fresh;
  try {
   await isolatedPage.goto(savedUrl);
   await ready(isolatedPage);
   fresh = await describe(isolatedPage);
   assert.deepEqual(fresh.keys, ['code:KeyI']);
   assert.deepEqual(fresh.pad, ['y']);
   assert.deepEqual(isolatedErrors, []);
  } finally {await evidence.close(isolated,'isolated context cleanup');}

  const other = await savedPage.evaluate(() => window.hintCheck.addPlayer());
  await savedPage.evaluate(id => window.hintCheck.usePlayer(id), other);
  await savedPage.waitForFunction(() => window.hintCheck.describe()?.keys[0] === 'code:KeyI');
  await savedPage.evaluate(id => window.hintCheck.usePlayer(id), originalPlayer);
  await savedPage.waitForFunction(() => window.hintCheck.describe()?.keys[0] === 'code:KeyU');
  await savedPage.evaluate(() => window.hintCheck.reset());
  await saved(savedPage);
  await savedPage.reload();
  await ready(savedPage);
  const reset = await describe(savedPage);
  assert.deepEqual(reset.keys, ['code:KeyI']);
  assert.deepEqual(reset.pad, ['y']);
  await savedPage.locator('.scene-view').focus();
  await savedPage.keyboard.press('u');
  await savedPage.waitForTimeout(80);
  assert.equal(await savedPage.locator('.hud-details-sheet').count(), 0);
  await savedPage.keyboard.press('i');
  await savedPage.locator('.hud-details-sheet').waitFor();
  await savedPage.keyboard.press('Escape');
  await savedPage.locator('.hud-details-sheet').waitFor({state:'detached'});
  assert.deepEqual(savedBrowser.errors, []);
  report.savedControls = {scope:'player',initial,reloaded,fresh,reset,originalPlayer,other,errors:savedBrowser.errors,
   evidence:'Natural SaveStore completion, real reload, isolated context, player switch, reset then reload; no storage seeding'};
 } finally {await evidence.close(savedBrowser,'saved browser cleanup');}
 report.passed=true;
}catch(error){evidence.fail(error);}finally{await evidence.close(server,'server cleanup');evidence.finish();}
console.log(`Action hints: ${report.profiles.length} profiles passed; evidence ${out}`);
