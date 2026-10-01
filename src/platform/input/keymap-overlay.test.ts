import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {installFakeDom,keyEvent,live} from '../../testing/fake-dom';
import {openOverlayLayer,swallowActions,wrapAtEnds,wrapByIndex} from './keymap-overlay';
import {appLayers,installAppInput} from '../ui/runtime';
import {CORE_INPUT_ACTIONS,inputActionRegistry,type InputActionDef} from './actions';

/** A game's move rows (movement is a game's or a kit's action, not a core row). */
const MOVE_ROWS:InputActionDef[]=(['up','down','left','right'] as const).map((d,i)=>({id:`game.move-${d}`,label:`game.move-${d}`,scope:'global',kind:'hold',defaults:{keys:[['code:KeyW','code:ArrowUp'],['code:KeyS','code:ArrowDown'],['code:KeyA','code:ArrowLeft'],['code:KeyD','code:ArrowRight']][i],pad:[(['ls-up','ls-down','ls-left','ls-right'] as const)[i]]}}));

const as=<T>(x:unknown)=>x as T;
function overlay(){
 const dom=installFakeDom(),doc=dom.document;
 const host=doc.createElement('div');doc.body.append(host);
 const root=doc.createElement('section');const buttons=[0,1,2].map(i=>{const b=doc.createElement('button');b.textContent='b'+i;root.append(b);return b;});host.append(root);
 const outside=doc.createElement('button');host.append(outside);
 return {dom,doc,host,root,buttons,outside};
}
const focusables=(root:HTMLElement)=>Array.from(root.querySelectorAll<HTMLElement>('button')).filter(b=>!(b as HTMLButtonElement).disabled);

test('overlay layer: Escape reaches onEscape through the keymap, once per press; the page below never sees it',()=>{
 const t=overlay();
 try{
  let closes=0,below=0;const abort=new AbortController();
  t.doc.addEventListener('keydown',(e:{key:string})=>{if(e.key==='Escape')below++;});
  openOverlayLayer({id:'minigame:probe',element:as<HTMLElement>(t.root),signal:abort.signal,focusables,onEscape:()=>{closes++;abort.abort();}});
  assert.equal(appLayers(as<Document>(t.doc)).top()?.id,'minigame:probe');
  t.buttons[1].dispatchEvent(keyEvent('Escape'));t.doc.body.dispatchEvent(keyEvent('Escape',{repeat:true}));
  assert.equal(closes,1);assert.equal(below,0);assert.equal(appLayers(as<Document>(t.doc)).top(),null,'aborting the signal closed the layer');
  // With no overlay on top the key is the page's again.
  t.doc.dispatchEvent({type:'keyup',key:'Escape',code:'Escape'});t.doc.body.dispatchEvent(keyEvent('Escape'));assert.equal(below,1);
 }finally{t.dom.restore();}
});

test('overlay layer: an onEscape that declines leaves Escape to the page',()=>{
 const t=overlay();
 try{
  let below=0;const abort=new AbortController();t.doc.addEventListener('keydown',()=>below++);
  openOverlayLayer({id:'pad-countdown',element:as<HTMLElement>(t.root),signal:abort.signal,onEscape:()=>false});
  t.doc.body.dispatchEvent(keyEvent('Escape'));assert.equal(below,1);abort.abort();
 }finally{t.dom.restore();}
});

