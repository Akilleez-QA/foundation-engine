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
const runnerLine=slice('      const fixedSystems = ','\n      const live = ');
const liveInputLine=slice('      const liveInput = sceneInput(','\n');
const inputLine=slice('        input: tap ? tap.input : liveInput,','\n');
const update=slice('        update(f: FrameInfo) {','        render() {');
const STEP=1/60;
type GestureOptions={press():void;canceled():void};
type ReaderContext={input:{pressed(action:string):boolean;pointer:{pressed:boolean}}};
type Seen={tick:number;frame:number;lane:'fixed'|'frame';jump:boolean;tap:boolean};
function fixture(tapRunning?:()=>boolean){
 const handlers=new Map<string,(e:{phase:string})=>boolean>(),seen:Seen[]=[];let gestureOptions:GestureOptions|undefined,tick=0,frameNo=0;
 const rawPointer={x:0,y:0,down:false,pressed:false};
 const bindScenePointer=(_canvas:unknown,options:GestureOptions)=>{gestureOptions=options;return {pointer:rawPointer,sync(){},cancel(){options.canceled();},dispose(){}};};
 const read=(lane:'fixed'|'frame')=>(ctx:ReaderContext)=>{const jump=ctx.input.pressed('jump'),tap=ctx.input.pointer.pressed;if(jump||tap)seen.push({tick,frame:frameNo,lane,jump,tap});};
 const systems=[{id:'fixed-reader',run:(ctx:ReaderContext)=>{tick++;read('fixed')(ctx);}},{id:'frame-reader',phase:'frame' as const,run:read('frame')}];
 const run=ts.transpile(`let programFailed=false,simulating=true,arrived=true,frame=0,t=0,calm=false,frameMs=0;const FIXED_STEP=1/60,tap=tapRunning?{running:tapRunning,beforeTick(){},afterTick(){},get input(){return liveInput;}}:null;const timing=undefined,body={systems},world={clearEvents(){}},scene={id:'test'};
${wiring}
${runnerLine}
${liveInputLine}
const ctx={
${inputLine}
};
return {setSimulating:v=>{simulating=v;},${update}};`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
 const actx={invalidate(){},runId:'run-test',signal:new AbortController().signal,own(){},coverage:()=>'top',leaving:()=>false};
 const sceneActionHints=()=>()=>null;
 const api=new Function('s','o','actx','surface','view','bindScenePointer','actionOf','viewOwnsInput','createSystemRunner','sceneInput','createPressLatch','sceneActionHints','systems','tapRunning','sync','failPrograms','ProgramLinkError','FrameReadinessError','monotonicNow','particles',run)(
  {app:{has:()=>false},input:{onAction:(action:string,fn:(e:{phase:string})=>boolean)=>{handlers.set(action,fn);},cancel(){},held:()=>false,describeAction:()=>null},log:{error(){}}},{inputs:[{id:'jump'},{id:'tap',tap:true}]},actx,{canvas:{}},{closest:()=>null},
  bindScenePointer,actionOf,()=>true,createSystemRunner,sceneInput,latch.createPressLatch,sceneActionHints,systems,tapRunning,()=>{},()=>{},class extends Error{},class extends Error{},()=>1,{step(){},interpolate:()=>false});
 return {
  seen,
  press:()=>handlers.get(actionOf('jump'))!({phase:'press'}),
  tap:()=>{rawPointer.pressed=true;gestureOptions!.press();},
  cancel:()=>gestureOptions!.canceled(),
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

test('the per-tick latch hooks touch no empty Set or Map (no per-tick allocation when idle)', () => {
 // The latch keeps press timestamps in Maps (AU-01); guard both collection types so the check cannot pass vacuously.
 const l=latch.createPressLatch(),calls:string[]=[];
 type Proto={clear:()=>void;values:()=>unknown;entries:()=>unknown;[Symbol.iterator]:()=>unknown};
 const protos:Proto[]=[Set.prototype,Map.prototype];
 const saved=protos.map(proto=>({clear:proto.clear,values:proto.values,entries:proto.entries,iterator:proto[Symbol.iterator]}));
 protos.forEach((proto,i)=>{
  proto.clear=function(this:unknown){calls.push('clear');return saved[i].clear.call(this);};
  proto.values=function(this:unknown){calls.push('iterate');return saved[i].values.call(this);};
  proto.entries=function(this:unknown){calls.push('iterate');return saved[i].entries.call(this);};
  proto[Symbol.iterator]=function(this:unknown){calls.push('iterate');return saved[i].iterator.call(this);};
 });
 try{for(let i=0;i<3;i++){l.beginStep();l.beginStep();l.beginFrameLane();l.endFrame();}}
 finally{protos.forEach((proto,i)=>{proto.clear=saved[i].clear;proto.values=saved[i].values;proto.entries=saved[i].entries;proto[Symbol.iterator]=saved[i].iterator;});}
 assert.deepEqual(calls,[]);
 l.add('jump',5);l.beginStep();assert.equal(l.has('jump'),true);l.beginStep();assert.equal(l.has('jump'),false);
});

test('press timestamps follow the latch lanes: the earliest press per tick or frame, kept across zero-step frames', () => {
 const l=latch.createPressLatch();
 l.add('jump',100);l.add('jump',110);
 l.beginFrameLane();assert.equal(l.get('jump'),100,'the frame lane sees its earliest press');
 l.endFrame();
 l.beginFrameLane();assert.equal(l.get('jump'),undefined,'a later frame does not');l.endFrame();
 l.beginStep();assert.equal(l.get('jump'),100,'a zero-step frame kept the press and its time for the next tick');
 l.beginStep();assert.equal(l.get('jump'),undefined,'later ticks do not see it');
 l.endFrame();l.add('jump',200);l.clear();l.beginStep();assert.equal(l.get('jump'),undefined,'cancellation drops the time with the press');
});

test('ctx.input.pointer is read-only at compile time, matching the runtime getter view', () => {
 const view=latch.createPressLatch().pointer({x:0,y:0,down:false,pressed:false});
 const state=sceneInput(()=>true,()=>false,new Map<string,number>(),view);
 // @ts-expect-error A system cannot clear the pointer press; the runtime view has getters only.
 const write=()=>{state.pointer.pressed=false;};
 assert.throws(write,TypeError);
});

test('a held replay tap releases live presses, so none surfaces at replay tick 0 (SIM-01)', () => {
 let running=false;const f=fixture(()=>running);
 f.press();f.tap();f.frame(STEP);
 assert.equal(f.ticks,0,'the held tap runs no tick');
 running=true;f.frame(STEP);f.frame(STEP);
 assert.equal(f.ticks,2);
 assert.deepEqual(f.seen.filter(s=>s.lane==='fixed'),[]);
});
