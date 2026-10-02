import {createDependencyLease,type DependencyValue} from '../../../src/platform/assets/dependency-lease';
/** Task-queue oracle; bundle as an IIFE for an isolated native browser, or invoke in Node.
 * A bounded 0.25ms acquisition workload makes the timer eligible; no rendering or graphics context is required. */
export async function run(){
 let acquired=0,finished=false;
 const nodes=Array.from({length:256},(_,i)=>({id:String(i),dependencies:[],bytes:1}));
 const value=(id:string):DependencyValue<string>=>({bytes:1,lease:{value:id,release(){}}});
 const owner=createDependencyLease({nodes,required:nodes.map(n=>n.id),maxPinnedBytes:256,maxConcurrent:1,acquire:async id=>{const until=performance.now()+.25;while(performance.now()<until){}acquired++;return value(id);}});
 const sentinel=new Promise<{acquired:number;finished:boolean}>(resolve=>setTimeout(()=>resolve({acquired,finished}),0));
 try{
  const pending=owner.prepare(4).then(()=>{finished=true;});
  const observed=await sentinel;await pending;
  if(observed.finished||observed.acquired<=0||observed.acquired>=nodes.length)throw Error(`Task starvation: ${JSON.stringify(observed)}`);
  return {observed,total:acquired,scope:'Actual scheduled task interleaving; not a frame-time or physical-device guarantee'};
 }finally{owner.dispose();}
}
