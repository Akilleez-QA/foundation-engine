#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out=resolve(process.argv[2]??'playtest/terrain-worker');mkdirSync(out,{recursive:true});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],limitations:['Chromium module-worker transport and numeric oracle only; no physical-device timing or rendered terrain acceptance.']};
const server=await createServer({root:ROOT,logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'terrain-worker-diagnostic',configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/__terrain-worker.html'))return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Terrain worker diagnostic</title><script type="module" src="/scripts/play/fixtures/terrain-worker-entry.mjs"></script>');});}}]});
let browser;
try{
 await server.listen();browser=await launch({width:800,height:600,strictClose:true});
 browser.page.on('pageerror',e=>report.errors.push(String(e)));
 await browser.page.goto(`${server.resolvedUrls.local[0]}__terrain-worker.html?flags=dev.silent`);
 await browser.page.waitForFunction(()=>!!window.runTerrainWorkerCheck);
 const r=await browser.page.evaluate(()=>window.runTerrainWorkerCheck());report.result=r;
 assert.ok(r.worker.workers>0);assert.equal(r.worker.workersAvailable,true);assert.equal(r.fallback.workers,0);
 assert.deepEqual(r.mesh,r.inline);assert.deepEqual(r.mesh.positions.filter((_,i)=>i%3===1),[39,43,47,33,37,41,27,31,35]);
 assert.ok(Math.abs(r.sample.height-35.6)<1e-10);assert.ok(Math.abs(r.sample.normal.x+4/Math.sqrt(53))<1e-10);assert.ok(Math.abs(r.sample.normal.z-6/Math.sqrt(53))<1e-10);
 assert.deepEqual([r.before,r.prepared,r.declined,r.afterDecline,r.accepted,r.after],[0,0,false,0,true,1]);
 assert.equal(r.cancelled,'cancelled');assert.equal(r.stale,'superseded');assert.equal(r.worker.reservedBytes,0);assert.deepEqual(report.errors,[]);report.passed=true;
}finally{writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(`terrain-worker: PASS; ${out}`);
