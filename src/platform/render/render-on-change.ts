import * as T from 'three';

// Kept for areas not yet converted to scheduler change tracking (a migration aid, STD-RUN-8) until their adoption rows
// (ADR 0061). Every other on-demand scene uses `onDemandFrames` in platform/render/shadows.ts (the observing trackers).

type View=readonly [T.Object3D,T.Camera];
const objectHook=T.Object3D.prototype.onBeforeRender,materialHook=T.Material.prototype.onBeforeRender,compileHook=T.Material.prototype.onBeforeCompile;
/** Mark an onBeforeRender hook that changes nothing a still frame would show (e.g. lazy texture filtering). */
export const stillSafeHook=<F extends object>(hook:F)=>{(hook as {stillSafe?:boolean}).stillSafe=true;return hook;};
/** Skips identical frames: `changed()` is true when anything a render would draw differs from the last frame it
 *  returned true for (cameras, canvas size, object transforms and visibility, geometry and texture uploads, material
 *  and uniform values, lights, background, fog). Content it cannot see changing (per-frame shader hooks, skinning,
 *  video) always counts as changed. For loops that otherwise redraw a still scene at display refresh rate. */
export function createRenderOnChange(){
 let data=new Float64Array(2048),last=new Float64Array(2048),n=0,size=-1,lastHeader=-1,coast=false,still=0,force=false,frame=0;const seen=new WeakMap<object,number>(),fields=new WeakMap<object,{version:number;numbers:string[];colors:string[];textures:string[];other:string[]}>();
 const push=(v:number)=>{if(n===data.length){const grown=new Float64Array(n*2);grown.set(data);data=grown;}data[n++]=v;};
 const matrix=(m:T.Matrix4)=>{const e=m.elements;for(let i=0;i<16;i++)push(e[i]);};
 // Local transforms of every visible node imply the world transforms, without a second updateMatrixWorld per frame.
 const local=(o:T.Object3D)=>{if(!o.matrixAutoUpdate)return matrix(o.matrix);const {position:p,quaternion:q,scale:k}=o;push(p.x);push(p.y);push(p.z);push(q.x);push(q.y);push(q.z);push(q.w);push(k.x);push(k.y);push(k.z);};
 const value=(v:unknown)=>{
  if(typeof v==='number')push(v);else if(typeof v==='boolean')push(v?1:0);else if(!v||typeof v!=='object')return;
  else if((v as T.Color).isColor){const c=v as T.Color;push(c.r);push(c.g);push(c.b);}
  else if((v as T.Texture).isTexture)texture(v as T.Texture);
  else if((v as {isVector2?:boolean}).isVector2||(v as {isVector3?:boolean}).isVector3||(v as T.Vector4).isVector4||(v as T.Quaternion).isQuaternion){const x=v as T.Vector4;push(x.x);push(x.y);push(x.z??0);push(x.w??0);}
  else if((v as {isMatrix4?:boolean}).isMatrix4||(v as T.Matrix3).isMatrix3){for(const e of (v as T.Matrix4).elements)push(e);}
  else if(Array.isArray(v)||ArrayBuffer.isView(v)){const list=v as ArrayLike<unknown>;for(let i=0;i<list.length;i++)value(list[i]);}
 };
 function texture(t:T.Texture){push(t.id);push(t.version);push(t.offset.x);push(t.offset.y);push(t.repeat.x);push(t.repeat.y);push(t.rotation);if((t as T.VideoTexture).isVideoTexture)force=true;}
 function material(m:T.Material){
  // three itself bumps the version of transparent double-sided materials on every draw (two passes).
  push((m as unknown as {id:number}).id);if(seen.get(m)===frame)return;seen.set(m,frame);if(!(m.transparent&&m.side===T.DoubleSide&&!m.forceSinglePass))push(m.version);
  // A compile hook marked still-safe (a shader patch whose inputs live in `uniforms`, read below) does not force redraws.
  if(m.onBeforeRender!==materialHook||m.onBeforeCompile!==compileHook&&!(m.onBeforeCompile as {stillSafe?:boolean}).stillSafe)force=true;
  const record=m as unknown as Record<string,unknown>;let f=fields.get(m);
  if(!f||f.version!==m.version){f={version:m.version,numbers:[],colors:[],textures:[],other:[]};for(const key of Object.keys(record)){const v=record[key] as {isColor?:boolean;isTexture?:boolean}|null;if(key==='uniforms'||key==='userData'||key==='version'||key[0]==='_'||typeof v==='string'||typeof v==='function')continue;(typeof v==='number'||typeof v==='boolean'?f.numbers:v?.isColor?f.colors:v?.isTexture||v===null&&/map$/i.test(key)?f.textures:f.other).push(key);}fields.set(m,f);}
  for(const key of f.numbers)push(+(record[key] as number));
  for(const key of f.colors){const c=record[key] as T.Color;push(c.r);push(c.g);push(c.b);}
  for(const key of f.textures){const t=record[key] as T.Texture|null;if(t)texture(t);else push(-1);}
  for(const key of f.other)value(record[key]);
  const uniforms=(m as T.ShaderMaterial).uniforms;if(uniforms)for(const key of Object.keys(uniforms))value(uniforms[key].value);
 }
 function visit(o:T.Object3D,mask:number){
  if(!o.visible)return;push(o.id);local(o);push(o.layers.mask&mask);push(o.renderOrder);
  if(o.onBeforeRender!==objectHook&&!(o.onBeforeRender as {stillSafe?:boolean}).stillSafe)force=true;
  const mesh=o as T.Mesh&T.InstancedMesh&T.SkinnedMesh&{isBatchedMesh?:boolean};
  if(mesh.geometry&&mesh.material){
   if(mesh.isSkinnedMesh||mesh.isBatchedMesh)force=true;
   const g=mesh.geometry;push(g.id);for(const key in g.attributes){const a=g.attributes[key];push((a as T.InterleavedBufferAttribute).isInterleavedBufferAttribute?(a as T.InterleavedBufferAttribute).data.version:(a as T.BufferAttribute).version);}
   push(g.index?.version??-1);push(g.drawRange.start);push(g.drawRange.count);push(g.groups.length);
   for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])material(m);
   if(mesh.isInstancedMesh){push(mesh.count);push(mesh.instanceMatrix.version);push(mesh.instanceColor?.version??-1);}
   if(mesh.morphTargetInfluences)for(const v of mesh.morphTargetInfluences)push(v);
   if((o as T.Sprite).isSprite){push((o as T.Sprite).center.x);push((o as T.Sprite).center.y);}
  }
  const light=o as T.SpotLight&T.HemisphereLight&T.DirectionalLight;
  if(light.isLight){value(light.color);push(light.intensity);value(light.groundColor);push(light.distance??0);push(light.angle??0);push(light.penumbra??0);push(light.decay??0);if(light.target){local(light.target);if(light.target.parent)matrix(light.target.parent.matrixWorld);}}
  for(const child of o.children)visit(child,mask);
 }
 return {
  changed(renderer:T.WebGLRenderer,...views:View[]){
   // Something just changed in the scene: draw the next frame too, and scan again only after it (halves scans while animating).
   if(coast){coast=false;return true;}
   n=0;force=false;frame++;const canvas=renderer.domElement;push(canvas.width);push(canvas.height);push(renderer.toneMapping);push(renderer.toneMappingExposure);
   for(const [root,camera] of views){
    local(root);if(root.parent)matrix(root.parent.matrixWorld);local(camera);if(camera.parent)matrix(camera.parent.matrixWorld);matrix(camera.projectionMatrix);push(camera.layers.mask);
    const scene=root as T.Scene;if(scene.isScene){value(scene.background);push(scene.backgroundIntensity);push(scene.backgroundBlurriness);value(scene.environment);push(scene.environmentIntensity);if(scene.fog){value(scene.fog.color);const fog=scene.fog as T.Fog&T.FogExp2;push(fog.near??0);push(fog.far??0);push(fog.density??0);}if(scene.overrideMaterial)material(scene.overrideMaterial);}
   }
   // A moving camera (moving, dragging) already means a new frame: skip the scene scan until it rests.
   const header=n;let moved=header!==lastHeader;for(let i=0;!moved&&i<header;i++)moved=data[i]!==last[i];
   if(moved){const swap=last;last=data;data=swap;lastHeader=header;size=-1;still=0;return true;}
   // Long still: read the scene every other frame (a change then shows one frame later).
   if(still>30&&frame%2)return false;
   for(const [root,camera] of views)for(const child of root.children)visit(child,camera.layers.mask);
   let changed=force||n!==size;for(let i=0;!changed&&i<n;i++)changed=data[i]!==last[i];
   if(changed){const swap=last;last=data;data=swap;size=n;coast=!force;still=0;}else still++;
   return changed;
  },
  /** The next frame draws whatever the scan says (after a context restore, or a change it cannot see). */
  invalidate(){size=-1;lastHeader=-1;coast=false;still=0;},
 };
}
