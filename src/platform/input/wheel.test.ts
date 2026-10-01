import test from 'node:test';
import assert from 'node:assert/strict';
import {PINCH_NOTCHES_PER_EFOLD,TRACKPAD_GAIN} from './frame-actions';
import {attachWheel,isTrackpadLike,wheelPixels} from './wheel';
import {env,ev,key,recordingSink,wheelEvent} from '../../testing/input-fakes';

const setup=()=>{const sink=recordingSink(),e=env(),abort=new AbortController(),surface=new EventTarget();const w=attachWheel(surface,sink,{...e,signal:abort.signal,now:()=>0});
 const wheel=(deltaY:number,extra={})=>{const x=wheelEvent(deltaY,extra);surface.dispatchEvent(x);return x;};
 const gesture=(type:string,scale:number,timeStamp=1)=>{const g=ev(type,{scale,timeStamp});surface.dispatchEvent(g);return g;};
 return {sink,surface,w,wheel,gesture,...e};};
const near=(a:number,b:number,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} ≉ ${b}`);

test('deltaMode is read first: 3 Firefox lines equal 48 px, a page is 90 % of the viewport',()=>{
 assert.deepEqual(wheelPixels({deltaMode:1,deltaX:0,deltaY:3},1000),{x:0,y:48});assert.deepEqual(wheelPixels({deltaMode:2,deltaX:0,deltaY:1},1000),{x:0,y:900});
 const a=setup();a.wheel(3,{deltaMode:1,timeStamp:10});a.wheel(48,{timeStamp:500});const [line,pixel]=a.sink.latch.drain().zoom;near(line.notches,.48);near(pixel.notches,.48);
});
test('Firefox line-mode trace: five notches down zoom out by five × 0.48 notches, one event each',()=>{
 const s=setup();for(let i=0;i<5;i++)s.wheel(3,{deltaMode:1,timeStamp:100+i*60});
 const steps=s.sink.latch.drain().zoom;assert.equal(steps.length,5);assert.ok(steps.every(z=>z.source==='wheel'&&z.notches>0));near(steps.reduce((n,z)=>n+z.notches,0),2.4);assert.deepEqual(steps.map(z=>z.t),[100,160,220,280,340]);
});
test('every event clamps to ±1.5 notches: free-spin wheels and page mode cannot jump the range',()=>{
 const s=setup();s.wheel(1200,{timeStamp:1});s.wheel(-1,{deltaMode:2,timeStamp:200});const [a,b]=s.sink.latch.drain().zoom;assert.equal(a.notches,1.5);assert.equal(b.notches,-1.5);
});
test('Chrome trackpad pinch (ctrl+wheel, no physical Control) zooms at the pinch gain and prevents page zoom',()=>{
 const s=setup();const trace=[-1.2,-2.5,-3.1,-2.0,-0.8];let t=1000;const events=trace.map(dy=>s.wheel(dy,{ctrlKey:true,timeStamp:t+=16}));
 assert.ok(events.every(e=>e.defaultPrevented));const steps=s.sink.latch.drain().zoom;assert.ok(steps.every(z=>z.source==='pinch'));
 near(steps.reduce((n,z)=>n+z.notches,0),PINCH_NOTCHES_PER_EFOLD*trace.reduce((a,b)=>a+b,0)/100);
});
test('Ctrl+wheel with the physical Control key held is an ordinary wheel; blur and a hidden page forget Control',()=>{
 const s=setup();s.win.dispatchEvent(key('keydown','ControlLeft','Control',{ctrlKey:true}));s.wheel(100,{ctrlKey:true,timeStamp:1});assert.equal(s.sink.latch.drain().zoom[0].source,'wheel');
 s.win.dispatchEvent(ev('blur'));s.wheel(10,{ctrlKey:true,timeStamp:300});assert.equal(s.sink.latch.drain().zoom[0].source,'pinch');
 s.win.dispatchEvent(key('keydown','KeyA','a',{ctrlKey:true}));s.doc.hidden=true;s.doc.dispatchEvent(ev('visibilitychange'));s.wheel(10,{ctrlKey:true,timeStamp:600});assert.equal(s.sink.latch.drain().zoom[0].source,'pinch');
 s.win.dispatchEvent(key('keydown','ControlLeft','Control',{ctrlKey:true}));s.win.dispatchEvent(key('keyup','ControlLeft','Control'));s.wheel(10,{ctrlKey:true,timeStamp:900});assert.equal(s.sink.latch.drain().zoom[0].source,'pinch');
});
test('Mac trackpad momentum trace: continuous small deltas get the trackpad gain and keep the momentum flag',()=>{
 const s=setup();const finger=[1.5,3.25,6.5,9.75,12],tail=[10.5,8,5.5,3.25,1.5,.5];let t=0;
 for(const dy of finger)s.wheel(dy,{timeStamp:t+=12,momentum:false});for(const dy of tail)s.wheel(dy,{timeStamp:t+=16,momentum:true});
 const steps=s.sink.latch.drain().zoom;assert.equal(steps.length,11);assert.ok(steps.slice(1).every(z=>z.source==='trackpad'));
 assert.deepEqual(steps.map(z=>z.momentum),[...finger.map(()=>false),...tail.map(()=>true)]);
 near(steps[4].notches,12/100*TRACKPAD_GAIN);assert.ok(steps.every((z,i)=>i===0||z.t>steps[i-1].t),'timestamps pass through for the rig to segment');
 const plain=setup();plain.wheel(100,{timeStamp:5});assert.equal('momentum' in plain.sink.latch.drain().zoom[0],false,'no flag when the browser has none');
});
test('the trackpad heuristic changes gain only: a notched mouse stays a wheel, a fractional stream is a trackpad',()=>{
 assert.equal(isTrackpadLike({deltaMode:0,deltaX:0,deltaY:100},100,300),false);assert.equal(isTrackpadLike({deltaMode:1,deltaX:0,deltaY:.5},8,5),false);
 assert.equal(isTrackpadLike({deltaMode:0,deltaX:0,deltaY:4.5},4.5,300),true);assert.equal(isTrackpadLike({deltaMode:0,deltaX:1,deltaY:4},4,300),true);assert.equal(isTrackpadLike({deltaMode:0,deltaX:0,deltaY:4},4,8),true);
});
test('horizontal two-finger scroll turns the view instead of zooming',()=>{
 const s=setup();s.wheel(10,{deltaX:100,timeStamp:1});const out=s.sink.latch.drain();near(out.look.x,.5);assert.equal(out.zoom.length,0);
});
test('Safari gesture events zoom by the per-event scale ratio and block page zoom',()=>{
 const s=setup();assert.ok(s.gesture('gesturestart',1).defaultPrevented);for(const scale of [1.05,1.12,1.2])assert.ok(s.gesture('gesturechange',scale,50).defaultPrevented);s.gesture('gestureend',1.2);
 const steps=s.sink.latch.drain().zoom;assert.equal(steps.length,3);near(steps.reduce((n,z)=>n+z.notches,0),-PINCH_NOTCHES_PER_EFOLD*Math.log(1.2));assert.ok(steps.every(z=>z.t===50&&z.source==='pinch'));
 near(steps[1].notches,-PINCH_NOTCHES_PER_EFOLD*Math.log(1.12/1.05));
});
test('a pinch Safari also reports as ctrl+wheel zooms once: the wheel owns it, even one just before gesturestart',()=>{
 const s=setup();s.gesture('gesturestart',1,100);s.wheel(-3,{ctrlKey:true,timeStamp:110});s.gesture('gesturechange',1.2,120);s.gesture('gestureend',1.2,130);
 assert.deepEqual(s.sink.latch.drain().zoom.map(z=>z.t),[110]);
 s.wheel(-3,{ctrlKey:true,timeStamp:1000});s.gesture('gesturestart',1,1100);s.gesture('gesturechange',1.2,1110);assert.equal(s.sink.latch.drain().zoom.length,1,'a ctrl+wheel 100 ms before gesturestart claims it');
 s.gesture('gestureend',1.2,1120);s.gesture('gesturestart',1,2000);s.gesture('gesturechange',1.2,2010);assert.equal(s.sink.latch.drain().zoom.length,1,'250 ms later the gesture zooms again');
});
test('touch pinches leave Safari gesture events to the pointer recogniser',()=>{
 const s=setup();s.surface.dispatchEvent(ev('pointerdown',{pointerType:'touch',pointerId:4}));s.gesture('gesturestart',1);s.gesture('gesturechange',1.5);assert.equal(s.sink.latch.drain().zoom.length,0);
 s.surface.dispatchEvent(ev('lostpointercapture',{pointerId:4}));s.gesture('gesturechange',1.8);assert.equal(s.sink.latch.drain().zoom.length,1);
});
test('aborting removes every listener',()=>{
 const sink=recordingSink(),e=env(),abort=new AbortController(),surface=new EventTarget();const w=attachWheel(surface,sink,{...e,signal:abort.signal});abort.abort();
 const x=wheelEvent(10);surface.dispatchEvent(x);e.win.dispatchEvent(key('keydown','ControlLeft','Control',{ctrlKey:true}));assert.equal(x.defaultPrevented,false);assert.equal(w.controlHeld,false);assert.equal(sink.latch.drain().zoom.length,0);
});
test('outside gameplay the wheel still never scrolls or zooms the page, but emits nothing',()=>{
 const s=setup();s.sink.setKind('ui');assert.ok(s.wheel(100,{timeStamp:1}).defaultPrevented);assert.equal(s.sink.latch.drain().zoom.length,0);
});
