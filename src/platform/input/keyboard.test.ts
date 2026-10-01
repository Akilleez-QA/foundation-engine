import test from 'node:test';
import assert from 'node:assert/strict';
import {heldVector} from './frame-actions';
import {attachKeyboard,KeyboardInput} from './keyboard';
import {env,ev,key,recordingSink} from '../../testing/input-fakes';

const setup=(options={})=>{const sink=recordingSink(),e=env(),abort=new AbortController();attachKeyboard(sink,{...e,signal:abort.signal,now:()=>1000,...options});return {sink,...e,abort,down:(code:string,k:string,x={})=>{const k2=key('keydown',code,k,x);e.win.dispatchEvent(k2);return k2;},up:(code:string,k:string,x={})=>e.win.dispatchEvent(key('keyup',code,k,x))};};

test('movement is bound by code: AZERTY Z moves forward, a key labelled w elsewhere does not',()=>{
 const {sink,down}=setup();const e=down('KeyW','z');assert.ok(sink.held.has('up'));assert.ok(e.defaultPrevented);
 sink.held.clear();down('KeyZ','w');assert.equal(sink.held.size,0);
 down('ArrowLeft','ArrowLeft');assert.ok(sink.held.has('left'));assert.ok(sink.latch.drain().moveStarted);
});
test('Shift or Caps Lock during a move cannot strand the player: keyup releases by code',()=>{
 const {sink,down,up}=setup();down('KeyW','w');up('KeyW','W',{shiftKey:true});assert.equal(sink.held.size,0);
});
test('mnemonics match key case-insensitively; Ctrl, Meta and Alt chords are never consumed',()=>{
 const {sink,down}=setup();down('KeyM','M',{shiftKey:true});down('Semicolon','m');
 assert.deepEqual(sink.latch.drain().actions.map(a=>a.action),['mute','mute'],'Shift+M and AZERTY M both mute');
 for(const mod of ['ctrlKey','metaKey','altKey']){const e=down('KeyM','m',{[mod]:true});assert.equal(e.defaultPrevented,false);const w=down('KeyW','w',{[mod]:true});assert.equal(w.defaultPrevented,false);}
 assert.equal(sink.latch.drain().actions.length,0);assert.equal(sink.held.size,0);
});
test('toggles ignore autorepeat: holding M mutes exactly once',()=>{
 const {sink,down}=setup();down('KeyM','m');for(let i=0;i<30;i++)down('KeyM','m',{repeat:true});
 assert.equal(sink.latch.drain().actions.length,1);
 down('KeyV','v');down('Digit3','3');down('Escape','Escape');
 assert.deepEqual(sink.latch.drain().actions.map(a=>[a.action,a.mode]),[['cameraMode','cycle'],['slot3',undefined],['back',undefined]]);
});
test('zoom keys: + = I and NumpadAdd zoom in, − _ O and NumpadSubtract out; repeats capped at 8 notches/s',()=>{
 let t=0;const sink=recordingSink(),e=env(),abort=new AbortController();attachKeyboard(sink,{...e,signal:abort.signal,now:()=>t});
 const press=(code:string,k:string,x={})=>e.win.dispatchEvent(key('keydown',code,k,{timeStamp:0,...x}));
 press('Equal','+');press('Equal','=');press('KeyI','i');press('NumpadAdd','+');press('Minus','-');press('Minus','_');press('KeyO','O');press('NumpadSubtract','-');
 assert.deepEqual(sink.latch.drain().zoom.map(z=>[z.notches,z.source]),[[-1,'key'],[-1,'key'],[-1,'key'],[-1,'key'],[1,'key'],[1,'key'],[1,'key'],[1,'key']]);
 t=1000;press('Minus','-');for(let i=1;i<=30;i++){t=1000+i*33;press('Minus','-',{repeat:true});}
 const steps=sink.latch.drain().zoom;assert.equal(steps[0].source,'key');assert.ok(steps.slice(1).every(z=>z.source==='repeat'));assert.ok(steps.length-1<=8,`${steps.length-1} repeats in one second`);
});
test('editable targets own every key and focused buttons own Space and Enter',()=>{
 const {sink,down}=setup();
 for(const tagName of ['INPUT','TEXTAREA','SELECT']){const e=down('KeyW','w',{target:{tagName}});down('KeyM','m',{target:{tagName}});assert.equal(e.defaultPrevented,false);}
 down('KeyW','w',{target:{tagName:'DIV',isContentEditable:true}});
 assert.equal(sink.held.size,0);assert.equal(sink.latch.drain().actions.length,0);
 const button={tagName:'BUTTON',getAttribute:()=>null};const space=down('Space',' ',{target:button});down('Enter','Enter',{target:button});
 assert.equal(space.defaultPrevented,false);assert.equal(sink.latch.drain().actions.length,0);
 down('KeyW','w',{target:button});assert.ok(sink.held.has('up'),'arrows and WASD still move from a focused HUD button');
 const s=down('Space',' ');assert.ok(s.defaultPrevented);assert.deepEqual(sink.latch.drain().actions.map(a=>a.action),['interact']);
});
test('IME composition never triggers shortcuts',()=>{
 const {sink,down}=setup();down('KeyM','m',{isComposing:true});down('KeyM','Process',{keyCode:229});assert.equal(sink.latch.drain().actions.length,0);
});
test('held keys clear on blur, hidden, pagehide, pointer-lock and fullscreen changes and Meta keyup; only a fresh press re-arms',()=>{
 for(const fire of [(s:ReturnType<typeof setup>)=>s.win.dispatchEvent(ev('blur')),(s:ReturnType<typeof setup>)=>{s.doc.hidden=true;s.doc.dispatchEvent(ev('visibilitychange'));},(s:ReturnType<typeof setup>)=>s.win.dispatchEvent(ev('pagehide')),(s:ReturnType<typeof setup>)=>s.doc.dispatchEvent(ev('pointerlockchange')),(s:ReturnType<typeof setup>)=>s.doc.dispatchEvent(ev('fullscreenchange')),(s:ReturnType<typeof setup>)=>s.up('MetaLeft','Meta')]){
  const s=setup();s.down('KeyD','d');s.sink.held.press('pointer:1','up');fire(s);
  assert.equal(s.sink.held.has('right'),false);assert.ok(s.sink.held.has('up'),'on-screen pad pointers are not keyboard sources');
  s.down('KeyD','d',{repeat:true});assert.equal(s.sink.held.has('right'),false,'autorepeat after a reset does not re-arm');
  s.down('KeyD','d');assert.ok(s.sink.held.has('right'));
 }
});
test('W+D is no faster than W; W+ArrowUp is no faster than W',()=>{
 const {sink,down}=setup();down('KeyW','w');down('KeyD','d');const v=heldVector(sink.held);assert.ok(Math.abs(Math.hypot(v.x,v.y)-1)<.01);
 sink.held.clear();down('KeyW','w');down('ArrowUp','ArrowUp');assert.deepEqual(heldVector(sink.held),{x:0,y:1});
});
test('in ui and modal contexts arrows navigate focus, WASD and interact stay native, Escape still goes back',()=>{
 const {sink,down}=setup();sink.setKind('modal');
 const arrow=down('ArrowDown','ArrowDown');assert.ok(arrow.defaultPrevented);assert.deepEqual(sink.navs,['down']);
 down('KeyW','w');down('Space',' ');down('Equal','+');assert.equal(sink.held.size,0);assert.equal(sink.latch.drain().zoom.length,0);
 sink.navResult=false;const native=down('ArrowUp','ArrowUp');assert.equal(native.defaultPrevented,false,'a range or list keeps its arrows');
 down('Escape','Escape');assert.deepEqual(sink.latch.drain().actions.map(a=>a.action),['back']);
});
test('single-key shortcuts can be switched off (WCAG 2.1.4) without losing Escape or movement',()=>{
 let on=false;const {sink,down}=setup({singleKeyShortcuts:()=>on});down('KeyM','m');down('KeyV','v');down('Digit1','1');down('Equal','+');down('Escape','Escape');down('KeyW','w');
 assert.deepEqual(sink.latch.drain().actions.map(a=>a.action),['back']);assert.ok(sink.held.has('up'));on=true;down('KeyM','m');assert.equal(sink.latch.drain().actions.length,1);
});
test('another handler that already consumed the key wins, and the listener detaches on abort',()=>{
 const s=setup();const e=key('keydown','KeyW','w');e.preventDefault();s.win.dispatchEvent(e);assert.equal(s.sink.held.size,0);
 s.abort.abort();s.down('KeyW','w');assert.equal(s.sink.held.size,0);
 const k=new KeyboardInput(recordingSink());assert.equal(k.down(key('keydown','KeyQ','q') as unknown as KeyboardEvent),false);
});
