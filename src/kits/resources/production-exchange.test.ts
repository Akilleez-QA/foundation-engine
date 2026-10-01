import test from 'node:test';
import assert from 'node:assert/strict';
import {createProduction, type ProductionOptions, type ProductionCommand, type ProductionSnapshot} from './production';
import {createInventoryLedger} from '../inventory';
import {createEquipment, type EquipmentSnapshot, type ItemInstance} from '../equipment';
import {createAuthoredDocument, type DocumentValue} from '../authoring/document';
import {createSaveStore} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';
import type {SaveSection} from '../../core/save/section';

const ore = {id:'ore', material:'raw', properties:{grade:2}};
const plate = {id:'plate', material:'formed', properties:{grade:2}};
function config(maxCommands=16): ProductionOptions {
  const stock=createInventoryLedger({capacities:{input:10,output:2}});
  stock.transact('seed',[],[{container:'input',batch:ore,quantity:4}]);
  return {capacities:{input:10,output:2},initialInventory:stock.snapshot(),deposits:[],maxCommands,
    recipes:[{id:'shape',inputs:[{batchId:'ore',quantity:2}],output:{batch:plate,quantity:1}}],
    jobs:[{id:'press',kind:'factory',recipeId:'shape',inputContainer:'input',outputContainer:'output',startTick:0,periodTicks:1,powered:true,limit:2}]};
}
const craft: ProductionCommand={kind:'advance',id:'craft',jobId:'press',toTick:1,maxTicks:1,maxCycles:1};
const withdraw=(id='delivery'): Extract<ProductionCommand,{kind:'exchange'}> => ({kind:'exchange',id,consume:[{container:'output',batchId:'plate',quantity:1}],produce:[]});

test('production exchange is replayable and preserves clocks/reserves across withdrawal and checkpoints',()=>{
  const options=config(), model=createProduction(options);
  assert.equal(model.apply(craft,0).ok,true);
  const before=model.snapshot();
  assert.deepEqual(model.apply(withdraw(),0),{ok:true,duplicate:false,throughTick:null,produced:0,pending:false});
  assert.equal(model.quantity('output','plate'),0);
  assert.deepEqual(model.snapshot().jobs,before.jobs);assert.deepEqual(model.snapshot().remaining,before.remaining);
  const restored=createProduction(options,model.snapshot());
  assert.deepEqual(restored.apply(withdraw(),0),{ok:true,duplicate:true,throughTick:null,produced:0,pending:false});
  assert.deepEqual(restored.apply({...withdraw(),consume:[]},0),{ok:false,reason:'conflict'});
  const beforeFailure=restored.snapshot();
  assert.deepEqual(restored.apply(withdraw('empty'),0),{ok:false,reason:'insufficient'});
  assert.deepEqual(restored.snapshot(),beforeFailure);
  restored.checkpoint();const after=createProduction(options,restored.snapshot());
  assert.deepEqual(after.apply(withdraw(),0),{ok:false,reason:'stale-epoch'});
  assert.equal(after.quantity('output','plate'),0);
});

test('imported batches count toward later production capacity even after checkpoint restoration',()=>{
  const options=config(), model=createProduction(options);
  const foreign={id:'imported',material:'other',properties:{grade:7}};
  assert.equal(model.apply({kind:'exchange',id:'import',consume:[],produce:[{container:'output',batch:foreign,quantity:2}]},0).ok,true);
  model.checkpoint();const restored=createProduction(options,model.snapshot());
  const result=restored.apply(craft,1);assert.ok(result.ok);assert.equal(result.produced,0);
  assert.equal(restored.quantity('input','ore'),4);
  assert.equal(restored.apply({kind:'exchange',id:'remove-import',consume:[{container:'output',batchId:'imported',quantity:2}],produce:[]},1).ok,true);
  const next=restored.apply({...craft,id:'next',toTick:2},1);assert.ok(next.ok);assert.equal(next.produced,1);
  assert.equal(createProduction(options,restored.snapshot()).quantity('output','plate'),1);
});

