import test from 'node:test';
import assert from 'node:assert/strict';
import {pickDirection,trapFocus,UiNav} from './ui-nav';
import {ev} from '../../testing/input-fakes';

/** Just enough DOM for spatial navigation: rects, focus, click, closest and a flat scope. */
type Doc={activeElement:FakeEl|null;body:FakeEl};
class FakeEl extends EventTarget{
 dataset:Record<string,string>={};disabled=false;hidden=false;clicks=0;children:FakeEl[]=[];parent:FakeEl|null=null;isConnected=true;type='';role='';value=0;
 constructor(public doc:Doc,public tagName:string,public rect={left:0,top:0,width:40,height:40},public id=''){super();}
 add(...children:FakeEl[]){for(const k of children){k.parent=this;this.children.push(k);}return this;}
 all():FakeEl[]{return this.children.flatMap(k=>[k,...k.all()]);}
 getBoundingClientRect(){return this.rect;}getClientRects(){return this.hidden?[]:[this.rect];}
 closest(selector:string):FakeEl|null{for(let e:FakeEl|null=this;e;e=e.parent){if(selector.includes('[hidden]')&&e.hidden)return e;if(selector.includes('input,')&&(/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)||e.role==='slider'))return e;}return null;}
 contains(e:FakeEl|null){for(let x=e;x;x=x.parent)if(x===this)return true;return false;}
 querySelectorAll(){return this.all().filter(e=>/^(BUTTON|INPUT)$/.test(e.tagName));}
 querySelector(s:string){return this.all().find(e=>'#'+e.id===s)??null;}
 focus(){this.doc.activeElement=this;}click(){this.clicks++;}
 stepUp(){this.value++;}stepDown(){this.value--;}
}
const grid=()=>{
 const doc={activeElement:null} as unknown as Doc;doc.body=new FakeEl(doc,'BODY');
 const at=(x:number,y:number,id:string)=>new FakeEl(doc,'BUTTON',{left:x,top:y,width:40,height:40},id);
 const a=at(0,0,'a'),b=at(100,0,'b'),c=at(0,100,'c'),d=at(100,100,'d'),far=at(400,10,'far');
 const scope=new FakeEl(doc,'DIV').add(a,b,c,d,far),opener=at(0,500,'opener');doc.body.add(scope,opener);
 const nav=new UiNav({doc:doc as unknown as Document,scope:()=>scope as unknown as Element});
 return {doc,scope,a,b,c,d,far,opener,nav};
};

test('spatial pick: nearest ahead, aligned items beat closer diagonal ones',()=>{
 const from={left:0,top:0,width:10,height:10};
 assert.equal(pickDirection(from,[{left:50,top:40,width:10,height:10},{left:80,top:0,width:10,height:10}],'right'),1);
 assert.equal(pickDirection(from,[{left:-50,top:0,width:10,height:10}],'right'),-1);assert.equal(pickDirection(from,[{left:0,top:-60,width:10,height:10}],'up'),0);
});
test('the first move focuses the first control, then d-pad directions move spatially',()=>{
 const g=grid();assert.ok(g.nav.move('right'));assert.equal(g.doc.activeElement,g.a);
 g.nav.move('right');assert.equal(g.doc.activeElement,g.b);g.nav.move('down');assert.equal(g.doc.activeElement,g.d);g.nav.move('left');assert.equal(g.doc.activeElement,g.c);
 g.nav.move('left');assert.equal(g.doc.activeElement,g.c,'nothing further left: focus stays');
 g.b.disabled=true;g.d.hidden=true;g.nav.move('up');assert.equal(g.doc.activeElement,g.a);g.nav.move('right');assert.equal(g.doc.activeElement,g.far,'disabled and hidden controls are skipped');g.d.hidden=false;
 g.a.dataset.navDown='#d';g.a.focus();g.nav.move('down');assert.equal(g.doc.activeElement,g.d,'data-nav-down overrides the geometry');
});
test('held direction: immediate, then 380 ms, then every 120 ms; a new direction restarts',()=>{
 const g=grid();g.a.focus();let moves=0;for(let t=0;t<=740;t+=20)moves+=g.nav.step('right',t);
 // Edge at 0, repeats at 380, 500, 620, 740.
 assert.equal(moves,5);assert.equal(g.nav.step('down',760),1);assert.equal(g.nav.step(null,780),0);assert.equal(g.nav.step('down',800),1);
});
test('keyboard arrows leave text fields, ranges and roving groups alone; the pad steps a focused range',()=>{
 const g=grid();const range=new FakeEl(g.doc,'INPUT',{left:0,top:200,width:100,height:20},'r');range.type='range';g.scope.add(range);range.focus();
 assert.equal(g.nav.move('right',range as unknown as EventTarget),false);assert.equal(range.value,0);
 assert.ok(g.nav.move('right'));assert.equal(range.value,1);g.nav.move('left');assert.equal(range.value,0);g.nav.move('up');assert.equal(g.doc.activeElement,g.c);
});
test('confirm clicks the focused control only inside the scope',()=>{
 const g=grid();g.opener.focus();assert.equal(g.nav.activate(),false);assert.equal(g.opener.clicks,0);g.b.focus();assert.ok(g.nav.activate());assert.equal(g.b.clicks,1);
 assert.equal(new UiNav({doc:g.doc as unknown as Document,scope:()=>null}).move('up'),false);
});
test('focus is trapped in the top layer and restored to the opener, or the fallback when it is gone',()=>{
 const g=grid();g.opener.focus();const release=trapFocus(g.scope as unknown as HTMLElement,{doc:g.doc as unknown as Document});assert.equal(g.doc.activeElement,g.a);
 g.far.focus();const tab=ev('keydown',{key:'Tab',shiftKey:false});g.scope.dispatchEvent(tab);assert.ok(tab.defaultPrevented);assert.equal(g.doc.activeElement,g.a,'Tab wraps inside');
 const back=ev('keydown',{key:'Tab',shiftKey:true});g.scope.dispatchEvent(back);assert.equal(g.doc.activeElement,g.far,'Shift+Tab wraps backwards');
 release();assert.equal(g.doc.activeElement,g.opener);g.far.focus();const after=ev('keydown',{key:'Tab',shiftKey:false});g.scope.dispatchEvent(after);assert.equal(after.defaultPrevented,false,'released traps detach');
 const h=grid();h.opener.focus();const r2=trapFocus(h.scope as unknown as HTMLElement,{doc:h.doc as unknown as Document,initial:h.d as unknown as HTMLElement,fallback:()=>h.c as unknown as HTMLElement});
 assert.equal(h.doc.activeElement,h.d);h.opener.isConnected=false;r2();assert.equal(h.doc.activeElement,h.c);
});
