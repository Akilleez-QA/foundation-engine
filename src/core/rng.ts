/**
 * core/rng.ts: the one seeded random number generator (STD-SIM-9).
 * mulberry32 is the single copy every simulation and presentation stream uses; nothing keeps a private copy.
 * Pure: no imports, no Math.random, no clock reads.
 */

/** The raw mulberry32 stream: uniform numbers in [0, 1). The seed is taken as an unsigned 32-bit integer. */
export function mulberry32(seed:number):()=>number{
 let a=seed>>>0;
 return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}

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
 const next=mulberry32(typeof seed==='number'?seed:hashSeed(seed));
 return {
  next,
  range:(lo,hi)=>lo+(hi-lo)*next(),
  int:(lo,hi)=>lo+Math.floor((hi-lo+1)*next()),
  pick:<T>(arr:readonly T[]):T=>{if(arr.length===0)throw new RangeError('rng.pick: empty array');return arr[Math.floor(arr.length*next())];},
 };
}
