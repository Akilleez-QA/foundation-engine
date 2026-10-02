/** Native link validation, owned once by a context rather than by a renderer lease. */
export class ProgramLinkError extends Error {
  constructor(readonly programLog:string,readonly shaderLogs:readonly string[]){
    super(`Shader program link failed${programLog?`: ${programLog}`:''}`);this.name='ProgramLinkError';
  }
}
export interface ProgramValidation { validate(program:WebGLProgram):void; clear():void }
const installed=new WeakMap<WebGL2RenderingContext,ProgramValidation>();
export function installProgramValidation(gl:WebGL2RenderingContext):ProgramValidation {
  const existing=installed.get(gl);if(existing)return existing;
  const deleted=new WeakSet<WebGLProgram>(),epochs=new WeakMap<WebGLProgram,number>();let epoch=0;
  // Weak keys do not retain deleted programs. A new map also retires a lost context's generations.
  let verdicts=new WeakMap<WebGLProgram,true|ProgramLinkError>();
  const create=gl.createProgram.bind(gl),link=gl.linkProgram.bind(gl),use=gl.useProgram.bind(gl),remove=gl.deleteProgram.bind(gl);
  const validate=(program:WebGLProgram)=>{
    if(gl.isContextLost())return;
    if(deleted.has(program))throw new ProgramLinkError('Program was deleted',[]);
    const generation=epochs.get(program);
    if(generation!==undefined&&generation!==epoch)throw new ProgramLinkError('Program context was retired',[]);
    epochs.set(program,epoch);
    const prior=verdicts.get(program);
    if(prior===true)return;if(prior)throw prior;
    const valid=gl.getProgramParameter(program,gl.LINK_STATUS);
    if(gl.isContextLost())return;
    if(valid===true){verdicts.set(program,true);return;}
    // Read diagnostics only for an unsuccessful link; successful warning collection remains a dev option.
    const bounded=(value:string|null)=> (value??'').slice(0,4096);
    const programLog=bounded(gl.getProgramInfoLog(program));
    const shaders=gl.getAttachedShaders(program)??[];
    const shaderLogs=shaders.slice(0,2).map(shader=>bounded(gl.getShaderInfoLog(shader)));
    const error=new ProgramLinkError(programLog,Object.freeze(shaderLogs));
    verdicts.set(program,error);throw error;
  };
  gl.createProgram=()=>{const program=create();if(program)epochs.set(program,epoch);return program;};
  gl.linkProgram=(program)=>{if(deleted.has(program))throw new ProgramLinkError('Program was deleted',[]);if(epochs.has(program)&&epochs.get(program)!==epoch)throw new ProgramLinkError('Program context was retired',[]);verdicts.delete(program);epochs.set(program,epoch);link(program);};
  gl.deleteProgram=(program)=>{if(program){verdicts.delete(program);deleted.add(program);}remove(program);};
  gl.useProgram=(program)=>{if(program)validate(program);use(program);};
  const api={validate,clear(){verdicts=new WeakMap();epoch++;}};
  installed.set(gl,api);return api;
}
