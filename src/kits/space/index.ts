import {defineKit,defineEnvironment,type EnvironmentState,type Vec3} from '../../author';
export function space(){return defineKit({id:'space'});}
/** Nested decorative populations: increasing quality preserves every existing identity/direction. */
export function decorativeStars(seed:number,count:number): {id:number;direction:Vec3;color:number}[] {
 if(!Number.isSafeInteger(seed)||!Number.isSafeInteger(count)||count<0||count>4096)throw Error('space: invalid population');
 let s=seed>>>0;const random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
 return Array.from({length:count},(_,id)=>{const y=random()*2-1,a=random()*Math.PI*2,r=Math.sqrt(Math.max(0,1-y*y));return {id,direction:[r*Math.cos(a),y,r*Math.sin(a)] as Vec3,color:0xffffff};});
}
/** One transition parameter coordinates visibility, light and haze. Points must share stable identities. */
export function environmentTransition(from:EnvironmentState,to:EnvironmentState,progress:number):EnvironmentState {
 if(!Number.isFinite(progress))throw Error('space: invalid transition');
 const a=defineEnvironment(from),b=defineEnvironment(to),t=Math.max(0,Math.min(1,progress));
 if(t===0)return a;if(t===1)return b;
 if(a.points.length!==b.points.length||a.points.some((p,i)=>p.direction.some((v,j)=>v!==b.points[i].direction[j])))throw Error('space: transition populations must share directions');
 if(Boolean(a.haze)!==Boolean(b.haze))throw Error('space: haze transitions require matching endpoints');
 const mix=(x:number,y:number)=>x*(1-t)+y*t;
 // Decode sRGB before mixing and encode afterwards.
 const linear=(x:number)=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;
 const srgb=(x:number)=>x<=0.0031308?12.92*x:1.055*x**(1/2.4)-0.055;
 const color=(x:number,y:number)=>[16,8,0].reduce((v,shift)=>v|(Math.round(srgb(mix(linear(((x>>shift)&255)/255),linear(((y>>shift)&255)/255)))*255)<<shift),0);
 return defineEnvironment({background:color(a.background,b.background),ambient:{sky:color(a.ambient.sky,b.ambient.sky),ground:color(a.ambient.ground,b.ambient.ground),intensity:mix(a.ambient.intensity,b.ambient.intensity)},directional:{color:color(a.directional.color,b.directional.color),intensity:mix(a.directional.intensity,b.directional.intensity),position:a.directional.position.map((v,i)=>mix(v,b.directional.position[i])) as Vec3},haze:a.haze&&b.haze?{color:color(a.haze.color,b.haze.color),near:mix(a.haze.near,b.haze.near),far:mix(a.haze.far,b.haze.far)}:null,points:a.points.map((p,i)=>({...p,color:color(p.color,b.points[i].color)})),pointSize:mix(a.pointSize,b.pointSize)});
}
/** Geometric horizon only; no atmosphere model. Unsupported at/inside the surface. */
export function horizon(radius:number,distance:number){
 if(!Number.isFinite(radius)||!Number.isFinite(distance)||radius<=0||distance<=radius)return null;
 const ratio=radius/distance;return {angularRadius:Math.asin(ratio),limbRadius:radius*Math.sqrt((1-ratio)*(1+ratio)),planeDistance:radius*ratio};
}
