import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelPoseLink, captureModelPoseLink, normalizeModelPoseLinkLimits, MAX_MODEL_POSE_LINK_NODES } from './model-pose-link';

test('pose link intake detaches node mappings and captures scalar policies without caller array methods', () => {
  const nodes = [{source:'a',target:'b'}], input = {source:1,nodes,inheritVisibility:false};
  Object.defineProperty(nodes,'map',{value:()=>{throw Error('caller method');}});
  const captured=ModelPoseLink(input).value;
  nodes[0].source='changed';input.source=2;
  assert.equal(captured.source,1);assert.equal(captured.nodes[0].source,'a');
  assert.ok(Object.isFrozen(captured)&&Object.isFrozen(captured.nodes)&&Object.isFrozen(captured.nodes[0]));
});
test('pose link default constructor accepts configured mapping sizes above default scene limit', () => {
  const nodes=Array.from({length:129},(_,i)=>({source:`a${i}`,target:`b${i}`}));
  const input={source:1,nodes,inheritVisibility:true};
  assert.equal(ModelPoseLink(input).value.nodes.length,129);
  assert.throws(()=>captureModelPoseLink(input,128),/capacity/);
  assert.equal(captureModelPoseLink(input,256).nodes.length,129);
  let indexed=false;
  const tooMany=new Proxy([],{get(target,key,receiver){if(key==='length')return MAX_MODEL_POSE_LINK_NODES+1;if(key==='0')indexed=true;return Reflect.get(target,key,receiver);}});
  assert.throws(()=>ModelPoseLink({...input,nodes:tooMany}),/capacity/);assert.equal(indexed,false);
});
test('pose link rejects malformed mappings, duplicate identities and omitted policies', () => {
  const input={source:1,nodes:[{source:'a',target:'b'}],inheritVisibility:true};
  for(const bad of [{source:0},{source:NaN},{nodes:[]},{nodes:[{source:'',target:'b'}]},{nodes:[{source:'a',target:'b'},{source:'a',target:'c'}]},{nodes:[{source:'a',target:'b'},{source:'c',target:'b'}]},{inheritVisibility:undefined}])assert.throws(()=>ModelPoseLink({...input,...bad}),/pose link/);
});
test('pose link limits snapshot configurable zero boundaries and explicit constructor ceiling', () => {
  const input={maxLinks:0,maxMappedNodesPerLink:256,restTolerance:0};const limits=normalizeModelPoseLinkLimits(input);input.maxLinks=3;
  assert.equal(limits.maxLinks,0);assert.equal(limits.maxSkinVerticesPerModel,65536);assert.equal(limits.maxMappedNodesPerLink,256);assert.ok(Object.isFrozen(limits));
  for(const bad of [{maxLinks:-1},{maxRigNodesPerModel:Infinity},{maxMappedNodesTotal:1.5},{maxSkinVerticesPerModel:Number.MAX_SAFE_INTEGER+1},{restTolerance:NaN},{restTolerance:-1},{maxMappedNodesPerLink:MAX_MODEL_POSE_LINK_NODES+1}])assert.throws(()=>normalizeModelPoseLinkLimits(bad),/pose link/);
});
test('explicit null limits are rejected rather than defaulted',()=>{
  assert.throws(()=>normalizeModelPoseLinkLimits({maxLinks:null} as never),/invalid limits/);
  assert.throws(()=>normalizeModelPoseLinkLimits(null as never),/invalid limits/);
});
