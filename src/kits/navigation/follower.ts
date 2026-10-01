export type RoutePoint=readonly[number,number,number];
export type FollowerState='planning'|'moving'|'blocked'|'replan'|'arrived'|'cancelled'|'no-route';
/** Observes collision-resolved position; proposals never count as actual movement or arrival. */
export function createRouteFollower(options:{arrivalRadius:number;blockedSeconds:number;maxReplans:number}){
 const {arrivalRadius,blockedSeconds,maxReplans}=options;
 if(!Number.isFinite(arrivalRadius)||arrivalRadius<=0||!Number.isFinite(blockedSeconds)||blockedSeconds<=0||!Number.isSafeInteger(maxReplans)||maxReplans<0)throw Error('navigation: invalid follower');
 let state:FollowerState='planning',generation=0,replans=0,index=0,stalled=0,best=Infinity,route:readonly RoutePoint[]=[];
 const position=(p:RoutePoint)=>{if(p.length!==3||!p.every(Number.isFinite))throw Error('navigation: invalid route point');};
 return {
  get state(){return state;},get generation(){return generation;},get target(){return state==='moving'?route[index]:undefined;},
  accept(epoch:number,points:readonly RoutePoint[]){if(epoch!==generation||(state!=='planning'&&state!=='replan'))return false;if(points.length>8192)throw Error('navigation: route too long');points.forEach(position);route=points.map(p=>Object.freeze([...p]) as RoutePoint);index=0;stalled=0;best=Infinity;state=route.length?'moving':'no-route';return true;},
  observe(p:RoutePoint,dt:number){position(p);if(!Number.isFinite(dt)||dt<0||dt>1)throw Error('navigation: invalid observation interval');if(state!=='moving')return state;
   const distance=Math.hypot(...route[index].map((v,i)=>v-p[i]));if(!Number.isFinite(distance))throw Error('navigation: movement overflow');
   if(distance<=arrivalRadius){index++;stalled=0;best=Infinity;if(index===route.length)state='arrived';}
   else if(distance<best-1e-5){best=distance;stalled=0;}else {stalled+=dt;if(stalled>=blockedSeconds)state='blocked';}
   return state;
  },
  replan(){if(state!=='blocked'||replans>=maxReplans)return null;if(generation===Number.MAX_SAFE_INTEGER)throw Error('navigation: generation exhausted');replans++;generation++;route=[];state='replan';return generation;},
  cancel(){if(state==='cancelled')return;state='cancelled';route=[];},
 };
}
