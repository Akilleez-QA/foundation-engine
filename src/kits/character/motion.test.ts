import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ACCEL_TIME,createMotion,STOP_TIME,turnToward} from './motion';

/** Hold a direction for `hold` seconds, then let go, at a fixed frame rate: positions over time. */
function walk(fps:number,hold:number,total:number,speed=3.8){
 const m=createMotion({speed}),dt=1/fps;let x=0;const at:number[]=[];
 for(let t=0;t<total-1e-9;t+=dt){const s=m.step({x:t<hold-1e-9?1:0,z:0},dt);x+=s.x;at.push(x);}
 return {x,at,m};
}

test('walking reaches top speed in ACCEL_TIME and stops in STOP_TIME, independent of frame rate',()=>{
 for(const fps of [30,60,120,144]){
  const m=createMotion({speed:3.8}),dt=1/fps;let t=0;
  while(Math.hypot(m.velocity.x,m.velocity.z)<3.8-1e-9){m.step({x:1,z:0},dt);t+=dt;}
  assert.ok(Math.abs(t-ACCEL_TIME)<=dt+1e-9,`${fps} fps: top speed after ${t}`);
  t=0;while(Math.hypot(m.velocity.x,m.velocity.z)>0){m.step({x:0,z:0},dt);t+=dt;}
  assert.ok(Math.abs(t-STOP_TIME)<=dt+1e-9,`${fps} fps: stopped after ${t}`);
 }
 // Distance walked for the same hold differs by well under a centimetre between 30 and 144 fps.
 const a=walk(30,1,1.5).x,b=walk(144,1,1.5).x;assert.ok(Math.abs(a-b)<.01,`${a} vs ${b}`);
});

test('a tap still moves at once, and a release never keeps their walking for more than a short coast',()=>{
 const {at}=walk(60,1/60,.5);assert.ok(at[0]>0,'moves on the first frame');
 const {x}=walk(60,1,1.2);const {x:held}=walk(60,1,1);assert.ok(x-held<3.8*STOP_TIME/2+.01,'coast after release is about half the stop time at top speed');
});

test('a stick tilt walks slower; diagonal input is never faster than straight',()=>{
 const m=createMotion({speed:4});for(let i=0;i<60;i++)m.step({x:.5,z:0},1/60);assert.ok(Math.abs(m.velocity.x-2)<1e-9);
 const d=createMotion({speed:4});for(let i=0;i<60;i++)d.step({x:1,z:1},1/60);assert.ok(Math.abs(Math.hypot(d.velocity.x,d.velocity.z)-4)<1e-9);
});

test('a wall takes away only the blocked part of the velocity',()=>{
 const m=createMotion({speed:4});for(let i=0;i<30;i++)m.step({x:1,z:1},1/60);
 m.moved({x:.05,z:.05},{x:.05,z:0},1/60);assert.ok(m.velocity.z===0&&m.velocity.x>2.8&&m.velocity.x<2.9);
 m.moved({x:.05,z:0},{x:0,z:0},1/60);assert.deepEqual(m.velocity,{x:0,z:0});
});

test('My eyes: a turn swings the walk with the view instead of skidding',()=>{
 const m=createMotion({speed:4});for(let i=0;i<30;i++)m.step({x:1,z:0},1/60,{snap:true});
 // Turning 2° a frame (the 110°/s key turn): the walk stays on the view and keeps its speed.
 for(let i=1;i<=45;i++){const a=i*2*Math.PI/180,s=m.step({x:Math.cos(a),z:Math.sin(a)},1/60,{snap:true});
  assert.ok(Math.abs(Math.atan2(m.velocity.z,m.velocity.x)-a)<1e-9);assert.ok(Math.hypot(s.x,s.z)>4/60*.99);}
});

test('routes: no stall at corners, no overshoot, and they stops exactly on the last point',()=>{
 for(const fps of [30,60,120]){
  const route=[{x:0,z:0},{x:.5,z:0},{x:1,z:0},{x:1,z:.5},{x:1,z:1},{x:3,z:1}],m=createMotion({speed:3.8}),p={x:0,z:0},dt=1/fps;
  let frames=0,stalls=0,arrived=false,moving=false;
  while(!arrived&&frames<1000){const s=m.follow(route,p,dt);frames++;const d=Math.hypot(s.x,s.z);if(moving&&d<1e-9&&!s.arrived)stalls++;if(d>0)moving=true;p.x+=s.x;p.z+=s.z;arrived=s.arrived;}
  assert.ok(arrived,`${fps}: arrived`);assert.equal(stalls,0,`${fps}: stalls`);assert.equal(route.length,0);
  assert.ok(Math.hypot(p.x-3,p.z-1)<1e-9,`${fps}: ends on the point ${JSON.stringify(p)}`);
  assert.deepEqual(m.velocity,{x:0,z:0});
  // Path length 4 m at 3.8 m/s plus the ramps: about 1.2 s whatever the frame rate.
  assert.ok(Math.abs(frames*dt-1.2)<.1,`${fps}: ${frames*dt}s`);
 }
});

test('facing turns at a bounded rate, faster for a reversal, and settles on the heading',()=>{
 let h=0;const steps:number[]=[];for(let i=0;i<30;i++){const n=turnToward(h,1,0,1/60);steps.push(Math.abs(n-h));h=n;}
 assert.ok(Math.max(...steps)<=720*Math.PI/180/60+1e-9);assert.ok(Math.abs(h-Math.PI/2)<1e-9);
 const r=turnToward(0,0,-1,1/60);assert.ok(Math.abs(r)>1.4*720*Math.PI/180/60,'a reversal pivots faster');
 assert.equal(turnToward(.3,0,0,1/60),.3,'standing still keeps the facing');
});
