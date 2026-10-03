import {scheduleTask,type TaskScheduler} from '../../core/task-yield';
import type {Lease} from './lease-cache';
import type {DependencyBudget} from './dependency-budget';
export interface DependencyNode {id:string;dependencies:readonly string[];bytes:number}
export interface DependencyValue<T> {lease:Pick<Lease<T>,'value'|'release'>;bytes:number}
export interface DependencyOptions<T> {nodes:readonly DependencyNode[];required:readonly string[];maxPinnedBytes:number;maxConcurrent:number;budget?:DependencyBudget;signal?:AbortSignal;/** A cancellable real task boundary; injected schedulers must not resume synchronously. */scheduleTask?:TaskScheduler;acquire(id:string,signal:AbortSignal):Promise<DependencyValue<T>>}
/** Closure ownership over existing leases. pump() belongs to the application's existing preparation/frame owner. */
export function createDependencyLease<T>(options:DependencyOptions<T>){
 const nodes=new Map<string,DependencyNode>(),order:string[]=[],critical=new Set<string>();
 const {maxPinnedBytes,maxConcurrent}=options;
 const yieldTask=options.scheduleTask??scheduleTask;
 if(!Number.isSafeInteger(maxPinnedBytes)||maxPinnedBytes<0||!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||options.nodes.length>1024)throw Error('dependency: invalid limits');
 let total=0,edges=0;
 for(const row of options.nodes){if(typeof row.id!=='string'||!row.id||row.id.length>256||nodes.has(row.id)||!Number.isSafeInteger(row.bytes)||row.bytes<0)throw Error('dependency: invalid node');total+=row.bytes;edges+=row.dependencies.length;if(!Number.isSafeInteger(total)||total>maxPinnedBytes||edges>8192)throw Error('dependency: admission exceeded');nodes.set(row.id,Object.freeze({...row,dependencies:Object.freeze([...row.dependencies])}));}
 const visiting=new Set<string>(),visited=new Set<string>(),depths=new Map<string,number>();
 function visit(id:string,depth:number){const node=nodes.get(id);if(!node||depth>64||visiting.has(id))throw Error('dependency: invalid graph');if(visited.has(id))return;visiting.add(id);for(const child of node.dependencies)visit(child,depth+1);const height=1+Math.max(0,...node.dependencies.map(child=>depths.get(child)!));if(height>65)throw Error('dependency: invalid graph');depths.set(id,height);visiting.delete(id);visited.add(id);order.push(id);}
 for(const id of nodes.keys())visit(id,0);
 function require(id:string){if(!nodes.has(id))throw Error('dependency: missing critical node');if(critical.has(id))return;critical.add(id);for(const child of nodes.get(id)!.dependencies)require(child);}
 for(const id of options.required)require(id);
 // Stable topological priority; pending critical work retains one concurrency slot.
 order.sort((a,b)=>Number(critical.has(b))-Number(critical.has(a)));
 // All-or-nothing admission avoids owners pinning partial closures while waiting for each other.
 // Validation precedes reservation; an already cancelled owner reserves nothing.
 const reservation=options.signal?.aborted?undefined:options.budget?.reserve(total);
 const acquisitions=new Map<string,AbortController>(),pending=new Set<string>();
 const states=new Map(order.map(id=>[id,'waiting' as 'waiting'|'loading'|'ready'|'failed'])),held=new Map<string,DependencyValue<T>>();
 const completed:{id:string;value?:DependencyValue<T>;error?:unknown}[]=[];const waiters=new Set<()=>void>();const notify=()=>{for(const wake of waiters)wake();waiters.clear();};
 let cursor=0,active=0,closed=false,failure=false,releaseErrors=0;
 const taskWaiters=new Set<()=>void>();
 const yieldTurn=()=>new Promise<void>((resolve,reject)=>{
  let done=false,cancelTask:(()=>void)|undefined;
  const finish=()=>{if(done)return;done=true;taskWaiters.delete(finish);try{cancelTask?.();resolve();}catch(error){reject(error);}};
  taskWaiters.add(finish);
  try{cancelTask=yieldTask(finish);if(done)cancelTask();}
  catch(error){done=true;taskWaiters.delete(finish);reject(error);}
 });
 let reservationReleased=false;
 const releaseAdmission=()=>{if(closed&&active===0&&!reservationReleased){reservationReleased=true;reservation?.release();}};
 const release=(id:string,value:DependencyValue<T>)=>{try{value.lease.release();}catch{releaseErrors++;}finally{acquisitions.get(id)?.abort();acquisitions.delete(id);}};
 const cleanup=()=>{
  // Cancellation stops delivery immediately, but prerequisites remain owned until all
  // acquisitions settle. An adapter may still be using them while observing abort.
  for(const id of pending)acquisitions.get(id)?.abort();
  for(const item of completed.splice(0)){active--;if(item.value)held.set(item.id,item.value);}
  if(active===0)for(const id of [...order].reverse()){const value=held.get(id);if(value){held.delete(id);release(id,value);}}
  releaseAdmission();notify();for(const wake of [...taskWaiters])wake();options.signal?.removeEventListener('abort',cancel);
 };
 const cancel=()=>{if(closed)return;closed=true;cleanup();};
 options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
 const admissible=(id:string)=>{
  if(critical.has(id))return true;
  let criticalPending=false;for(const key of critical)if(states.get(key)!=='ready'){criticalPending=true;break;}
  if(!criticalPending)return true;
  let optionalLoading=0;for(const key of order)if(!critical.has(key)&&states.get(key)==='loading')optionalLoading++;
  return optionalLoading<maxConcurrent-1;
 };
 const owner={
  pump(maxWork:number){if(!Number.isSafeInteger(maxWork)||maxWork<0)throw Error('dependency: invalid work');if(closed)return 0;let work=0;
   while(completed.length&&work<maxWork){const item=completed.shift()!;work++;active--;
    if(item.error!==undefined||!item.value||!Number.isSafeInteger(item.value.bytes)||item.value.bytes<0||item.value.bytes>nodes.get(item.id)!.bytes){if(item.value)release(item.id,item.value);if(closed)return work;states.set(item.id,'failed');if(critical.has(item.id)){failure=true;closed=true;cleanup();return work;}}
    else {held.set(item.id,item.value);states.set(item.id,'ready');}
   }
   for(let examined=0;examined<order.length&&work<maxWork&&active<maxConcurrent;examined++){const id=order[cursor]!;/* cursor < order.length (non-empty inside this loop) */cursor=(cursor+1)%order.length;work++;if(states.get(id)!=='waiting')continue;
    if(!admissible(id))continue;
    const node=nodes.get(id)!;
    if(node.dependencies.some(d=>states.get(d)==='failed')){states.set(id,'failed');continue;}
    if(node.dependencies.some(d=>states.get(d)!=='ready'))continue;
    states.set(id,'loading');active++;
    const controller=new AbortController();acquisitions.set(id,controller);pending.add(id);
    Promise.resolve().then(()=>{if(closed||controller.signal.aborted)throw Error('dependency: cancelled');return options.acquire(id,controller.signal);}).then(value=>{pending.delete(id);if(closed){held.set(id,value);active--;cleanup();}else {completed.push({id,value});notify();}},error=>{pending.delete(id);controller.abort();acquisitions.delete(id);if(closed){active--;cleanup();}else {completed.push({id,error:error??Error('dependency: acquire failed')});notify();}});
   }return work;
  },
  get status():'pending'|'ready'|'partial'|'failed'|'closed'{if(failure)return 'failed';if(closed)return 'closed';if([...critical].some(id=>states.get(id)!=='ready'))return 'pending';return [...states.values()].every(s=>s==='ready')?'ready':'partial';},
  get(id:string):T|undefined{return closed?undefined:held.get(id)?.lease.value;},
  get stats(){return {reservedBytes:reservation?reservationReleased?0:total:closed?0:total,active,ready:held.size,releaseErrors};},
  /** Existing router SceneRun.ready may await this bounded preparation, without a frame loop. */
  async prepare(maxWork=16):Promise<void>{
   if(!Number.isSafeInteger(maxWork)||maxWork<1)throw Error('dependency: invalid preparation budget');
   while(owner.status==='pending'){
    owner.pump(maxWork);
    if(owner.status!=='pending')break;
    // Always cross a real task boundary, including immediately resolved acquisitions.
    // Waiting only for completion promises otherwise drains the graph in one microtask checkpoint.
    try{await yieldTurn();}catch(error){cancel();throw error;}
    // After the cooperative boundary, sleep on real completion rather than polling stalled I/O.
    const runnable=active<maxConcurrent&&order.some(id=>states.get(id)==='waiting'&&admissible(id)&&nodes.get(id)!.dependencies.every(child=>states.get(child)==='ready'));
    if(!closed&&active>0&&!completed.length&&!runnable)await new Promise<void>(resolve=>waiters.add(resolve));
   }
   if(owner.status==='failed'||owner.status==='closed')throw Error(`dependency: ${owner.status}`);
  },
  dispose:cancel,
 };return owner;
}
