import test from 'node:test';
import assert from 'node:assert/strict';
import {createInput,InputContextStack,type InputSettings} from './index';
import {env,ev,fakePad,key,ptr,snapshots,wheelEvent} from '../../testing/input-fakes';

const setup=(o:{pads?:ReturnType<typeof fakePad>[];settings?:InputSettings;contexts?:InputContextStack}={})=>{
 const e=env(),abort=new AbortController(),surface=Object.assign(new EventTarget(),{setPointerCapture(){}});let t=0;
 const input=createInput({surface,signal:abort.signal,...e,now:()=>t,getPads:snapshots(o.pads??[]),settings:o.settings,contexts:o.contexts});
 const k=(type:'keydown'|'keyup',code:string,name:string,x={})=>e.win.dispatchEvent(key(type,code,name,{timeStamp:0,...x}));
 const frame=(ms=16)=>{t+=ms;return input.sample(ms/1000);};
 return {...e,abort,surface,input,k,frame,fire:(type:string,id:number,x:number,y:number,extra={})=>surface.dispatchEvent(ptr(type,id,x,y,extra))};
};

test('keys move camera-relative, diagonals stay unit length and moveStarted fires once per fresh press',()=>{
 const s=setup();s.k('keydown','KeyW','w');let f=s.frame();assert.deepEqual(f.move,{x:0,y:1});assert.ok(f.moveStarted);assert.ok(f.mine);
 s.k('keydown','KeyD','d');f=s.frame();assert.ok(Math.abs(Math.hypot(f.move.x,f.move.y)-1)<1e-9);assert.ok(f.moveStarted);assert.equal(s.frame().moveStarted,false);
 s.k('keyup','KeyW','w');s.k('keyup','KeyD','d');assert.deepEqual(s.frame().move,{x:0,y:0});
 assert.equal(s.input.sample(5).dt,.1,'dt is clamped after a stall');
});
test('a tap shorter than a frame is latched for exactly one sample',()=>{
 const s=setup();s.fire('pointerdown',1,50,60);s.fire('pointerup',1,50,60);const f=s.frame();assert.equal(f.taps.length,1);assert.deepEqual([f.taps[0].x,f.taps[0].y],[50,60]);assert.equal(s.frame().taps.length,0);
 s.k('keydown','KeyM','m');s.k('keyup','KeyM','m');assert.ok(s.frame().pressed.has('mute'));
});
test('opening a layer cancels held input; its frames go to the layer; closing requires a fresh press',()=>{
 const pads=[fakePad()],s=setup({pads});s.frame();s.k('keydown','KeyW','w');pads[0].stick(0,0,-1);s.frame();
 const seen:string[]=[];const layer=s.input.openLayer('modal',{label:'guide',onFrame:f=>seen.push(...f.actions.map(a=>a.action))});
 let f=s.frame();assert.equal(f.mine,false);assert.equal(f.context,layer);assert.deepEqual(f.move,{x:0,y:0});
 pads[0].press(1);s.frame();assert.deepEqual(seen,[],'B pressed while the stick is still held from gameplay is swallowed');
 s.k('keydown','Escape','Escape');s.frame();assert.deepEqual(seen,['back'],'a fresh key press reaches the layer');
 pads[0].stick(0,0,0);pads[0].release(1);s.frame();pads[0].press(1);s.frame();assert.deepEqual(seen,['back','back'],'after neutral, B goes back');pads[0].release(1);s.frame();
 layer.pop();s.k('keydown','KeyW','w',{repeat:true});f=s.frame();assert.deepEqual(f.move,{x:0,y:0},'W still held from before the modal does not move');assert.ok(f.mine);
 s.k('keyup','KeyW','w');s.k('keydown','KeyW','w');assert.deepEqual(s.frame().move,{x:0,y:1});
});
test('blur, pagehide and a hidden page stop keys, pad buttons and the gamepad',()=>{
 for(const fire of [(s:ReturnType<typeof setup>)=>s.win.dispatchEvent(ev('blur')),(s:ReturnType<typeof setup>)=>s.win.dispatchEvent(ev('pagehide')),(s:ReturnType<typeof setup>)=>{s.doc.hidden=true;s.doc.dispatchEvent(ev('visibilitychange'));}]){
  const pads=[fakePad()],s=setup({pads});s.frame();s.k('keydown','KeyA','a');pads[0].stick(0,0,-1);s.input.held.press('pointer:4','up');s.fire('pointerdown',2,0,0);s.fire('pointermove',2,50,0);
  s.frame();fire(s);const f=s.frame();assert.deepEqual(f.move,{x:0,y:0});assert.equal(f.dragging,false);
 }
});
test('gamepad through the facade: A interacts, View cycles, R3 anchors, the d-pad zooms, disconnect pauses',()=>{
 const pads=[fakePad()],s=setup({pads});s.frame();
 const tap=(i:number)=>{pads[0].press(i);const f=s.frame();pads[0].release(i);s.frame();return f;};
 assert.deepEqual(tap(0).actions.map(a=>[a.action,a.device]),[['interact','gamepad']]);
 assert.deepEqual(tap(8).actions.map(a=>a.mode),['cycle']);const r3=tap(11);assert.deepEqual(r3.actions.map(a=>a.mode),['anchor']);assert.ok(r3.cameraInput);
 assert.equal(s.doc.body.dataset.inputDevice,'gamepad');
 pads[0].press(13);assert.deepEqual(s.frame().zoom.map(z=>[z.notches,z.source]),[[1,'pad']]);pads[0].release(13);s.frame();
 pads[0].stick(1,1,0);assert.ok(s.frame().look.x>0);pads[0].stick(1,0,0);
 pads[0].connected=false;assert.ok(s.frame().pressed.has('pause'));
});
test('in a modal the pad navigates instead of moving, zooming or interacting',()=>{
 const pads=[fakePad()],s=setup({pads});s.frame();const got:string[]=[];s.input.openLayer('ui',{onFrame:f=>got.push(...f.actions.map(a=>a.action))});s.frame();
 pads[0].press(13);pads[0].stick(0,0,-1);let f=s.frame();assert.equal(f.zoom.length,0);assert.deepEqual(f.move,{x:0,y:0});pads[0].release(13);pads[0].stick(0,0,0);
 pads[0].press(0);f=s.frame();assert.equal(f.actions.length,0,'A confirms the focused control, not interact');pads[0].release(0);s.frame();
 pads[0].press(9);s.frame();assert.deepEqual(got,['pause']);
});
test('a minigame layer with stick play gets the sticks and bumpers; A, B and the d-pad stay menu controls',()=>{
 const pads=[fakePad()],s=setup({pads});s.frame();const frames:{move:{x:number;y:number};zoom:number;actions:string[]}[]=[];
 const layer=s.input.openLayer('modal',{label:'minigame',stick:'play',onFrame:f=>frames.push({move:f.move,zoom:f.zoom.length,actions:f.actions.map(a=>a.action)})});s.frame();
 pads[0].stick(0,1,0);let f=s.frame();assert.ok(frames.at(-1)!.move.x>.9,'the left stick plays');assert.deepEqual(f.move,{x:0,y:0},'the mover gets nothing');
 pads[0].stick(0,0,0);pads[0].press(5);s.frame();assert.equal(frames.at(-1)!.zoom,1,'RB zooms the game view');pads[0].release(5);s.frame();
 pads[0].press(0);s.frame();assert.deepEqual(frames.at(-1)!.actions,[],'A clicks the focused control');pads[0].release(0);s.frame();
 pads[0].press(1);s.frame();assert.deepEqual(frames.at(-1)!.actions,['back']);pads[0].release(1);s.frame();
 layer.pop();s.frame();const plain:number[]=[];s.input.openLayer('modal',{onFrame:f=>plain.push(f.move.x)});s.frame();pads[0].stick(0,1,0);s.frame();assert.equal(plain.at(-1),0,'without stick play a modal only navigates');
});
test('a viewer layer receives look and zoom while gameplay stops moving',()=>{
 const s=setup();const frames:number[]=[];s.input.openLayer('viewer',{label:'star viewer',onFrame:f=>frames.push(f.zoom.length)});
 s.surface.dispatchEvent(wheelEvent(100,{timeStamp:5}));const f=s.frame();assert.equal(f.mine,false);assert.deepEqual(frames,[1]);assert.equal(f.zoom.length,0,'the mover gets an empty frame');
});
test('an on-screen move pad holds per pointer and per key; Space on a focused pad button moves',()=>{
 const s=setup();const button=(dir:string)=>Object.assign(new EventTarget(),{dataset:{dir},setPointerCapture(){}}) as unknown as HTMLElement;
 const up=button('up'),left=button('left'),none=button('');s.input.bindMovePad([up,left,none],b=>b.dataset.dir||undefined);
 up.dispatchEvent(ptr('pointerdown',7,0,0,{pointerType:'touch'}));left.dispatchEvent(ptr('pointerdown',8,0,0,{pointerType:'touch'}));s.k('keydown','KeyW','w');
 let f=s.frame();assert.ok(f.move.x<0&&f.move.y>0);assert.ok(f.moveStarted);
 up.dispatchEvent(ptr('pointerup',7,0,0,{pointerType:'touch'}));f=s.frame();assert.ok(f.move.y>0,'W still holds up after the pad finger lifts');
 left.dispatchEvent(ptr('lostpointercapture',8,0,0,{pointerType:'touch'}));s.k('keyup','KeyW','w');assert.deepEqual(s.frame().move,{x:0,y:0});
 const space=key('keydown','Space',' ');up.dispatchEvent(space);assert.ok(space.defaultPrevented);assert.deepEqual(s.frame().move,{x:0,y:1});
 up.dispatchEvent(key('keyup','Space',' '));assert.deepEqual(s.frame().move,{x:0,y:0});
 up.dispatchEvent(key('keydown','Enter','Enter'));up.dispatchEvent(ev('blur'));assert.deepEqual(s.frame().move,{x:0,y:0},'leaving the button releases it');
 up.dispatchEvent(ptr('pointerdown',9,0,0,{button:2}));assert.deepEqual(s.frame().move,{x:0,y:0},'right-click does not move');
});
test('look settings: sensitivity and invert apply to every look source',()=>{
 const settings:InputSettings={lookSensitivity:2,invertY:true};const s=setup({settings});s.fire('pointerdown',1,0,0);s.fire('pointermove',1,20,0);s.fire('pointermove',1,30,10);
 // Event look is spread over the next few frames (LOOK_SMOOTH_S); the total is exact.
 let f=s.frame();assert.ok(f.cameraInput);assert.ok(f.dragging);assert.ok(f.look.x>0&&f.look.x<10*.006*2,'part now, the rest over the next frames');
 const sum={x:f.look.x,y:f.look.y};for(let i=0;i<30;i++){f=s.frame();sum.x+=f.look.x;sum.y+=f.look.y;}
 assert.ok(Math.abs(sum.x-10*.006*2)<1e-9);assert.ok(Math.abs(sum.y+10*.004*2)<1e-9);assert.equal(f.look.x,0,'nothing left over');
});
test('drag look is spread evenly over frames: events that land two in one frame and none in the next do not stutter',()=>{
 const s=setup();s.fire('pointerdown',1,0,0);s.fire('pointermove',1,20,0);s.frame();let x=20,events=0;const per:number[]=[];
 // A steady drag: one 5 px event every 16 ms, sampled by 13 ms frames. Raw, a frame gets one event or none (rate 0 to 1.2×).
 for(let i=1;i<=80;i++){while((events+1)*16<=i*13){events++;x+=5;s.fire('pointermove',1,x,0);}per.push(s.frame(13).look.x);}
 const tail=per.slice(20),mean=tail.reduce((a,b)=>a+b,0)/tail.length,spread=Math.max(...tail.map(v=>Math.abs(v-mean)))/mean;
 assert.ok(spread<.35,`look per frame varies by ${spread} of its mean`);
 // Events that land in pairs on every other frame (a two-frame beat a flat window leaves in place).
 const t2=setup();t2.fire('pointerdown',1,0,0);t2.fire('pointermove',1,20,0);t2.frame();let x2=20;const per2:number[]=[];
 for(let i=1;i<=60;i++){if(i%2===0)for(let k=0;k<2;k++){x2+=5;t2.fire('pointermove',1,x2,0);}per2.push(t2.frame(22).look.x);}
 const tail2=per2.slice(20),mean2=tail2.reduce((a,b)=>a+b,0)/tail2.length,spread2=Math.max(...tail2.map(v=>Math.abs(v-mean2)))/mean2;
 assert.ok(spread2<.15,`paired events: look per frame varies by ${spread2} of its mean`);
});
test('a shared stack serves several screens; aborting detaches listeners and pops the base context',()=>{
 const contexts=new InputContextStack(),a=setup({contexts}),b=setup({contexts});assert.equal(contexts.top(),b.input.base);assert.equal(b.frame().mine,true);assert.equal(a.frame().mine,false);
 a.k('keydown','KeyW','w');assert.deepEqual(a.frame().move,{x:0,y:0},'a screen under another never moves');a.k('keyup','KeyW','w');
 b.abort.abort();assert.equal(contexts.top(),a.input.base);b.k('keydown','KeyW','w');assert.deepEqual(b.frame().move,{x:0,y:0});
});
test('B on a covering native dialog nobody handles closes it like Escape; the mover screen itself never closes',()=>{
 const Keyboard=class extends Event{key:string;code:string;constructor(type:string,init:KeyboardEventInit){super(type,init);this.key=init.key??'';this.code=init.code??'';}};
 const g=globalThis as {KeyboardEvent?:unknown},saved=g.KeyboardEvent;g.KeyboardEvent=Keyboard;
 try{
  const pads=[fakePad()],s=setup({pads});s.frame();const seen:string[]=[];
  const dialog=Object.assign(new EventTarget(),{tagName:'DIALOG',open:true,contains:(el:unknown)=>el===button,requestClose(){seen.push('requestClose');dialog.open=false;}});
  const button=Object.assign(new EventTarget(),{closest:()=>dialog});dialog.addEventListener('keydown',e=>seen.push((e as KeyboardEvent).key+':'+String((e as KeyboardEvent&{inputSynthetic?:boolean}).inputSynthetic)));
  button.addEventListener('keydown',e=>dialog.dispatchEvent(new Keyboard('keydown',{key:(e as KeyboardEvent).key,code:'Escape'})));
  (s.doc as {activeElement:unknown}).activeElement=button;const cover=s.input.contexts.push('modal',{label:'dom-modal'});s.frame();
  pads[0].press(1);const f=s.frame();pads[0].release(1);s.frame();
  assert.deepEqual(seen,['Escape:undefined','requestClose'],'Escape reaches the focused control, then the dialog closes');assert.equal(f.mine,false);
  assert.equal(s.doc.body.dataset.inputDevice,'gamepad','the synthetic Escape does not switch the prompts to the keyboard');
  cover.pop();dialog.open=true;seen.length=0;const own=s.input.openLayer('ui',{label:'eyepiece',onFrame:frame=>{if(frame.pressed.has('back'))seen.push('layer back');}});s.frame();
  pads[0].press(1);s.frame();pads[0].release(1);s.frame();assert.deepEqual(seen,['layer back'],'a layer with its own handler gets B instead');own.pop();
 }finally{g.KeyboardEvent=saved;}
});
