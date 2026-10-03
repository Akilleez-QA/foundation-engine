import {appInput,appLayers} from '../ui/runtime';
import {FOCUS_NEXT,FOCUS_PREV,type ActionHandler,type ActionId} from './actions';
import type {LayerHandle,LayerKind} from '../ui/layers';

/**
 * Escape and Tab for a layer-managed overlay go through the keymap (, ADRs 0020/0044/0047).
 *
 * The app's one dispatcher (`appInput()`) sees every key first, in the capture phase on window. While an overlay's
 * layer is on top, Back (Escape) reaches the layer's `onEscape` through `layers.escape()`, once per press (its
 * autorepeat closes nothing more), and Tab and Shift+Tab reach the overlay's own focus trap, subscribed on its layer.
 * The overlays keep no Escape or Tab listener of their own.
 *
 * The layers are non-modal and cover nothing (as the panel cards are): the overlays already keep focus
 * and pointer input themselves, the frame loop sees no change, and nothing outside the overlay's host turns inert.
 */

/** Where Tab goes from `active` (inside the overlay): an element to focus (the wrap), or null to leave it to native Tab. */
export type TabWrap=(active:Element,list:readonly HTMLElement[],backwards:boolean)=>HTMLElement|null;
/** The panel card's rule: wrap at either end. */
export const wrapAtEnds:TabWrap=(active,list,backwards)=>{
 // Matching an end means the list is non-empty, so the other end exists.
 if(backwards)return active===list[0]?list[list.length-1]!:null;
 return active===list[list.length-1]?list[0]!:null;
};
/** `trapFocus`'s rule (src/input/ui-nav.ts): wrap at either end, or when focus is on nothing in the list. */
export const wrapByIndex:TabWrap=(active,list,backwards)=>{
 const i=list.indexOf(active as HTMLElement);
 if(backwards)return i<=0?list[list.length-1]??null:null;
 return i===list.length-1||i<0?list[0]??null:null;
};

export type TabTrap={
 /** The layer the trap belongs to: its Tab rows are subscribed on that layer only. */
 layer:string;
 element:HTMLElement;
 focusables:(root:HTMLElement)=>HTMLElement[];
 wrap:TabWrap;
 signal:AbortSignal;
};
/**
 * Tab and Shift+Tab inside `element`, through the keymap. At a wrap the trap moves focus and the key is consumed;
 * anywhere else the key is left alone and native Tab moves focus, exactly as the overlay's old keydown listener on
 * `element` did (so with focus outside the overlay, Tab is native too). An overlay with nothing focusable swallows Tab.
 */
export function trapTab(o:TabTrap):void{
 const doc=o.element.ownerDocument,input=appInput(doc);
 const step=(backwards:boolean):ActionHandler=>()=>{
  const active=doc.activeElement;if(!active||!o.element.contains(active))return false;
  const list=o.focusables(o.element);if(!list.length)return true;
  const next=o.wrap(active,list,backwards);if(!next)return false;
  next.focus();return true;
 };
 input.onAction(FOCUS_NEXT,step(false),{layer:o.layer,signal:o.signal});
 input.onAction(FOCUS_PREV,step(true),{layer:o.layer,signal:o.signal});
}

/**
 * Keys this overlay swallows while `when()` holds (the pad countdown's moving keys): each action is consumed on its
 * layer, press, repeat and release, so the mover never sees it. Returning false leaves the key to the page.
 */
export function swallowActions(layer:string,doc:Document,actions:readonly ActionId[],when:()=>boolean,signal:AbortSignal):void{
 const input=appInput(doc);
 for(const action of actions)input.onAction(action,()=>when(),{layer,signal});
}

export type OverlayLayer={
 id:string;
 element:HTMLElement;
 /** Back on this overlay. Return false to leave Escape to the page (a native dialog above it owns it). */
 onEscape:()=>void|boolean;
 /** Released when this aborts: the layer closes and the key subscriptions go. */
 signal:AbortSignal;
 /** The overlay's focus trap. Omitted: Tab is not the overlay's (the pad countdown card never trapped it). */
 focusables?:(root:HTMLElement)=>HTMLElement[];
 wrap?:TabWrap;
 kind?:LayerKind;
};
/**
 * Open a non-modal overlay layer on the app's layers with Back and Tab routed to it through the keymap. It closes
 * when `signal` aborts. Closing or replacing the returned layer also releases its key subscriptions.
 */
export function openOverlayLayer(o:OverlayLayer):LayerHandle{
 // Retain this opening's authored references across callbacks and later caller edits.
 o={...o};
 const doc=o.element.ownerDocument;
 const layer=appLayers(doc).open({id:o.id,kind:o.kind??'panel',element:o.element,cover:'none',modal:false,onEscape:o.onEscape});
 if(layer.closed)return layer;
 const close=()=>layer.close('program');
 const detach=()=>o.signal.removeEventListener('abort',close);
 layer.signal.addEventListener('abort',detach,{once:true});
 o.signal.addEventListener('abort',close,{once:true});
 // Admission can invoke callbacks that abort the caller before the bridge exists.
 if(o.signal.aborted)close();
 if(o.focusables)trapTab({layer:o.id,element:o.element,focusables:o.focusables,wrap:o.wrap??wrapByIndex,signal:layer.signal});
 return layer;
}

/**
 * A native modal dialog is open outside `element` (Sound, Comfort, the guide, the travel map): Escape is that
 * dialog's own, so an overlay under it declines Back (the panel shell's rule).
 */
export function modalDialogAbove(element:HTMLElement):boolean{
 return Array.from(element.ownerDocument.querySelectorAll<HTMLDialogElement>('dialog:modal')).some(d=>!d.contains(element));
}
