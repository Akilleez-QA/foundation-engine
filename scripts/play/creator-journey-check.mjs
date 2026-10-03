#!/usr/bin/env node
// One stock explorer journey. Uses real keyboard/UI, existing dev probes and bounded clock steps.
// Failure paths: an emulated storage refusal with the store's own retry, interrupted scene changes (a superseding
// goto and window blur mid-transition) and application disposal through the dev/test-only engine.dispose().
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {serve, open, ROOT} from './lib.mjs';
import {gameDirLabel} from '../lib/game-dir.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? 'playtest/creator-journey');
mkdirSync(out, {recursive:true});
const git = args => execFileSync('git', args, {cwd:ROOT, encoding:'utf8'}).trim();
const report = {
  revision:git(['rev-parse','HEAD']), dirtyWorktree:!!git(['status','--porcelain']),
  game:gameDirLabel(), seed:1, steps:[], screenshots:[],
  limitations:[
    'Desktop headless Chromium, software GL and emulated window blur; not physical-device or OS suspension acceptance.',
    'Teleport positions interaction fixtures; real keyboard activates movement, interactions and settings.',
    'Storage refusal is emulated by a test-owned Storage.prototype.setItem switch (labelled), not real quota exhaustion. The stock explorer shows no save-failure message: the player-visible state is the retained HUD progress; refusal is read from durable bytes and the save probe.',
    'Interrupted transitions: one superseding engine.goto and one emulated window blur while a door transition is pending. Not OS suspension, tab discard or a network-delayed chunk.',
    'Disposal uses the dev/test-only engine.dispose(), which calls the kernel App.dispose(); production builds have no test API and no page-level disposal trigger. The page renderer pool outlives the app. No full heap/listener leak certification.',
    'Exploration discoveries persist. Lamp visual state and player position are not promised save state.',
  ],
};
const evidence = diagnosticReport(report, resolve(out,'report.json'));
let server, browser;
try {
  assert.equal(gameDirLabel(),'templates/explorer/game','run with GAME_DIR=templates/explorer/game');
  server = await serve(); browser = await launch({width:1280,height:800,strictClose:true});
  const page = browser.page;
  // Labelled emulation: a test-owned switch refuses localStorage writes (as a full or blocked store throws).
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    const control = window.__journeyStorage = {refuse:false, refused:0};
    Storage.prototype.setItem = function(key, value) {
      if (control.refuse && this === window.localStorage) { control.refused++; throw new DOMException('journey: refused write (emulated)','QuotaExceededError'); }
      return write.call(this, key, value);
    };
  });
  report.browser = browser.browser.version();
  await open(browser,server.url,'garden',{seed:1});
  const stepClock = ms => page.evaluate(ms => window.engine.clock.step(ms),ms);
  const state = () => page.evaluate(() => window.engine.state());
  const sample = async label => {
    const value = await page.evaluate(() => ({state:window.engine.state(),pool:window.engine.probe('render.pool'),settings:window.engine.probe('settings')}));
    report.steps.push({label,...value}); return value;
  };
  const progressRaw = () => page.evaluate(() => { const key=Object.keys(localStorage).find(k=>k.endsWith('|explore.progress')); return key ? localStorage.getItem(key) : null; });
  const hudText = () => page.locator('.scene-overlay').innerText();
  const shot = async label => { const name=`${label}.png`; await page.screenshot({path:resolve(out,name)}); report.screenshots.push(name); };
  const scene = async id => {
    // Loading/presentation readiness owns real frames across an asynchronous route change.
    await page.evaluate(() => window.engine.clock.resume());
    await page.waitForFunction(id => document.querySelector('#app')?.dataset.scene === `scene.${id}` && document.querySelector('#app')?.dataset.sceneState === 'active',id);
    await page.evaluate(() => window.engine.clock.hold());
    await stepClock(100);
  };
  await page.evaluate(() => window.engine.clock.hold());
  await stepClock(100);
  assert.equal((await state()).world.state.near,null);
  assert.match(await page.locator('.scene-overlay').innerText(),/Found 0 of 3/);
  const initial = await sample('start'); await shot('start');
  assert.equal(initial.pool.contexts,1,'one live context at startup');
  assert.equal(initial.pool.overflows,0,'no overflow at startup');

  // A held physical key must not survive the lifecycle interruption.
  await page.locator('.scene-view').focus();
  const before = (await state()).world.named.player;
  await page.keyboard.down('ArrowRight'); await stepClock(200);
  const moving = (await state()).world.named.player;
  assert.ok(Math.hypot(moving.x-before.x,moving.z-before.z)>.1,'real keyboard moves player');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await stepClock(200);
  const stopped = (await state()).world.named.player;
  // The stock character intentionally decelerates after input clears (STOP_TIME=0.1s).
  assert.ok(Math.hypot(stopped.x-moving.x,stopped.z-moving.z)<3.5*.1,'only bounded authored coast after blur');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await stepClock(200);
  assert.deepEqual((await state()).world.named.player,stopped,'returning focus does not re-arm held input');
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowLeft'); await stepClock(200); await page.keyboard.up('ArrowLeft');
  const resumed = (await state()).world.named.player;
  assert.ok(Math.hypot(resumed.x-stopped.x,resumed.z-stopped.z)>.1,'fresh press moves again');
  await sample('focus recovery');

  // The actual stock menu controls the real settings owner, without audible output.
  await page.locator('details.shell-menu > summary').click();
  await page.locator('#shell-sound').focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#shell-sound').textContent(),'Sound: off');
  assert.equal(await page.locator('details.shell-menu').getAttribute('open'),null);
  assert.equal((await sample('settings')).settings.stored['sound.muted'],true);

  const reach = async (x,z,id) => {
    assert.equal(await page.evaluate(([x,z])=>window.engine.teleport(x,z),[x,z]),true);
    await stepClock(100);
    assert.equal((await state()).world.state.near,id);
    await page.locator('.scene-view').focus();
  };
  const use = async (x,z,id) => { await reach(x,z,id); await page.keyboard.press('e'); await stepClock(100); };

  // A refused save: the discovery stays in play, the durable bytes stay exactly as they were, and the store's own
  // retry writes it once storage accepts writes again. Nothing here reloads before the retry.
  // Baseline: the garden visit is durably recorded and nothing is pending, so the refused bytes are a real envelope.
  await page.waitForFunction(() => {
    const key=Object.keys(localStorage).find(k=>k.endsWith('|explore.progress'));
    return !!key && JSON.parse(localStorage.getItem(key)).data.visited.includes('garden') && window.engine.probe('save').pending.dirty===0;
  }, null, {timeout:15000});
  const durableBefore = await progressRaw();
  assert.ok(!JSON.parse(durableBefore).data.used.includes('garden/bench'));
  await page.evaluate(() => { window.__journeyStorage.refuse = true; });
  await use(-3,-1,'bench');
  assert.match(await hudText(),/Found 1 of 3/,'the player still sees the discovery while saving is refused');
  await page.waitForFunction(() => window.__journeyStorage.refused >= 2, null, {timeout:15000}); // first write and one retry
  assert.equal(await progressRaw(),durableBefore,'a refused write leaves the durable bytes byte-identical');
  await sample('save refused');
  const refusedSave = await page.evaluate(() => window.engine.probe('save'));
  assert.ok(refusedSave.pending.dirty>0,'a refused write does not count as saved');
  assert.equal(refusedSave.pending.scheduled,true,'the store keeps a retry scheduled');
  assert.match(await hudText(),/Found 1 of 3/);
  await shot('save-refused');
  report.refusal = {durableBefore, refused:await page.evaluate(() => window.__journeyStorage.refused), pending:refusedSave.pending};
  await page.evaluate(() => { window.__journeyStorage.refuse = false; });
  await page.waitForFunction(() => {
    const key=Object.keys(localStorage).find(k=>k.endsWith('|explore.progress'));
    return !!key && JSON.parse(localStorage.getItem(key)).data.used.includes('garden/bench') && window.engine.probe('save').pending.dirty===0;
  }, null, {timeout:15000});
  report.refusal.retried = await progressRaw();
  await sample('save retried');

  // A scene change superseded mid-transition: the shed visit has begun (entering, frames held so it cannot present),
  // then a newer goto returns to the garden. The stale request never becomes active.
  const interrupted = await page.evaluate(async () => {
    const e=window.engine, events=[];
    const off=e.events((k,p)=>{ if(k==='scene.entering'||k==='scene.entered') events.push({k,scene:p.id??p.to}); });
    e.clock.hold();
    const stale = e.goto('shed',undefined,3000).then(r=>({arrived:r}),error=>({refused:String(error.message??error)}));
    let during;
    for(const t0=performance.now(); ; await new Promise(r=>setTimeout(r,10))) {
      during=e.probe('scene');
      if(during.scene==='scene.shed'&&during.state==='entering')break;
      if(performance.now()-t0>5000)throw Error(`shed transition never began: ${JSON.stringify(during)}`);
    }
    const next=e.goto('garden'); e.clock.resume();
    const final=await next, first=await stale; off();
    return {during, final, first, events, after:e.probe('scene')};
  });
  await page.evaluate(() => window.engine.clock.hold()); await stepClock(100);
  report.interruptedGoto = interrupted;
  assert.deepEqual([interrupted.during.scene,interrupted.during.state],['scene.shed','entering'],'interrupted mid-transition');
  assert.ok(interrupted.events.some(e=>e.k==='scene.entering'&&e.scene==='scene.shed'),'the shed visit had begun');
  assert.equal(interrupted.first.arrived,undefined,'the superseded goto never arrives');
  assert.ok(interrupted.after.epoch>interrupted.during.epoch);
  assert.ok(!interrupted.events.some(e=>e.k==='scene.entered'&&e.scene==='scene.shed'),'the stale shed visit is never entered');
  assert.equal(interrupted.after.scene,'scene.garden');
  assert.equal(interrupted.after.state,'active');
  const afterInterrupt = await sample('interrupted goto');
  assert.equal(afterInterrupt.state.world.scene,'garden');
  assert.deepEqual(afterInterrupt.state.world.named.player,{x:0,y:afterInterrupt.state.world.named.player.y,z:2},'a fresh garden visit, no stale arrival position');
  assert.equal(afterInterrupt.pool.contexts,1,'one live context after the interrupted change');
  assert.equal(afterInterrupt.pool.overflows,0,'no overflow after the interrupted change');
  assert.match(await hudText(),/Found 1 of 3/);
  assert.deepEqual(browser.errors,[]);

  await use(-4,2,'lamp');
  // Focus loss while the door's transition is pending: the held key is released and does not survive arrival.
  await reach(4,-2.6,'to-shed');
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.press('e'); await stepClock(100);
  const blurredAt = await page.evaluate(() => { window.dispatchEvent(new Event('blur')); return window.engine.probe('scene'); });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await scene('shed');
  report.interruptedByBlur = {blurredAt};
  assert.ok(!(blurredAt.scene==='scene.shed'&&blurredAt.state==='active'),'blur arrived while the change was still pending');
  const arrived = (await state()).world.named.player;
  assert.equal(arrived.x,0); assert.equal(arrived.z,2.2);
  await stepClock(300);
  assert.deepEqual((await state()).world.named.player,arrived,'a key held across the interrupted change does not move the player');
  await page.keyboard.up('ArrowLeft');
  await sample('blur during transition');
  await use(-2.2,-.9,'crate');
  assert.match(await page.locator('.scene-overlay').innerText(),/Found 3 of 3/);
  await use(0,2.4,'to-garden'); await scene('garden');
  assert.equal((await state()).world.named.player.x,4);
  const returned = await sample('discovered and returned'); await shot('discovered');
  assert.equal(returned.pool.contexts,1,'one live context after first round trip');
  assert.equal(returned.pool.overflows,0,'no overflow after first round trip');
  assert.ok(returned.pool.leases>initial.pool.leases);
  assert.ok(returned.pool.lastRelease,'scene replacement records a renderer release');

  // Repeat both existing routes; assert bounded live contexts after every settled return.
  for(let i=0;i<3;i++) {
    await use(4,-2.6,'to-shed'); await scene('shed');
    await use(0,2.4,'to-garden'); await scene('garden');
    const visit=await sample(`repeat ${i+1}`);
    assert.equal(visit.pool.contexts,returned.pool.contexts);
    assert.equal(visit.pool.overflows,returned.pool.overflows);
    assert.ok(visit.pool.lastRelease);
  }
  await page.waitForFunction(() => {
    const entries=Object.entries(localStorage);
    const progress=entries.find(([key])=>key.endsWith('|explore.progress'));
    const settings=entries.find(([key])=>key.endsWith('|device|settings.values'));
    if(!progress || !settings)return false;
    const used=JSON.parse(progress[1]).data.used;
    return ['garden/bench','garden/lamp','shed/crate'].every(key=>used.includes(key)) && JSON.parse(settings[1]).data['sound.muted']===true;
  });
  await sample('durable before reload');
  await page.reload(); await scene('garden');
  await page.evaluate(() => window.engine.clock.hold()); await stepClock(100);
  assert.match(await page.locator('.scene-overlay').innerText(),/Found 3 of 3/);
  assert.equal(await page.locator('#shell-sound').textContent(),'Sound: off');
  await sample('reloaded'); await shot('reloaded');
  assert.deepEqual(browser.errors,[]);

  // Application disposal through the kernel's own App.dispose (dev/test-only hook).
  const live = await sample('before disposal');
  assert.ok(live.state.world.entities>0);
  const disposal = await page.evaluate(() => window.engine.dispose());
  report.disposal = disposal;
  assert.equal(disposal.disposed,true);
  assert.equal(disposal.running,false,'no scene handle survives disposal');
  assert.deepEqual(disposal.probes,[],'every module-owned probe getter is released');
  assert.equal(disposal.poolReleased,true,'the running scene returned its renderer lease');
  assert.equal(disposal.pool.overflows,0);
  assert.ok(disposal.pool.contexts<=1,'at most the parked page context remains');
  const after = await page.evaluate(() => ({state:window.engine.state(), views:document.querySelectorAll('.scene-view').length, sound:document.querySelectorAll('#shell-sound').length}));
  report.disposal.after = after;
  assert.equal(after.state.world,undefined,'no world is readable after disposal');
  assert.equal(after.views,0,'the scene view left the page');
  assert.equal(after.sound,0,'the shell menu row left the page');
  // A retired app schedules no frames and ignores input without errors; stepping it is refused; disposal is idempotent.
  const loopBefore = await page.evaluate(() => window.engine.loop());
  await page.evaluate(() => window.engine.clock.resume());
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('e'); await page.waitForTimeout(300);
  const loopAfter = await page.evaluate(() => window.engine.loop());
  report.disposal.loop = {before:loopBefore, after:loopAfter};
  assert.deepEqual(loopAfter,loopBefore,'no frame runs after disposal');
  await assert.rejects(stepClock(50),/disposed/,'the test clock refuses to step a retired app');
  assert.equal((await page.evaluate(() => window.engine.dispose())).disposed,false);
  assert.match(await progressRaw(),/garden\/bench/,'durable progress survives disposal');
  await shot('disposed');
  assert.deepEqual(browser.errors,[]);
  report.passed=true;
} catch(error) { evidence.fail(error); }
finally {
  await evidence.close(browser,'browser cleanup'); await evidence.close(server,'server cleanup'); evidence.finish();
}
console.log(`Creator journey: PASS; ${out}`);
