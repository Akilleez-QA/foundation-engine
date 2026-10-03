#!/usr/bin/env node
// One stock explorer journey. Uses real keyboard/UI, existing dev probes and bounded clock steps.
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
    'Save success and reload only. Refused writes/retry remain separately covered by src/author/save-handle.test.ts, not browser recovery UI.',
    'Scene renderer release and bounded pooled contexts are checked; no full heap/listener leak or application disposal certification.',
    'Exploration discoveries persist. Lamp visual state and player position are not promised save state.',
  ],
};
const evidence = diagnosticReport(report, resolve(out,'report.json'));
let server, browser;
try {
  assert.equal(gameDirLabel(),'templates/explorer/game','run with GAME_DIR=templates/explorer/game');
  server = await serve(); browser = await launch({width:1280,height:800,strictClose:true});
  const page = browser.page;
  report.browser = browser.browser.version();
  await open(browser,server.url,'garden',{seed:1});
  const stepClock = ms => page.evaluate(ms => window.engine.clock.step(ms),ms);
  const state = () => page.evaluate(() => window.engine.state());
  const sample = async label => {
    const value = await page.evaluate(() => ({state:window.engine.state(),pool:window.engine.probe('render.pool'),settings:window.engine.probe('settings')}));
    report.steps.push({label,...value}); return value;
  };
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

  const use = async (x,z,id) => {
    assert.equal(await page.evaluate(([x,z])=>window.engine.teleport(x,z),[x,z]),true);
    await stepClock(100);
    assert.equal((await state()).world.state.near,id);
    await page.locator('.scene-view').focus(); await page.keyboard.press('e'); await stepClock(100);
  };
  await use(-3,-1,'bench'); await use(-4,2,'lamp');
  await use(4,-2.6,'to-shed'); await scene('shed');
  assert.equal((await state()).world.named.player.z,2.2);
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
  report.passed=true;
} catch(error) { evidence.fail(error); }
finally {
  await evidence.close(browser,'browser cleanup'); await evidence.close(server,'server cleanup'); evidence.finish();
}
console.log(`Creator journey: PASS; ${out}`);
