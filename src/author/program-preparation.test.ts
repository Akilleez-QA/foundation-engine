import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ProgramLinkError} from '../platform/render/program-validation';
// Execute the actual runtime preparation/restore blocks with a controllable pool,
// without creating a GPU context or reimplementing their lifetime logic.
const source=readFileSync(new URL('./runtime.ts',import.meta.url),'utf8');
const prepare=source.slice(source.indexOf('      let programsPrepared=false,'),source.indexOf('      return {\n        ready,'));
const restore=source.slice(source.indexOf('        contextRestored() {'),source.indexOf('\n      };\n    },',source.indexOf('        contextRestored() {')));
const draw=source.slice(source.indexOf('        render() {'),source.indexOf('        activate() {'));
function fixture(){
 const cards:any[]=[],layers:any[]=[];let compileError:Error|undefined,renderError:Error|undefined;
 const doc={createElement:()=>({children:[] as any[],setAttribute(){},addEventListener(){},append(...nodes:any[]){this.children.push(...nodes);},remove(){}})};
 const pending:{resolve:(result:string)=>void;reject:(error:Error)=>void}[]=[],owner=new AbortController(),view={dataset:{} as Record<string,string>,append:(node:unknown)=>cards.push(node)},log:unknown[]=[];let compiled=0,invalidated=0,lost=false;
 const run=ts.transpile(`let dirty=true;const three={},camera={},visit={current:()=>true};${prepare}\nreturn {ready,state:()=>programsPrepared,${draw}${restore}};`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
 const api=new Function('actx','view','renderer','surface','sync','s','scene','ProgramLinkError','doc','failureText',run)({signal:owner.signal,leaving:()=>owner.signal.aborted,invalidate:()=>invalidated++,own:()=>{},layer:(l:unknown)=>layers.push(l),runId:'run-test'},view,{compile:()=>{compiled++;if(compileError)throw compileError;},render:()=>{if(renderError)throw renderError;},getContext:()=>({isContextLost:()=>lost})},{programsReady:()=>new Promise<string>((resolve,reject)=>pending.push({resolve,reject}))},()=>{}, {log:{error:(...args:unknown[])=>log.push(args)}},{id:'test'},ProgramLinkError,doc,(key:string)=>key);
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
 assert.equal(restored.api.state(),false);assert.equal(restored.view.dataset.programReadiness,'failed');assert.equal(restored.cards.length,1);assert.equal(restored.layers[0].modal,'scope');
 restored.api.contextRestored();await turn();assert.equal(restored.cards.length,1,'one owned recovery surface');
});

test('later generated shader failure stops rendering and surfaces one owned recovery card',async()=>{
 const f=fixture();f.pending[0]!.resolve('ready');await f.api.ready;f.renderThrows(new ProgramLinkError('late variant',[]));
 assert.equal(f.api.render(),false);assert.equal(f.api.state(),false);assert.equal(f.view.dataset.programReadiness,'failed');assert.equal(f.cards.length,1);
 assert.equal(f.api.render(),false);assert.equal(f.cards.length,1);
 const ordinary=fixture();ordinary.pending[0]!.resolve('ready');await ordinary.api.ready;ordinary.renderThrows(Error('unrelated'));assert.throws(()=>ordinary.api.render(),/unrelated/);assert.equal(ordinary.cards.length,0);
});
