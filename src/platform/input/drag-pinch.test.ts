import test from 'node:test';import assert from 'node:assert/strict';import {installDragPinch} from './drag-pinch';
function rig(){const el=new EventTarget(),win=new EventTarget(),doc=Object.assign(new EventTarget(),{hidden:false}),abort=new AbortController(),log={drag:[] as number[][],zoom:[] as number[],alt:2};
 const input=installDragPinch(el,{drag:(dx,dy)=>log.drag.push([dx,dy]),zoom:f=>{log.zoom.push(f);log.alt*=f;}},{signal:abort.signal,window:win,document:doc});
 const fire=(type:string,pointerId:number,clientX:number,extra:object={})=>{const e=Object.assign(new Event(type,{cancelable:true}),{pointerId,clientX,clientY:100,pointerType:'touch',button:0,buttons:1,...extra});el.dispatchEvent(e);return e;};
 return {el,win,doc,abort,log,input,fire};}
test('pinch applies its first delta and a parallel translation restores the altitude',()=>{const {log,fire}=rig();fire('pointerdown',1,100);fire('pointerdown',2,200);fire('pointermove',2,250);assert.equal(log.alt,2*100/150);fire('pointermove',1,150);assert.equal(log.alt,2);assert.equal(log.drag.length,0);});
test('lifting a pinch finger hands the drag to the other finger without a jump',()=>{const {log,fire}=rig();fire('pointerdown',1,100);fire('pointerdown',2,200);fire('pointermove',1,160);fire('pointerup',2,200);fire('pointermove',1,161);assert.deepEqual(log.drag,[[1,0]]);});
test('coincident pinch contacts never create a nonfinite zoom',()=>{const {log,fire}=rig();fire('pointerdown',1,100);fire('pointerdown',2,200);fire('pointermove',2,100);fire('pointermove',2,150);assert.ok(log.zoom.every(Number.isFinite));assert.ok(Number.isFinite(log.alt));});
test('lost capture, blur and a hidden page end contacts so a later drag is not a pinch',()=>{for(const end of ['lost','blur','hidden'] as const){const r=rig();r.fire('pointerdown',1,100);r.fire('pointerdown',2,200);
 if(end==='lost')r.fire('lostpointercapture',2,200);else if(end==='blur'){r.win.dispatchEvent(new Event('blur'));r.fire('pointerdown',1,100);}else{r.doc.hidden=true;r.doc.dispatchEvent(new Event('visibilitychange'));r.fire('pointerdown',1,100);}
 r.fire('pointermove',1,110);assert.deepEqual(r.log.drag,[[10,0]],end);assert.equal(r.log.zoom.length,0,end);}});
test('only the primary mouse button drags, and a missed release ends the drag',()=>{const {log,fire,input}=rig();fire('pointerdown',1,100,{pointerType:'mouse',button:2});fire('pointermove',1,120,{pointerType:'mouse'});assert.equal(log.drag.length,0);
 fire('pointerdown',1,100,{pointerType:'mouse'});fire('pointermove',1,110,{pointerType:'mouse'});fire('pointermove',1,130,{pointerType:'mouse',buttons:0});assert.deepEqual(log.drag,[[10,0]]);assert.equal(input.size,0);
 assert.equal(fire('contextmenu',1,0).defaultPrevented,true);});
test('aborting removes every listener',()=>{const {log,fire,abort}=rig();abort.abort();fire('pointerdown',1,100);fire('pointermove',1,120);assert.equal(log.drag.length,0);});
