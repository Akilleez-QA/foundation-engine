import test from 'node:test';
import assert from 'node:assert/strict';
import {PINCH_NOTCHES_PER_EFOLD} from './frame-actions';
import {attachPointer} from './pointer';
import {env,ev,ptr,recordingSink} from '../../testing/input-fakes';

const setup=(options={})=>{
 const sink=recordingSink(),e=env(),abort=new AbortController(),captured:number[]=[];
 const surface=Object.assign(new EventTarget(),{setPointerCapture:(id:number)=>{captured.push(id);}});
 const g=attachPointer(surface,sink,{...e,signal:abort.signal,now:()=>0,...options});
 const fire=(type:string,id:number,x:number,y:number,extra={})=>{const p=ptr(type,id,x,y,extra);surface.dispatchEvent(p);return p;};
 return {sink,surface,g,fire,captured,...e,abort};
};
const touch={pointerType:'touch'};

test('a tap is ≤ 12 px for a mouse and ≤ 16 px for touch, and a 1.2 s slow poke still counts',()=>{
 const s=setup();s.fire('pointerdown',1,100,100);s.fire('pointermove',1,108,105);s.fire('pointerup',1,108,105,{timeStamp:100});
 assert.equal(s.sink.latch.drain().taps.length,1);assert.deepEqual(s.captured,[1]);
 s.fire('pointerdown',2,100,100);s.fire('pointermove',2,113,100);s.fire('pointerup',2,113,100);assert.equal(s.sink.latch.drain().taps.length,0,'13 px on a mouse is a drag');
 s.fire('pointerdown',3,100,100,{...touch,timeStamp:1});s.fire('pointermove',3,114,100,touch);s.fire('pointerup',3,114,100,{...touch,timeStamp:1201});
 const [tap]=s.sink.latch.drain().taps;assert.equal(tap.pointerType,'touch');assert.equal(tap.duration,1200);
 s.fire('pointerdown',4,0,0,{...touch,timeStamp:1});s.fire('pointerup',4,0,0,{...touch,timeStamp:1600});assert.equal(s.sink.latch.drain().taps.length,0,'a 1.6 s press is a hold, not a world tap');
});
test('a drag never becomes a tap, even when it returns to its start',()=>{
 const s=setup();s.fire('pointerdown',1,100,100);s.fire('pointermove',1,140,100);s.fire('pointermove',1,100,100);s.fire('pointerup',1,100,100);
 assert.equal(s.sink.latch.drain().taps.length,0);
});
test('look drag uses clientX/Y differences after the slop, at the configured radians per px',()=>{
 const s=setup({lookPerPx:{x:.01,y:.005}});s.fire('pointerdown',1,0,0);s.fire('pointermove',1,20,0,{movementX:999});
 assert.ok(s.g.dragging);assert.deepEqual(s.sink.latch.drain().look,{x:0,y:0},'crossing the slop does not jump');
 s.fire('pointermove',1,50,10,{movementX:999});const look=s.sink.latch.drain().look;assert.ok(Math.abs(look.x-.3)<1e-12);assert.ok(Math.abs(look.y-.05)<1e-12);
});
test('only the primary mouse button moves or looks; other buttons are ignored and side buttons cannot navigate',()=>{
 const s=setup();for(const button of [1,2,3,4]){const down=s.fire('pointerdown',1,0,0,{button});s.fire('pointermove',1,50,0);s.fire('pointerup',1,50,0,{button});assert.equal(down.defaultPrevented,button!==2);}
 const out=s.sink.latch.drain();assert.equal(out.taps.length,0);assert.deepEqual(out.look,{x:0,y:0});
 const menu=ev('contextmenu');s.surface.dispatchEvent(menu);assert.ok(menu.defaultPrevented);
});
test('two fingers pinch as log-ratio zoom notches after a 20 px latch; spreading zooms in',()=>{
 const s=setup();s.fire('pointerdown',1,100,100,touch);s.fire('pointerdown',2,200,100,touch);
 s.fire('pointermove',2,210,100,touch);assert.equal(s.sink.latch.drain().zoom.length,0,'10 px is below the latch');
 s.fire('pointermove',2,300,100,touch);const [step]=s.sink.latch.drain().zoom;assert.equal(step.source,'pinch');
 assert.ok(Math.abs(step.notches-Math.max(-1.5,-PINCH_NOTCHES_PER_EFOLD*Math.log(2)))<1e-9);
 s.fire('pointermove',2,290,100,touch);const [inward]=s.sink.latch.drain().zoom;assert.ok(inward.notches>0,'pinching in zooms out');
 assert.ok(Math.abs(inward.notches-(-PINCH_NOTCHES_PER_EFOLD*Math.log(190/200)))<1e-9);
 assert.ok(s.g.pinching);assert.deepEqual(s.sink.latch.drain().look,{x:0,y:0});
});
test('lifting one pinch finger hands over to a one-finger drag with no jump and no tap',()=>{
 const s=setup();s.fire('pointerdown',1,100,100,touch);s.fire('pointerdown',2,200,100,touch);s.fire('pointermove',2,260,100,touch);
 s.fire('pointerup',1,100,100,touch);s.sink.latch.drain();assert.equal(s.g.pinching,false);assert.ok(s.g.dragging);
 s.fire('pointermove',2,270,100,touch);assert.ok(Math.abs(s.sink.latch.drain().look.x-10*.006)<1e-12,'the remaining finger drags from where it is');
 s.fire('pointerup',2,270,100,touch);assert.equal(s.sink.latch.drain().taps.length,0);
});
test('a third finger never breaks the first two',()=>{
 const s=setup();s.fire('pointerdown',1,0,0,touch);s.fire('pointerdown',2,100,0,touch);s.fire('pointerdown',3,50,50,touch);s.fire('pointermove',3,500,500,touch);s.fire('pointerup',3,500,500,touch);
 assert.ok(s.g.pinching);s.fire('pointermove',2,200,0,touch);assert.equal(s.sink.latch.drain().zoom.length,1);
});
test('every drag ends on cancel, lost capture, a buttonless move, blur, pagehide and hidden',()=>{
 const ends:[string,(s:ReturnType<typeof setup>)=>void][]=[
  ['pointercancel',s=>s.fire('pointercancel',1,0,0)],['lostpointercapture',s=>s.fire('lostpointercapture',1,0,0)],['buttons 0',s=>s.fire('pointermove',1,60,0,{buttons:0})],
  ['blur',s=>s.win.dispatchEvent(ev('blur'))],['pagehide',s=>s.win.dispatchEvent(ev('pagehide'))],['hidden',s=>{s.doc.hidden=true;s.doc.dispatchEvent(ev('visibilitychange'));}]];
 for(const [name,end] of ends){
  const s=setup();s.fire('pointerdown',1,0,0);s.fire('pointermove',1,40,0);assert.ok(s.g.dragging,name);end(s);assert.equal(s.g.dragging,false,name);
  s.sink.latch.drain();s.fire('pointermove',1,90,0);s.fire('pointerup',1,90,0);const out=s.sink.latch.drain();assert.deepEqual(out.look,{x:0,y:0},name);assert.equal(out.taps.length,0,name);
 }
 const s=setup();s.fire('pointerdown',1,0,0);s.fire('pointercancel',1,0,0);s.fire('pointerup',1,0,0);assert.equal(s.sink.latch.drain().taps.length,0,'a cancelled press is not a tap');
});
test('outside gameplay the surface takes no gestures, and fingers down across a context change stay ignored',()=>{
 const s=setup();s.sink.setKind('modal');s.fire('pointerdown',1,0,0);s.fire('pointerup',1,0,0);assert.equal(s.sink.latch.drain().taps.length,0);assert.deepEqual(s.captured,[]);
 s.sink.setKind('gameplay');s.fire('pointerdown',2,0,0);s.g.ignoreActive();s.fire('pointermove',2,80,0);s.fire('pointerup',2,80,0);const out=s.sink.latch.drain();assert.deepEqual(out.look,{x:0,y:0});assert.equal(out.taps.length,0);
 s.fire('pointerdown',3,0,0);s.fire('pointerup',3,0,0);assert.equal(s.sink.latch.drain().taps.length,1,'the next fresh press works');
});
test('device notes: touch on a finger, keyboard-mouse on a click, and hover moves reported for the dwell tracker',()=>{
 const s=setup();s.fire('pointerdown',1,0,0,touch);s.fire('pointerup',1,0,0,touch);s.fire('pointerdown',2,0,0);s.fire('pointerup',2,0,0);
 assert.deepEqual(s.sink.devices,['touch','keyboard-mouse']);s.fire('pointermove',9,0,0,{buttons:0});s.fire('pointermove',9,5,0,{buttons:0});assert.equal(s.sink.moves,1);
});
test('pinch is symmetric: spreading then translating both fingers returns to the start zoom',()=>{
 const s=setup();s.fire('pointerdown',1,100,100,touch);s.fire('pointerdown',2,200,100,touch);s.fire('pointermove',2,250,100,touch);s.fire('pointermove',1,150,100,touch);
 const steps=s.sink.latch.drain().zoom;assert.ok(Math.abs(steps.reduce((n,z)=>n+z.notches,0))<1e-12);assert.equal(s.sink.latch.drain().look.x,0);
});
test('coincident pinch contacts never produce a non-finite zoom',()=>{
 const s=setup();s.fire('pointerdown',1,100,100,touch);s.fire('pointerdown',2,100,100,touch);s.fire('pointermove',2,101,100,touch);s.fire('pointermove',2,130,100,touch);s.fire('pointermove',2,160,100,touch);
 const steps=s.sink.latch.drain().zoom;assert.ok(steps.length>0&&steps.every(z=>Number.isFinite(z.notches)));
});
test('losing one pinch finger to lost capture, blur or a hidden page leaves no phantom pinch',()=>{
 for(const end of ['lost','blur','hidden']){
  const s=setup();s.fire('pointerdown',1,100,100,touch);s.fire('pointerdown',2,200,100,touch);
  if(end==='lost')s.fire('lostpointercapture',2,200,100,touch);else if(end==='blur'){s.win.dispatchEvent(ev('blur'));s.fire('pointerdown',1,100,100,touch);s.fire('pointermove',1,120,100,touch);}else{s.doc.hidden=true;s.doc.dispatchEvent(ev('visibilitychange'));s.fire('pointerdown',1,100,100,touch);s.fire('pointermove',1,120,100,touch);}
  assert.equal(s.g.pinching,false,end);s.sink.latch.drain();s.fire('pointermove',1,130,100,touch);const out=s.sink.latch.drain();assert.equal(out.zoom.length,0,end);assert.ok(out.look.x>0,end);
 }
});
test('capture is released when a missed mouse release ends the drag',()=>{
 const released:number[]=[];const s=setup();Object.assign(s.surface,{hasPointerCapture:()=>true,releasePointerCapture:(id:number)=>released.push(id)});
 s.fire('pointerdown',5,0,0);s.fire('pointermove',5,40,0);s.fire('pointermove',5,60,0,{buttons:0});assert.deepEqual(released,[5]);
 s.fire('pointerdown',6,0,0);s.win.dispatchEvent(ev('blur'));assert.deepEqual(released,[5,6]);
});