test('overlay layer: Tab wraps by trapFocus’s rule through the keymap; the middle is native Tab; nothing focusable swallows it',()=>{
 const t=overlay();
 try{
  const abort=new AbortController(),before=live.listeners;
  openOverlayLayer({id:'minigame:probe',element:as<HTMLElement>(t.root),signal:abort.signal,focusables,onEscape:()=>{}});
  t.buttons[2].focus();let e=keyEvent('Tab');t.buttons[2].dispatchEvent(e);assert.equal(t.doc.activeElement,t.buttons[0]);assert.equal((e as {defaultPrevented?:boolean}).defaultPrevented,true);
  e=keyEvent('Tab',{shiftKey:true});t.buttons[0].dispatchEvent(e);assert.equal(t.doc.activeElement,t.buttons[2]);
  t.buttons[1].focus();e=keyEvent('Tab');t.buttons[1].dispatchEvent(e);assert.equal(t.doc.activeElement,t.buttons[1],'mid-list: left to native Tab');assert.equal((e as {defaultPrevented?:boolean}).defaultPrevented,false);
  t.outside.focus();e=keyEvent('Tab');t.outside.dispatchEvent(e);assert.equal((e as {defaultPrevented?:boolean}).defaultPrevented,false,'focus outside the overlay: native Tab, as before');
  (t.root as unknown as {tabIndex:number}).tabIndex=-1;t.root.focus();t.root.dispatchEvent(keyEvent('Tab'));assert.equal(t.doc.activeElement,t.buttons[0],'focus on the overlay itself wraps in');
  t.buttons.forEach(b=>{(b as unknown as {disabled:boolean}).disabled=true;});e=keyEvent('Tab');t.root.focus();t.root.dispatchEvent(e);assert.equal((e as {defaultPrevented?:boolean}).defaultPrevented,true);
  abort.abort();assert.equal(live.listeners,before,'the keymap subscriptions add no DOM listeners');
  t.buttons.forEach(b=>{(b as unknown as {disabled:boolean}).disabled=false;});t.buttons[2].focus();e=keyEvent('Tab');t.buttons[2].dispatchEvent(e);assert.equal((e as {defaultPrevented?:boolean}).defaultPrevented,false,'closed: Tab is native again');
 }finally{t.dom.restore();}
});

test('overlay keys: swallowed actions are consumed on the layer only while `when` holds',()=>{
 const t=overlay();
 try{
  let owns=true,moved=0;const abort=new AbortController();t.doc.addEventListener('keydown',()=>moved++);
  installAppInput(as<Document>(t.doc),inputActionRegistry([...CORE_INPUT_ACTIONS,...MOVE_ROWS]),abort.signal);
  openOverlayLayer({id:'pad-countdown',element:as<HTMLElement>(t.root),signal:abort.signal,onEscape:()=>false});
  swallowActions('pad-countdown',as<Document>(t.doc),['game.move-up','game.move-left'],()=>owns,abort.signal);
  t.doc.body.dispatchEvent(keyEvent('ArrowUp'));t.doc.body.dispatchEvent({...keyEvent('w'),code:'KeyW'});t.doc.body.dispatchEvent(keyEvent('ArrowLeft'));assert.equal(moved,0);
  t.doc.body.dispatchEvent(keyEvent('ArrowDown'));assert.equal(moved,1,'rows it did not take pass');
  for(const k of ['ArrowUp','KeyW','ArrowLeft'])t.doc.dispatchEvent({type:'keyup',key:k,code:k});
  owns=false;t.doc.body.dispatchEvent(keyEvent('ArrowUp'));assert.equal(moved,2);
  abort.abort();
 }finally{t.dom.restore();}
});

test('wrap rules: the panel card’s and trapFocus’s',()=>{
 const t=overlay();
 try{
  const list=as<HTMLElement[]>(t.buttons),card=wrapAtEnds;
  assert.equal(card(list[2],list,false),list[0]);assert.equal(card(list[0],list,true),list[2]);assert.equal(card(list[1],list,false),null);
  assert.equal(card(as<HTMLElement>(t.root),list,true),null,'inside the card but not a control: native');
  assert.equal(wrapByIndex(as<HTMLElement>(t.root),list,true),list[2],'trapFocus: not in the list wraps');assert.equal(wrapByIndex(list[1],list,true),null);
 }finally{t.dom.restore();}
});


