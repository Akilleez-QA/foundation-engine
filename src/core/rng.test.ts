import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng,mulberry32,hashSeed} from './rng';

test('a number seed is exactly the mulberry32 stream (the private copies it replaced)',()=>{
 assert.deepEqual([0,1,42].map(s=>{const r=mulberry32(s);return [r(),r()];}),[[0.26642920868471265,0.0003297457005828619],[0.6270739405881613,0.002735721180215478],[0.6011037519201636,0.44829055899754167]]);
 for(const seed of [0,7,123456789,0xffffffff,-7,2.5]){const a=createRng(seed),b=mulberry32(seed);for(let i=0;i<500;i++)assert.equal(a.next(),b());}
});
test('named streams hash the name with FNV-1a and are stable',()=>{
 assert.equal(hashSeed(''),2166136261);assert.equal(hashSeed('kepler-ellipses'),4271176374);
 const r=createRng('kepler-ellipses');
 assert.deepEqual([r.next(),r.next(),r.range(-3,40),r.int(1,6)],[0.4049949839245528,0.9202000363729894,0.4489185814745724,6]);
 assert.notEqual(createRng('a').next(),createRng('b').next());
});
test('range, int and pick stay in bounds and int reaches both ends',()=>{
 const r=createRng('bounds'),seen=new Set<number>(),picked=new Set<string>(),items=['a','b','c'] as const;
 for(let i=0;i<5000;i++){
  const x=r.next();assert.ok(x>=0&&x<1);
  const y=r.range(-2,3);assert.ok(y>=-2&&y<3);
  const n=r.int(1,6);assert.ok(Number.isInteger(n)&&n>=1&&n<=6);seen.add(n);
  picked.add(r.pick(items));
 }
 assert.equal(seen.size,6);assert.equal(picked.size,3);
 assert.throws(()=>r.pick([]),RangeError);
});
