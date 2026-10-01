import test from 'node:test';
import assert from 'node:assert/strict';
import {holdButtonKeys,isFocusViewKey,walkKeys} from './keys';
import {AliasHeldInput} from './held';

// The mover's own sequence: press by e.code, release by e.code.
const mover=()=>{const keys=new AliasHeldInput();return {keys,
 down:(e:{code:string;key:string;shiftKey?:boolean;repeat?:boolean})=>{const dir=walkKeys[e.code];if(dir&&!e.repeat)keys.press('key:'+e.code,dir);},
 up:(e:{code:string;key:string})=>keys.release('key:'+e.code),
 moving:()=>(['up','down','left','right'] as const).some(d=>keys.has(d))};};

test('Shift+W moves, and pressing Shift mid-move cannot strand the key',()=>{
 const w=mover();w.down({code:'KeyW',key:'W',shiftKey:true});assert.ok(w.keys.has('up'));
 const v=mover();v.down({code:'KeyW',key:'w'});v.down({code:'ShiftLeft',key:'Shift',shiftKey:true});assert.ok(v.moving());
 v.up({code:'KeyW',key:'W'});v.up({code:'ShiftLeft',key:'Shift'});assert.equal(v.moving(),false);
});
test('Caps Lock letters move the same directions as lowercase',()=>{
 for(const [code,dir] of [['KeyW','up'],['KeyA','left'],['KeyS','down'],['KeyD','right']] as const){const w=mover();w.down({code,key:code.slice(3)});assert.ok(w.keys.has(dir),code);w.up({code,key:code.slice(3).toLowerCase()});assert.equal(w.moving(),false,code);}
});
test('releasing a key keeps a pad finger or an alias moving',()=>{
 const w=mover();w.down({code:'KeyW',key:'w'});w.keys.press('pointer:3','up');w.down({code:'ArrowUp',key:'ArrowUp'});
 w.up({code:'KeyW',key:'w'});assert.ok(w.keys.has('up'));w.keys.release('pointer:3');assert.ok(w.keys.has('up'));w.up({code:'ArrowUp',key:'ArrowUp'});assert.equal(w.moving(),false);
});
test('F picks the focus view in either case',()=>{assert.ok(isFocusViewKey({key:'f'}));assert.ok(isFocusViewKey({key:'F'}));assert.equal(isFocusViewKey({key:'f',ctrlKey:true}),false);});
test('a focused hold button presses on Space or Enter, ignores repeats and lets go on release or blur',()=>{
 const button:{onkeydown:unknown;onkeyup:unknown;onblur:unknown}={onkeydown:null,onkeyup:null,onblur:null};let held=0,presses=0,prevented=0;
 holdButtonKeys(button,()=>{held++;presses++;},()=>{held=0;});
 const key=(type:'onkeydown'|'onkeyup',code:string,repeat=false)=>(button[type] as (e:object)=>void)({code,repeat,preventDefault:()=>prevented++});
 key('onkeydown','Space');key('onkeydown','Space',true);assert.equal(presses,1);assert.equal(held,1);key('onkeyup','Space');assert.equal(held,0);
 key('onkeydown','Enter');assert.equal(held,1);(button.onblur as ()=>void)();assert.equal(held,0);
 const before=prevented;key('onkeydown','KeyW');key('onkeyup','Tab');assert.equal(prevented,before);assert.equal(presses,2);
});
