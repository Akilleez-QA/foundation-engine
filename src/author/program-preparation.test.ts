import test from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {FrameReadinessError} from '../platform/render/frame-readiness';
import {ProgramLinkError} from '../platform/render/program-validation';
// Execute the actual runtime preparation/restore blocks with a controllable pool,
// without creating a GPU context or reimplementing their lifetime logic.
const source=readFileSync(new URL('./runtime.ts',import.meta.url),'utf8');
const prepare=source.slice(source.indexOf('      let programsPrepared=false,'),source.indexOf('      return {\n        ready,'));
const restore=source.slice(source.indexOf('        contextRestored() {'),source.indexOf('\n      };\n    },',source.indexOf('        contextRestored() {')));
const draw=source.slice(source.indexOf('        render() {'),source.indexOf('        activate() {'));
const step=source.slice(source.indexOf('        update(f: FrameInfo) {'),source.indexOf('        render() {'));
// The runtime's own arrival callback (it runs the scene's enter()), cut from the enterActivity call.
const arriveAt=source.indexOf('    arrive: () =>'),arrival=source.slice(arriveAt,source.indexOf('\n',arriveAt)).replace(/,$/,'');
function fixture(frameReady?:()=>Promise<string>,tap:{running():boolean}|null=null,arrive=true){
 const cards:unknown[]=[],layers:{modal?:string}[]=[];let compileError:Error|undefined,renderError:Error|undefined;
 const doc={createElement:()=>({children:[] as unknown[],setAttribute(){},addEventListener(){},append(...nodes:unknown[]){this.children.push(...nodes);},remove(){}})};
 const pending:{resolve:(result:string)=>void;reject:(error:Error)=>void}[]=[],owner=new AbortController(),view={dataset:{} as Record<string,string>,append:(node:unknown)=>cards.push(node)},log:unknown[]=[];let compiled=0,invalidated=0,lost=false;
 const run=ts.transpile(`let dirty=true,frame=0,t=0,calm=false,frameMs=0,steps=0;const pressed={clear(){},endFrame(){}},gestures={sync(){},pointer:{pressed:false}},runner={frame(){steps++;},alpha:0},ctx={},particles={interpolate:()=>false};const three={},camera={},visit={current:()=>true};let arrived=false,activityStart,tapArrive,ctxRef=ctx,enteredAt=-1;scene.enter=()=>{enteredAt=steps;};${prepare}\nreturn {ready,state:()=>programsPrepared,steps:()=>steps,enteredAt:()=>enteredAt,${arrival},${step}${draw}${restore}};`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
 const api=new Function('actx','view','renderer','surface','sync','s','scene','ProgramLinkError','doc','failureText','FrameReadinessError','tap',run)({signal:owner.signal,leaving:()=>owner.signal.aborted,invalidate:()=>invalidated++,own:()=>{},layer:(l:{modal?:string})=>layers.push(l),runId:'run-test'},view,{compile:()=>{compiled++;if(compileError)throw compileError;},render:()=>{if(renderError)throw renderError;},getContext:()=>({isContextLost:()=>lost})},{frameReady,programsReady:()=>new Promise<string>((resolve,reject)=>pending.push({resolve,reject}))},()=>{}, {log:{error:(...args:unknown[])=>log.push(args)}},{id:'test'},ProgramLinkError,doc,(key:string)=>key,FrameReadinessError,tap);
 if(arrive)api.arrive();
 return {api,pending,owner,view,log,cards,layers,compileThrows:(e:Error)=>{compileError=e;},renderThrows:(e:Error)=>{renderError=e;},lose:()=>{lost=true;},get compiled(){return compiled;},get invalidated(){return invalidated;}};
}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('actual author runtime remains unprepared until pool readiness and rejects retired initial readiness',async()=>{
 const f=fixture();assert.equal(f.compiled,1);assert.equal(f.api.state(),false);f.pending[0]!.resolve('ready');await f.api.ready;assert.equal(f.api.state(),true);assert.equal(f.view.dataset.programReadiness,'ready');
 const retired=fixture();retired.owner.abort();retired.pending[0]!.resolve('ready');await assert.rejects(retired.api.ready,/retired/);assert.equal(retired.api.state(),false);
});
test('actual restore fences stale outcomes and marks current failure as degraded without indefinite blank',async()=>{
 const f=fixture();f.pending[0]!.resolve('ready');await f.api.ready;
 f.api.contextRestored();f.api.contextRestored();f.pending[1]!.reject(Error('old'));await turn();assert.equal(f.api.state(),false);assert.equal(f.log.length,0);
 f.pending[2]!.reject(Error('driver'));await turn();assert.equal(f.api.state(),true);assert.equal(f.view.dataset.programReadiness,'degraded');assert.equal(f.log.length,1);
 f.api.contextRestored();f.lose();f.pending[3]!.reject(Error('lost'));await turn();assert.equal(f.api.state(),false,'lost context never takes fallback');assert.equal(f.log.length,1);
});

test('initial first draw failures reject ready, and synchronous restore link failures show owned recovery',async()=>{
 const first=fixture();first.renderThrows(new ProgramLinkError('bad draw',[]));first.pending[0]!.resolve('ready');await assert.rejects(first.api.ready,ProgramLinkError);assert.equal(first.api.state(),false);
 const restored=fixture();restored.pending[0]!.resolve('ready');await restored.api.ready;
 restored.compileThrows(new ProgramLinkError('bad restore',[]));assert.doesNotThrow(()=>restored.api.contextRestored());await turn();
 assert.equal(restored.api.state(),false);assert.equal(restored.view.dataset.programReadiness,'failed');assert.equal(restored.cards.length,1);assert.equal(must(restored.layers[0],'layer').modal,'scope');
 restored.api.contextRestored();await turn();assert.equal(restored.cards.length,1,'one owned recovery surface');
});

test('later generated shader failure stops rendering and surfaces one owned recovery card',async()=>{
 const f=fixture();f.pending[0]!.resolve('ready');await f.api.ready;f.renderThrows(new ProgramLinkError('late variant',[]));
 assert.equal(f.api.render(),false);assert.equal(f.api.state(),false);assert.equal(f.view.dataset.programReadiness,'failed');assert.equal(f.cards.length,1);
 assert.equal(f.api.render(),false);assert.equal(f.cards.length,1);
 const ordinary=fixture();ordinary.pending[0]!.resolve('ready');await ordinary.api.ready;ordinary.renderThrows(Error('unrelated'));assert.throws(()=>ordinary.api.render(),/unrelated/);assert.equal(ordinary.cards.length,0);
});

test('actual author admission waits for initial GPU completion and refuses a retired frame',async()=>{
 let resolve!:(value:string)=>void;const f=fixture(()=>new Promise<string>(r=>{resolve=r;}));f.pending[0]!.resolve('ready');await turn();assert.equal(f.api.state(),false);resolve('ready');await f.api.ready;assert.equal(f.api.state(),true);
 const retired=fixture(()=>Promise.resolve('retired'));retired.pending[0]!.resolve('ready');await assert.rejects(retired.api.ready,/frame preparation retired/);assert.equal(retired.api.state(),false);
 const failed=fixture(()=>Promise.reject(new FrameReadinessError('fence failed')));failed.pending[0]!.resolve('ready');await assert.rejects(failed.api.ready,FrameReadinessError);
});

test('bounded initial preparation failure degrades to first-draw compilation instead of refusing the scene',async()=>{
 const f=fixture();f.pending[0]!.reject(Error('Program readiness capacity exceeded'));await f.api.ready;
 assert.equal(f.api.state(),true);assert.equal(f.view.dataset.programReadiness,'degraded');assert.equal(f.log.length,1);assert.equal(f.cards.length,0);
 const link=fixture();link.pending[0]!.reject(new ProgramLinkError('bad link',[]));await assert.rejects(link.api.ready,ProgramLinkError);assert.equal(link.api.state(),false);assert.equal(link.log.length,0);
 const retired=fixture();retired.owner.abort();retired.pending[0]!.reject(Error('timed out'));await assert.rejects(retired.api.ready,/timed out/);assert.equal(retired.api.state(),false);assert.equal(retired.log.length,0);
});

test('systems do not step before initial preparation settles, so they cannot run long before scene arrival',async()=>{
 const f=fixture();for(let i=0;i<5;i++)f.api.update({dt:.016,calm:false});assert.equal(f.api.steps(),0);
 f.pending[0]!.resolve('ready');await f.api.ready;f.api.update({dt:.016,calm:false});assert.equal(f.api.steps(),1);
 const degraded=fixture();degraded.pending[0]!.reject(Error('Program readiness timed out'));await degraded.api.ready;degraded.api.update({dt:.016,calm:false});assert.equal(degraded.api.steps(),1);
 const restored=fixture();restored.pending[0]!.resolve('ready');await restored.api.ready;restored.api.contextRestored();restored.api.update({dt:.016,calm:false});assert.equal(restored.api.steps(),1,'restore preparation does not pause started systems');
});

test('a dev/test tick tap holds the fixed lane until it reports running (SIM-01)',async()=>{
 let running=false;const f=fixture(undefined,{running:()=>running});f.pending[0]!.resolve('ready');await f.api.ready;
 f.api.update({dt:.016,calm:false});assert.equal(f.api.steps(),0,'held before arrival');
 running=true;f.api.update({dt:.016,calm:false});assert.equal(f.api.steps(),1);
 running=false;f.api.update({dt:.016,calm:false});assert.equal(f.api.steps(),1,'held again after a replay ends');
});

test('no system steps before arrival runs enter(), on a first entry or a re-entry, even once preparation settled',async()=>{
 // Re-entering a scene (goto to itself, restart, the next level) is a fresh visit with fresh state, like a first entry:
 // the router's first-render frames run update() between preparation and arrival, and must not step systems there.
 const f=fixture(undefined,null,false);f.pending[0]!.resolve('ready');await f.api.ready;
 for(let i=0;i<3;i++)f.api.update({dt:.016,calm:false});
 assert.equal(f.api.steps(),0,'first-render frames before arrival step no system');
 f.api.arrive();assert.equal(f.api.enteredAt(),0,'enter() ran before any step');
 f.api.update({dt:.016,calm:false});assert.equal(f.api.steps(),1,'systems step once arrived');
});
