import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createSystemRunner} from '../core/ecs/systems';
import {actionOf} from './ids';
import {sceneInput} from './scene-input';
import * as latch from './press-latch';
// STD-SIM-12: presses survive zero-step frames. Execute the actual runtime input wiring, runner construction and
// frame update from runtime.ts with a deterministic fake clock, without a GPU, DOM or frame loop.
const source=readFileSync(new URL('./runtime.ts',import.meta.url),'utf8');
const slice=(from:string,to:string)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,`runtime.ts slice ${from.trim()}`);return source.slice(a,b);};
const wiring=slice('      const pressed = ','      input.onCancel(');
const runnerLine=slice('      const runner = createSystemRunner(','\n');
const inputLine=slice('        input: sceneInput(','\n');
const update=slice('        update(f: FrameInfo) {','        render() {');
const STEP=1/60;
type Seen={tick:number;frame:number;lane:'fixed'|'frame';jump:boolean;tap:boolean};
function fixture(){
 const handlers=new Map<string,(e:{phase:string})=>boolean>(),seen:Seen[]=[];let gestureOptions:any,tick=0,frameNo=0;
 const rawPointer={x:0,y:0,down:false,pressed:false};
 const bindScenePointer=(_canvas:unknown,options:any)=>{gestureOptions=options;return {pointer:rawPointer,sync(){},cancel(){options.canceled();},dispose(){}};};
 const read=(lane:'fixed'|'frame')=>(ctx:any)=>{const jump=ctx.input.pressed('jump'),tap=ctx.input.pointer.pressed;if(jump||tap)seen.push({tick,frame:frameNo,lane,jump,tap});};
 const systems=[{id:'fixed-reader',run:(ctx:any)=>{tick++;read('fixed')(ctx);}},{id:'frame-reader',phase:'frame' as const,run:read('frame')}];
 const run=ts.transpile(`let programFailed=false,simulating=true,frame=0,t=0,calm=false;const timing=undefined,body={systems},world={clearEvents(){}},scene={id:'test'};
${wiring}
${runnerLine}
const ctx={
${inputLine}
};
return {setSimulating:v=>{simulating=v;},${update}};`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
 const actx={invalidate(){},runId:'run-test',signal:new AbortController().signal,own(){},coverage:()=>'top',leaving:()=>false};
 const sceneActionHints=()=>()=>null;
 const api=new Function('s','o','actx','surface','view','bindScenePointer','actionOf','viewOwnsInput','createSystemRunner','sceneInput','createPressLatch','sceneActionHints','systems','sync','failPrograms','ProgramLinkError','FrameReadinessError',run)(
  {input:{onAction:(action:string,fn:any)=>{handlers.set(action,fn);},cancel(){},held:()=>false,describeAction:()=>null},log:{error(){}}},{inputs:[{id:'jump'},{id:'tap',tap:true}]},actx,{canvas:{}},{closest:()=>null},
  bindScenePointer,actionOf,()=>true,createSystemRunner,sceneInput,(latch as any).createPressLatch,sceneActionHints,systems,()=>{},()=>{},class extends Error{},class extends Error{});
 return {
  seen,
  press:()=>handlers.get(actionOf('jump'))!({phase:'press'}),
  tap:()=>{rawPointer.pressed=true;gestureOptions.press();},
  cancel:()=>gestureOptions.canceled(),
  frame:(dt:number)=>{frameNo++;api.update({dt,calm:false});},
  setSimulating:api.setSimulating as (v:boolean)=>void,
  get ticks(){return tick;},
 };
}

test('STD-SIM-12: a press during a zero-step frame reaches the next fixed tick exactly once', () => {
 const f=fixture();
 f.press();f.tap();
 f.frame(STEP/2);
 assert.equal(f.ticks,0,'a 120 Hz frame shorter than the fixed step runs no fixed tick');
 f.frame(STEP/2);
 assert.equal(f.ticks,1);
 for(let i=0;i<6;i++)f.frame(STEP/2);
 assert.deepEqual(f.seen.filter(s=>s.lane==='fixed'),[{tick:1,frame:2,lane:'fixed',jump:true,tap:true}],'the first fixed tick after the press sees it, once');
 assert.deepEqual(f.seen.filter(s=>s.lane==='frame'),[{tick:0,frame:1,lane:'frame',jump:true,tap:true}],'frame systems keep seeing a press only in the frame it arrived');
});

test('a resumed dt = 0 frame (idle, cover, clock.hold) keeps the press for the next tick', () => {
 const f=fixture();
 f.press();f.frame(0);f.frame(0);
 assert.equal(f.ticks,0);
 f.frame(STEP);
 assert.deepEqual(f.seen.filter(s=>s.lane==='fixed').map(s=>s.tick),[1]);
});

test('a frame with several fixed ticks delivers a press to its first tick only', () => {
 const f=fixture();
 f.press();f.frame(STEP*3);
 assert.equal(f.ticks,3);
 assert.deepEqual(f.seen.filter(s=>s.lane==='fixed').map(s=>s.tick),[1],'not duplicated across the frame\'s later ticks');
 assert.equal(f.seen.filter(s=>s.lane==='frame').length,1);
});

test('retention is bounded: cancellation and a non-simulating frame release a pending press', () => {
 const canceled=fixture();
 canceled.press();canceled.tap();canceled.frame(STEP/2);canceled.cancel();canceled.frame(STEP);
 assert.equal(canceled.seen.filter(s=>s.lane==='fixed').length,0,'pointer/overlay/hidden cancellation releases the press');
 const held=fixture();
 held.press();held.frame(STEP/2);held.setSimulating(false);held.frame(STEP);held.setSimulating(true);held.frame(STEP);
 assert.equal(held.seen.filter(s=>s.lane==='fixed').length,0,'a frame that does not simulate releases the press');
});

test('the per-tick latch hooks touch no empty Set (no per-tick allocation when idle)', () => {
 const l=latch.createPressLatch(),proto=Set.prototype as any,calls:string[]=[];
 const saved={clear:proto.clear,values:proto.values,iterator:proto[Symbol.iterator]};
 proto.clear=function(this:Set<unknown>){calls.push('clear');return saved.clear.call(this);};
 proto.values=proto[Symbol.iterator]=function(this:Set<unknown>){calls.push('iterate');return saved.values.call(this);};
 try{for(let i=0;i<3;i++){l.beginStep();l.beginStep();l.beginFrameLane();l.endFrame();}}
 finally{proto.clear=saved.clear;proto.values=saved.values;proto[Symbol.iterator]=saved.iterator;}
 assert.deepEqual(calls,[]);
 l.add('jump');l.beginStep();assert.equal(l.has('jump'),true);l.beginStep();assert.equal(l.has('jump'),false);
});

test('ctx.input.pointer is read-only at compile time, matching the runtime getter view', () => {
 const view=latch.createPressLatch().pointer({x:0,y:0,down:false,pressed:false});
 const state=sceneInput(()=>true,()=>false,new Set(),view);
 // @ts-expect-error A system cannot clear the pointer press; the runtime view has getters only.
 const write=()=>{state.pointer.pressed=false;};
 assert.throws(write,TypeError);
});
