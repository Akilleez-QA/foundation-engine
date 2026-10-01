import {createStagedObjectives} from '../../src/kits/objectives/stages.ts';
export const graphLimits=Object.freeze({maxBytes:131072,maxNodes:16384,maxDepth:24});
export const graphStorageKey='objective-workbench|device|objectives.graph';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function fail(path,message){throw Error(`${path}: ${message}`);}
function fields(value,keys,path){if(!value||typeof value!=='object'||Array.isArray(value))fail(path,'expected record');const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(k=>!keys.includes(k)))fail(path,'unexpected or missing fields');return value;}
function name(value,path,max=96){if(typeof value!=='string'||!value.length||value.length>max)fail(path,'invalid identity');return value;}
function number(value,path,max=Number.MAX_SAFE_INTEGER,min=0){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail(path,'invalid integer');return value;}
function list(value,max,path,capture){if(!Array.isArray(value))fail(path,'expected array');const length=value.length;if(!Number.isSafeInteger(length)||length<1||length>max)fail(path,'array bound');const result=[];for(let i=0;i<length;i++)result.push(capture(value[i],`${path}[${i}]`));return result;}
/** Finite creator schema for this optional tool, not engine reward or graph policy. */
export function captureGraph(raw){
 if(typeof raw==='string'){if(raw.length>graphLimits.maxBytes||new TextEncoder().encode(raw).length>graphLimits.maxBytes)fail('graph','byte limit');try{raw=JSON.parse(raw);}catch(error){fail('graph',error.message);}}
 const r=fields(raw,['version','definition','outcomes'],'graph');if(r.version!==1)fail('graph.version','unsupported version');
 const d=fields(r.definition,['id','revision','start','stages'],'definition');
 const definition={id:name(d.id,'definition.id'),revision:number(d.revision,'definition.revision'),start:name(d.start,'definition.start'),stages:list(d.stages,64,'definition.stages',(raw,path)=>{
  const s=fields(raw,['id','requirements','choices'],path);return {id:name(s.id,`${path}.id`),requirements:list(s.requirements,64,`${path}.requirements`,(raw,p)=>{const q=fields(raw,['id','event','target'],p);return {id:name(q.id,`${p}.id`),event:name(q.event,`${p}.event`),target:number(q.target,`${p}.target`,Number.MAX_SAFE_INTEGER,1)};}),choices:list(s.choices,16,`${path}.choices`,(raw,p)=>{const q=fields(raw,['id','to'],p),to=q.to;return {id:name(q.id,`${p}.id`),to:to===null?null:name(to,`${p}.to`)};})};
 })};
 const stages=new Map();for(const s of definition.stages){if(stages.has(s.id))fail(`stage.${s.id}`,'duplicate stage');stages.set(s.id,s);}
 if(!stages.has(definition.start))fail('definition.start','unknown stage');
 for(const s of definition.stages){const choices=new Set();for(const c of s.choices){if(choices.has(c.id))fail(`stage.${s.id}.choice.${c.id}`,'duplicate choice');choices.add(c.id);if(c.to!==null&&!stages.has(c.to))fail(`stage.${s.id}.choice.${c.id}.to`,'unknown destination');}}
 try{createStagedObjectives({definition,runId:'graph-validation',maxEventsPerStage:64});}catch(error){fail('definition.stages',error.message);}
 const outcomes=list(r.outcomes,1024,'outcomes',(raw,p)=>{const o=fields(raw,['stage','choice','units','capability'],p);return {stage:name(o.stage,`${p}.stage`),choice:name(o.choice,`${p}.choice`),units:number(o.units,`${p}.units`,8),capability:name(o.capability,`${p}.capability`,64)};});
 const seen=new Set();for(const o of outcomes){const key=JSON.stringify([o.stage,o.choice]);if(seen.has(key))fail('outcomes','duplicate terminal outcome');seen.add(key);const c=stages.get(o.stage)?.choices.find(c=>c.id===o.choice);if(!c||c.to!==null)fail(`outcomes.${o.stage}.${o.choice}`,'not a terminal edge');}
 for(const s of definition.stages)for(const c of s.choices)if(c.to===null&&!seen.has(JSON.stringify([s.id,c.id])))fail(`outcomes.${s.id}.${c.id}`,'missing terminal outcome');
 const result={version:1,definition,outcomes},json=JSON.stringify(result);if(new TextEncoder().encode(json).length>graphLimits.maxBytes)fail('graph','byte limit');
 let nodes=0;const pending=[{v:result,depth:0}];while(pending.length){const {v,depth}=pending.pop();if(++nodes>graphLimits.maxNodes||depth>graphLimits.maxDepth)fail('graph','structure limit');if(v&&typeof v==='object')for(const child of Object.values(v))pending.push({v:child,depth:depth+1});}
 return freeze(result);
}
export function initialGraph(){return captureGraph({version:1,definition:{id:'authored-route',revision:1,start:'prepare',stages:[{id:'prepare',requirements:[{id:'work',event:'work',target:1}],choices:[{id:'short',to:null},{id:'continue',to:'confirm'}]},{id:'confirm',requirements:[{id:'work',event:'work',target:1}],choices:[{id:'finish',to:null}]}]},outcomes:[{stage:'prepare',choice:'short',units:1,capability:'route-short'},{stage:'confirm',choice:'finish',units:2,capability:'route-long'}]});}
export function outcomeFor(graph,stage,choice){return graph.outcomes.find(o=>o.stage===stage&&o.choice===choice)??null;}
export const graphSectionDefinition={id:'objectives.graph',scope:'device',version:1,maxChars:131072,initial:initialGraph,parse:captureGraph};
/** Optional sample single-writer guard, including SaveStore's autonomous flushes; not atomic CAS. */
export function createGraphStoragePort(port){
 let seen=false,expected=null;
 const check=()=>{if(!seen||port.get(graphStorageKey)!==expected)throw Error('graph external-conflict');};
 return {kind:port.kind,get(key){const raw=port.get(key);if(key===graphStorageKey){if(!seen){seen=true;expected=raw;}else if(raw!==expected)throw Error('graph external-conflict');}return raw;},set(key,value){if(key===graphStorageKey){check();port.set(key,value);expected=value;}else port.set(key,value);},remove(key){if(key===graphStorageKey){check();port.remove(key);expected=null;}else port.remove(key);},keys:()=>port.keys(),...(port.subscribe?{subscribe:fn=>port.subscribe(fn)}:{})};
}
