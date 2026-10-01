import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lazyModule,activityLoading,startLoading,endLoading,recoverableImport,failedChunkUrl,isChunkFailure,type ChunkRetry} from './lazy-activity';

// The scene rules (load once, supersession, retry, preload) moved to core/router/handover.test.ts with.

test('startLoading/endLoading count nested loads',()=>{
 startLoading('a');startLoading('b');assert.equal(activityLoading(),true);
 endLoading();assert.equal(activityLoading(),true);endLoading();assert.equal(activityLoading(),false);
});

test('lazyModule loads once, counts as loading while it waits, and retries after a failure',async()=>{
 let attempts=0;
 const lazy=lazyModule(async()=>{if(++attempts===1)throw Error('offline');return 'game';});
 await assert.rejects(lazy.load());assert.equal(activityLoading(),false);
 const pending=lazy.load();assert.equal(activityLoading(),true);
 assert.equal(await pending,'game');assert.equal(activityLoading(),false);
 lazy.preload();assert.equal(await lazy.load(),'game');assert.equal(attempts,2);
});

test('a load emits loading.started with its card delay, and each settle emits loading.settled with what remains',async()=>{
 const {appEvents}=await import('../../core/app-events');
 const heard:unknown[]=[];const offs=[appEvents.on('loading.started',p=>heard.push(['started',p])),appEvents.on('loading.settled',p=>heard.push(['settled',p]))];
 startLoading('the home scene');startLoading('a desk',600);endLoading();endLoading();for(const off of offs)off();
 assert.deepEqual(heard,[['started',{label:'the home scene',cardAfterMs:150}],['started',{label:'a desk',cardAfterMs:600}],['settled',{pending:1}],['settled',{pending:0}]]);
});

// (STD-PRI-11, ADR 0045): Chromium keeps a failed import() failed until the page reloads.
const chunk='http://127.0.0.1:4388/assets/tool-panel-Ab12Cd34.js';
const chromium=(url=chunk)=>new TypeError('Failed to fetch dynamically imported module: '+url);
function fakeRetry({reachable=true,fail=0}:{reachable?:boolean;fail?:number}={}){
 const log:string[]=[];let failures=fail;
 const retry:ChunkRetry={
  importUrl:async url=>{log.push('import '+url);if(failures-->0)throw chromium(url);return {from:url};},
  reachable:async url=>{log.push('reachable '+url);return reachable;},
  reload:url=>{log.push('reload '+url);},
 };
 return {retry,log};
}

test('the failed file is read from Chromium\'s and Firefox\'s messages; Safari names none',()=>{
 assert.equal(failedChunkUrl(chromium()),chunk);
 assert.equal(failedChunkUrl(new TypeError('error loading dynamically imported module: '+chunk+'?v=2')),chunk);
 assert.equal(failedChunkUrl(new TypeError('Importing a module script failed.')),null);
 assert.equal(isChunkFailure(new TypeError('Importing a module script failed.')),true);
 assert.equal(isChunkFailure(new TypeError('x is not a function')),false);
});

test('Try again re-requests the failed file with a cache-busting URL and keeps what arrives',async()=>{
 const {retry,log}=fakeRetry();let loads=0;
 const load=recoverableImport(async()=>{loads++;throw chromium();},retry);
 await assert.rejects(load(),/dynamically imported module/);
 assert.deepEqual(await load(),{from:chunk+'?retry=1'});
 assert.deepEqual(await load(),{from:chunk+'?retry=1'},'later requests reuse the recovered module');
 assert.equal(loads,1,'the original import is not asked again (the browser would fail it)');
 assert.deepEqual(log,['import '+chunk+'?retry=1','import '+chunk+'?retry=1']);
});

test('still offline: Try again fails again without reloading; back online it recovers on the next Try again',async()=>{
 const offline=fakeRetry({reachable:false,fail:1});
 const load=recoverableImport(async()=>{throw chromium();},offline.retry);
 await assert.rejects(load());await assert.rejects(load());
 assert.deepEqual(offline.log,['import '+chunk+'?retry=1','reachable '+chunk]);
 assert.deepEqual(await load(),{from:chunk+'?retry=2'});
});

test('the file answers but the import still fails (a remembered dependency): reload on the same place',async()=>{
 const {retry,log}=fakeRetry({reachable:true,fail:1});
 const load=recoverableImport(async()=>{throw chromium();},retry);
 await assert.rejects(load());await assert.rejects(load());
 assert.deepEqual(log,['import '+chunk+'?retry=1','reachable '+chunk,'reload '+chunk]);
});

test('an unnamed failure (Safari) reloads on Try again; other errors are not retried by URL',async()=>{
 const {retry,log}=fakeRetry();
 const safari=recoverableImport(async()=>{throw new TypeError('Importing a module script failed.');},retry);
 await assert.rejects(safari());await assert.rejects(safari(),/reloads/);assert.deepEqual(log,['reload null']);
 let calls=0;const broken=recoverableImport(async()=>{calls++;throw new Error('boom');},retry);
 await assert.rejects(broken(),/boom/);await assert.rejects(broken(),/boom/);assert.equal(calls,2);
 const fine=recoverableImport(async()=>({ok:true}),retry);assert.deepEqual(await fine(),{ok:true});
});

test('a module inside a shared chunk is found by its one namespace; several namespaces reload instead',async()=>{
 const ns=(o:object)=>Object.freeze(Object.defineProperty({__proto__:null,...o},Symbol.toStringTag,{value:'Module'}));
 const hall=ns({installHall:()=>'hall'}),log:string[]=[];
 const shared=(exports:object):ChunkRetry=>({importUrl:async u=>{log.push('import '+u);return ns(exports);},reachable:async()=>true,reload:u=>{log.push('reload '+u);}});
 const one=recoverableImport(async()=>{throw chromium();},shared({a:1,f:hall,g:()=>0}));
 await assert.rejects(one());assert.equal(await one(),hall);
 const two=recoverableImport(async()=>{throw chromium();},shared({f:hall,h:ns({other:1})}));
 await assert.rejects(two());await assert.rejects(two(),/reloads/);assert.equal(log.at(-1),'reload '+chunk);
});
