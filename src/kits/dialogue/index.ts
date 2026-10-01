import { defineKit } from '../../author';
export interface DialogueOption { id: string; text: string; to: string | null; requires?: readonly string[]; effects?: readonly string[] }
export interface DialogueNode { id: string; text: string; options: readonly DialogueOption[] }
export interface DialogueDefinition { id: string; start: string; nodes: readonly DialogueNode[] }
export interface DialogueState { definition: string; session: string; node: string | null; revision: number }
/** String fields are localization keys. Effects are intents for the game's authoritative reducer. */
export function createDialogue(definition: DialogueDefinition, session: string, restored?: DialogueState) {
  const validId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256;
  const d = structuredClone(definition), nodes = new Map(d.nodes.map(n => [n.id, n]));
  if (!validId(d.id) || !validId(session) || nodes.size !== d.nodes.length || !nodes.has(d.start) || nodes.size > 1024) throw Error('dialogue: invalid definition');
  for (const n of d.nodes) {
    if (!validId(n.id) || !validId(n.text) || n.options.length > 32 || new Set(n.options.map(o=>o.id)).size !== n.options.length) throw Error('dialogue: invalid node');
    for (const o of n.options) if (!validId(o.id) || !validId(o.text) || (o.to !== null && !nodes.has(o.to)) || (o.requires ?? []).length>1024 || (o.effects ?? []).length>1024 || (o.requires ?? []).some(x=>!validId(x)) || (o.effects ?? []).some(x=>!validId(x))) throw Error('dialogue: invalid option');
  }
  // Every node must have an authored route to an exit, independently of runtime fact availability.
  const exits = new Set(d.nodes.filter(n=>n.options.some(o=>o.to===null) || !n.options.length).map(n=>n.id));
  for (let changed = true; changed;) { changed=false; for (const n of d.nodes) if (!exits.has(n.id) && n.options.some(o=>o.to!==null && exits.has(o.to))) {exits.add(n.id);changed=true;} }
  if (exits.size !== nodes.size) throw Error('dialogue: graph has no exit');
  let state: DialogueState = restored ? structuredClone(restored) : {definition:d.id,session,node:d.start,revision:0};
  if (state.definition!==d.id || state.session!==session || (state.node!==null&&!nodes.has(state.node)) || !Number.isSafeInteger(state.revision) || state.revision<0) throw Error('dialogue: invalid snapshot');
  const allowed = (o: DialogueOption, facts: ReadonlySet<string>) => (o.requires??[]).every(f=>facts.has(f));
  return {
    snapshot: (): DialogueState => structuredClone(state),
    view(facts: ReadonlySet<string>) {
      if (state.node===null) return null;
      const n=nodes.get(state.node)!;
      return {session,revision:state.revision,node:n.id,text:n.text,options:n.options.filter(o=>allowed(o,facts)).map(o=>({id:o.id,text:o.text}))};
    },
    choose(request: {session:string;revision:number;node:string;option:string}, facts: ReadonlySet<string>): {status:'applied';effects:string[]}|{status:'stale'|'unavailable'|'closed'} {
      if (state.node===null) return {status:'closed'};
      if (request.session!==session || request.revision!==state.revision || request.node!==state.node) return {status:'stale'};
      const before=state;
      const o=nodes.get(state.node)!.options.find(o=>o.id===request.option);
      if (!o || !allowed(o,facts)) return {status:'unavailable'};
      if(state!==before)return {status:state.node===null?'closed':'stale'};
      if (state.revision===Number.MAX_SAFE_INTEGER) throw Error('dialogue: revision exhausted');
      state={...state,node:o.to,revision:state.revision+1};
      return {status:'applied',effects:[...o.effects??[]]};
    },
    close() { if(state.node!==null){ if(state.revision===Number.MAX_SAFE_INTEGER) throw Error('dialogue: revision exhausted'); state={...state,node:null,revision:state.revision+1}; } },
  };
}
export const dialogue = () => defineKit({id:'dialogue'});
