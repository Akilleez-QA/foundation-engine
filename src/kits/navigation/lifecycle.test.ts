import test from 'node:test';import assert from 'node:assert/strict';
import {createNavigationGraph} from './search';import {createRouteQueue} from './queue';import {createRouteFollower} from './follower';import {definePortal,crossPortal} from './portals';import {createFrames} from '../frames/frame';
const matrix=(x=0)=>[1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1];
test('round robin work serves short request alongside long route and admits before allocation',()=>{const q=createRouteQueue({maxRequests:2,maxNodes:102});const graph=createNavigationGraph(Array.from({length:100},(_,i)=>({id:String(i),edges:i===99?[]:[{to:String(i+1),cost:1}]})));assert.equal(q.offer({id:'long',owner:'a',generation:0,graph,start:'0',goal:'99'}),'accepted');const short=createNavigationGraph([{id:'s',edges:[]}]);q.offer({id:'short',owner:'b',generation:0,graph:short,start:'s',goal:'s'});assert.equal(q.offer({id:'third',owner:'c',generation:0,graph:short,start:'bad',goal:'bad'}),'saturated');assert.equal(q.pump(12),12);assert.equal(q.result('short')?.status,'arrived');assert.equal(q.result('long')?.status,'pending');q.dispose();assert.equal(q.stats.nodes,0);});
test('portal rechecks clearance, readiness and both frame lifetimes at crossing',()=>{const f=createFrames();f.set({id:'outside',generation:0,matrix:matrix()});f.set({id:'inside',generation:0,matrix:matrix(3)});const p=definePortal({id:'door',revision:0,from:{frame:{id:'outside',generation:0},position:[0,0,0]},to:{frame:{id:'inside',generation:0},position:[0,0,0]},width:1,height:2,open:true});assert.equal(crossPortal(p,0,{radius:.6,height:1},f,()=>true,()=>true).status,'blocked');assert.equal(crossPortal(p,0,{radius:.3,height:1},f,()=>false,()=>true).status,'unavailable');assert.equal(crossPortal(p,0,{radius:.3,height:1},f,()=>true,()=>{f.remove({id:'inside',generation:0});return true;}).status,'stale');});
test('only resolved position arrives; blocked movement replans finitely and ignores stale result',()=>{const f=createRouteFollower({arrivalRadius:.1,blockedSeconds:1,maxReplans:1});f.accept(0,[[1,0,0]]);f.observe([0,0,0],.5);f.observe([0,0,0],.5);assert.equal(f.observe([0,0,0],.5),'blocked');assert.equal(f.replan(),1);assert.equal(f.accept(0,[[0,0,0]]),false);f.accept(1,[[1,0,0]]);assert.equal(f.observe([1,0,0],.1),'arrived');f.cancel();assert.equal(f.accept(1,[[0,0,0]]),false);});
test('new generation replaces saturated old owner without admitting stale completions',()=>{const graph=createNavigationGraph([{id:'a',edges:[]}]),q=createRouteQueue({maxRequests:1,maxNodes:1});q.offer({id:'old',owner:'same',generation:0,graph,start:'a',goal:'a'});assert.equal(q.offer({id:'new',owner:'same',generation:1,graph,start:'a',goal:'a'}),'accepted');assert.equal(q.result('old'),null);assert.equal(q.offer({id:'old',owner:'same',generation:0,graph,start:'a',goal:'a'}),'stale');assert.equal(q.offer({id:'new',owner:'other',generation:1,graph,start:'a',goal:'a'}),'conflict');});
test('scaled portal frames cannot overstate physical clearance',()=>{const f=createFrames();f.set({id:'small',generation:0,matrix:[.5,0,0,0,0,.5,0,0,0,0,.5,0,0,0,0,1]});const p=definePortal({id:'door',revision:0,from:{frame:{id:'small',generation:0},position:[0,0,0]},to:{frame:{id:'small',generation:0},position:[0,0,1]},width:1,height:2,open:true});assert.equal(crossPortal(p,0,{radius:.3,height:.8},f,()=>true,()=>true).status,'blocked');});
test('structural graph mutation cannot corrupt queue admission accounting',()=>{const nodes=[{id:'a',edges:[]}],q=createRouteQueue({maxRequests:1,maxNodes:1});q.offer({id:'a',owner:'a',generation:0,graph:{nodes},start:'a',goal:'a'});nodes.push({id:'b',edges:[]});q.release('a');assert.equal(q.stats.nodes,0);});
test('rotation or scale mutation at fixed endpoint positions invalidates crossing',()=>{const f=createFrames();f.set({id:'f',generation:0,matrix:matrix()});const p=definePortal({id:'p',revision:0,from:{frame:{id:'f',generation:0},position:[0,0,0]},to:{frame:{id:'f',generation:0},position:[0,0,0]},width:1,height:2,open:true});assert.equal(crossPortal(p,0,{radius:.3,height:1},f,()=>true,()=>{f.set({id:'f',generation:0,matrix:[.5,0,0,0,0,.5,0,0,0,0,.5,0,0,0,0,1]});return true;}).status,'stale');});


test('structural request duplicates use source identity while search and accounting use the admitted snapshot', () => {
  const graph = { nodes: [
    { id: 'start', edges: [{ to: 'goal', cost: 2 }] },
    { id: 'goal', edges: [] },
  ] };
  const request = { id: 'route', owner: 'actor', generation: 0, graph, start: 'start', goal: 'goal' };
  const queue = createRouteQueue({ maxRequests: 2, maxNodes: 2 });
  assert.equal(queue.offer(request), 'accepted');
  assert.equal(queue.offer({ ...request }), 'duplicate');
  assert.equal(queue.offer({ ...request, graph: { nodes: graph.nodes } }), 'conflict');
  assert.equal(queue.offer({ ...request, goal: 'start' }), 'conflict');

  // Reoffering the same identity does not replace already admitted topology.
  graph.nodes[0].edges[0].cost = 99;
  graph.nodes.push({ id: 'late', edges: [] });
  assert.equal(queue.offer(request), 'duplicate');
  assert.deepEqual(queue.stats, { requests: 1, nodes: 2, owners: 1 });
  queue.pump(32);
  assert.deepEqual(queue.result('route'), { status: 'arrived', path: ['start', 'goal'], cost: 2 });
  queue.release('route');
  assert.deepEqual(queue.stats, { requests: 0, nodes: 0, owners: 1 });
  queue.dispose();
});
