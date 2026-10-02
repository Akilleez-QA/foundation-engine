import * as THREE from 'three';
import {installProgramValidation,ProgramLinkError} from '../../../src/platform/render/program-validation';
/** Native correctness oracle: bundle as an IIFE and call run() in an isolated browser. */
export function run(){
 const canvas=document.createElement('canvas');document.body.append(canvas);
 const renderer=new THREE.WebGLRenderer({canvas}),gl=renderer.getContext(),validation=installProgramValidation(gl);
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
  assert(logReads===0,'Success logs read in failure-only mode');results.push({name:'valid draw without success logs',passed:true});
  const malformed=new THREE.ShaderMaterial({vertexShader:material.vertexShader,fragmentShader:'INVALID SHADER'});materials.push(malformed);mesh.material=malformed;
  let failure:unknown;try{renderer.render(scene,camera);}catch(error){failure=error;}
  assert(failure instanceof ProgramLinkError,'Late malformed shader not rejected');results.push({name:'late malformed shader',passed:true,details:(failure as ProgramLinkError).shaderLogs});
  renderer.debug.checkShaderErrors=true;let diagnostics=0;renderer.debug.onShaderError=()=>{diagnostics++;};
  const explicit=new THREE.ShaderMaterial({vertexShader:material.vertexShader,fragmentShader:'ANOTHER INVALID SHADER'});materials.push(explicit);mesh.material=explicit;
  failure=undefined;try{renderer.render(scene,camera);}catch(error){failure=error;}
  assert(failure instanceof ProgramLinkError&&diagnostics===1,'Explicit full diagnostics lost');results.push({name:'full diagnostics callback and typed failure',passed:true});
  const old=gl.createProgram()!;validation.clear();let stale:unknown;try{gl.linkProgram(old);}catch(error){stale=error;}
  assert(stale instanceof ProgramLinkError,'Retired handle revived');results.push({name:'unlinked old epoch cannot relink',passed:true});
  return {backend,khr:!!gl.getExtension('KHR_parallel_shader_compile'),results,scope:'Native shader correctness, not timing or actual context-loss acceptance'};
 }finally{geometry.dispose();for(const value of materials)value.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
}
