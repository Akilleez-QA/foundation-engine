/**
 * kits/character/motion: how a character accelerates, stops and turns, independent of the frame rate.
 * - Velocity eases to top speed in ACCEL_TIME and stops in STOP_TIME (a direction change counts as stopping), linearly,
 *   so the result does not depend on the frame rate; position integrates the average of the old and new velocity.
 * - Tapped routes are walked as one path: a step that reaches a corner carries on along the next leg in the same
 *   frame (no stall at waypoints), and the player slows to stop exactly on the last point (never past it).
 * - Facing turns toward the way they actually moved at TURN_RATE (twice that for a reversal), instead of snapping.
 * The caller still applies its own collision to the returned step and reports what really happened (`moved`).
 */
export type Vec={x:number;z:number};
export const ACCEL_TIME=.15,STOP_TIME=.1,TURN_RATE=720*Math.PI/180,REVERSAL=150*Math.PI/180;
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));

export function createMotion(options:{speed:number;accelTime?:number;stopTime?:number}){
 let speed=options.speed;const accelTime=options.accelTime??ACCEL_TIME,stopTime=options.stopTime??STOP_TIME;
 let vx=0,vz=0;
 return {
  get velocity():Vec{return {x:vx,z:vz};},
  get speed(){return speed;},
  set speed(s:number){speed=s;},
  /** Stop dead (a teleport, a door, a panel taking over). */
  reset(){vx=vz=0;},
  /**
   * Free movement. `dir` is the wanted world direction with length 0..1 (a stick's tilt); returns this frame's step.
   * `snap` turns the current velocity onto the new direction at once (movement follows the view exactly).
   */
  step(dir:Vec,dt:number,{snap=false}:{snap?:boolean}={}):Vec{
   if(!(dt>0))return {x:0,z:0};
   const m=Math.hypot(dir.x,dir.z),k=m>1?1/m:1,tx=dir.x*k*speed,tz=dir.z*k*speed;
   if(snap&&m>1e-6){const ux=dir.x/m,uz=dir.z/m,along=Math.max(0,vx*ux+vz*uz);vx=ux*along;vz=uz*along;}
   const ox=vx,oz=vz;
   const dx=tx-vx,dz=tz-vz,gap=Math.hypot(dx,dz);
   // Speeding up along the way they already goes uses the gentler rate; slowing or turning uses the stop rate.
   const speeding=Math.hypot(tx,tz)>=Math.hypot(vx,vz)&&vx*dx+vz*dz>=-1e-9,reach=speed/(speeding?accelTime:stopTime)*dt;
   if(gap<=reach+1e-9){vx=tx;vz=tz;}else{vx+=dx*reach/gap;vz+=dz*reach/gap;}
   return {x:(ox+vx)/2*dt,z:(oz+vz)/2*dt};
  },
  /**
   * Follow a route (world points; the first may be where they stands). Consumed points are removed from `route` in
   * place. Returns the step and whether this frame reached the end.
   */
  follow(route:Vec[],from:Vec,dt:number):Vec&{arrived:boolean}{
   if(!(dt>0)||!route.length)return {x:0,z:0,arrived:false};
   let remaining=0,px=from.x,pz=from.z;for(const p of route){remaining+=Math.hypot(p.x-px,p.z-pz);px=p.x;pz=p.z;}
   const current=Math.hypot(vx,vz),decel=speed/stopTime,accel=speed/accelTime;
   // Aim for top speed, but never faster than lets her stop on the last point at the stop rate.
   const cap=Math.min(speed,Math.sqrt(2*decel*remaining)),next=current<cap?Math.min(cap,current+accel*dt):Math.max(cap,current-decel*dt);
   let travel=(current+next)/2*dt,x=from.x,z=from.z,lastDir:Vec|null=null;
   if(travel>=remaining-1e-4)travel=remaining+1;
   while(route.length){
    const p=route[0],d=Math.hypot(p.x-x,p.z-z);
    if(d<=travel){if(d>1e-9)lastDir={x:(p.x-x)/d,z:(p.z-z)/d};travel-=d;x=p.x;z=p.z;route.shift();continue;}
    lastDir={x:(p.x-x)/d,z:(p.z-z)/d};x+=lastDir.x*travel;z+=lastDir.z*travel;break;
   }
   const arrived=!route.length;
   if(arrived){vx=vz=0;}else if(lastDir){vx=lastDir.x*next;vz=lastDir.z*next;}
   return {x:x-from.x,z:z-from.z,arrived};
  },
  /** After collision: the step the caller actually took. A blocked step loses the blocked part of the velocity. */
  moved(wanted:Vec,actual:Vec,dt:number){
   if(!(dt>0))return;const w=Math.hypot(wanted.x,wanted.z),a=Math.hypot(actual.x,actual.z);
   if(w<1e-9||a>=w-1e-6)return;
   // Keep only the part of the velocity that the wall let through (sliding keeps the parallel part).
   if(a<1e-9){vx=vz=0;return;}
   const ux=actual.x/a,uz=actual.z/a,along=Math.max(0,vx*ux+vz*uz);vx=ux*along;vz=uz*along;
  },
 };
}
export type Motion=ReturnType<typeof createMotion>;

/** Facing: turn from `heading` toward the way they moved this frame (Three.js rotation.y = atan2(dx, dz)). */
export function turnToward(heading:number,dx:number,dz:number,dt:number,rate=TURN_RATE){
 if(Math.hypot(dx,dz)<1e-7||!(dt>0))return heading;
 const goal=Math.atan2(dx,dz),diff=wrap(goal-heading),max=rate*(Math.abs(diff)>REVERSAL?2:1)*dt;
 return Math.abs(diff)<=max?goal:heading+Math.sign(diff)*max;
}

/** A view that follows a character along a route: the view (rig yaw, Engine convention: looks along −(sin, cos)) eases after their facing at
 *  `omega` per second, so the camera turns with the path without whipping round its corners. */
export function followHeading(yaw:number,heading:number,dt:number,omega=6){
 const goal=heading+Math.PI,diff=wrap(goal-yaw);return yaw+diff*(1-Math.exp(-omega*Math.max(0,Math.min(.05,dt))));
}
