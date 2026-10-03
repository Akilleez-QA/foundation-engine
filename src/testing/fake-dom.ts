/**
 * A tiny DOM for node tests of DOM-building modules . It covers only what those
 * modules use: elements, text, attributes, dataset, a simple selector engine (tag, .class, [attr], [attr=value],
 * comma lists), focus, capture/bubble events with AbortSignal removal, requestAnimationFrame and ResizeObserver.
 * install() also installs the app's keymap (appInput) on the fake document, so Escape
 * and Tab reach layer-managed overlays through it.
 * It counts live listeners, observers and animation frames so lifecycle tests can prove a close releases them.
 * Not a test file itself (no .test.ts suffix); install() swaps it onto globalThis and returns a restore function.
 */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {appInput} from '../platform/ui/runtime';
/** An event as the fake delivers it: the dispatched object itself, given a target and propagation state. */
export interface FakeEvent{type:string;target:FakeNode;currentTarget?:FakeNode;defaultPrevented:boolean;stopped:boolean;preventDefault():void;stopPropagation():void;[key:string]:unknown}
/** What a test dispatches: a plain object with a type (plus any event fields), or a real Event. */
export type FakeEventInit={type:string;[key:string]:unknown};
/** A listener names the event fields it reads; the fake delivers whatever object the test dispatched. */
type FakeListener<E=FakeEvent>=(event:E)=>void;
type Listener={type:string;fn:FakeListener;capture:boolean};
const isEvent=(value:unknown):value is Event=>typeof Event==='function'&&value instanceof Event;
type FakeStyle=Record<string,string>&{setProperty(k:string,v:string):void;getPropertyValue(k:string):string};
const fakeStyle=():FakeStyle=>Object.assign({} as Record<string,string>,{setProperty(this:Record<string,string>,k:string,v:string){this[k]=v;},getPropertyValue(this:Record<string,string>,k:string){return this[k]??'';}});
export const live={listeners:0,observers:0,frames:0};
class FakeNode{
 parentNode:FakeNode|null=null;childNodes:FakeNode[]=[];ownerDocument!:FakeDocument;
 private listeners:Listener[]=[];
 get parentElement():FakeElement|null{return this.parentNode instanceof FakeElement?this.parentNode:null;}
 get isConnected():boolean{let node:FakeNode|null=this;while(node){if(node instanceof FakeDocument)return true;node=node.parentNode;}return false;}
 get textContent():string{return this.childNodes.map(c=>c.textContent).join('');}
 set textContent(value:string){this.replaceChildren();if(value)this.append(this.ownerDocument.createTextNode(value));}
 append(...nodes:(FakeNode|string)[]){for(const n of nodes){const node=typeof n==='string'?this.ownerDocument.createTextNode(n):n;node.remove();node.parentNode=this;this.childNodes.push(node);}}
 /** Inserts nodes before this one in its parent. */
 before(...nodes:FakeNode[]){const p=this.parentNode;if(!p)return;for(const node of nodes){if(node===this)continue;node.remove();node.parentNode=p;p.childNodes.splice(p.childNodes.indexOf(this),0,node);}}
 replaceChildren(...nodes:FakeNode[]){for(const c of [...this.childNodes])c.remove();this.append(...nodes);}
 remove(){const p=this.parentNode;if(!p)return;p.childNodes.splice(p.childNodes.indexOf(this),1);this.parentNode=null;if(this.ownerDocument.activeElement&&this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;}
 contains(node:FakeNode|null|undefined):boolean{for(let n=node;n;n=n.parentNode)if(n===this)return true;return false;}
 addEventListener<E=FakeEvent>(type:string,fn:FakeListener<E>,options?:boolean|{capture?:boolean;signal?:AbortSignal}){
  const capture=typeof options==='boolean'?options:!!options?.capture,signal=typeof options==='object'?options.signal:undefined;
  if(signal?.aborted)return;if(this.listeners.some(l=>l.type===type&&l.fn===fn&&l.capture===capture))return;
  const entry={type,fn:fn as FakeListener,capture};this.listeners.push(entry);live.listeners++;
  signal?.addEventListener('abort',()=>this.drop(entry),{once:true});
 }
 removeEventListener<E=FakeEvent>(type:string,fn:FakeListener<E>,options?:boolean|{capture?:boolean}){const capture=typeof options==='boolean'?options:!!options?.capture;const entry=this.listeners.find(l=>l.type===type&&l.fn===fn&&l.capture===capture);if(entry)this.drop(entry);}
 private drop(entry:Listener){const i=this.listeners.indexOf(entry);if(i>=0){this.listeners.splice(i,1);live.listeners--;}}
 /** Capture from the document down, then bubble back up (every event bubbles here). Returns !defaultPrevented. */
 dispatchEvent(init:FakeEventInit|Event){
  // A real Event (a CustomEvent the module dispatches) has read-only fields: carry its type and detail instead.
  const source:FakeEventInit=isEvent(init)?{type:init.type,detail:(init as CustomEvent).detail}:init;
  const event:FakeEvent=Object.assign(source,{target:this as FakeNode,defaultPrevented:false,stopped:false,preventDefault(){event.defaultPrevented=true;},stopPropagation(){event.stopped=true;}});
  const path:FakeNode[]=[];for(let n:FakeNode|null=this;n;n=n.parentNode)path.push(n);
  const fire=(node:FakeNode,capture:boolean)=>{for(const l of [...node.listeners])if(l.type===event.type&&(l.capture===capture||node===this)&&node.listeners.includes(l)){event.currentTarget=node;l.fn(event);}};
  for(const node of [...path].reverse()){if(node===this)break;fire(node,true);if(event.stopped)return !event.defaultPrevented;}
  for(const node of path){fire(node,false);if(event.stopped)break;}
  return !event.defaultPrevented;
 }
}
class FakeText extends FakeNode{constructor(public data:string){super();}override get textContent(){return this.data;}override set textContent(v:string){this.data=v;}}
const camel=(name:string)=>name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
const kebab=(key:string)=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
export class FakeElement extends FakeNode{
 attributes=new Map<string,string>();hidden=false;disabled=false;type='';value='';min='';max='';src='';alt='';decoding='';
 style=fakeStyle();
 rect={left:0,top:0,width:400,height:300};private tab:number|null=null;
 dataset:Record<string,string>;
 constructor(public tagName:string){super();const el=this;
  this.dataset=new Proxy({} as Record<string,string>,{get:(_t,k:string)=>el.attributes.get(kebab(k)),set:(_t,k:string,v)=>{el.attributes.set(kebab(k),String(v));return true;},deleteProperty:(_t,k:string)=>{el.attributes.delete(kebab(k));return true;},has:(_t,k:string)=>el.attributes.has(kebab(k)),ownKeys:()=>[...el.attributes.keys()].filter(a=>a.startsWith('data-')).map(camel),getOwnPropertyDescriptor:(_t,k:string)=>el.attributes.has(kebab(k))?{enumerable:true,configurable:true,value:el.attributes.get(kebab(k))}:undefined});}
 get className(){return this.attributes.get('class')??'';}set className(v:string){this.attributes.set('class',v);}
 get id(){return this.attributes.get('id')??'';}set id(v:string){this.attributes.set('id',v);}
 get classList(){const el=this,list=()=>el.className.split(/\s+/).filter(Boolean);return {contains:(c:string)=>list().includes(c),add:(...c:string[])=>{el.className=[...new Set([...list(),...c])].join(' ');},remove:(...c:string[])=>{el.className=list().filter(x=>!c.includes(x)).join(' ');},toggle:(c:string,force?:boolean)=>{const on=force??!list().includes(c);if(on)el.classList.add(c);else el.classList.remove(c);return on;}};}
 get children():FakeElement[]{return this.childNodes.filter((c):c is FakeElement=>c instanceof FakeElement);}
 get childElementCount(){return this.children.length;}
 /** A small HTML parser: elements, attributes and text (enough for small templates). */
 set innerHTML(html:string){this.replaceChildren();if(html)parseInto(this,html);}
 get tabIndex(){return this.tab??(['BUTTON','INPUT','SELECT','TEXTAREA'].includes(this.tagName)||(this.tagName==='A'&&this.attributes.has('href'))?0:-1);}set tabIndex(v:number){this.tab=v;}
 setAttribute(name:string,value:string){this.attributes.set(name,String(value));}
 getAttribute(name:string){return this.attributes.get(name)??null;}
 hasAttribute(name:string){return this.attributes.has(name);}
 removeAttribute(name:string){this.attributes.delete(name);}
 /** Rendered when connected and no ancestor is hidden. */
 getClientRects(){for(let n:FakeNode|null=this;n&&n instanceof FakeElement;n=n.parentNode)if(n.hidden)return [];return this.isConnected?[this.getBoundingClientRect()]:[];}
 getBoundingClientRect(){const r=this.rect;return {...r,x:r.left,y:r.top,right:r.left+r.width,bottom:r.top+r.height};}
 get clientWidth(){return this.rect.width;}get clientHeight(){return this.rect.height;}
 focus(){if(!this.isConnected||this.tab===null&&this.tabIndex<0)return;const doc=this.ownerDocument;if(doc.activeElement===this)return;doc.activeElement=this;this.dispatchEvent({type:'focusin'});}
 blur(){if(this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=this.ownerDocument.body;}
 click(){if(!this.disabled)this.dispatchEvent({type:'click'});}
 matches(selector:string){return selector.split(',').some(s=>matchCompound(this,s.trim()));}
 closest(selector:string){for(let n:FakeNode|null=this;n instanceof FakeElement;n=n.parentNode)if(n.matches(selector))return n;return null;}
 querySelectorAll(selector:string):FakeElement[]{const out:FakeElement[]=[];const visit=(n:FakeElement)=>{for(const c of n.children){if(c.matches(selector))out.push(c);visit(c);}};visit(this);return out;}
 querySelector(selector:string){return this.querySelectorAll(selector)[0]??null;}
}
const voidTags=new Set(['img','input','br','hr','meta','link','source']);
const decode=(t:string)=>t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function parseInto(root:FakeElement,html:string){
 const stack:FakeElement[]=[root],doc=root.ownerDocument,token=/<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
 for(const m of html.matchAll(token)){
  const top=stack[stack.length-1]!;// root stays: closing tags truncate to length i >= 1
  if(m[5]!==undefined){top.append(doc.createTextNode(decode(m[5])));continue;}
  if(m[1]){for(let i=stack.length-1;i>0;i--)if(stack[i]!.tagName===m[1].toUpperCase()){stack.length=i;break;}continue;}
  if(!m[2])continue;
  const el=doc.createElement(m[2]);top.append(el);
  for(const a of (m[3]??'').matchAll(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))el.setAttribute(a[1]!,decode(a[2]??a[3]??a[4]??''));
  if(el.hasAttribute('hidden'))el.hidden=true;
  if(!m[4]&&!voidTags.has(m[2].toLowerCase()))stack.push(el);
 }
}
function matchCompound(el:FakeElement,compound:string){
 if(!compound)return false;if(/:modal/.test(compound))return false;
 const parts=compound.match(/^[a-z0-9-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/gi);if(!parts||parts.join('')!==compound)return false;
 return parts.every(p=>{
  if(p.startsWith('.'))return el.classList.contains(p.slice(1));
  if(p.startsWith('[')){const m=p.slice(1,-1).match(/^([\w-]+)(?:=["']?([^"']*)["']?)?$/);if(!m)return false;return m[2]===undefined?el.hasAttribute(m[1]!):el.getAttribute(m[1]!)===m[2];}// group 1 is not optional
  if(p.startsWith(':'))return p===':not([hidden])'?!el.hidden:false;
  return el.tagName===p.toUpperCase();
 });
}
export class FakeDocument extends FakeNode{
 body:FakeElement;activeElement:FakeElement;
 constructor(){super();this.ownerDocument=this;this.body=this.createElement('body');this.append(this.body);this.activeElement=this.body;}
 createElement(tag:string){const el=new FakeElement(tag.toUpperCase());el.ownerDocument=this;return el;}
 createTextNode(text:string){const t=new FakeText(text);t.ownerDocument=this;return t;}
 querySelectorAll(selector:string){return this.body.matches(selector)?[this.body,...this.body.querySelectorAll(selector)]:this.body.querySelectorAll(selector);}
 querySelector(selector:string){return this.querySelectorAll(selector)[0]??null;}
 hidden=false;
}
/** The fake stands in wherever a module under test takes a Document; it implements only the subset those modules use. */
// lint:allow-unknown-cast FakeDocument is a structural subset of Document, not a Document
const asDocument=(doc:FakeDocument):Document=>doc as unknown as Document;
/** Install the fake as globalThis.document (plus rAF and ResizeObserver). Returns {document, flushFrames, restore}. */
export function installFakeDom(){
 const doc=new FakeDocument(),saved=new Map<string,PropertyDescriptor|undefined>();
 let nextFrame=1;const frames=new Map<number,(t:number)=>void>();
 const set=(key:string,value:unknown)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 set('document',doc);
 set('requestAnimationFrame',(fn:(t:number)=>void)=>{const id=nextFrame++;frames.set(id,fn);live.frames++;return id;});
 set('cancelAnimationFrame',(id:number)=>{if(frames.delete(id))live.frames--;});
 set('ResizeObserver',class{private on=false;constructor(private fn:()=>void){}observe(){if(!this.on){this.on=true;live.observers++;}}unobserve(){}disconnect(){if(this.on){this.on=false;live.observers--;}}trigger(){this.fn();}});
 // The app's keymap listens on the document itself: it is the root every fake event travels through.
 appInput(asDocument(doc));
 return {document:doc,
  /** Run the pending animation frames once, at time `now`. */
  flushFrames(now=performance.now()){const due=[...frames];frames.clear();live.frames-=due.length;for(const [,fn] of due)fn(now);},
  restore(){for(const [key,d] of saved){if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key);}}};
}
/** A key event for dispatchEvent. */
export const keyEvent=(key:string,extra:Record<string,unknown>={})=>({type:'keydown',key,code:key,shiftKey:false,...extra});
