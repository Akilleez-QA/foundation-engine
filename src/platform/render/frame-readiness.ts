import {monotonicNow} from '../../core/clock';
/** Completion of preceding GPU commands, not display presentation or future work. */
export class FrameReadinessError extends Error {}
export interface FrameReadinessOptions {
 maxWaitMs?:number;
 now?:()=>number;
 /** Must enqueue a later browser task, never invoke the callback synchronously. */
 schedule?:(callback:()=>void)=>unknown;
 cancel?:(handle:unknown)=>void;
}
export function createFrameReadiness(gl:WebGL2RenderingContext,retired:()=>boolean,options:FrameReadinessOptions={}){
 const {maxWaitMs=15000,now=monotonicNow,schedule=fn=>setTimeout(fn,10),cancel=handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)}=options;
 if(!Number.isFinite(maxWaitMs)||maxWaitMs<=0||maxWaitMs>60000)throw Error('Invalid frame readiness bounds');
 let pending:(()=>void)|undefined;
 return {
  wait(signal:AbortSignal):Promise<'ready'|'retired'>{
   pending?.();if(signal.aborted||retired()||gl.isContextLost())return Promise.resolve('retired');
   let sync:WebGLSync|null;
   try{sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);}catch(error){return Promise.reject(error);}
   if(!sync)return Promise.reject(new FrameReadinessError('GPU completion fence unavailable'));
   return new Promise((resolve,reject)=>{
    let task:unknown,scheduled=false,done=false;const deadline=now()+maxWaitMs;
    const finish=(result:'ready'|'retired'|unknown)=>{
     if(done)return;done=true;
     let cleanupError:unknown;
     const clean=(operation:()=>void)=>{try{operation();}catch(error){cleanupError??=error;}};
     if(scheduled)clean(()=>cancel(task));scheduled=false;
     clean(()=>signal.removeEventListener('abort',abort));
     if(pending===abort)pending=undefined;
     clean(()=>{if(!gl.isContextLost())gl.deleteSync(sync);});
     if(cleanupError!==undefined){reject(cleanupError);return;}
     if(result==='ready'||result==='retired')resolve(result);else reject(result);
    };
    const abort=()=>finish('retired');pending=abort;signal.addEventListener('abort',abort,{once:true});
    const live=()=>!signal.aborted&&!retired()&&!gl.isContextLost();
    const poll=()=>{
     scheduled=false;if(done)return;
     try{
      if(!live()){abort();return;}
      const status=gl.clientWaitSync(sync,0,0);
      if(!live()){abort();return;}
      if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED){finish('ready');return;}
      if(status===gl.WAIT_FAILED)throw new FrameReadinessError('GPU completion fence failed');
      if(now()>=deadline)throw new FrameReadinessError('GPU completion fence timed out');
      enqueue();
     }catch(error){finish(error);}
    };
    const enqueue=()=>{
     let returned=false;
     const handle=schedule(()=>{if(!returned){finish(new FrameReadinessError('Frame scheduler must yield a task'));return;}poll();});
     returned=true;
     if(done){cancel(handle);return;}
     task=handle;scheduled=true;
    };
    try{
     if(!live()){abort();return;}
     gl.flush();if(done)return;if(!live()){abort();return;}
     // A real browser task boundary is required before checking a newly submitted fence.
     enqueue();
    }catch(error){finish(error);}
   });
  },
  retire(){pending?.();},
 };
}