test('resize retires every captured pinch contact; stale events cannot resume and a fresh tap works',()=>{
 const s=setup(),held=new Set<number>();
 Object.assign(s.surface,{setPointerCapture:(id:number)=>held.add(id),hasPointerCapture:(id:number)=>held.has(id),releasePointerCapture:(id:number)=>held.delete(id)});
 s.fire('pointerdown',1,100,100,touch);s.fire('pointerdown',2,200,100,touch);
 s.fire('pointermove',2,240,100,touch);s.sink.latch.drain();
 assert.equal(s.g.pinching,true);assert.equal(held.size,2);
 s.win.dispatchEvent(ev('resize'));
 assert.equal(s.g.pinching,false);assert.equal(s.g.dragging,false);assert.equal(held.size,0);
 s.fire('pointermove',1,140,100,touch);s.fire('pointermove',2,300,100,touch);
 s.fire('pointerup',1,140,100,touch);s.fire('pointerup',2,300,100,touch);
 const stale=s.sink.latch.drain();assert.equal(stale.taps.length,0);assert.equal(stale.zoom.length,0);assert.deepEqual(stale.look,{x:0,y:0});
 s.fire('pointerdown',3,100,100,touch);s.fire('pointerup',3,100,100,touch);
 assert.equal(s.sink.latch.drain().taps.length,1);s.abort.abort();
 s.fire('pointerdown',4,100,100,touch);assert.equal(s.g.pinching,false);
});
