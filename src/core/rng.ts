/**
 * core/rng.ts: the one seeded random number generator (STD-SIM-9).
 * mulberry32 is the single copy every simulation and presentation stream uses; nothing keeps a private copy.
 * Pure: no imports, no Math.random, no clock reads.
 */

/** The raw mulberry32 stream: uniform numbers in [0, 1). The seed is taken as an unsigned 32-bit integer. */
export function mulberry32(seed:number):()=>number{
 let a=seed>>>0;
 return ()=>{a=(a+0x6D2B79F5)>>>0;return mulberry32Output(a);};
}
/** The mulberry32 output for an already advanced state word. */
function mulberry32Output(a:number):number{let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}

/** 32-bit FNV-1a over UTF-16 code units, so a named stream ('kepler-ellipses') always gets the same seed. */
export function hashSeed(name:string):number{
 let h=2166136261;
 for(let i=0;i<name.length;i++)h=Math.imul(h^name.charCodeAt(i),16777619)>>>0;
 return h;
}

export interface Rng{
 /** Uniform in [0, 1). */
 next():number;
 /** Uniform in [lo, hi). */
 range(lo:number,hi:number):number;
 /** Uniform integer in [lo, hi], both ends inclusive. */
 int(lo:number,hi:number):number;
 /** A uniformly chosen element. Throws on an empty array. */
 pick<T>(arr:readonly T[]):T;
}

/** A seeded stream. A number seed gives exactly mulberry32(seed); a string names a stream and is hashed with hashSeed. */
export function createRng(seed:string|number):Rng{
 return helpers(mulberry32(typeof seed==='number'?seed:hashSeed(seed)));
}
function helpers(next:()=>number):Rng{
 return {
  next,
  range:(lo,hi)=>lo+(hi-lo)*next(),
  int:(lo,hi)=>lo+Math.floor((hi-lo+1)*next()),
  pick:<T>(arr:readonly T[]):T=>{if(arr.length===0)throw new RangeError('rng.pick: empty array');return arr[Math.floor(arr.length*next())]!;},// next() in [0,1): index in [0,length)
 };
}

/**
 * A seeded stream whose whole generator state is one unsigned 32-bit word, so it can be saved with a simulation and
 * restored on rollback, reload or replay. Draws are exactly {@link createRng}'s for the same seed.
 */
export interface SaveableRng extends Rng{
 /** The generator word, an integer in 0..2^32-1. Restoring it reproduces every later draw exactly. */
 state():number;
 /** Replace the generator word. Throws RangeError unless it is a safe integer in 0..2^32-1 (no coercion). */
 restore(word:number):void;
}
/** Like {@link createRng}, plus `state()`/`restore(word)`. Allocation-free per draw; no clock, no Math.random. */
export function createSaveableRng(seed:string|number):SaveableRng{
 let a=(typeof seed==='number'?seed:hashSeed(seed))>>>0;
 const rng=helpers(()=>{a=(a+0x6D2B79F5)>>>0;return mulberry32Output(a);});
 return Object.freeze({
  ...rng,
  state:()=>a,
  restore(word:number){
   if(!Number.isSafeInteger(word)||word<0||word>0xffffffff)throw new RangeError('rng.restore: the state must be an integer in 0..2^32-1');
   a=word;
  },
 });
}

/** A seed path component: a safe integer (negative allowed) or a short string. Floats are rejected, not rounded. */
export type SeedPart=number|string;
/** Bounds on {@link deriveSeed} input: path components and UTF-16 code units per string component. */
export const SEED_PATH_LIMITS=Object.freeze({maxParts:32,maxStringLength:256});

/** lowbias32 (C. Wellons, hash-prospector, public domain): a bijective 32-bit integer mixer. */
function mix32(x:number):number{
 x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return x>>>0;
}
/** Absorbs one word; for a fixed state it is a bijection of the word, so sibling components never collide. */
const absorb=(h:number,w:number)=>mix32((h^mix32((w+0x9e3779b9)>>>0))>>>0);

/**
 * Derives an unsigned 32-bit child seed from a root seed and an ordered path, e.g.
 * `deriveSeed(root, 'region', cx, cz)` or `deriveSeed(root, 'floor', 3, 'loot')`.
 *
 * A pure function of its arguments: independent of call order, wall clock and every other stream, so a region or
 * level regenerates identically whenever it is requested. 32-bit integer arithmetic (`Math.imul`, shifts, xor; no
 * `Math.sin`), plus one exact power-of-two division to split integers wider than 32 bits, keeps results
 * bit-identical across JavaScript engines, workers and the main thread. Components are type-tagged and
 * length-prefixed: `1` differs from `'1'`, and `('ab')` from `('a','b')`. For the same root and prefix, distinct
 * final 32-bit signed integer components (-2^31..2^31-1) map to distinct seeds (the absorb step is bijective);
 * larger safe integers use a separately tagged two-word encoding.
 * Seeds are 32-bit: unrelated paths can collide (birthday bound near 2^16 paths), so a derived seed is a stream
 * seed, never an identity. Throws on a root outside 0..2^32-1, a non-integer or unsafe number, a string longer than
 * {@link SEED_PATH_LIMITS}.maxStringLength, or more than maxParts components.
 */
export function deriveSeed(root:number,...path:readonly SeedPart[]):number{
 if(!Number.isSafeInteger(root)||root<0||root>0xffffffff)throw new RangeError('deriveSeed: root must be an unsigned 32-bit integer');
 if(path.length>SEED_PATH_LIMITS.maxParts)throw new RangeError('deriveSeed: too many path components');
 let h=absorb(0x5eed0001,root);
 for(const part of path){
  if(typeof part==='number'){
   if(!Number.isSafeInteger(part))throw new RangeError('deriveSeed: numeric components must be safe integers');
   if(part>=-0x80000000&&part<=0x7fffffff)h=absorb(absorb(h,1),part>>>0);
   else{const lo=part>>>0;h=absorb(absorb(absorb(h,3),Math.floor((part-lo)/4294967296)|0),lo);}
  }else if(typeof part==='string'){
   if(part.length>SEED_PATH_LIMITS.maxStringLength)throw new RangeError('deriveSeed: string component too long');
   h=absorb(absorb(h,2),part.length);
   for(let i=0;i<part.length;i++)h=absorb(h,part.charCodeAt(i));
  }else throw new TypeError('deriveSeed: components must be numbers or strings');
 }
 return absorb(h,path.length);
}
