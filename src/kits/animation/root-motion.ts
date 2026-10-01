export interface RootKey { readonly at: number; readonly x: number; readonly z: number; readonly yaw: number }
export interface RootClip { readonly duration: number; readonly keys: readonly RootKey[] }
export interface RootDelta { x: number; z: number; yaw: number }
const identity = (): RootDelta => ({x:0,z:0,yaw:0});
const compose = (a: RootDelta,b: RootDelta): RootDelta => ({x:a.x+Math.cos(a.yaw)*b.x+Math.sin(a.yaw)*b.z,z:a.z-Math.sin(a.yaw)*b.x+Math.cos(a.yaw)*b.z,yaw:a.yaw+b.yaw});
const inverse = (a: RootDelta): RootDelta => ({x:-Math.cos(a.yaw)*a.x+Math.sin(a.yaw)*a.z,z:-Math.sin(a.yaw)*a.x-Math.cos(a.yaw)*a.z,yaw:-a.yaw});
/** Authored planar root motion, independent of skeletal playback. Yaw is unwrapped radians. */
export function createRootMotion(input: RootClip, loop=false) {
  const clip=structuredClone(input);
  if(!Number.isFinite(clip.duration)||clip.duration<=0||!clip.keys.length||clip.keys.length>4096||clip.keys[0].at!==0||clip.keys.at(-1)!.at!==clip.duration)throw Error('root motion: invalid clip');
  let previous=-1;
  for(const key of clip.keys){if(![key.at,key.x,key.z,key.yaw].every(Number.isFinite)||key.at<=previous||key.at>clip.duration||[key.x,key.z,key.yaw].some(v=>Math.abs(v)>1e6))throw Error('root motion: invalid key');previous=key.at;}
  const origin=inverse(clip.keys[0]);
  const at=(time:number):RootDelta=>{
    let lo=0,hi=clip.keys.length-1;while(hi-lo>1){const mid=(lo+hi)>>>1;if(clip.keys[mid].at<=time)lo=mid;else hi=mid;}
    const a=clip.keys[lo],b=clip.keys[hi],u=(time-a.at)/(b.at-a.at);
    return compose(origin,{x:a.x+(b.x-a.x)*u,z:a.z+(b.z-a.z)*u,yaw:a.yaw+(b.yaw-a.yaw)*u});
  };
  const end=at(clip.duration);
  const sample=(time:number)=>{
    if(!Number.isFinite(time)||time<0||(loop&&time/clip.duration>1e6))throw Error('root motion: time outside budget');
    if(!loop)return at(Math.min(time,clip.duration));
    let n=Math.floor(time/clip.duration),cycle=end,total=identity();
    while(n>0){if(n%2)total=compose(total,cycle);cycle=compose(cycle,cycle);n=Math.floor(n/2);}
    return compose(total,at(time%clip.duration));
  };
  let cursor=0,pose=sample(0);
  return {
    advance(time:number):RootDelta {if(time<cursor)throw Error('root motion: seek required');const next=sample(time),delta=compose(inverse(pose),next);pose=next;cursor=time;return delta;},
    /** Teleports/restarts suppress all intervening displacement. */
    seek(time:number){pose=sample(time);cursor=time;},
    get time(){return cursor;},
  };
}
