import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {updateWorldMatrixFromRoot} from './world-matrix';

function chain(){
 const container=new T.Group(),manual=new T.Group(),node=new T.Object3D(),leaf=new T.Object3D();
 container.add(manual);manual.add(node);node.add(leaf);
 manual.matrixAutoUpdate=false;manual.matrix.makeTranslation(1,0,0);manual.matrixWorldNeedsUpdate=true;node.position.y=1;leaf.position.z=2;
 container.updateMatrixWorld(true);container.position.x=10;
 return {container,manual,node,leaf};
}
test('a manual-matrix ancestor under a moved parent reaches the node (three r185+ updateWorldMatrix skips it)',()=>{
 const stock=chain();stock.node.updateWorldMatrix(true,false);
 assert.equal(stock.node.matrixWorld.elements[12],1,'three r185+ leaves the manual ancestor stale: re-check this helper on upgrade');
 const c=chain();updateWorldMatrixFromRoot(c.node);
 assert.equal(c.node.matrixWorld.elements[12],11);assert.equal(c.node.matrixWorld.elements[13],1);
 assert.equal(c.leaf.matrixWorld.elements[12],1,'children keep their previous world matrix unless asked');
});
test('with children, the whole subtree below the node is recomputed too',()=>{
 const c=chain();updateWorldMatrixFromRoot(c.node,true);
 assert.deepEqual([c.leaf.matrixWorld.elements[12],c.leaf.matrixWorld.elements[13],c.leaf.matrixWorld.elements[14]],[11,1,2]);
 const d=chain();updateWorldMatrixFromRoot(d.container,true);assert.equal(d.leaf.matrixWorld.elements[12],11);
});
test('a hand-managed world matrix (matrixWorldAutoUpdate false) is respected as three does',()=>{
 const c=chain();c.manual.matrixWorldAutoUpdate=false;c.manual.matrixWorld.makeTranslation(50,0,0);
 updateWorldMatrixFromRoot(c.node);assert.equal(c.node.matrixWorld.elements[12],50);
});
