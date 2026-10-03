import {Quaternion} from 'three';
export type ClipVector=readonly[number,number,number];
export type ClipRotation=readonly[number,number,number,number];
export interface PoseKey {readonly at:number;readonly position:ClipVector;readonly rotation:ClipRotation}
export interface PoseTrack {readonly joint:string;readonly keys:readonly PoseKey[]}
export interface PoseClip {readonly id:string;readonly duration:number;readonly tracks:readonly PoseTrack[]}
export interface JointPose {joint:string;position:ClipVector;rotation:ClipRotation}
/** Immutable local-joint tracks. Clip evaluation never changes the actor's simulation transform. */
export function definePoseClip(input:PoseClip):PoseClip {
 if(typeof input.id!=='string'||!input.id||input.id.length>256||!Number.isFinite(input.duration)||input.duration<=0||input.tracks.length>128||new Set(input.tracks.map(t=>t.joint)).size!==input.tracks.length)throw Error('animation: invalid pose clip');
 let count=0;
 const tracks=input.tracks.map(track=>{
  if(typeof track.joint!=='string'||!track.joint||track.joint.length>256||!track.keys.length)throw Error('animation: invalid joint track');
  let previous=-Infinity;
  const keys=track.keys.map(k=>{
   if(!Number.isFinite(k.at)||k.at<0||k.at>input.duration||k.at<=previous||k.position.length!==3||k.rotation.length!==4||!k.position.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e12)||!k.rotation.every(Number.isFinite))throw Error('animation: invalid pose key');
   previous=k.at;if(++count>4096)throw Error('animation: key budget exceeded');
   const scale=Math.max(...k.rotation.map(Math.abs));if(scale===0)throw Error('animation: invalid rotation');
   const scaled=k.rotation.map(v=>v/scale),length=Math.hypot(...scaled); // rotation.length checked === 4
   return Object.freeze({at:k.at,position:Object.freeze([...k.position]) as ClipVector,rotation:Object.freeze([scaled[0]!/length,scaled[1]!/length,scaled[2]!/length,scaled[3]!/length] as const)});
  });
  return Object.freeze({joint:track.joint,keys:Object.freeze(keys)});
 });
 return Object.freeze({id:input.id,duration:input.duration,tracks:Object.freeze(tracks)});
}
export function createPoseSampler(input:PoseClip){
 const clip=definePoseClip(input);
 return {clip,sample(time:number,loop=false):JointPose[]{
  if(!Number.isFinite(time)||time<0)throw Error('animation: invalid sample time');
  const t=loop?time%clip.duration:Math.min(time,clip.duration);
  return clip.tracks.map(track=>{
   // keys is non-empty (definePoseClip); lo, mid, hi stay in 0..keys.length-1.
   const keys=track.keys;let lo=0,hi=keys.length-1;
   if(t<=keys[0]!.at)hi=0;else if(t>=keys[hi]!.at)lo=hi;
   else while(hi-lo>1){const mid=(lo+hi)>>>1;if(keys[mid]!.at<=t)lo=mid;else hi=mid;}
   const a=keys[lo]!,b=keys[hi]!,u=a===b?0:(t-a.at)/(b.at-a.at);
   const rotation=new Quaternion(...a.rotation).slerp(new Quaternion(...b.rotation),u);
   const p=a.position,q=b.position;
   return {joint:track.joint,position:[p[0]*(1-u)+q[0]*u,p[1]*(1-u)+q[1]*u,p[2]*(1-u)+q[2]*u],rotation:[rotation.x,rotation.y,rotation.z,rotation.w]};
  });
 }};
}
/** Same normalized gait phase across clips with different lengths; speed is resolved movement, not intent. */
export function gaitPhase(distance:number,strideLength:number){
 if(!Number.isFinite(distance)||distance<0||!Number.isFinite(strideLength)||strideLength<=0)throw Error('animation: invalid gait phase');
 return (distance%strideLength)/strideLength;
}
