import {Matrix4,Vector3} from 'three';
import {authorPose,frameRef,type FrameRef,type Frames} from '../frames/frame';
export interface PortalEndpoint {frame:FrameRef;position:readonly[number,number,number]}
export interface NavigationPortal {id:string;revision:number;from:PortalEndpoint;to:PortalEndpoint;width:number;height:number;open:boolean}
export interface AgentClearance {radius:number;height:number}
const point=(value:PortalEndpoint):PortalEndpoint=>{if(value.position.length!==3||!value.position.every(Number.isFinite))throw Error('navigation: invalid portal endpoint');return Object.freeze({frame:frameRef(value.frame),position:Object.freeze([...value.position]) as PortalEndpoint['position']});};
export function definePortal(input:NavigationPortal):NavigationPortal{
 if(typeof input.id!=='string'||!input.id||input.id.length>256||!Number.isSafeInteger(input.revision)||input.revision<0||!Number.isFinite(input.width)||input.width<=0||!Number.isFinite(input.height)||input.height<=0||typeof input.open!=='boolean')throw Error('navigation: invalid portal');
 return Object.freeze({...input,from:point(input.from),to:point(input.to)});
}
/** Re-resolve both frame lifetimes and recheck clearance immediately before crossing. */
export function crossPortal(portal:NavigationPortal,revision:number,agent:AgentClearance,frames:Frames,ready:()=>boolean,clear:(from:readonly number[],to:readonly number[],agent:AgentClearance)=>boolean){
 const p=definePortal(portal),body=Object.freeze({...agent});
 if(!Number.isFinite(body.radius)||body.radius<=0||!Number.isFinite(body.height)||body.height<=0)throw Error('navigation: invalid body');
 if(p.revision!==revision)return {status:'stale' as const};
 if(!p.open)return {status:'blocked' as const};
 const fromMatrix=frames.resolve(p.from.frame),toMatrix=frames.resolve(p.to.frame);if(!fromMatrix||!toMatrix)return {status:'stale' as const};
 // Width/height are local lengths; unsupported shear/nonuniform frames must not overstate clearance.
 const scale=Math.min(Math.abs(authorPose(fromMatrix).scale),Math.abs(authorPose(toMatrix).scale));
 if(!Number.isFinite(scale)||scale<=0)throw Error('navigation: invalid portal scale');
 if(body.radius/scale>p.width/2||body.height/scale>p.height)return {status:'blocked' as const};
 const resolve=(e:PortalEndpoint)=>{const m=frames.resolve(e.frame);if(!m)return null;const position=new Vector3(...e.position).applyMatrix4(new Matrix4().fromArray(m)).toArray();if(!position.every(Number.isFinite))throw Error('navigation: portal transform overflow');return Object.freeze(position);};
 const from=resolve(p.from),to=resolve(p.to);if(!from||!to)return {status:'stale' as const};
 if(!ready())return {status:'unavailable' as const};
 if(!clear(from,to,body))return {status:'blocked' as const};
 // Callback code can relocate/remove a dependency; never commit a stale transform.
 const afterFrom=resolve(p.from),afterTo=resolve(p.to);
 if(!ready())return {status:'unavailable' as const};
 const finalFrom=frames.resolve(p.from.frame),finalTo=frames.resolve(p.to.frame);
 if(!finalFrom||!finalTo||finalFrom.some((v,i)=>v!==fromMatrix[i])||finalTo.some((v,i)=>v!==toMatrix[i]))return {status:'stale' as const};
 if(!afterFrom||!afterTo||afterFrom.some((v,i)=>v!==from[i])||afterTo.some((v,i)=>v!==to[i]))return {status:'stale' as const};
 return {status:'ready' as const,from,to};
}

import {createNavigationGraph,type NavigationEdge} from './search';
/** Filter frame-invalid, closed or undersized links during planning; crossing must still revalidate. */
export function createPortalGraph(nodes:readonly {id:string;edges:readonly (NavigationEdge&{portal?:NavigationPortal})[]}[],body:AgentClearance,frames:Frames){
 return createNavigationGraph(nodes.map(node=>({id:node.id,edges:node.edges.filter(edge=>!edge.portal||crossPortal(edge.portal,edge.portal.revision,body,frames,()=>true,()=>true).status==='ready').map(({to,cost})=>({to,cost}))})));
}
