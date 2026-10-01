export type Solid=
 |{id:string;kind:'circle';x:number;z:number;r:number}
 |{id:string;kind:'box';x:number;z:number;halfX:number;halfZ:number;rotation?:number}
 |{id:string;kind:'polygon';x:number;z:number;inradius:number;sides:number;rotation?:number};
export function insideSolid(p:{x:number;z:number},s:Solid,inflate=0){
 const dx=p.x-s.x,dz=p.z-s.z;
 if(s.kind==='circle')return Math.hypot(dx,dz)<s.r+inflate;
 const c=Math.cos(-(s.rotation??0)),n=Math.sin(-(s.rotation??0)),lx=dx*c-dz*n,lz=dx*n+dz*c;
 if(s.kind==='box')return Math.abs(lx)<s.halfX+inflate&&Math.abs(lz)<s.halfZ+inflate;
 for(let i=0;i<s.sides;i++){const a=(i+.5)*Math.PI*2/s.sides;if(lx*Math.cos(a)+lz*Math.sin(a)>s.inradius+inflate)return false;}
 return true;
}

