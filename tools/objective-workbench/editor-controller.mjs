import {createAuthoredDocument} from '../../src/kits/authoring/document.ts';
import {createAuthoringSession} from '../../src/kits/authoring/session.ts';
import {createStagedObjectives} from '../../src/kits/objectives/stages.ts';
import {captureGraph,initialGraph,graphLimits} from './graph.mjs';
export {graphSectionDefinition,graphStorageKey} from './graph.mjs';
const json=value=>JSON.stringify(value);
/** Creator-owned graph editor. Preview runs cannot access the adopted runtime or its persistence. */
export function createEditorController({saveHandle,readPersisted}){
 if(typeof readPersisted!=='function')throw Error('readPersisted required');
 let graph=initialGraph(),blocked=null,retired=false,busy=false,message='',preview=null,lastRaw,parsedRaw,parsedGraph,terminal;
 const physical=raw=>{if(raw!==parsedRaw){if(typeof raw!=='string'||raw.length>131072)throw Error('graph storage bound');const envelope=JSON.parse(raw);if(envelope.v!==1)throw Error('graph storage version');parsedGraph=captureGraph(envelope.data);parsedRaw=raw;}return parsedGraph;};
 try{const status=saveHandle.status();if(['newer','quarantined','unavailable'].includes(status))throw Error(`recovery-required:${status}`);graph=captureGraph(saveHandle.get());lastRaw=readPersisted();if(lastRaw!==null&&json(physical(lastRaw))!==json(graph))throw Error('external-conflict');if(lastRaw===null&&json(graph)!==json(initialGraph()))throw Error('missing-envelope');}catch(error){blocked=error.message;}
 const document=createAuthoredDocument({id:'objective-graph',json:json(graph),limits:graphLimits,validate:value=>{try{captureGraph(value);return true;}catch{return false;}}});
 const session=createAuthoringSession(document,{maxEntries:16,maxHistoryBytes:524288});
 let expectedHandle=json(graph),writingTarget=null,heldRef,heldJson;
 const handleJson=()=>{const held=saveHandle.get();if(held!==heldRef){heldJson=json(captureGraph(held));heldRef=held;}return heldJson;};
 const stop=()=>{preview=null;};
 const observe=()=>{let saveStatus='unavailable',durable=false;try{saveStatus=saveHandle.status();if(['newer','quarantined','unavailable'].includes(saveStatus))blocked??=`recovery-required:${saveStatus}`;const memory=handleJson();if(memory!==expectedHandle&&memory!==writingTarget)blocked??='external-conflict';const raw=readPersisted();if(raw!==null){const stored=physical(raw);if(raw!==lastRaw&&json(stored)!==expectedHandle&&json(stored)!==writingTarget)blocked??='external-conflict';lastRaw=raw;durable=saveStatus==='saved'&&json(stored)===document.read().json;}else if(lastRaw!==null&&lastRaw!==undefined)blocked??='external-conflict';}catch(error){blocked??=error.message;}return {saveStatus,durable:durable&&!blocked};};
 const read=()=>{if(terminal)return terminal;const persistence=observe(),snapshot=document.read();return Object.freeze({graph:snapshot.value,candidate:session.readPreview()?.value??null,revision:snapshot.ticket.revision,preview:preview?{view:preview.run.view(),definition:preview.graph.definition,graph:preview.graph}:null,history:session.stats(),blocked,retired,message,...persistence});};
 const guard=fn=>{if(retired)return {status:'retired'};if(busy)return {status:'busy'};busy=true;try{observe();if(retired)return {status:'retired'};if(blocked)return {status:'refused',reason:blocked};return fn();}catch(error){message=error.message;return {status:'rejected',reason:message};}finally{busy=false;}};
 const start=()=>{stop();const graph=session.readPreview()?.value??document.read().value;const run=createStagedObjectives({definition:graph.definition,runId:'isolated-preview',maxEventsPerStage:64});preview={graph,run,token:Symbol('preview')};return {status:'started',view:run.view()};};
 return {
  read,
  preview:raw=>guard(()=>{stop();session.cancel();const graph=captureGraph(raw);if(retired)return {status:'retired'};const result=session.preview(document.read().ticket,()=>json(graph));if(result.status==='prepared'){start();message='Provisional graph and runtime only.';}return result;}),
  commit:()=>guard(()=>{stop();const result=session.commit();message=result.status==='accepted'?'Graph committed; adopted run unchanged.':result.status;return result;}),
  cancel:()=>guard(()=>{stop();return session.cancel();}),
  undo:()=>guard(()=>{stop();session.cancel();const result=session.undo();message=`Undo ${result.status}; inspect save status.`;return result;}),
  redo:()=>guard(()=>{stop();session.cancel();const result=session.redo();message=`Redo ${result.status}; inspect save status.`;return result;}),
  startPreview:()=>guard(start),
  stopPreview:()=>guard(()=>{stop();return {status:'stopped'};}),
  captureEvent(eventId,event,amount=1){const captured=guard(()=>{if(!preview)return {status:'refused',reason:'no-preview'};if(typeof eventId!=='string'||!eventId.length||eventId.length>96||typeof event!=='string'||!event.length||event.length>96||!Number.isSafeInteger(amount)||amount<1)throw Error('preview event: invalid');return {owner:preview,ticket:preview.run.ticket(),eventId,event,amount};});if(!captured.owner)return ()=>({status:captured.status,reason:captured.reason});return ()=>guard(()=>{if(preview!==captured.owner)return {status:'stale'};return {status:preview.run.record({...captured.ticket,eventId:captured.eventId,event:captured.event,amount:captured.amount})};});},
  choose:(choice,id)=>guard(()=>{if(!preview)return {status:'refused',reason:'no-preview'};return {status:preview.run.transition({...preview.run.ticket(),choice,id})};}),
  save:()=>guard(()=>{const accepted=document.read();writingTarget=accepted.json;try{saveHandle.update(draft=>{for(const key of Object.keys(draft))delete draft[key];Object.assign(draft,structuredClone(accepted.value));},{now:true});}finally{try{const memory=handleJson();if(memory===writingTarget)expectedHandle=writingTarget;else if(memory!==expectedHandle)blocked??='external-conflict';}finally{writingTarget=null;}}if(retired)return {status:'retired'};const state=observe();message=state.durable?'Authored graph saved; adopted run unchanged.':'Graph remains unsaved.';return {status:state.durable?'saved':'unsaved',...state};}),
  dispose(){if(retired)return;retired=true;stop();session.dispose();document.dispose();terminal=Object.freeze({...read(),retired:true,preview:null,candidate:null});},
 };
}
