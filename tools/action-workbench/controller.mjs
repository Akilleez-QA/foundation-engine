import {createAuthoredDocument} from '../../src/kits/authoring/document.ts';
import {createActionRuns} from '../../src/kits/capabilities/action-runs.ts';
import {createTimedEffects} from '../../src/kits/capabilities/timed-effects.ts';
import {prepareResourceChange} from '../../src/kits/capabilities/resource-values.ts';
import {resolveAction,sweep} from '../../src/kits/combat/index.ts';
const identity=x=>typeof x==='string'&&x.length>0&&x.length<=64;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const defaults=Object.freeze({eligible:ctx=>ctx.target.enabled,hit:ctx=>!!sweep([0,0,0],ctx.target.position,0,[{id:ctx.target.id,from:ctx.target.position,to:ctx.target.position,radius:ctx.target.radius}]),mitigate:amount=>amount});
/** Finite session consumer, not a persistent authority or a generic combat service. */
export function createActionController({targets,policy=defaults}){
 if(typeof targets?.capture!=='function'||typeof targets?.same!=='function')throw Error('target-port');
 const runs=createActionRuns({now:0,maxActions:32}),effects=createTimedEffects({base:{amount:1},now:0,maxEffects:4,maxModifiers:8}),records=new Map();
 const document=createAuthoredDocument({id:'action-results',json:JSON.stringify({resources:{},receipts:[]}),limits:{maxBytes:131072,maxNodes:16384,maxDepth:24},validate:value=>!!value&&Array.isArray(value.receipts)&&value.receipts.length<=32&&Object.values(value.resources).every(n=>finite(n)&&n>=0&&n<=100)});
 let cleaned=false,retired=false,busy=false,inCallback=false,policyRevision=0,currentPolicy,terminal=null;
 const capturePolicy=input=>{const {eligible,hit,mitigate}=input;if([eligible,hit,mitigate].some(fn=>typeof fn!=='function'))throw Error('policy');return Object.freeze({eligible,hit,mitigate});};
 currentPolicy=capturePolicy(policy);
 const refuse=reason=>({status:'refused',reason});
 const guard=(fn,allowCallback=false)=>{if(retired)return refuse('retired');if(busy&&!(allowCallback&&inCallback))return refuse('busy');const oldBusy=busy,oldCallback=inCallback;busy=true;inCallback=false;try{const result=fn();return retired&&result?.status!=='refused'?refuse('retired'):result;}catch(error){return refuse(error.message);}finally{busy=oldBusy;inCallback=oldCallback;if(retired&&!busy)cleanup();}};
 const cleanup=()=>{if(cleaned)return;cleaned=true;runs.cancelOwner('session');effects.cancelAll();terminal=Object.freeze({...terminal,retired:true,actions:Object.freeze([...records.values()].map(row=>Object.freeze({...row.input,...runs.get(row.input.id)}))),effects:effects.snapshot()});records.clear();document.dispose();};
 const read=()=>terminal??Object.freeze({accepted:document.read().value,actions:Object.freeze([...records.values()].map(row=>Object.freeze({...row.input,...runs.get(row.input.id)}))),now:runs.now,policyRevision,effects:effects.snapshot(),retired});
 return {
  read,
  admit:raw=>guard(()=>{const {id,target,amount,readyAt,expiresAt}=raw;if(!identity(id)||!identity(target)||!finite(amount)||amount<0||amount>100||!finite(readyAt)||!finite(expiresAt)||expiresAt<=readyAt)throw Error('input');const input=Object.freeze({id,target,amount,readyAt,expiresAt}),old=records.get(id);if(old)return Object.keys(input).every(k=>input[k]===old.input[k])?{status:'duplicate',action:runs.get(id)}:refuse('conflict');if(records.size>=32)return refuse('capacity');const captured=targets.capture(target);if(!captured||!targets.same(captured))return refuse('target');if(retired)return refuse('retired');const result=runs.admit({id,owner:'session',readyAt,expiresAt});if(result.kind!=='admitted')return refuse(result.kind);records.set(id,{input,target:captured});return {status:'admitted',action:result.action};}),
  resolve:id=>guard(()=>{if(!identity(id))return refuse('identity');const before=document.read(),receipt=before.value.receipts.find(r=>r.id===id);if(receipt)return {status:'duplicate',receipt};const record=records.get(id),action=runs.get(id);if(!record||!action)return refuse('missing');if(action.state!=='ready')return refuse(action.state);const captured=record.target,revision=policyRevision,time=runs.now,selected=currentPolicy;
   const localFresh=()=>!retired&&document.read().ticket===before.ticket&&policyRevision===revision&&runs.now===time&&runs.get(id)===action;
   // Target-port reads can execute creator accessors: recheck local authority after they return.
   const fresh=()=>{if(!localFresh())return false;const matching=targets.same(captured);return matching===true&&localFresh();};
   if(!fresh())return refuse('stale');const multiplier=effects.values().amount,amount=record.input.amount*multiplier;if(!finite(amount)||amount<0)return refuse('amount');
   const context=Object.freeze({target:captured,action:record.input,policyRevision:revision,values:effects.values(),accepted:before.value});
   const invoke=(fn,...args)=>{inCallback=true;let value;try{value=fn(...args);}finally{inCallback=false;}if(!fresh())throw Error('stale');return value;};let accepted=null,reason='rejected';
   resolveAction({id,target:record.input.target,amount},{eligible:()=>invoke(selected.eligible,context),hit:()=>invoke(selected.hit,context),mitigate:n=>invoke(selected.mitigate,n,context),commit:result=>{
    if(!fresh()){reason='stale';return false;}if(!result.allowed||!result.hit){reason=result.allowed?'miss':'ineligible';return false;}
    const old=Object.hasOwn(before.value.resources,result.target)?before.value.resources[result.target]:0,change=prepareResourceChange({version:1,mode:'continuous',min:0,max:100,current:old},{kind:'add',delta:result.applied},{overflow:'reject',rounding:'reject'});if(!change.ok){reason=change.reason;return false;}
    const receipt=freeze({...result,amount:record.input.amount,policyRevision:revision}),next={resources:{...before.value.resources,[result.target]:change.state.current},receipts:[...before.value.receipts,receipt]},proposal=document.prepare(before.ticket,()=>JSON.stringify(next));
    if(proposal.status!=='prepared'){reason=proposal.status;return false;}if(!fresh()){document.discard(proposal.candidate);reason='stale';return false;}const published=document.publish(proposal.candidate);if(published.status!=='accepted'){reason=published.status;return false;}runs.acknowledge(id,action.revision);accepted=receipt;return true;
   }});return accepted?{status:'accepted',receipt:accepted}:refuse(reason);
  }),
  cancel:id=>guard(()=>{if(!identity(id))return refuse('identity');const action=runs.get(id);if(!action)return refuse('missing');const result=runs.cancel(id,action.revision);return {status:result.kind};},true),
  advance:time=>guard(()=>{if(!finite(time)||time<runs.now)throw Error('time');const expired=effects.advance(time);runs.advance(time);if(expired.length)policyRevision++;return {status:'advanced',now:runs.now,expired};},true),
  applyEffect:(input,policy)=>guard(()=>{const result=effects.apply(input,policy);if(result.kind==='applied')policyRevision++;return result;},true),
  cancelEffect:handle=>guard(()=>{const changed=effects.cancel(handle);if(changed)policyRevision++;return {status:changed?'cancelled':'missing'};},true),
  setPolicy:input=>guard(()=>{const next=capturePolicy(input);currentPolicy=next;policyRevision++;return {status:'changed',policyRevision};},true),
  dispose(){if(retired)return;terminal=read();retired=true;terminal=Object.freeze({...terminal,retired:true});if(!busy)cleanup();},
 };
}
