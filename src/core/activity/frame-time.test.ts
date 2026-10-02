import test from 'node:test';
import assert from 'node:assert/strict';
import {frameNow,withFrameTime} from './frame-time';
import {FrameLoop} from './loop';

test('nested frame scopes restore their parent, including thrown callbacks',()=>{
 const before=frameNow();
 withFrameTime(100,()=>{
  assert.equal(frameNow(),100);
  withFrameTime(200,()=>assert.equal(frameNow(),200));assert.equal(frameNow(),100);
  assert.throws(()=>withFrameTime(300,()=>{throw Error('render');}));assert.equal(frameNow(),100);
 });
 assert.ok(frameNow()>=before);
});
test('actual loop update and render share its scheduler time, including reentrant loop dispatch',()=>{
 const make=()=>new FrameLoop({layers:{coverage:()=> 'top',onChange:()=>()=>{}},calm:()=>false,scheduler:{request:()=>1,cancel(){}},now:()=>9999});
 const outer=make(),inner=make();outer.holdFrames(true);inner.holdFrames(true);
 const reads:number[]=[];
 inner.add({owner:'inner',render:f=>{assert.equal(frameNow(),f.t*1000);reads.push(frameNow());}});
 outer.add({owner:'outer',update:f=>{reads.push(frameNow());assert.equal(frameNow(),f.t*1000);inner.stepFrame(.02);reads.push(frameNow());},render:()=>reads.push(frameNow())});
 outer.stepFrame(.01);assert.deepEqual(reads,[10009,10019,10009,10009],'held frames continue from now()');outer.dispose();inner.dispose();
});
