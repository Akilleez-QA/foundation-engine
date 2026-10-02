/** Readiness for programs recorded by the owning context tracker; no renderer-private state. */
export type ProgramReadiness = 'ready' | 'unsupported' | 'retired';
export interface ProgramReadinessOptions {
  maxPrograms?: number;
  validate?: (program:WebGLProgram)=>void;
  maxWaitMs?: number;
  now?: () => number;
  request?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
}
export function waitForPrograms(gl: Pick<WebGL2RenderingContext, 'getExtension' | 'getProgramParameter' | 'isContextLost'>,
  tracked: ReadonlyMap<object, string>, signal: AbortSignal, options: ProgramReadinessOptions = {}): Promise<ProgramReadiness> {
  const {validate,maxPrograms=1024,maxWaitMs=15000,now=()=>performance.now(),request=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id)}=options;
  if(!Number.isSafeInteger(maxPrograms)||maxPrograms<1||maxPrograms>4096||!Number.isFinite(maxWaitMs)||maxWaitMs<=0||maxWaitMs>60000)throw Error('Invalid program readiness bounds');
  if(signal.aborted||gl.isContextLost())return Promise.resolve('retired');
  const extension=gl.getExtension('KHR_parallel_shader_compile') as {COMPLETION_STATUS_KHR:number}|null;
  if(signal.aborted||gl.isContextLost())return Promise.resolve('retired');
  const programs:WebGLProgram[]=[];
  for(const [handle,kind]of tracked)if(kind==='deleteProgram'){
    if(programs.length===maxPrograms)return Promise.reject(Error('Program readiness capacity exceeded'));
    programs.push(handle as WebGLProgram);
  }
  if(!extension){
    try{for(const program of programs){if(signal.aborted||gl.isContextLost())return Promise.resolve('retired');if(tracked.get(program)==='deleteProgram')validate?.(program);}return Promise.resolve(signal.aborted||gl.isContextLost()?'retired':'unsupported');}
    catch(error){return Promise.reject(error);}
  }
  const deadline=now()+maxWaitMs;
  return new Promise((resolve,reject)=>{
    let frame:number|undefined,done=false;
    const finish=(result:ProgramReadiness|Error)=>{
      if(done)return;done=true;if(frame!==undefined)cancel(frame);frame=undefined;signal.removeEventListener('abort',retire);
      if(result instanceof Error)reject(result);else resolve(result);
    };
    const retire=()=>finish('retired');
    const check=()=>{
      frame=undefined;if(done)return;
      try{
        if(signal.aborted||gl.isContextLost()){retire();return;}
        let pending=false;
        for(const program of programs){
          if(signal.aborted||gl.isContextLost()){retire();return;}
          // A deleted program no longer belongs to this preparation and must not be queried.
          if(tracked.get(program)!=='deleteProgram')continue;
          if(!gl.getProgramParameter(program,extension.COMPLETION_STATUS_KHR))pending=true;
          if(signal.aborted){retire();return;}
        }
        if(!pending){
          for(const program of programs){if(signal.aborted||gl.isContextLost()){retire();return;}if(tracked.get(program)==='deleteProgram')validate?.(program);}
          if(signal.aborted||gl.isContextLost()){retire();return;}
          finish('ready');return;
        }
        if(now()>=deadline){finish(Error('Program readiness timed out'));return;}
        frame=request(check);
      }catch(error){finish(error instanceof Error?error:Error(String(error)));}
    };
    signal.addEventListener('abort',retire,{once:true});check();
  });
}
