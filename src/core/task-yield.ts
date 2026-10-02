/** One cooperative task boundary, not a frame loop. Never substitute a microtask.
 * Cancellation retires pending work; running code is not preemptible. */
export type TaskScheduler = (resume: () => void) => (() => void);
interface NativeTaskScheduler {
 postTask(callback:()=>void,options:{signal:AbortSignal;priority:'user-visible'}):Promise<unknown>;
}
/** Feature detection keeps unsupported runtimes on a cancellable timer task. */
export const scheduleTask: TaskScheduler = resume => {
 let done=false,timer:ReturnType<typeof setTimeout>|undefined;
 const controller=new AbortController();
 const invoke=()=>{if(done)return;done=true;resume();};
 const fallback=()=>{if(!done&&timer===undefined)timer=globalThis.setTimeout(invoke,0);};
 const scheduler=(globalThis as typeof globalThis&{scheduler?:NativeTaskScheduler}).scheduler;
 if(typeof scheduler?.postTask==='function'){
  let returned=false,inline=false;
  try{
   const pending=scheduler.postTask(()=>{if(!returned){inline=true;return;}invoke();},{signal:controller.signal,priority:'user-visible'});
   returned=true;
   // Also tolerate a nonconforming synchronous adapter without running inline.
   if(inline)fallback();
   void pending.catch(()=>fallback());
  }catch{fallback();}
 }else fallback();
 return ()=>{if(done)return;done=true;if(timer!==undefined)globalThis.clearTimeout(timer);controller.abort();};
};
