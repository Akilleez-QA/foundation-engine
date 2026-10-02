#!/usr/bin/env node
// Browser evidence for GEN-01: the discovered `job.kits.procgen.cellular` row runs in a real Chromium module worker
// and produces the same grid as the main-thread fallback and a direct drain; cancellation and staleness are named.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out=resolve(process.argv[2]??'playtest/procgen-worker');mkdirSync(out,{recursive:true});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],limitations:['Chromium module-worker transport and determinism only; no physical-device timing or generation-quality acceptance.']};
const server=await createServer({root:ROOT,logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'procgen-worker-diagnostic',configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/__procgen-worker.html'))return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Procgen worker diagnostic</title><script type="module" src="/scripts/play/fixtures/procgen-worker-entry.mjs"></script>');});}}]});
let browser;
try{
 await server.listen();browser=await launch({width:800,height:600,strictClose:true});
 browser.page.on('pageerror',e=>report.errors.push(String(e)));
 await browser.page.goto(`${server.resolvedUrls.local[0]}__procgen-worker.html?flags=dev.silent`);
 await browser.page.waitForFunction(()=>!!window.runProcgenWorkerCheck);
 const r=await browser.page.evaluate(()=>window.runProcgenWorkerCheck());report.result=r;
 assert.ok(r.worker.workers>0);assert.equal(r.worker.workersAvailable,true);assert.equal(r.fallback.workers,0);
 assert.equal(new Set(r.digests).size,1,'worker, fallback and direct drain agree');
 assert.equal(r.cells,48*2*32);assert.ok(r.solid>0&&r.solid<r.cells);
 assert.equal(r.runningAtAbort,1);assert.equal(r.cancelled,'cancelled');assert.equal(r.stale,'superseded');
 assert.equal(r.worker.reservedBytes,0);assert.equal(r.fallback.reservedBytes,0);assert.deepEqual(report.errors,[]);report.passed=true;
}finally{writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(`procgen-worker: PASS; ${out}`);
