#!/usr/bin/env node
// Manual intended-use browser diagnostic. Root/full gate orchestration runs browsers serially.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out=resolve(process.argv[2]??'playtest/terrain-regions');mkdirSync(out,{recursive:true});
const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Independent terrain regions</title><style>body{margin:0;background:#101827;color:#eaf0fa;font:16px system-ui}main{max-width:1000px;margin:auto}h1{font-size:28px;margin:22px 0 8px}p{color:#aebfd4;margin:8px 0}canvas{display:block;width:100%;height:auto}.note{font-size:13px;padding-bottom:18px}</style></head><body><main><h1>One landscape, four independent regions</h1><p id="status"></p><canvas width="1000" height="660"></canvas><p class="note">Shared integer lattice · canonical halo normals · explicit coherent publication. Finite diagnostic; worker and general chunk adapters are separate work.</p></main><script type="module" src="/scripts/play/fixtures/terrain-regions-entry.mjs"></script></body></html>`;
const server=await createServer({root:ROOT,logLevel:'error',plugins:[{name:'terrain-regions-diagnostic',configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/__terrain-regions-check.html'))return next();res.setHeader('Content-Type','text/html');res.end(html);});}}],server:{host:'127.0.0.1',port:0}});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],limitations:['Finite direct Three.js consumer, not a shipped game or supported-device performance gate.','Synchronous region preparation; no general worker adapter, regional Surface facade, chunk LOD adapter or automatic invalidation.','Fixture explicitly rebuilds all four halo dependencies and publishes one complete set; no new framework or scheduler.','Monolith parity includes smooth vertex normals; face-normal ownership at closed shared edges remains explicit ambiguous coverage.']};
let browser;
try {
  await server.listen();browser=await launch({width:1080,height:840});const page=browser.page;
  page.on('pageerror',error=>report.errors.push(String(error)));
  await page.goto(`${server.resolvedUrls.local[0]}__terrain-regions-check.html?flags=dev.silent`);await page.waitForFunction(()=>!!window.terrainRegions);
  const state=()=>page.evaluate(()=>window.terrainRegions.state());
  const assertOracle=s=>{assert.equal(s.oracle.maxPositionError,0);assert.ok(s.oracle.maxNormalError<1e-12);assert.ok(s.oracle.editOracleError<1e-12);assert.ok(s.oracle.sharedVertices>0);};
  const initial=await state();assert.equal(initial.revision,1);assert.equal(initial.acceptedQuery,'covered');assert.equal(initial.unavailable,'unavailable');assert.equal(initial.outside,'outside');assert.equal(initial.seam,'ambiguous');assertOracle(initial);
  await page.screenshot({path:resolve(out,'initial.png')});
  assert.equal(await page.evaluate(()=>window.terrainRegions.begin()),true);
  const pending=await state();assert.equal(pending.desiredQuery,'pending');assert.equal(pending.acceptedQuery,'covered');assert.equal(pending.revision,1);assert.deepEqual(pending.acceptedRevisions,[1,1,1,1]);assert.equal(pending.acceptedHeight,initial.acceptedHeight);assert.equal(pending.builds,4);
  assert.equal(await page.evaluate(()=>window.terrainRegions.publish()),false);
  await page.screenshot({path:resolve(out,'pending.png')});
  assert.equal(await page.evaluate(()=>window.terrainRegions.complete()),true);
  const ready=await state();assert.equal(ready.candidateCount,4);assert.equal(ready.builds,8);assert.deepEqual(ready.acceptedRevisions,[1,1,1,1]);assert.equal(ready.desiredQuery,'pending');
  assert.equal(await page.evaluate(()=>window.terrainRegions.publish()),true);
  const published=await state();assert.equal(published.revision,2);assert.deepEqual(published.acceptedRevisions,[2,2,2,2]);assert.equal(published.desiredQuery,'covered');assert.equal(published.candidateCount,0);assertOracle(published);
  await page.screenshot({path:resolve(out,'published.png')});
  const unchanged=await state();assert.deepEqual(await state(),unchanged,'querying state must not redraw or rebuild');
  await page.evaluate(()=>window.terrainRegions.close());assert.equal((await state()).closed,true);
  assert.deepEqual(report.errors,[]);writeFileSync(resolve(out,'snapshots.json'),JSON.stringify({initial,pending,ready,published},null,2));report.passed=true;console.log(`Terrain region diagnostic passed; evidence ${out}`);
} catch(error){report.errors.push(String(error));throw error;}finally{writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));try{await browser?.close();}finally{await server.close();}}