test('exchange limits and caller capture cannot mutate accepted state or evade bounds',()=>{
  const model=createProduction(config());model.apply(craft,0);const before=model.snapshot();
  const rows=withdraw().consume as {container:string;batchId:string;quantity:number}[];
  rows.map=()=>{throw Error('caller method');};rows[Symbol.iterator]=()=>{throw Error('caller iterator');};
  assert.equal(model.apply({...withdraw(),consume:rows},0).ok,true);
  rows[0]!.quantity=99;assert.equal(model.snapshot().commands[1]!.kind,'exchange');
  const huge=new Proxy([], {get(target,key,receiver){if(key==='length')return 65;if(key==='0')throw Error('unbounded read');return Reflect.get(target,key,receiver);}});
  assert.throws(()=>model.apply({...withdraw('huge'),consume:huge},0),/row limit/);
  const fractional=new Proxy([], {get(target,key,receiver){if(key==='length')return .5;return Reflect.get(target,key,receiver);}});
  assert.throws(()=>model.apply({...withdraw('fractional'),consume:fractional},0),/row limit/);
  const snapshot=model.snapshot();
  assert.throws(()=>model.apply({...withdraw('getter'),get consume(){model.checkpoint();return [];}},0),/reentrant/);
  assert.deepEqual(model.snapshot(),snapshot);
  assert.throws(()=>model.apply({kind:'exchange',id:'properties',consume:[],produce:[{container:'input',quantity:1,batch:{...ore,properties:Object.fromEntries(Array.from({length:65},(_,i)=>[String(i),1]))}}]},0),/property limit/);
  assert.deepEqual(model.snapshot(),snapshot);
  const corrupt=structuredClone(before);corrupt.inventory.operations=[];
  assert.throws(()=>createProduction(config(),corrupt),/state does not match history/);
});

test('exchange shares command saturation and rejects seed operation identity collisions',()=>{
  const model=createProduction(config(1));
  assert.equal(model.apply(craft,0).ok,true);
  assert.deepEqual(model.apply(withdraw(),0),{ok:false,reason:'checkpoint-required'});
  model.checkpoint();assert.equal(model.apply(withdraw(),1).ok,true);
  const fresh=createProduction(config());
  assert.deepEqual(fresh.apply({kind:'exchange',id:'seed',consume:[],produce:[{container:'input',batch:ore,quantity:4}]},0),{ok:false,reason:'conflict'});
});

interface Receipt {id:string;signature:string;item:ItemInstance}
interface Envelope {production:ProductionSnapshot;equipment:EquipmentSnapshot;receipts:Receipt[]}
const item=():ItemInstance=>({id:'tool-1',definition:'authored-tool-v1',slots:['hand'],functional:true});
const gear=(saved:EquipmentSnapshot)=>createEquipment(['hand'],1,saved);
function initial(options:ProductionOptions):Envelope {
  const model=createProduction(options);model.apply(craft,0);
  return {production:model.snapshot(),equipment:gear({revision:0,items:[],equipped:[]}).snapshot(),receipts:[]};
}

// Creator-owned consumer: a single bounded pending document and existing SaveStore envelope.
function consumer(options:ProductionOptions,baseline:Envelope) {
  const document=createAuthoredDocument({id:'crafted-custody',json:JSON.stringify(baseline),limits:{maxBytes:65536,maxNodes:4096,maxDepth:16},validate(raw:DocumentValue):raw is DocumentValue {
    const value=raw as unknown as Envelope;
    const restoredProduction=createProduction(options,value.production);gear(value.equipment);
    if(!Array.isArray(value.receipts)||value.receipts.length>1)throw Error('receipt limit');
    for(const receipt of value.receipts){
      if(receipt.id!=='delivery'||receipt.signature!==JSON.stringify({command:withdraw(),item:receipt.item}))throw Error('invalid receipt');
      const actual=value.equipment.items.find(i=>i.id===receipt.item.id);
      if(!actual || actual.definition!==receipt.item.definition || actual.functional!==receipt.item.functional || JSON.stringify(actual.slots)!==JSON.stringify(receipt.item.slots))throw Error('missing delivered item');
    }
    // This finite sample has one production segment and one delivery. Retain its
    // exact current-epoch history until this consumer is retired; no compaction API.
    const expectedProduction=createProduction(options);
    expectedProduction.apply(craft,0);
    if(value.receipts.length)expectedProduction.apply(withdraw(),0);
    if(JSON.stringify(restoredProduction.snapshot())!==JSON.stringify(expectedProduction.snapshot()))throw Error('incoherent production delivery');
    return true;
  }});
  const snapshot=()=>structuredClone(document.read().value) as unknown as Envelope;
  let pending: ReturnType<typeof document.prepare> | undefined, attempted=false;
  return {snapshot,
    prepare(selected:ItemInstance){
      if(pending)return 'pending';
      const pinned=structuredClone(selected), command=withdraw(), signature=JSON.stringify({command,item:pinned});
      const value=snapshot(),old=value.receipts.find(r=>r.id===command.id);
      if(old)return old.signature===signature?'duplicate':'conflict';
      const production=createProduction(options,value.production), equipment=gear(value.equipment);
      if(equipment.acquire(pinned,equipment.snapshot().revision)!=='applied')return 'capacity';
      if(!production.apply(command,production.epoch).ok)return 'stock';
      const candidate={production:production.snapshot(),equipment:equipment.snapshot(),receipts:[{id:command.id,signature,item:pinned}]};
      pending=document.prepare(document.read().ticket,()=>JSON.stringify(candidate));
      return pending.status;
    },
    publish(accept:(candidate:Envelope)=>boolean){
      if(pending?.status!=='prepared')return 'empty';attempted=true;
      if(accept(structuredClone(pending.candidate.value) as unknown as Envelope)!==true)return 'pending';
      const result=document.publish(pending.candidate);if(result.status==='accepted')pending=undefined;
      return result.status;
    },
    cancel(){if(attempted||pending?.status!=='prepared')return false;document.discard(pending.candidate);pending=undefined;return true;},
  };
}

