import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectProgressionChange,prepareProgressionChange,deriveProgressionGrants,deriveProgressionGrantSources,
  type ProgressionRules,type ProgressionBounds,type ProgressionState,type ProgressionChange,type ProgressionFailure} from './progression';
const bounds:ProgressionBounds={xpTypes:2,skills:4,prerequisites:4,grants:8,learned:4};
const rules:ProgressionRules={id:'inspection-v1',allocationLimit:3,xpTypes:[{id:'practice',maxBalance:20},{id:'other',maxBalance:20}],skills:[
  {id:'a',xpType:'practice',xpCost:3,pointCost:1,requires:[],certificates:['shared'],schematics:['shared']},
  {id:'b',xpType:'practice',xpCost:5,pointCost:2,requires:['a'],certificates:['shared'],schematics:[]},
  {id:'c',xpType:'other',xpCost:2,pointCost:2,requires:[],certificates:['shared'],schematics:['recipe']},
]};
const state=(learned:string[]=[],balance=10):ProgressionState=>({version:1,rulesId:rules.id,learned,xp:[{type:'practice',balance},{type:'other',balance:0}],spentAllocation:learned.reduce((n,id)=>n+rules.skills.find(s=>s.id===id)!.pointCost,0)});
function compare(s:ProgressionState,change:ProgressionChange,reason:ProgressionFailure|null,b=bounds){
 const before=structuredClone(s),inspection=inspectProgressionChange(s,change,rules,b),candidate=prepareProgressionChange(s,change,rules,b);
 assert.ok(inspection.ok);assert.equal(inspection.reason,reason);assert.equal(inspection.eligible,reason===null);
 assert.equal(candidate.ok,inspection.eligible);if(!candidate.ok)assert.equal(candidate.reason,reason);
 assert.deepEqual(s,before);return inspection;
}
test('inspection shares actual candidate outcomes for every ordinary action and refusal',()=>{
 compare(state(),{kind:'learn',skill:'a'},null);
 compare(state(['a']),{kind:'learn',skill:'a'},'already-learned');
 const missing=compare(state(),{kind:'learn',skill:'b'},'prerequisites');
 assert.ok('missingPrerequisites' in missing.facts);assert.deepEqual(missing.facts.missingPrerequisites,['a']);
 compare(state([],0),{kind:'learn',skill:'a'},'insufficient-xp');
 compare(state(['a']),{kind:'learn',skill:'c'},'insufficient-xp');
 compare(state(['a','b']),{kind:'learn',skill:'c'},'allocation');
 compare(state(),{kind:'surrender',skill:'a'},'not-learned');
 const dependent=compare(state(['a','b']),{kind:'surrender',skill:'a'},'dependent');
 assert.ok('learnedDependents' in dependent.facts);assert.deepEqual(dependent.facts.learnedDependents,['b']);
 compare(state(['a']),{kind:'surrender',skill:'a'},null);
 compare(state(),{kind:'earn',xpType:'practice',amount:11},'xp-capacity');
 compare(state(),{kind:'spend',xpType:'practice',amount:11},'insufficient-xp');
 compare(state(),{kind:'earn',xpType:'practice',amount:10},null);
 compare(state(),{kind:'spend',xpType:'practice',amount:10},null);
});
test('all blockers retain first-refusal ordering including learned count before allocation and funds',()=>{
 const full=state(['a','b'],0),limited={...bounds,learned:2};
 assert.deepEqual(compare(full,{kind:'learn',skill:'c'},'limit',limited).blockers,['limit','allocation','insufficient-xp']);
 assert.deepEqual(compare(full,{kind:'learn',skill:'b'},'already-learned',limited).blockers,['already-learned','limit','allocation','insufficient-xp']);
 const empty={...bounds,learned:0};
 assert.deepEqual(compare(state([],0),{kind:'learn',skill:'b'},'prerequisites',empty).blockers,['prerequisites','limit','insufficient-xp']);
});
test('validation order remains bounds, rules, state, then command; invalid inspection has no false eligibility',()=>{
 const cases:[unknown,unknown,ProgressionRules,ProgressionBounds,ProgressionFailure][]=[
  [state(),{kind:'learn',skill:'missing'},rules,bounds,'unknown'],
  [state(),{kind:'earn',xpType:'practice',amount:0},rules,bounds,'invalid'],
  [{...state(),rulesId:'wrong'},null,rules,bounds,'rules-mismatch'],
  [null,null,{...rules,skills:[{...rules.skills[0],requires:['a']}]},bounds,'cycle'],
  [null,null,rules,{...bounds,learned:-1},'invalid'],
  [state(),{kind:'learn',skill:'a',extra:1},rules,bounds,'invalid'],
  [state(),{kind:'earn',xpType:'missing',amount:1},rules,bounds,'unknown'],
 ];
 for(const [s,c,r,b,reason] of cases){const expected={ok:false,reason};assert.deepEqual(inspectProgressionChange(s,c as ProgressionChange,r,b),expected);assert.deepEqual(prepareProgressionChange(s,c as ProgressionChange,r,b),expected);assert.ok(Object.isFrozen(inspectProgressionChange(s,c as ProgressionChange,r,b)));}
});
test('source projection uses kind and id, retains shared skill contributors, and is detached/frozen',()=>{
 const accepted=state(['a','b']),before=deriveProgressionGrantSources(accepted,rules,bounds);
 assert.deepEqual(before,[{kind:'certificate',id:'shared',skills:['a','b']},{kind:'schematic',id:'shared',skills:['a']}]);
 const union=deriveProgressionGrants(accepted,rules,bounds);
 assert.deepEqual(union.certificates,before.filter(s=>s.kind==='certificate').map(s=>s.id));
 assert.deepEqual(union.schematics,before.filter(s=>s.kind==='schematic').map(s=>s.id));
 const next=prepareProgressionChange(accepted,{kind:'surrender',skill:'b'},rules,bounds);assert.ok(next.ok);
 assert.deepEqual(deriveProgressionGrantSources(next.state,rules,bounds),[{kind:'certificate',id:'shared',skills:['a']},{kind:'schematic',id:'shared',skills:['a']}]);
 assert.deepEqual(before[0].skills,['a','b']);assert.ok(Object.isFrozen(before));assert.ok(Object.isFrozen(before[0]));assert.ok(Object.isFrozen(before[0].skills));
 assert.throws(()=>{(before[0].skills as string[]).push('invented');});
 const last=prepareProgressionChange(next.state,{kind:'surrender',skill:'a'},rules,bounds);assert.ok(last.ok);assert.deepEqual(deriveProgressionGrantSources(last.state,rules,bounds),[]);
});
test('capture reads each caller field once and never reruns getters to apply or explain',()=>{
 for(const action of [inspectProgressionChange,prepareProgressionChange]){
  let reads=0;const change={get kind(){reads++;return 'learn' as const;},get skill(){reads++;return 'a';}};
  let costs=0;const r={...rules,skills:rules.skills.map((s,i)=>i===0?{...s,get xpCost(){costs++;return 3;}}:s)};
  assert.equal(action(state(),change,r,bounds).ok,true);assert.equal(reads,2);assert.equal(costs,1);
 }
 let reads=0;const r={...rules,skills:rules.skills.map((s,i)=>i===0?{...s,get certificates(){reads++;return ['shared'];}}:s)};
 deriveProgressionGrantSources(state(['a']),r,bounds);assert.equal(reads,1);
 const s=state(),view=inspectProgressionChange(s,{kind:'learn',skill:'b'},rules,bounds);assert.ok(view.ok);assert.ok(Object.isFrozen(view));assert.ok(Object.isFrozen(view.blockers));assert.ok(Object.isFrozen(view.facts));
 assert.ok('missingPrerequisites' in view.facts);assert.ok(Object.isFrozen(view.facts.missingPrerequisites));
 s.learned.push('a');assert.deepEqual(view.facts.missingPrerequisites,['a']);
});
test('sparse and forged arrays reject before provenance inspection can overrun bounds',()=>{
 const sparse={...rules,skills:Array(1)};assert.deepEqual(inspectProgressionChange(state(),{kind:'learn',skill:'a'},sparse,bounds),{ok:false,reason:'invalid'});
 assert.throws(()=>deriveProgressionGrantSources(state(),sparse,bounds));
 const forged=new Proxy(rules.skills,{get(target,key,receiver){return key==='length'?{valueOf(){throw Error('coercion');}}:Reflect.get(target,key,receiver);}});
 assert.deepEqual(inspectProgressionChange(state(),{kind:'learn',skill:'a'},{...rules,skills:forged},bounds),{ok:false,reason:'invalid'});
});
