import test from 'node:test';
import assert from 'node:assert/strict';
import {InputContextStack,observeDomModals} from './context';
import {DeviceTracker} from './device';

test('the top context is the highest rank, latest among equals; pops fall back in order',()=>{
 const stack=new InputContextStack(),changes:string[]=[];stack.onChange(c=>changes.push(`${c.reason}:${c.top?.label}`));
 const game=stack.push('gameplay',{label:'scene'}),modal=stack.push('modal',{label:'guide'}),viewer=stack.push('viewer',{label:'viewer'});
 assert.equal(stack.top(),modal,'a viewer opened under a modal stays under it');assert.ok(stack.owns(modal));assert.equal(stack.owns(game),false);
 const panel=stack.push('modal',{label:'reset'});assert.equal(stack.top(),panel);panel.pop();panel.pop();assert.equal(stack.top(),modal);
 modal.pop();assert.equal(stack.top(),viewer);viewer.pop();assert.ok(stack.owns(game));assert.equal(stack.topKind(),'gameplay');
 assert.deepEqual(changes,['push:scene','push:guide','push:guide','push:reset','pop:guide','pop:viewer','pop:scene']);
 game.pop();assert.equal(stack.top(),null);assert.equal(stack.topKind(),'gameplay');assert.equal(game.active,false);
});
test('onPop runs after listeners, once',()=>{
 const stack=new InputContextStack(),log:string[]=[];stack.onChange(()=>log.push('change'));const c=stack.push('ui',{onPop:()=>log.push('pop')});log.length=0;c.pop();c.pop();assert.deepEqual(log,['change','pop']);
});
test('DOM modals, visible dialogs and .view-covered become one modal context (viewOwnsInput adapter)',()=>{
 let owns=true,covered=false,callback:(()=>void)|null=null;
 class FakeObserver{constructor(cb:()=>void){callback=cb;}observe(){}disconnect(){callback=null;}}
 const host={ownerDocument:{documentElement:{}},closest:(s:string)=>covered&&s==='.view-covered'?{}:null} as unknown as HTMLElement;
 const stack=new InputContextStack(),game=stack.push('gameplay'),abort=new AbortController();let changes=0;stack.onChange(()=>changes++);
 const stop=observeDomModals(stack,host,{signal:abort.signal,owns:()=>owns,Observer:FakeObserver as unknown as typeof MutationObserver});
 assert.ok(stack.owns(game));owns=false;callback!();assert.equal(stack.topKind(),'modal');callback!();assert.equal(changes,1,'one context per blocked period');
 owns=true;callback!();assert.ok(stack.owns(game));covered=true;stop.sync();assert.equal(stack.top()?.label,'dom-modal');
 abort.abort();assert.ok(stack.owns(game));assert.equal(callback,null);
});
test('device family: dwell, click-or-key to leave the gamepad, and trackpad-mouse noise never flips it',()=>{
 const body={dataset:{} as DOMStringMap},seen:string[]=[];const d=new DeviceTracker({body,onChange:f=>seen.push(f)});assert.equal(body.dataset.inputDevice,'keyboard-mouse');
 assert.ok(d.note('gamepad',1000));assert.equal(body.dataset.inputDevice,'gamepad');
 for(let t=1000;t<3000;t+=16)d.mouseMove(40,0,t);assert.equal(d.family,'gamepad','a Steam Deck trackpad moving the mouse keeps gamepad prompts');
 assert.equal(d.note('keyboard-mouse',1200),false,'within 500 ms of the last switch');assert.ok(d.note('keyboard-mouse',1600));
 assert.ok(d.note('touch',2200));assert.equal(d.mouseMove(10,0,2800),false);assert.equal(d.mouseMove(10,0,2900),false);assert.ok(d.mouseMove(10,0,3000),'24 px within 250 ms');
 assert.deepEqual(seen,['gamepad','keyboard-mouse','touch','keyboard-mouse']);
});
