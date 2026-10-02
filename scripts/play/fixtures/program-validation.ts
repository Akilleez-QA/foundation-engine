import * as THREE from 'three';
import {installProgramValidation,ProgramLinkError} from '../../../src/platform/render/program-validation';
/** Native correctness oracle: bundle as an IIFE and call run() in an isolated browser. */
export function run(){
 const canvas=document.createElement('canvas');document.body.append(canvas);
 const renderer=new THREE.WebGLRenderer({canvas}),gl=renderer.getContext() as WebGL2RenderingContext,validation=installProgramValidation(gl);
 const info=gl.getExtension('WEBGL_debug_renderer_info');
 const backend=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const results:{name:string;passed:boolean;details?:unknown}[]=[];
 const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
 let logReads=0;const readLog=gl.getProgramInfoLog.bind(gl);
 gl.getProgramInfoLog=program=>{logReads++;return readLog(program);};
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1,.1,10);camera.position.z=2;
 const geometry=new THREE.BoxGeometry(),material=new THREE.ShaderMaterial({vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'void main(){gl_FragColor=vec4(1.,0.,0.,1.);}'});
 const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);const materials=[material];
 try{
  renderer.debug.checkShaderErrors=false;renderer.compile(scene,camera);renderer.render(scene,camera);
  const pixel=new Uint8Array(4);gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  assert(pixel[0]!>=250&&pixel[1]!<=5&&pixel[2]!<=5&&pixel[3]!>=250,'Valid draw did not produce a red center pixel');
  assert(logReads===0,'Success logs read in failure-only mode');results.push({name:'valid red draw without success logs',passed:true,details:{pixel:[...pixel],readback:'diagnostic only, not performance'}});
  const malformed=new THREE.ShaderMaterial({vertexShader:material.vertexShader,fragmentShader:'INVALID SHADER'});materials.push(malformed);mesh.material=malformed;
  let failure:unknown;try{renderer.render(scene,camera);}catch(error){failure=error;}
  assert(failure instanceof ProgramLinkError,'Late malformed shader not rejected');results.push({name:'late malformed shader',passed:true,details:(failure as ProgramLinkError).shaderLogs});
  renderer.debug.checkShaderErrors=true;let diagnostics=0;renderer.debug.onShaderError=()=>{diagnostics++;};
  const explicit=new THREE.ShaderMaterial({vertexShader:material.vertexShader,fragmentShader:'ANOTHER INVALID SHADER'});materials.push(explicit);mesh.material=explicit;
  failure=undefined;try{renderer.render(scene,camera);}catch(error){failure=error;}
  assert(failure instanceof ProgramLinkError&&diagnostics===1,'Explicit full diagnostics lost');results.push({name:'full diagnostics callback and typed failure',passed:true});
  const linked=gl.createProgram()!,shaders:WebGLShader[]=[];
  for(const [type,source] of [[gl.VERTEX_SHADER,'#version 300 es\nout vec3 value;void main(){value=vec3(1.);gl_Position=vec4(0.);}'],[gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;in vec2 value;out vec4 color;void main(){color=vec4(value,0.,1.);}']] as const){
   const shader=gl.createShader(type)!;shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);assert(gl.getShaderParameter(shader,gl.COMPILE_STATUS)===true,'Mismatch shader did not compile');gl.attachShader(linked,shader);
  }
  gl.linkProgram(linked);failure=undefined;try{validation.validate(linked);}catch(error){failure=error;}
  assert(failure instanceof ProgramLinkError,'Link-only mismatch not rejected');results.push({name:'compiled shaders with incompatible varyings fail linkage',passed:true,details:(failure as ProgramLinkError).programLog});
  gl.deleteProgram(linked);for(const shader of shaders)gl.deleteShader(shader);
  const old=gl.createProgram()!;validation.clear();let stale:unknown;try{gl.linkProgram(old);}catch(error){stale=error;}
  assert(stale instanceof ProgramLinkError,'Retired handle revived');results.push({name:'unlinked old epoch cannot relink',passed:true});
  return {backend,khr:!!gl.getExtension('KHR_parallel_shader_compile'),results,scope:'Native shader correctness, not timing or actual context-loss acceptance'};
 }finally{geometry.dispose();for(const value of materials)value.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
}

/** Invoke these methods in separate browser tasks; loss and restore are asynchronous browser events. */
export function contextLossFixture(){
 const canvas=document.createElement('canvas');document.body.append(canvas);const gl=canvas.getContext('webgl2');if(!gl)throw Error('WebGL2 unavailable');
 const validation=installProgramValidation(gl),extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('Context loss extension unavailable');
 const old=gl.createProgram()!,events:string[]=[];let queries=0;
 const query=gl.getProgramParameter.bind(gl);gl.getProgramParameter=(...args:Parameters<typeof query>)=>{queries++;return query(...args);};
 canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();validation.clear();events.push('lost');});
 canvas.addEventListener('webglcontextrestored',()=>events.push('restored'));
 return {
  lose(){extension.loseContext();},
  restore(){if(!events.includes('lost'))throw Error('Loss notification pending');extension.restoreContext();},
  read(){return {events:[...events]};},
  verify(){
   if(!events.includes('restored'))throw Error('Restore notification pending');
   let stale:unknown;try{gl.linkProgram(old);}catch(error){stale=error;}
   if(!(stale instanceof ProgramLinkError)||queries!==0)throw Error('Old handle queried or revived');
   const program=gl.createProgram()!,vertex=gl.createShader(gl.VERTEX_SHADER)!,fragment=gl.createShader(gl.FRAGMENT_SHADER)!;
   gl.shaderSource(vertex,'#version 300 es\nvoid main(){gl_Position=vec4(0.);}');gl.compileShader(vertex);
   gl.shaderSource(fragment,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1.);}');gl.compileShader(fragment);
   gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);validation.validate(program);gl.useProgram(program);
   gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
   return {events:[...events],oldHandleQueries:0,freshLink:true,scope:'actual native loss/restore correctness, not timing'};
  },
  dispose(){extension.loseContext();canvas.remove();},
 };
}

/** Fence result follows a task yield; reading the red pixel is diagnostic only. */
export async function frameCompletion(){
 const {createFrameReadiness}=await import('../../../src/platform/render/frame-readiness');
 const canvas=document.createElement('canvas');document.body.append(canvas);const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true});if(!gl)throw Error('WebGL2 unavailable');
 const readiness=createFrameReadiness(gl,()=>false);try{
  gl.clearColor(1,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
  const ready=await readiness.wait(new AbortController().signal);if(ready!=='ready')throw Error('Fence unexpectedly retired');
  const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(pixel[0]!==255||pixel[1]!==0||pixel[2]!==0)throw Error('Submitted clear pixel mismatch');
  const owner=new AbortController(),canceled=readiness.wait(owner.signal);owner.abort();if(await canceled!=='retired')throw Error('Aborted fence published ready');
  return {ready,pixel:[...pixel],cancellation:'retired',scope:'preceding GPU command completion; diagnostic readback, not display presentation or performance'};
 }finally{readiness.retire();gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();}
}
