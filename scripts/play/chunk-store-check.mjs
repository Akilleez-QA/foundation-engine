#!/usr/bin/env node
// Browser evidence for GEN-02: the chunk store over real Chromium IndexedDB, with GEN-01 regeneration plus stored edits.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out=resolve(process.argv[2]??'playtest/chunk-store');mkdirSync(out,{recursive:true});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,errors:[],limitations:['Desktop Chromium IndexedDB in a fresh profile only; no quota exhaustion, eviction by the browser, private-mode, multi-process crash or physical-device evidence.']};
const server=await createServer({root:ROOT,logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'chunk-store-diagnostic',configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/__chunk-store.html'))return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Chunk store diagnostic</title><script type="module" src="/scripts/play/fixtures/chunk-store-entry.mjs"></script>');});}}]});
let browser;
try{
 await server.listen();browser=await launch({width:800,height:600,strictClose:true});
 browser.page.on('pageerror',e=>report.errors.push(String(e)));
 await browser.page.goto(`${server.resolvedUrls.local[0]}__chunk-store.html?flags=dev.silent`);
 await browser.page.waitForFunction(()=>!!window.runChunkStoreCheck);
 const r=await browser.page.evaluate(()=>window.runChunkStoreCheck());report.result=r;
 assert.equal(r.durability,'durable');assert.equal(r.write,'saved');
 assert.equal(r.reopened.records,2);assert.ok(r.reopened.bytes>1000);assert.equal(r.roundTrip,true);
 assert.equal(r.tabNewer,'saved');assert.equal(r.tabStale,'stale');
 assert.equal(r.corrupt,'quarantined');assert.equal(r.overwrite,'saved');assert.deepEqual(r.quarantine,['checksum']);
 assert.equal(r.afterVersionChange,'unavailable');assert.equal(r.fallback,'session');
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(`chunk-store: PASS; ${out}`);
