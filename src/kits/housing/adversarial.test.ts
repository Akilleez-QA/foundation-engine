import {test} from 'node:test';import assert from 'node:assert/strict';import {createStructure,type StructureSnapshot} from './index';
const fresh=():StructureSnapshot=>({revision:0,owner:'owner',grants:{},placements:[],occupants:[],packed:false});
test('housing snapshots placement before terrain callbacks can mutate caller data',()=>{
 const h=createStructure(fresh()),p={id:'a',x:0,z:0,width:1,depth:1,height:0};
 assert.equal(h.place('owner',p,0,()=>{p.width=NaN;p.id='changed';return {height:0,excluded:false};}),true);
 assert.equal(h.snapshot().placements[0].id,'a');assert.equal(h.snapshot().placements[0].width,1);
});
test('housing occupancy and permission grants respect configured bounds',()=>{
 const h=createStructure(fresh(),1);assert.equal(h.enter('owner'),true);assert.equal(h.enter('owner'),true);
 assert.equal(h.grant('owner','one',['enter']),true);assert.equal(h.grant('owner','two',['enter']),false);
 assert.throws(()=>createStructure({...fresh(),occupants:['a','b']},1));
});
test('tiny housing footprints do not divide by zero at coarse sampling spacing',()=>{
 const h=createStructure(fresh());let sampled=0;
 assert.equal(h.place('owner',{id:'tiny',x:0,z:0,width:1e-300,depth:1e-300,height:0},0,(x,z)=>{assert.ok(Number.isFinite(x)&&Number.isFinite(z));sampled++;return {height:0,excluded:false};},1e300),true);assert.equal(sampled,4);
});
test('housing restore rejects overlapping saved placement arrangements',()=>{
 const p={id:'one',x:0,z:0,width:1,depth:1,height:0};assert.throws(()=>createStructure({...fresh(),placements:[p,{...p,id:'two'}]}));
});
