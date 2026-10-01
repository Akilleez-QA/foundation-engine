import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndustryCandidate,prepareIndustryCommand,type IndustrialState,type IndustryBounds} from './industry';
const bounds:IndustryBounds={stock:{containers:8,batches:4,positions:8,changes:8,properties:4},deposits:1,plans:1,machines:1,maxStepTicks:100};
const source=():IndustrialState=>({version:1,stock:{version:1,containers:['a','b','c'].map(id=>({id,maxMassMg:10,maxVolumeUl:10,phases:['solid']})),batches:[{id:'ore',material:'ore',phase:'solid',unit:'g',massMg:1,volumeUl:1,properties:{}}],positions:[{container:'a',batch:'ore',quantity:10}]},deposits:[],plans:[],machines:[]});
const transfer=(from:string,to:string,quantity:number)=>({from,to,batch:'ore',quantity});
test('ordered atomic batch equals sequential transfers including chains/self transfers and keeps source detached',()=>{
 const raw=source(),copy=structuredClone(raw),moves=[transfer('a','b',7),transfer('b','c',4),transfer('c','c',2)];
 const result=prepareIndustryCommand(raw,{kind:'transfer-batch',transfers:moves},bounds);assert.ok(result.ok);
 let sequential=raw;for(const m of moves){const r=prepareIndustryCommand(sequential,{kind:'transfer',...m},bounds);assert.ok(r.ok);sequential=r.state;}
 assert.deepEqual(result.state,sequential);assert.deepEqual(raw,copy);
 result.state.stock.positions[0]!.quantity=999;assert.deepEqual(raw,copy);
});
test('late shortage or intermediate overfill rejects entire batch without a partial candidate mutation',()=>{
 const draft=createIndustryCandidate(source(),bounds),before=draft.snapshot();
 assert.deepEqual(draft.apply({kind:'transfer-batch',transfers:[transfer('a','b',5),transfer('a','c',6)]}),{ok:false,reason:'insufficient'});
 assert.deepEqual(draft.snapshot(),before);
 const small=source();small.stock.containers[1]!.maxMassMg=4;
 assert.deepEqual(prepareIndustryCommand(small,{kind:'transfer-batch',transfers:[transfer('a','b',5),transfer('b','c',5)]},bounds),{ok:false,reason:'capacity'});
 draft.dispose();assert.deepEqual(draft.apply({kind:'transfer-batch',transfers:[]}),{ok:false,reason:'retired'});
});
test('phase/position bounds and existing two-change admission remain enforced',()=>{
 const phase=source();phase.stock.containers[1]!.phases=['gas'];assert.deepEqual(prepareIndustryCommand(phase,{kind:'transfer-batch',transfers:[transfer('a','b',1)]},bounds),{ok:false,reason:'phase'});
 assert.deepEqual(prepareIndustryCommand(source(),{kind:'transfer-batch',transfers:[transfer('a','b',1)]},{...bounds,stock:{...bounds.stock,positions:1}}),{ok:false,reason:'limit'});
 const huge=new Array(5);Object.defineProperty(huge,0,{get(){throw Error('must not read');}});
 const draft=createIndustryCandidate(source(),bounds);assert.deepEqual(draft.apply({kind:'transfer-batch',transfers:huge}),{ok:false,reason:'limit'});
 const input=[transfer('a','b',1)];Object.defineProperty(input,Symbol.iterator,{value(){throw Error('iterator');}});assert.equal(draft.apply({kind:'transfer-batch',transfers:input}).ok,true);
});
test('command capture retirement cannot publish a partially observed batch',()=>{
 const draft=createIndustryCandidate(source(),bounds);const t=transfer('a','b',1);Object.defineProperty(t,'quantity',{get(){draft.dispose();return 1;}});
 assert.deepEqual(draft.apply({kind:'transfer-batch',transfers:[t]}),{ok:false,reason:'retired'});assert.throws(()=>draft.snapshot(),/retired/);
});
test('machine work and installed custody remain protected in batch mode',()=>{
 const s=source();s.stock.containers.push({id:'installed',maxMassMg:10,maxVolumeUl:10,phases:['solid']});
 s.plans=[{id:'plan',inputs:[{batch:'ore',quantity:1}],outputs:[{batch:s.stock.batches[0]!,quantity:1}],workJ:1,maxPowerW:1}];
 s.machines=[{id:'m',plan:'plan',input:'a',output:'b',work:'c',installed:'installed',active:false,powered:false,progressJ:0,completed:0,energyRemainder:0}];
 for(const target of ['c','installed'])assert.deepEqual(prepareIndustryCommand(s,{kind:'transfer-batch',transfers:[transfer('a',target,1)]},bounds),{ok:false,reason:'protected-container'});
});
test('bounded snapshots detach every mutable canonical child and preserve parser shape',()=>{
 const raw=source();raw.deposits=[{id:'site',body:'moon',region:'one',batch:'ore',remaining:20}];
 raw.plans=[{id:'plan',inputs:[{batch:'ore',quantity:1}],outputs:[{batch:raw.stock.batches[0]!,quantity:1}],workJ:1,maxPowerW:1}];
 raw.stock.containers.push({id:'installed',maxMassMg:10,maxVolumeUl:10,phases:['solid']});
 raw.stock.positions[0]!.quantity=9;raw.stock.positions.push({container:'c',batch:'ore',quantity:1});
 raw.machines=[{id:'m',plan:'plan',input:'a',output:'b',work:'c',installed:'installed',active:true,powered:true,progressJ:0,completed:0,energyRemainder:1}];
 const d=createIndustryCandidate(raw,bounds),before=d.snapshot(),a=d.snapshot();
 a.machines[0]!.completed=99;a.machines[0]!.energyRemainder=9;a.stock.positions.find(p=>p.container==='c')!.quantity=5;
 a.stock.batches[0]!.properties.x=1;a.stock.containers[0]!.phases.push('gas');a.stock.positions[0]!.quantity=999;
 a.deposits[0]!.remaining=0;a.plans[0]!.inputs[0]!.quantity=99;a.plans[0]!.outputs[0]!.batch.properties.y=1;
 assert.deepEqual(d.snapshot(),before);assert.equal(Object.getPrototypeOf(before.stock.batches[0]!.properties),null);
});
