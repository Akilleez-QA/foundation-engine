import {lazy,type Lazy} from '../registry';
import {recoverableImport} from './chunk-retry';
/** Keep chunk retry on the module request, before mapping its exports to a feature's implementation. */
export function lazyBody<M,T>(load:()=>Promise<M>,bind:(module:M)=>T|Promise<T>):Lazy<T>{
 const request=recoverableImport(load);
 return lazy(async()=>bind(await request()));
}