for (const closeFirst of [true, false]) {
 test(`overlay layer: ${closeFirst ? 'close/reopen' : 'replacement'} retires the old focus trap`, () => {
  const t = overlay();
  const owner = new AbortController();
  try {
   const first = openOverlayLayer({id: 'tools', element: as<HTMLElement>(t.root), signal: owner.signal, focusables, onEscape() {}});
   if (closeFirst) first.close();
   const replacement = t.doc.createElement('section');
   const buttons = [0, 1].map(() => {
    const button = t.doc.createElement('button');
    replacement.append(button);
    return button;
   });
   t.host.append(replacement);
   const second = openOverlayLayer({id: 'tools', element: as<HTMLElement>(replacement), signal: owner.signal, focusables, onEscape() {}});
   assert.equal(first.closed, true);
   buttons[1].focus();
   const event = keyEvent('Tab');
   buttons[1].dispatchEvent(event);
   assert.equal(t.doc.activeElement, buttons[0], 'new layer owns wrapping after the old layer closes');
   assert.equal((event as {defaultPrevented?: boolean}).defaultPrevented, true);
   second.close();
   assert.equal(getEventListeners(owner.signal, 'abort').length, 0, 'closed overlays release their caller abort bridges');
  } finally {
   owner.abort();
   t.dom.restore();
  }
 });
}

test('overlay layer: pre-aborted caller leaves no layer or subscriptions', () => {
 const t = overlay();
 const owner = new AbortController();
 owner.abort();
 try {
  const layer = openOverlayLayer({id: 'tools', element: as<HTMLElement>(t.root), signal: owner.signal, focusables, onEscape() {}});
  assert.equal(layer.closed, true);
  assert.equal(appLayers(as<Document>(t.doc)).top(), null);
  assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
  assert.equal(getEventListeners(layer.signal, 'abort').length, 0);
 } finally {
  t.dom.restore();
 }
});

test('overlay layer: synchronous closure during admission retains no caller bridge', () => {
 const t = overlay();
 const owner = new AbortController();
 const layers = appLayers(as<Document>(t.doc));
 const off = layers.onChange(change => {
  if (change.reason === 'push') layers.close('tools');
 });
 try {
  const layer = openOverlayLayer({id: 'tools', element: as<HTMLElement>(t.root), signal: owner.signal, focusables, onEscape() {}});
  assert.equal(layer.closed, true);
  assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
  assert.equal(getEventListeners(layer.signal, 'abort').length, 0);
 } finally {
  off();
  owner.abort();
  t.dom.restore();
 }
});

test('overlay layer: caller abort during admission closes the returned layer', () => {
 const t = overlay();
 const owner = new AbortController();
 const layers = appLayers(as<Document>(t.doc));
 const off = layers.onChange(change => {
  if (change.reason === 'push') owner.abort();
 });
 try {
  const layer = openOverlayLayer({id: 'tools', element: as<HTMLElement>(t.root), signal: owner.signal, focusables, onEscape() {}});
  assert.equal(layer.closed, true);
  assert.equal(layers.top(), null);
  assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
  assert.equal(getEventListeners(layer.signal, 'abort').length, 0);
 } finally {
  off();
  t.dom.restore();
 }
});

test('overlay layer: later caller option edits do not transfer abort ownership', () => {
 const t = overlay();
 const original = new AbortController();
 const replacement = new AbortController();
 try {
  const options = {id: 'tools', element: as<HTMLElement>(t.root), signal: original.signal, focusables, onEscape() {}};
  const layer = openOverlayLayer(options);
  assert.equal(getEventListeners(original.signal, 'abort').length, 1);
  options.signal = replacement.signal;
  layer.close();
  assert.equal(getEventListeners(original.signal, 'abort').length, 0);
  assert.equal(getEventListeners(replacement.signal, 'abort').length, 0);
 } finally {
  original.abort();
  replacement.abort();
  t.dom.restore();
 }
});