test('real SaveStore publishes production, pinned equipment and receipt together across failure/retry/reload',()=>{
  const options=config(), baseline=initial(options), occupied=structuredClone(baseline);
  occupied.equipment=gear({revision:0,items:[{...item(),id:'occupied'}],equipped:[]}).snapshot();
  const full=consumer(options,occupied);assert.equal(full.prepare(item()),'capacity');assert.deepEqual(full.snapshot(),occupied);
  const owner=consumer(options,baseline), backend=new MemoryBackend();
  const section:SaveSection<Envelope>={id:'consumer.crafted-custody',scope:'device',version:1,initial:()=>baseline,parse:raw=>consumer(options,raw as Envelope).snapshot()};
  const createStore=()=>createSaveStore({local:backend.port(),session:new MemoryBackend().port(),build:'test',sections:[section],timers:{now:()=>0,set:()=>0,clear:()=>{}}});
  const store=createStore(),handle=store.section(section);assert.equal(handle.replace(baseline,{now:true}),'saved');
  const selected=item();assert.equal(owner.prepare(selected),'prepared');selected.definition='new-definition';
  const published:string[]=[];
  const save=(candidate:Envelope)=>{published.push(JSON.stringify(candidate));return handle.replace(candidate,{now:true})==='saved';};
  backend.failSet=()=>true;
  assert.equal(owner.publish(save),'pending');assert.deepEqual(owner.snapshot(),baseline);
  assert.equal(owner.cancel(),false,'attempted external publication cannot be discarded');
  assert.equal(owner.prepare(item()),'pending');
  const oldStore=createStore();assert.deepEqual(oldStore.section(section).get(),baseline);oldStore.dispose();
  backend.failSet=()=>false;
  assert.equal(owner.publish(save),'accepted');assert.equal(published[0],published[1]);store.dispose();
  const reloaded=createStore(),restored=consumer(options,reloaded.section(section).get());
  assert.equal(restored.prepare(item()),'duplicate');assert.equal(restored.prepare({...item(),definition:'changed'}),'conflict');
  const value=restored.snapshot(), production=createProduction(options,value.production), equipment=gear(value.equipment);
  assert.equal(production.quantity('output','plate'),0);assert.equal(production.quantity('input','ore'),2);
  assert.equal(equipment.snapshot().items.length,1);assert.equal(equipment.snapshot().items[0]!.definition,'authored-tool-v1');
  assert.equal(equipment.commit('tool-1',equipment.snapshot().revision),'applied');assert.equal(equipment.active()[0]!.id,'tool-1');
  const equipped=consumer(options,{...value,equipment:equipment.snapshot()}).snapshot();
  const restoredGear=gear(equipped.equipment);assert.equal(restoredGear.active()[0]!.id,'tool-1');
  assert.equal(restoredGear.commit('tool-1',restoredGear.snapshot().revision,false),'applied');
  const unequipped=consumer(options,{...equipped,equipment:restoredGear.snapshot()}).snapshot();
  assert.deepEqual(gear(unequipped.equipment).active(),[]);assert.equal(unequipped.equipment.items.length,1);
  reloaded.dispose();
});


test('returned production results cannot corrupt retained retry receipts',()=>{
  const model=createProduction(config());
  const made=model.apply(craft,0);assert.ok(made.ok);made.produced=999;
  const repeat=model.apply(craft,0);assert.ok(repeat.ok);assert.equal(repeat.produced,1);
  const delivered=model.apply(withdraw(),0);assert.ok(delivered.ok);delivered.throughTick=999;delivered.pending=true;
  assert.deepEqual(model.apply(withdraw(),0),{ok:true,duplicate:true,throughTick:null,produced:0,pending:false});
});


test('custody restore requires the exact production withdrawal and retained epoch policy',()=>{
  const options=config(),baseline=initial(options),owner=consumer(options,baseline);
  assert.equal(owner.prepare(item()),'prepared');assert.equal(owner.publish(()=>true),'accepted');
  const delivered=owner.snapshot();
  assert.throws(()=>consumer(options,{...delivered,production:baseline.production}),/incoherent production delivery/);
  assert.throws(()=>consumer(options,{...baseline,production:delivered.production}),/incoherent production delivery/);
  const compacted=createProduction(options,delivered.production);compacted.checkpoint();
  assert.throws(()=>consumer(options,{...delivered,production:compacted.snapshot()}),/incoherent production delivery/);
  assert.equal(consumer(options,delivered).prepare(item()),'duplicate');
});
