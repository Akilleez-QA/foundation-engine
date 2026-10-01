import {createAuthoredDocument} from '../../src/kits/authoring/document.ts';
import {createStagedObjectives} from '../../src/kits/objectives/stages.ts';
import {createInventoryLedger} from '../../src/kits/inventory/ledger.ts';
import {createCapabilities} from '../../src/kits/capabilities/pure.ts';
import {captureGraph,initialGraph,outcomeFor,graphLimits} from './graph.mjs';
import {createRelatedWork,createWorkSource} from './related-work.mjs';
export const runtimeStorageKey='objective-workbench|device|objective.runtime';
const inventoryOptions={capacities:{awards:8},maxOperations:65};
const blocker={id:'blocker',material:'blocker',properties:{}};
const equal=(a,b)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const ak=Reflect.ownKeys(a),bk=Reflect.ownKeys(b);return ak.length===bk.length&&ak.every(k=>bk.includes(k)&&equal(a[k],b[k]));};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function fields(v,keys){if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid');const own=Reflect.ownKeys(v);if(own.length!==keys.length||own.some(k=>!keys.includes(k)))throw Error('invalid');return v;}
function id(v){if(typeof v!=='string'||!v.length||v.length>96)throw Error('identity');return v;}
function ordinal(v){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('ordinal');return v;}
function consumer(v){if(v!=='left'&&v!=='right')throw Error('consumer');return v;}
const options=(adoption,name)=>({definition:adoption.graph.definition,runId:`run-${adoption.serial}-${name}`,maxEventsPerStage:64});
function adoption(serial,graph){const a={serial,graph,runs:{}};for(const name of ['left','right'])a.runs[name]=createStagedObjectives(options(a,name)).snapshot();return a;}
export function initialRuntimeEnvelope(){const inventory=createInventoryLedger(inventoryOptions);inventory.transact('seed',[],[{container:'awards',batch:blocker,quantity:8}]);return {version:1,revision:0,adoptions:[adoption(0,initialGraph())],inventory:inventory.snapshot(),capabilities:createCapabilities([]).snapshot(),consequences:[],receipts:[]};}
function capture(raw){const c=fields(raw,['id','payload']),key=id(c.id),p=c.payload,kind=p?.kind;let payload;
 if(kind==='adopt'){fields(p,['kind','graph']);payload={kind,graph:captureGraph(p.graph)};}
 else if(kind==='free'){fields(p,['kind']);payload={kind};}
 else if(kind==='choose'){fields(p,['kind','adoption','consumer','stage','incarnation','choice']);payload={kind,adoption:ordinal(p.adoption),consumer:consumer(p.consumer),stage:id(p.stage),incarnation:ordinal(p.incarnation),choice:id(p.choice)};}
 else if(kind==='cancel-run'){fields(p,['kind','adoption','consumer']);payload={kind,adoption:ordinal(p.adoption),consumer:consumer(p.consumer)};}
 else if(kind==='record'){fields(p,['kind','adoption','consumer','stage','incarnation','eventId','event','amount']);payload={kind,adoption:ordinal(p.adoption),consumer:consumer(p.consumer),stage:id(p.stage),incarnation:ordinal(p.incarnation),eventId:id(p.eventId),event:id(p.event),amount:ordinal(p.amount)};if(!payload.amount)throw Error('amount');}
 else throw Error('kind');return freeze({id:key,payload});
}
function capabilityState(consequences){const labels=[...new Set(consequences.map(c=>c.capability))];const owner=createCapabilities(labels.map(label=>({id:label,requires:[],evidence:[label]})));for(const row of consequences){owner.record(row.capability);owner.grant({capability:row.capability,reason:'earned',event:row.id});}return owner.snapshot();}
function transition(value,c){const previous=value.receipts.find(r=>r.id===c.id);if(previous){if(!equal(previous,c))throw Error('conflict');return null;}if(value.receipts.length>=64)throw Error('receipt-capacity');const next=structuredClone(value),p=c.payload,a=next.adoptions.at(-1),stock=createInventoryLedger(inventoryOptions,next.inventory);
 if(p.kind==='adopt'){if(next.adoptions.length>=16)throw Error('adoption-capacity');next.adoptions.push(adoption(a.serial+1,p.graph));}
 else if(p.kind==='free'){const quantity=stock.quantity('awards','blocker');if(!quantity)throw Error('already-free');const result=stock.transact(`operation:${c.id}`,[{container:'awards',batchId:'blocker',quantity}],[]);if(!result.ok)throw Error(result.reason);}
 else{
  if(p.adoption!==a.serial)throw Error('stale');const run=createStagedObjectives(options(a,p.consumer),a.runs[p.consumer]);
  if(p.kind==='record'){const result=run.record({...run.ticket(),stage:p.stage,incarnation:p.incarnation,eventId:p.eventId,event:p.event,amount:p.amount});if(result!=='accepted')throw Error(result);}
  else if(p.kind==='cancel-run'){if(!run.cancel())throw Error('terminal');}
  else{const result=run.transition({...run.ticket(),stage:p.stage,incarnation:p.incarnation,id:c.id,choice:p.choice});if(result!=='accepted')throw Error(result);
   const outcome=outcomeFor(a.graph,p.stage,p.choice);if(outcome){const consequence={id:`award:${a.serial}:${p.consumer}`,adoption:a.serial,consumer:p.consumer,stage:p.stage,choice:p.choice,units:outcome.units,capability:outcome.capability};
    if(next.consequences.some(r=>r.id===consequence.id))throw Error('duplicate-award');if(outcome.units){const result=stock.transact(consequence.id,[],[{container:'awards',batch:{id:consequence.id,material:'authored-award',properties:{units:outcome.units}},quantity:outcome.units}]);if(!result.ok)throw Error(result.reason);}next.consequences.push(consequence);next.capabilities=capabilityState(next.consequences);
   }
  }a.runs[p.consumer]=run.snapshot();
 }
 next.inventory=stock.snapshot();next.receipts.push(c);next.revision++;return next;
}
export function parseRuntimeEnvelope(raw){const r=fields(raw,['version','revision','adoptions','inventory','capabilities','consequences','receipts']);if(r.version!==1||!Array.isArray(r.receipts))throw Error('envelope');const count=r.receipts.length;if(!Number.isSafeInteger(count)||count>64)throw Error('receipt-capacity');let expected=initialRuntimeEnvelope();for(let i=0;i<count;i++){const next=transition(expected,capture(r.receipts[i]));if(!next)throw Error('duplicate-receipt');expected=next;}if(!equal(r,expected))throw Error('incoherent-envelope');return expected;}
export const runtimeSectionDefinition={id:'objective.runtime',scope:'device',version:1,maxChars:131072,initial:initialRuntimeEnvelope,parse:parseRuntimeEnvelope};
/** Sample single-writer guard. The synchronous compare/write is not cross-process atomic CAS. */
export function createRuntimeStoragePort(port){
 let seen=false,expected=null;
 const check=()=>{if(!seen||port.get(runtimeStorageKey)!==expected)throw Error('external-conflict');};
 return {kind:port.kind,get(key){const raw=port.get(key);if(key===runtimeStorageKey){if(!seen){seen=true;expected=raw;}else if(raw!==expected)throw Error('external-conflict');}return raw;},set(key,value){if(key===runtimeStorageKey){check();port.set(key,value);expected=value;}else port.set(key,value);},remove(key){if(key===runtimeStorageKey){check();port.remove(key);expected=null;}else port.remove(key);},keys:()=>port.keys(),...(port.subscribe?{subscribe:fn=>port.subscribe(fn)}:{})};
}function project(value){const a=value.adoptions.at(-1),stock=createInventoryLedger(inventoryOptions,value.inventory);return freeze({adoption:a.serial,graph:a.graph,runs:['left','right'].map(id=>({id,...createStagedObjectives(options(a,id),a.runs[id]).view()})),units:value.consequences.reduce((n,r)=>n+r.units,0),blocker:stock.quantity('awards','blocker'),capabilities:value.capabilities.grants.map(g=>g.capability)});}
export function createRuntimeController({saveHandle,readPersisted,saveBuild,source:createSource=createWorkSource}){
 if(typeof readPersisted!=='function'||typeof createSource!=='function')throw Error('ports');
 // This finite consumer requires the same build string as its SaveStore and no legacy envelope metadata.
 if(typeof saveBuild!=='string'||!saveBuild.length||saveBuild.length>256)throw Error('save-build');
 let blocked=null,retired=false,busy=false,pending=null,terminal=null,message='Adopt explicitly; accepted runs retain their definition.',starting=initialRuntimeEnvelope(),lastRaw;
 try{const status=saveHandle.status();if(['quarantined','newer','unavailable'].includes(status))throw Error(`recovery-required:${status}`);starting=parseRuntimeEnvelope(saveHandle.get());lastRaw=readPersisted();}catch(error){blocked=error.message;}
 const document=createAuthoredDocument({id:'objective-runtime',json:JSON.stringify(starting),limits:graphLimits,validate:v=>{try{parseRuntimeEnvelope(v);return true;}catch{return false;}}});
 const candidates=new WeakSet();let projectedValue,projectedView,parsedRaw,parsedValue;
 const physical=raw=>{if(raw!==parsedRaw){if(typeof raw!=='string'||raw.length>131072)throw Error('invalid-storage');const wrapper=JSON.parse(raw);if(wrapper.v!==1)throw Error('version');parsedValue=parseRuntimeEnvelope(wrapper.data);parsedRaw=raw;}return parsedValue;};
 try{if(lastRaw!==null&&lastRaw!==undefined&&!equal(physical(lastRaw),starting))blocked??='external-conflict';else if(lastRaw===null&&!equal(starting,initialRuntimeEnvelope()))blocked??='external-conflict';}catch(error){blocked??=error.message;}
 let lifetime={},source=createSource(),work=createRelatedWork(source);const workers=new Map(),sourceTickets=new Map();
 const observe=()=>{let saveStatus='unavailable',durable=false,canAcknowledge=false;try{saveStatus=saveHandle.status();if(['quarantined','newer','unavailable'].includes(saveStatus))blocked??=`recovery-required:${saveStatus}`;const accepted=document.read().value,expected=pending?.value??accepted;if(!equal(saveHandle.get(),expected))blocked??='external-conflict';const raw=readPersisted();if(raw!==null){const stored=physical(raw),matches=equal(stored,expected);if(raw!==lastRaw&&!matches)blocked??='external-conflict';durable=saveStatus==='saved'&&equal(stored,accepted);canAcknowledge=!!pending&&saveStatus==='saved'&&matches;if(matches)lastRaw=raw;}else if(lastRaw!==null&&lastRaw!==undefined)blocked??='external-conflict';}catch(error){blocked??=`recovery-required:${error.message}`;}return {saveStatus,durable,canAcknowledge:canAcknowledge&&!blocked};};
 const read=()=>{if(terminal)return terminal;const persistence=observe(),envelope=document.read().value;if(envelope!==projectedValue){projectedView=project(envelope);projectedValue=envelope;}return Object.freeze({envelope,view:projectedView,...persistence,pending:!!pending,blocked,retired,message,work:work.stats()});};
 const guard=fn=>{if(retired)return {status:'refused',reason:'retired'};if(busy)return {status:'refused',reason:'busy'};busy=true;try{observe();if(blocked)return {status:'refused',reason:blocked};return fn();}catch(error){message=error.message;return {status:'refused',reason:error.message};}finally{busy=false;}};
 const write=()=>{try{saveHandle.update(draft=>{for(const key of Object.keys(draft))delete draft[key];Object.assign(draft,structuredClone(pending.value));},{now:true});}catch(error){message=error.message;}return {status:'pending',canAcknowledge:observe().canAcknowledge};};
 const prepare=c=>{if(pending)return {status:'refused',reason:'pending'};const before=document.read(),next=transition(before.value,c);if(!next)return {status:'duplicate'};if(JSON.stringify({v:runtimeSectionDefinition.version,by:saveBuild,data:next}).length>runtimeSectionDefinition.maxChars)return {status:'refused',reason:'storage-capacity'};const result=document.prepare(before.ticket,()=>JSON.stringify(next));if(result.status==='prepared')candidates.add(result.candidate);return result;};
 const release=name=>{const entry=workers.get(name);if(!entry)return false;workers.delete(name);entry.active=false;if(entry.lease)work.release(entry.lease);return true;};
 const reset=()=>{lifetime={};for(const entry of workers.values())entry.active=false;workers.clear();sourceTickets.clear();try{work.close();}catch(error){message=`Work cleanup failed after authority retirement: ${error.message}`;}source=createSource();work=createRelatedWork(source);};
 const reconcileOwners=()=>{const a=document.read().value.adoptions.at(-1);for(const [name,entry] of workers){const view=createStagedObjectives(options(a,name),a.runs[name]).view();if(entry.adoption!==a.serial||view.status!=='active'||entry.stage!==view.stage||entry.incarnation!==view.incarnation)release(name);}};
 const publicCommand=raw=>{fields(raw,['id','payload']);const key=id(raw.id),p=raw.payload;if(p?.kind==='record')throw Error('internal-record');if(p?.kind==='choose'||p?.kind==='cancel-run'){const name=consumer(p.consumer),required=p.kind==='choose'?['kind','consumer','choice']:['kind','consumer'];fields(p,required);const previous=document.read().value.receipts.find(r=>r.id===key);if(previous){if(previous.payload.kind!==p.kind||previous.payload.consumer!==name||(p.kind==='choose'&&previous.payload.choice!==id(p.choice)))throw Error('conflict');return previous;}const a=document.read().value.adoptions.at(-1),ticket=createStagedObjectives(options(a,name),a.runs[name]).ticket();return capture({id:key,payload:{...p,adoption:a.serial,...(p.kind==='choose'?{stage:ticket.stage,incarnation:ticket.incarnation}:{})}});}return capture(raw);};
 return {
  read,
  preview:raw=>guard(()=>prepare(publicCommand(raw))),
  commit:candidate=>guard(()=>{if(pending)return {status:'refused',reason:'pending'};if(!candidates.has(candidate)||candidate.ticket!==document.read().ticket)return {status:'stale'};pending=candidate;return write();}),
  cancel:candidate=>guard(()=>{if(pending)return {status:'refused',reason:'pending'};if(!candidates.has(candidate))return {status:'stale'};candidates.delete(candidate);document.discard(candidate);return {status:'cancelled'};}),
  retry:()=>guard(()=>pending?write():{status:'refused',reason:'no-pending'}),
  acknowledge:()=>guard(()=>{if(!pending)return {status:'refused',reason:'no-pending'};if(!observe().canAcknowledge)return {status:'refused',reason:'not-durable'};const oldSerial=document.read().value.adoptions.at(-1).serial,result=document.publish(pending);if(result.status==='accepted'){candidates.delete(pending);pending=null;if(document.read().value.adoptions.at(-1).serial!==oldSerial)reset();else reconcileOwners();}return {status:result.status};}),
  acquireWork:name=>{const outcome=guard(()=>{consumer(name);if(pending)return {status:'refused',reason:'pending'};if(workers.has(name))return {status:'refused',reason:'active'};const a=document.read().value.adoptions.at(-1),run=createStagedObjectives(options(a,name),a.runs[name]),view=run.view();if(view.status!=='active'||view.ready)return {status:'refused',reason:'terminal'};const prior=sourceTickets.get(name);if(prior&&(prior.adoption!==a.serial||prior.stage!==view.stage||prior.incarnation!==view.incarnation))return {status:'refused',reason:'reset-required'};const ownerLifetime=lifetime,entry={active:true,lease:null,adoption:a.serial,stage:view.stage,incarnation:view.incarnation};
   entry.receive=raw=>{if(retired||!entry.active||lifetime!==ownerLifetime||workers.get(name)!==entry)return false;const result=guard(()=>{if(pending)return {status:'refused',reason:'pending'};const eventId=id(raw.id),event=id(raw.event),amount=ordinal(raw.amount),c=capture({id:`work:${a.serial}:${name}:${view.incarnation}:${eventId}`,payload:{kind:'record',adoption:a.serial,consumer:name,stage:view.stage,incarnation:view.incarnation,eventId,event,amount}});const proposal=prepare(c);if(proposal.status==='duplicate')return proposal;if(proposal.status!=='prepared')return proposal;pending=proposal.candidate;return write();});return result.status==='duplicate';};
   workers.set(name,entry);const result=work.acquire(entry.receive);if(result.status!=='admitted'){workers.delete(name);entry.active=false;return result;}entry.lease=result.lease;sourceTickets.set(name,{adoption:a.serial,stage:view.stage,incarnation:view.incarnation});return {status:'admitted'};
  });if(outcome.status==='admitted')work.reconcile();return outcome;},
  releaseWork:name=>guard(()=>({status:release(consumer(name))?'released':'missing'})),
  captureWork:name=>workers.get(name)?.receive??(()=>false),
  emitWork:raw=>{if(retired||blocked||busy)return {status:'refused',reason:retired?'retired':blocked??'busy'};return source.emit(raw);},
  reconcileWork:()=>{if(retired)return {status:'refused',reason:'retired'};return work.reconcile();},
  resetWork:()=>guard(()=>{if(pending||workers.size)return {status:'refused',reason:pending?'pending':'active'};reset();return {status:'reset'};}),
  dispose(){if(retired)return;if(busy)throw Error('busy');terminal=read();retired=true;lifetime={};for(const entry of workers.values())entry.active=false;workers.clear();document.dispose();try{work.close();}finally{terminal=freeze({...terminal,retired:true,work:work.stats()});}},
 };
}
