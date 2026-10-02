import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng,createSaveableRng,mulberry32,hashSeed,deriveSeed,SEED_PATH_LIMITS} from './rng';

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

const bits=(x:number)=>{let n=0;for(x>>>=0;x;x&=x-1)n++;return n;};
test('GEN-01 deriveSeed is a pinned pure function of root and path, independent of call order',()=>{
 const pinned=[deriveSeed(0),deriveSeed(42,'region',0,0),deriveSeed(42,'region',-1,0),deriveSeed(42,'region',0,-1),deriveSeed(0xffffffff,'floor',2**40,'x'),deriveSeed(7,1),deriveSeed(7,'1'),deriveSeed(7,-(2**53-1))];
 assert.deepEqual(pinned,[3511696298,2758992549,1864662887,1142697386,2773009025,1946926767,2651055847,421625852]);
 const forward:number[]=[],backward:number[]=[];
 for(let i=0;i<64;i++)forward.push(deriveSeed(9,'region',i,-i));
 for(let i=63;i>=0;i--)backward[i]=deriveSeed(9,'region',i,-i);
 assert.deepEqual(forward,backward);
 for(const s of forward)assert.ok(Number.isInteger(s)&&s>=0&&s<=0xffffffff);
});
test('GEN-01 deriveSeed separates types, order, grouping and siblings',()=>{
 assert.notEqual(deriveSeed(1,1),deriveSeed(1,'1'));
 assert.notEqual(deriveSeed(1,'ab'),deriveSeed(1,'a','b'));
 assert.notEqual(deriveSeed(1,'a',2),deriveSeed(1,2,'a'));
 assert.notEqual(deriveSeed(1,3,4),deriveSeed(1,4,3));
 assert.notEqual(deriveSeed(1),deriveSeed(1,0));
 assert.notEqual(deriveSeed(1,0),deriveSeed(1,2**32),'the high word is absorbed');
 assert.notEqual(deriveSeed(1,-1),deriveSeed(1,0xffffffff),'sign is absorbed');
 assert.notEqual(deriveSeed(1,2**31),deriveSeed(1,-(2**31)),'wide integers are tagged apart from int32');
 // bijective absorb: int32 siblings under one prefix never collide, across the sign boundary too
 const seen=new Set<number>();for(let i=-100000;i<100000;i++)seen.add(deriveSeed(5,"region",7,i));for(const i of [-(2**31),2**31-1])seen.add(deriveSeed(5,"region",7,i));
 assert.equal(seen.size,200002);
});
test('GEN-01 deriveSeed avalanches: one-bit root or coordinate changes flip about half the output bits',()=>{
 let flips=0,n=0;
 for(let r=0;r<200;r++){const root=deriveSeed(r,'base'),a=deriveSeed(root,'region',r,3);for(let b=0;b<32;b++){flips+=bits(a^deriveSeed((root^(1<<b))>>>0,'region',r,3));n++;}}
 const mean=flips/n;assert.ok(mean>15.5&&mean<16.5,`root avalanche mean ${mean}`);
 flips=0;n=0;
 for(let x=-500;x<500;x++){flips+=bits(deriveSeed(11,'region',x,0)^deriveSeed(11,'region',x+1,0));n++;}
 assert.ok(flips/n>15&&flips/n<17,`neighbour avalanche ${flips/n}`);
 // first draws of neighbouring derived streams are uncorrelated enough to look uniform
 let sum=0,lag=0;const first:number[]=[];
 for(let x=0;x<20000;x++){const v=mulberry32(deriveSeed(3,'region',x,0))();first.push(v);sum+=v;}
 for(let x=1;x<first.length;x++)lag+=(first[x]!-.5)*(first[x-1]!-.5);
 assert.ok(Math.abs(sum/first.length-.5)<.01);assert.ok(Math.abs(lag/(first.length-1))<.0025);
});
test('GEN-01 deriveSeed rejects ambiguous or unbounded input instead of rounding',()=>{
 for(const root of [-1,2**32,1.5,NaN,Infinity,'1' as unknown as number])assert.throws(()=>deriveSeed(root,'a'),RangeError);
 for(const part of [0.5,NaN,Infinity,2**53,-(2**53)])assert.throws(()=>deriveSeed(1,part),RangeError);
 for(const part of [null,undefined,{},[],true,1n])assert.throws(()=>deriveSeed(1,part as never),TypeError);
 assert.throws(()=>deriveSeed(1,'x'.repeat(SEED_PATH_LIMITS.maxStringLength+1)),RangeError);
 assert.doesNotThrow(()=>deriveSeed(1,'x'.repeat(SEED_PATH_LIMITS.maxStringLength)));
 assert.throws(()=>deriveSeed(1,...new Array(SEED_PATH_LIMITS.maxParts+1).fill(0)),RangeError);
 assert.doesNotThrow(()=>deriveSeed(1,...new Array(SEED_PATH_LIMITS.maxParts).fill(0)));
});

test('RNG-01 a saveable stream draws exactly the createRng stream for number and named seeds',()=>{
 for(const seed of [0,7,123456789,0xffffffff,-7,2.5,'kepler-ellipses','']){
  const a=createRng(seed),b=createSaveableRng(seed);
  for(let i=0;i<500;i++){assert.equal(b.next(),a.next());assert.equal(b.int(1,6),a.int(1,6));assert.equal(b.range(-3,4),a.range(-3,4));}
  assert.equal(b.pick(['x','y','z']),a.pick(['x','y','z']));
 }
 assert.equal(createSaveableRng(42).state(),42);
 assert.equal(createSaveableRng(-1).state(),0xffffffff,'seeds are taken as unsigned 32-bit, as mulberry32 does');
 assert.equal(createSaveableRng('kepler-ellipses').state(),hashSeed('kepler-ellipses'));
});

test('RNG-01 restoring a saved word replays every later draw exactly, including through JSON, and is per stream',()=>{
 const r=createSaveableRng('rollback');
 for(let i=0;i<37;i++)r.next();
 const word=r.state(),saved=JSON.parse(JSON.stringify({word})).word as number;
 const first=Array.from({length:200},()=>r.int(0,1000));
 r.restore(saved);
 assert.deepEqual(Array.from({length:200},()=>r.int(0,1000)),first);
 const other=createSaveableRng('rollback');
 other.restore(word);
 assert.deepEqual(Array.from({length:200},()=>other.int(0,1000)),first,'another stream restored to the word continues identically');
 r.restore(0);other.next();
 assert.notEqual(r.state(),other.state(),'streams do not share state');
 // Full wrap of the word space is valid: 0 and 2^32-1 are ordinary states.
 r.restore(0xffffffff);r.next();assert.equal(r.state(),(0xffffffff+0x6D2B79F5)>>>0);
});

test('RNG-01 restore refuses anything but an integer word in 0..2^32-1 without changing the state',()=>{
 const r=createSaveableRng(5);r.next();
 const before=r.state();
 for(const bad of [-1,2**32,1.5,NaN,Infinity,'5',null,undefined,2**53,{valueOf:()=>3}])
  assert.throws(()=>r.restore(bad as unknown as number),RangeError);
 assert.equal(r.state(),before);
 assert.ok(Object.isFrozen(r));
});
