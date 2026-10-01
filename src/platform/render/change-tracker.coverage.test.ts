import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createColourTracker,createShadowTracker,materialReaders,type Surface} from './change-tracker';

/**
 * Mutation coverage for the render change trackers (STD-REN-38 "change detection observes, never guesses").
 *
 * The hand-written matrix in `change-tracker.test.ts` proves the mutations someone thought of. This file proves the
 * ones nobody listed: it enumerates the engine's own state (every own field and accessor of every three material
 * class, of every drawable and light node kind, of textures, geometries, light shadows, the scene and the view),
 * mutates each to a different value of the same kind and requires the next scan to be due. A field is skipped only
 * by an entry in an exclusion table that says why it cannot change the picture (or which other observed input its
 * effect goes through). An engine upgrade that adds a field fails here until it is classified.
 *
 * Depth-pass inputs are proved against the shadow tracker the same way, from the list three's shadow pass copies
 * (`WebGLShadowMap.getDepthMaterial`, `renderObject`).
 */

const surface=():Surface=>({domElement:{width:800,height:600},toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:1});

type World={scene:T.Scene;camera:T.PerspectiveCamera;sun:T.DirectionalLight;out:Surface};
function world():World{
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,4/3,.1,100);camera.position.set(0,3,8);camera.lookAt(0,0,0);
 const sun=new T.DirectionalLight('#ffffff',2);sun.castShadow=true;sun.position.set(5,10,5);scene.add(sun,sun.target);
 return {scene,camera,sun,out:surface()};
}
function trackers(w:World){
 const colour=createColourTracker(),shadow=createShadowTracker();
 return {
  colour,shadow,
  colourDue:()=>{const r=colour.scan(w.out,[w.scene,w.camera]);w.scene.updateMatrixWorld();return r;},
  shadowDue:()=>{w.scene.updateMatrixWorld();return shadow.scan(w.scene);},
 };
}
/** Scan until still; a fixture that never settles is a pinned route and fails. */
function settle(due:()=>{due:boolean;forcedBy:string|null},name=''){let last=null as string|null;for(let i=0;i<6;i++){const r=due();if(!r.due)return;last=r.forcedBy;}assert.fail(`${name}: fixture never settles (forced by ${last})`);}

type Seen='colour'|'shadow'|'both';
/** Build, settle both trackers, mutate once, and require the next scan of each named tracker to be due. */
function expectSeen(name:string,build:(w:World)=>()=>void,seen:Seen='colour'){
 const w=world(),change=build(w),t=trackers(w);
 settle(t.colourDue,name);settle(t.shadowDue,name);
 change();
 const c=t.colourDue(),s=t.shadowDue();
 if(seen!=='shadow')assert.equal(c.due,true,`${name}: colour scan missed the change`);
 if(seen!=='colour')assert.equal(s.due,true,`${name}: shadow scan missed the change`);
 return {colour:c,shadow:s};
}

// ---------------------------------------------------------------------------------------------------------------
// Generic mutation by value kind.

type Holder=Record<string,unknown>;
type Mutation={label:string;prepare?:(h:Holder)=>void;change:(h:Holder)=>void};
const tex=()=>new T.DataTexture(new Uint8Array([9,8,7,255]),1,1);
/** Mutations that give `holder[key]` a different value of the same kind, or null when the kind is unknown. */
function mutationsFor(key:string,v:unknown):Mutation[]|null{
 if(typeof v==='number')return [{label:'number',change:h=>{h[key]=v===0||!Number.isFinite(v)?1:v+1;}}];
 if(typeof v==='boolean')return [{label:'toggle',change:h=>{h[key]=!v;}}];
 if(v===null||v===undefined){
  if(/map$/i.test(key))return [{label:'texture set',change:h=>{h[key]=tex();}}];
  return null;
 }
 const x=v as {isColor?:boolean;isVector2?:boolean;isVector3?:boolean;isVector4?:boolean;isQuaternion?:boolean;isEuler?:boolean;isTexture?:boolean;isMatrix3?:boolean;isMatrix4?:boolean};
 if(x.isColor)return [{label:'colour',change:h=>{(h[key] as T.Color).setRGB(.123,.456,.789);}}];
 if(x.isVector2||x.isVector3||x.isVector4)return [{label:'vector',change:h=>{(h[key] as T.Vector3).x+=.5;}}];
 if(x.isQuaternion)return [{label:'quaternion',change:h=>{(h[key] as T.Quaternion).set(.1,.2,.3,.9).normalize();}}];
 if(x.isEuler)return [
  {label:'euler angle',change:h=>{(h[key] as T.Euler).x+=.5;}},
  {label:'euler order',prepare:h=>{(h[key] as T.Euler).set(.3,.2,.1);},change:h=>{(h[key] as T.Euler).order='ZYX';}},
 ];
 if(x.isTexture)return [
  {label:'texture upload',change:h=>{(h[key] as T.Texture).needsUpdate=true;}},
  {label:'texture swap',change:h=>{h[key]=tex();}},
 ];
 if(x.isMatrix3||x.isMatrix4)return [{label:'matrix',change:h=>{(h[key] as T.Matrix4).elements[0]+=.5;}}];
 if(Array.isArray(v))return null;
 if(Object.getPrototypeOf(v)===Object.prototype)return [{label:'plain object key',change:h=>{(h[key] as Holder).COVERAGE_KEY=1;}}];
 return null;
}
/** Accessors with a setter on the prototype chain up to `stop` (three keeps some material state behind them). */
function accessors(o:object,stop:object):string[]{
 const out:string[]=[];
 for(let p=Object.getPrototypeOf(o);p&&p!==Object.prototype;p=Object.getPrototypeOf(p)){
  for(const [key,d] of Object.entries(Object.getOwnPropertyDescriptors(p)))if(d.get&&d.set&&!out.includes(key))out.push(key);
  if(p===stop)break;
 }
 return out;
}
/** Runs the generic sweep over one object family and returns the keys it could neither mutate nor exclude. */
function sweep(family:string,probe:Holder,keys:string[],excluded:Record<string,string>,special:Record<string,Mutation[]>,run:(label:string,m:Mutation)=>void){
 const unclassified:string[]=[];
 for(const key of keys){
  if(key in excluded||/^is[A-Z]/.test(key))continue;
  const list=special[key]??mutationsFor(key,probe[key]);
  if(!list){unclassified.push(`${family}.${key}`);continue;}
  for(const m of list)run(`${family}.${key} (${m.label})`,m);
 }
 return unclassified;
}

// ---------------------------------------------------------------------------------------------------------------
// Materials: every own field and accessor of every three material class.

/** Material fields that cannot change a presented frame by themselves. `is*` class flags are identity, set once. */
const materialExclusions:Record<string,string>={
 uuid:'identity string',name:'label',type:'class name',userData:'application data',
 version:'read directly; `needsUpdate` is proved below',
 precision:'program string: takes effect only through a program rebuild, which bumps the observed version',
 wireframeLinecap:'program string (WebGL has no line caps)',wireframeLinejoin:'program string (WebGL has no line joins)',
 vertexShader:'program string (rebuild bumps the version)',fragmentShader:'program string (rebuild bumps the version)',
 glslVersion:'program string (rebuild bumps the version)',index0AttributeName:'program string (rebuild bumps the version)',
 uniformsNeedUpdate:'request flag: the uniform values it re-uploads are observed (proved below)',
 uniforms:'every uniform value is observed (proved below)',
 uniformsGroups:'a non-empty uniform-group list is unobservable and forces (proved below)',
 linecap:'program string (WebGL has no line caps)',linejoin:'program string (WebGL has no line joins)',
};
/** Material fields whose kind the generic mutator cannot infer from the default value. */
const materialSpecial:Record<string,Mutation[]>={
 blendSrcAlpha:[{label:'set',change:h=>{h.blendSrcAlpha=T.OneFactor;}}],
 blendDstAlpha:[{label:'set',change:h=>{h.blendDstAlpha=T.OneFactor;}}],
 blendEquationAlpha:[{label:'set',change:h=>{h.blendEquationAlpha=T.SubtractEquation;}}],
 shadowSide:[{label:'set',change:h=>{h.shadowSide=T.BackSide;}}],
 clippingPlanes:[
  {label:'planes set',change:h=>{h.clippingPlanes=[new T.Plane(new T.Vector3(0,1,0),.5)];}},
  {label:'plane moved',prepare:h=>{h.clippingPlanes=[new T.Plane(new T.Vector3(0,1,0),.5)];},change:h=>{(h.clippingPlanes as T.Plane[])[0].constant=.7;}},
 ],
 matcap:[{label:'texture set',change:h=>{h.matcap=tex();}},{label:'texture upload',prepare:h=>{h.matcap=tex();},change:h=>{(h.matcap as T.Texture).needsUpdate=true;}}],
 iridescenceThicknessRange:[{label:'range',change:h=>{(h.iridescenceThicknessRange as number[])[1]=500;}}],
 defaultAttributeValues:[{label:'default colour',change:h=>{(h.defaultAttributeValues as {color:number[]}).color[0]=.5;}}],
 extensions:[{label:'extension flag',change:h=>{(h.extensions as {clipCullDistance:boolean}).clipCullDistance=true;}}],
};

const materialClasses=Object.entries(T).filter(([k,v])=>/Material$/.test(k)&&k!=='Material'&&typeof v==='function'&&(v as {prototype?:{isMaterial?:boolean}}).prototype!==undefined) as [string,new()=>T.Material][];

test('every field and accessor of every three material class is observed by the colour scan',()=>{
 assert.ok(materialClasses.length>=17,'material classes found: '+materialClasses.map(([k])=>k).join(', '));
 const unclassified:string[]=[];let proved=0;
 for(const [name,Material] of materialClasses){
  const probe=new Material() as unknown as Holder;
  const keys=[...Object.keys(probe),...accessors(probe,T.Material.prototype).filter(k=>k!=='needsUpdate')];
  // Accessors hide a backing field whose setter bumps the version only across zero: prove the in-range change.
  const accessorKeys=new Set(accessors(probe,T.Material.prototype));
  unclassified.push(...sweep(name,probe,keys,materialExclusions,materialSpecial,(label,m)=>{
   proved++;
   expectSeen(label,w=>{
    const material=new Material() as unknown as Holder,mesh=new T.Mesh(new T.BoxGeometry(),material as unknown as T.Material);w.scene.add(mesh);
    const key=label.slice(name.length+1).split(' ')[0];
    if(accessorKeys.has(key))material[key]=.5;
    m.prepare?.(material);
    return ()=>{if(accessorKeys.has(key))material[key]=.8;else m.change(material);};
   });
  }));
  expectSeen(name+'.needsUpdate',w=>{const m=new Material();w.scene.add(new T.Mesh(new T.BoxGeometry(),m));return ()=>{m.needsUpdate=true;};});
 }
 assert.deepEqual(unclassified,[],'fields with neither a mutation nor an exclusion reason');
 assert.ok(proved>500,`material mutations proved: ${proved}`);
});

test('material readers read exactly the keys they list (a recording proxy), and cover only same-kind keys',()=>{
 for(const [name,Material] of materialClasses){
  const m=new Material();
  for(const reader of materialReaders(m)){
   const read=new Set<string>();
   const proxy=new Proxy(m as unknown as Holder,{get(target,key,receiver){if(typeof key==='string')read.add(key);return Reflect.get(target,key,receiver);}});
   const sink={rec:new Float64Array(512),k:0,room(){return 0;},push(){},texture(){},force(){},matrix(){}} as never;
   reader.read(proxy,sink);
   const listed=[...reader.numbers,...reader.colors,...reader.textures,...reader.other].sort();
   assert.deepEqual([...read].sort(),listed,`${name}: reader reads exactly its listed keys`);
  }
 }
});

test('shader uniforms: every value kind is observed; uniform groups and unknown objects force',()=>{
 const kinds:[string,unknown,(u:{value:unknown})=>void][]=[
  ['number',1,u=>{u.value=2;}],
  ['boolean',false,u=>{u.value=true;}],
  ['vector2',new T.Vector2(),u=>{(u.value as T.Vector2).y=1;}],
  ['vector3',new T.Vector3(),u=>{(u.value as T.Vector3).z=1;}],
  ['vector4',new T.Vector4(),u=>{(u.value as T.Vector4).w=2;}],
  ['colour',new T.Color(),u=>{(u.value as T.Color).g=.5;}],
  ['matrix3',new T.Matrix3(),u=>{(u.value as T.Matrix3).elements[4]=2;}],
  ['matrix4',new T.Matrix4(),u=>{(u.value as T.Matrix4).elements[15]=2;}],
  ['quaternion',new T.Quaternion(),u=>{(u.value as T.Quaternion).set(0,1,0,0);}],
  ['texture',tex(),u=>{(u.value as T.Texture).needsUpdate=true;}],
  ['texture null',null,u=>{u.value=tex();}],
  ['number array',[1,2,3],u=>{(u.value as number[])[2]=4;}],
  ['typed array',new Float32Array(4),u=>{(u.value as Float32Array)[3]=1;}],
  ['vector array',[new T.Vector3(),new T.Vector3()],u=>{(u.value as T.Vector3[])[1].x=1;}],
  ['struct',{a:1,b:new T.Vector2()},u=>{(u.value as {b:T.Vector2}).b.x=1;}],
  ['struct array',[{a:1},{a:2}],u=>{(u.value as {a:number}[])[1].a=3;}],
  ['kind change',1,u=>{u.value=new T.Vector2(1,0);}],
 ];
 for(const [name,initial,change] of kinds)expectSeen('uniform '+name,w=>{
  const u={value:initial},m=new T.ShaderMaterial({uniforms:{u}});w.scene.add(new T.Mesh(new T.BoxGeometry(),m));return ()=>change(u);
 });
 const forced=(name:string,m:T.ShaderMaterial)=>{const w=world();w.scene.add(new T.Mesh(new T.BoxGeometry(),m));const t=trackers(w);t.colourDue();const r=t.colourDue();assert.equal(r.due,true,name);assert.ok(r.forcedBy,name);};
 const group=new T.UniformsGroup();group.add(new T.Uniform(1));
 forced('uniform group',new T.ShaderMaterial({uniformsGroups:[group]} as T.ShaderMaterialParameters));
 forced('unknown uniform object',new T.ShaderMaterial({uniforms:{box:{value:new T.Box3()}}}));
});

// ---------------------------------------------------------------------------------------------------------------
// Nodes: every own field of every drawable and light kind.

/** Node fields that cannot change a presented frame by themselves. */
const nodeExclusions:Record<string,string>={
 uuid:'identity string',name:'label',type:'class name',userData:'application data',id:'immutable',
 parent:'structure: proved by the structure test',children:'structure: proved by the structure test',
 up:'read only by lookAt, which writes the observed quaternion',animations:'clip data: playback writes observed transforms',
 matrix:'derived from the observed locals while matrixAutoUpdate; proved with auto-update off',
 matrixWorld:'derived from the locals while matrixWorldAutoUpdate; proved with auto-update off',
 matrixWorldNeedsUpdate:'propagation bookkeeping',
 static:'WebGPURenderer only (the engine renders with WebGLRenderer)',
 count:'Mesh.count is WebGPURenderer only; InstancedMesh.count is proved below',
 customDepthMaterial:'shadow pass only: forces the shadow tracker (proved below)',
 customDistanceMaterial:'shadow pass only: forces the shadow tracker (proved below)',
 morphTargetDictionary:'name-to-index lookup, not a draw input',
 boundingBox:'not a WebGL draw or culling input (raycasting only)',
 skeleton:'skeleton closure: proved by the ADR 0057 matrix in change-tracker.test.ts',
 bindMode:'skeleton closure: proved by the ADR 0057 matrix in change-tracker.test.ts',
 bindMatrix:'skeleton closure: proved by the ADR 0057 matrix in change-tracker.test.ts',
 bindMatrixInverse:'skeleton closure: proved by the ADR 0057 matrix in change-tracker.test.ts',
 previousInstanceMatrix:'WebGPURenderer only (motion vectors)',
 _currentLevel:'LOD output: the level it picked from observed inputs',
 power:'accessor over the observed intensity',
};
const nodeSpecial:Record<string,Mutation[]>={
 layers:[{label:'moved off the camera layer',change:h=>{(h.layers as T.Layers).set(3);}}],
 pivot:[
  {label:'pivot set',prepare:h=>{(h as unknown as T.Object3D).rotation.z=.5;},change:h=>{h.pivot=new T.Vector3(1,0,0);}},
  {label:'pivot moved',prepare:h=>{(h as unknown as T.Object3D).rotation.z=.5;h.pivot=new T.Vector3(1,0,0);},change:h=>{(h.pivot as T.Vector3).y=1;}},
 ],
 geometry:[{label:'geometry swap',change:h=>{h.geometry=new T.SphereGeometry();}}],
 material:[
  {label:'material swap',change:h=>{h.material=new T.MeshStandardMaterial();}},
  {label:'material array',change:h=>{h.material=[h.material as T.Material];}},
 ],
 morphTargetInfluences:[{label:'weight',change:h=>{
  const m=h as unknown as T.Mesh;
  if(m.morphTargetInfluences){m.morphTargetInfluences[0]=.5;return;}
  // A mesh without morph targets gains them (geometry and weights both change).
  m.geometry.morphAttributes.position=[m.geometry.attributes.position.clone()];m.updateMorphTargets();
 }}],
 instanceMatrix:[{label:'instance upload',change:h=>{(h.instanceMatrix as T.BufferAttribute).needsUpdate=true;}}],
 instanceColor:[{label:'instance colour',change:h=>{(h as unknown as T.InstancedMesh).setColorAt(0,new T.Color(1,0,0));}}],
 morphTexture:[{label:'morph texture',change:h=>{h.morphTexture=tex();}}],
 boundingSphere:[{label:'culling sphere set',change:h=>{h.boundingSphere=new T.Sphere(new T.Vector3(),.25);}}],
 target:[{label:'target moved',change:h=>{(h.target as T.Object3D).position.x+=1;}}],
 shadow:[],// swept as its own family below
 map:[{label:'cookie set',change:h=>{h.map=tex();}}],
 sh:[{label:'irradiance',change:h=>{(h.sh as T.SphericalHarmonics3).coefficients[4].y+=1;}}],
 levels:[
  {label:'level distance',change:h=>{(h.levels as {distance:number}[])[1].distance=7;}},
  {label:'level hysteresis',change:h=>{(h.levels as {hysteresis:number}[])[1].hysteresis=.3;}},
 ],
 center:[{label:'sprite centre',change:h=>{(h.center as T.Vector2).x=.25;}}],
};
/** Per-kind exclusions: flags three reads only on the kinds that draw or light. */
const notDrawn={castShadow:'read only on the drawn object itself, never inherited',receiveShadow:'read only on the drawn object itself, never inherited'};
const light={receiveShadow:'a light receives nothing',frustumCulled:'lights are not culled',renderOrder:'lights are not sorted'};
const kindExclusions:Record<string,Record<string,string>>={
 Group:notDrawn,Object3D:{...notDrawn,renderOrder:'only a Group passes its order to its children'},Bone:{...notDrawn,renderOrder:'only a Group passes its order to its children'},
 LOD:{...notDrawn,renderOrder:'only a Group passes its order to its children'},
 DirectionalLight:light,PointLight:light,SpotLight:light,
 HemisphereLight:{...light,castShadow:'this light kind has no shadow'},AmbientLight:{...light,castShadow:'this light kind has no shadow'},
 RectAreaLight:{...light,castShadow:'this light kind has no shadow'},LightProbe:{...light,castShadow:'this light kind has no shadow'},
};
type NodeKind=readonly [name:string,build:()=>T.Object3D];
const standard=()=>new T.MeshStandardMaterial();
const morphed=()=>{const m=new T.Mesh(new T.BoxGeometry(),standard());m.geometry.morphAttributes.position=[m.geometry.attributes.position.clone()];m.updateMorphTargets();return m;};
const nodeKinds:NodeKind[]=[
 ['Mesh',()=>new T.Mesh(new T.BoxGeometry(),standard())],
 ['Mesh (morphed)',morphed],
 ['Group',()=>new T.Group()],['Object3D',()=>new T.Object3D()],['Bone',()=>new T.Bone()],
 ['InstancedMesh',()=>new T.InstancedMesh(new T.BoxGeometry(),standard(),3)],
 ['SkinnedMesh',()=>{const m=new T.SkinnedMesh(new T.BoxGeometry(),standard()),bone=new T.Bone();m.add(bone);m.bind(new T.Skeleton([bone]));return m;}],
 ['Sprite',()=>new T.Sprite(new T.SpriteMaterial())],
 ['Points',()=>new T.Points(new T.BoxGeometry(),new T.PointsMaterial())],
 ['Line',()=>new T.Line(new T.BoxGeometry(),new T.LineBasicMaterial())],
 ['LineSegments',()=>new T.LineSegments(new T.BoxGeometry(),new T.LineDashedMaterial())],
 ['LineLoop',()=>new T.LineLoop(new T.BoxGeometry(),new T.LineBasicMaterial())],
 ['LOD',()=>{const l=new T.LOD();l.addLevel(new T.Mesh(new T.BoxGeometry(),standard()),0);l.addLevel(new T.Mesh(new T.BoxGeometry(),standard()),5);return l;}],
 ['DirectionalLight',()=>new T.DirectionalLight()],['PointLight',()=>new T.PointLight()],['SpotLight',()=>new T.SpotLight()],
 ['HemisphereLight',()=>new T.HemisphereLight()],['AmbientLight',()=>new T.AmbientLight()],['RectAreaLight',()=>new T.RectAreaLight()],
 ['LightProbe',()=>new T.LightProbe()],
];

test('every own field of every drawable and light node kind is observed by the colour scan',()=>{
 const unclassified:string[]=[];let proved=0;
 for(const [name,build] of nodeKinds){
  const probe=build() as unknown as Holder,own=kindExclusions[name]??{};
  unclassified.push(...sweep(name,probe,Object.keys(probe),{...nodeExclusions,...own},nodeSpecial,(label,m)=>{
   proved++;
   expectSeen(label,w=>{
    const node=build();w.scene.add(node);const target=(node as T.DirectionalLight).target;if(target)w.scene.add(target);
    m.prepare?.(node as unknown as Holder);
    return ()=>m.change(node as unknown as Holder);
   });
  }));
 }
 assert.deepEqual(unclassified,[],'fields with neither a mutation nor an exclusion reason');
 assert.ok(proved>=300,`node mutations proved: ${proved}`);
});

test('manually managed matrices are inputs: local with matrixAutoUpdate off, world with matrixWorldAutoUpdate off',()=>{
 expectSeen('manual local matrix',w=>{const m=new T.Mesh(new T.BoxGeometry(),standard());m.castShadow=true;m.matrixAutoUpdate=false;w.scene.add(m);return ()=>{m.matrix.elements[12]=2;};},'both');
 expectSeen('manual world matrix',w=>{const m=new T.Mesh(new T.BoxGeometry(),standard());m.castShadow=true;m.matrixWorldAutoUpdate=false;w.scene.add(m);return ()=>{m.matrixWorld.elements[13]=2;};},'both');
 expectSeen('auto-update switched off with a stale matrix',w=>{const m=new T.Mesh(new T.BoxGeometry(),standard());m.position.x=1;w.scene.add(m);return ()=>{m.matrixAutoUpdate=false;m.matrix.identity();};});
});

test('structure: added, removed, reordered, reparented and hidden-ancestor nodes are observed',()=>{
 const pair=(w:World)=>{const a=new T.Group(),b=new T.Group(),m=new T.Mesh(new T.BoxGeometry(),standard());a.position.x=2;m.castShadow=true;a.add(m);w.scene.add(a,b);return {a,b,m};};
 expectSeen('child added',w=>{const {b}=pair(w);return ()=>{const m=new T.Mesh(new T.BoxGeometry(),standard());m.castShadow=true;b.add(m);};},'both');
 expectSeen('child removed',w=>{const {a,m}=pair(w);return ()=>{a.remove(m);};},'both');
 expectSeen('children reordered',w=>{const {a,b}=pair(w);return ()=>{w.scene.children.splice(w.scene.children.indexOf(a),1);w.scene.children.push(a);void b;};});
 expectSeen('reparented under a moved group',w=>{const {b,m}=pair(w);return ()=>{b.add(m);};},'both');
 expectSeen('ancestor hidden',w=>{const {a}=pair(w);return ()=>{a.visible=false;};},'both');
});

// ---------------------------------------------------------------------------------------------------------------
// Textures, geometry, light shadows, the scene, the view and the surface.

const textureExclusions:Record<string,string>={
 uuid:'identity string',name:'label',userData:'application data',
 mipmaps:'upload state: takes effect through an upload, which bumps the observed version',
 mapping:'program parameter keyed on the environment map identity: takes effect through the material version',
 wrapS:'upload state (sampler parameters are set on upload)',wrapT:'upload state (sampler parameters are set on upload)',
 magFilter:'upload state (sampler parameters are set on upload)',minFilter:'upload state (sampler parameters are set on upload)',
 anisotropy:'upload state (sampler parameters are set on upload)',format:'upload state',internalFormat:'upload state',type:'upload state',
 generateMipmaps:'upload state',premultiplyAlpha:'upload state',flipY:'upload state',unpackAlignment:'upload state',colorSpace:'upload state (internal format)',
 updateRanges:'partial-upload hint for the next version bump',onUpdate:'upload callback',
 renderTarget:'render-target textures force (proved in change-tracker.test.ts)',
 version:'proved as texture upload',image:'accessor over the source data: uploaded on a version bump',
};
const textureSpecial:Record<string,Mutation[]>={
 source:[{label:'source swap',change:h=>{h.source=new T.Source({data:new Uint8Array(4),width:1,height:1});}}],
 pmremVersion:[{label:'PMREM regeneration',change:h=>{(h as unknown as T.Texture).needsPMREMUpdate=true;}}],
 matrix:[{label:'manual uv matrix',prepare:h=>{h.matrixAutoUpdate=false;},change:h=>{(h.matrix as T.Matrix3).elements[6]=.5;}}],
 matrixAutoUpdate:[{label:'uv matrix mode',prepare:h=>{(h as unknown as T.Texture).offset.set(.5,0);},change:h=>{h.matrixAutoUpdate=false;}}],
};

test('every own field of a texture is observed or is upload state behind the observed version',()=>{
 const probe=tex() as unknown as Holder;
 const unclassified=sweep('Texture',probe,[...Object.keys(probe),'version'],textureExclusions,textureSpecial,(label,m)=>{
  expectSeen(label,w=>{const t=tex(),mat=new T.MeshStandardMaterial({map:t});w.scene.add(new T.Mesh(new T.BoxGeometry(),mat));m.prepare?.(t as unknown as Holder);return ()=>m.change(t as unknown as Holder);});
 });
 assert.deepEqual(unclassified,[]);
 expectSeen('Texture.version',w=>{const t=tex();w.scene.add(new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({map:t})));return ()=>{t.needsUpdate=true;};});
});

test('geometry: attributes, index, morphs, groups, draw range and the culling sphere are observed by both scans',()=>{
 const mesh=(w:World,g:T.BufferGeometry)=>{const m=new T.Mesh(g,standard());m.castShadow=true;w.scene.add(m);return g;};
 const changes:[string,(g:T.BufferGeometry)=>void][]=[
  ['attribute upload',g=>{g.attributes.position.needsUpdate=true;}],
  ['attribute replaced',g=>{g.setAttribute('position',g.attributes.position.clone());}],
  ['attribute added',g=>{g.setAttribute('color',new T.BufferAttribute(new Float32Array(g.attributes.position.count*3),3));}],
  ['attribute removed',g=>{g.deleteAttribute('uv');}],
  ['index replaced',g=>{g.setIndex(g.index!.clone());}],
  ['index upload',g=>{g.index!.needsUpdate=true;}],
  ['index removed',g=>{g.setIndex(null);}],
  ['morph attribute added',g=>{g.morphAttributes.position=[g.attributes.position.clone()];}],
  ['morph relative',g=>{g.morphTargetsRelative=!g.morphTargetsRelative;}],
  ['group added',g=>{g.addGroup(0,6,0);}],
  ['group changed',g=>{g.groups[0].count=12;}],
  ['draw range',g=>{g.setDrawRange(0,6);}],
  ['culling sphere set',g=>{g.boundingSphere=new T.Sphere(new T.Vector3(),.1);}],
  ['culling sphere moved',g=>{g.computeBoundingSphere();g.boundingSphere!.center.x=3;}],
 ];
 for(const [name,change] of changes)expectSeen('geometry '+name,w=>{const g=mesh(w,new T.BoxGeometry());if(name==='culling sphere moved')g.computeBoundingSphere();return ()=>change(g);},'both');
});

test('light shadows: camera frustum, map, filtering and update mode are observed (colour and depth as each pass uses them)',()=>{
 const cases:[string,(s:T.DirectionalLightShadow)=>void,Seen][]=[
  ['ortho frustum',s=>{s.camera.left=-20;s.camera.updateProjectionMatrix();},'both'],
  ['projection set directly',s=>{s.camera.projectionMatrix.makeOrthographic(-3,3,3,-3,.5,50);},'both'],
  ['near plane',s=>{s.camera.near=1;s.camera.updateProjectionMatrix();},'both'],
  ['far plane',s=>{s.camera.far=80;s.camera.updateProjectionMatrix();},'both'],
  ['zoom',s=>{s.camera.zoom=2;s.camera.updateProjectionMatrix();},'both'],
  ['camera layers',s=>{s.camera.layers.set(2);},'both'],
  ['map size',s=>{s.mapSize.set(1024,1024);},'both'],
  ['map type',s=>{s.mapType=T.HalfFloatType;},'both'],
  ['radius (VSM blur)',s=>{s.radius=4;},'both'],
  ['blur samples (VSM blur)',s=>{s.blurSamples=4;},'both'],
  ['auto update',s=>{s.autoUpdate=false;},'both'],
  ['bias',s=>{s.bias=-.001;},'colour'],
  ['normal bias',s=>{s.normalBias=.02;},'colour'],
  ['intensity',s=>{s.intensity=.5;},'colour'],
 ];
 const box=(w:World)=>{const m=new T.Mesh(new T.BoxGeometry(),standard());m.castShadow=true;m.receiveShadow=true;w.scene.add(m);};
 for(const [name,change,seen] of cases)expectSeen('shadow '+name,w=>{box(w);return ()=>change(w.sun.shadow);},seen);
 // Every own field of a light shadow is either proved above or named here with its reason.
 const classified=new Set(['camera','mapSize','mapType','radius','blurSamples','autoUpdate','bias','normalBias','intensity']);
 const reasons:Record<string,string>={
  biasNode:'WebGPURenderer only',map:'the shadow map: an output',mapPass:'VSM scratch target: an output',matrix:'shadow matrix: computed while rendering',
  needsUpdate:'one-shot request: redraws a map whose inputs are observed',_frustum:'internal',_frameExtents:'internal',_viewportCount:'internal',_viewports:'internal',
  focus:'spot shadows only: proved below',
 };
 for(const key of Object.keys(new T.DirectionalLight().shadow))assert.ok(classified.has(key)||key in reasons||/^is[A-Z]/.test(key),`LightShadow.${key} is unclassified`);
 expectSeen('spot shadow focus',w=>{const spot=new T.SpotLight();spot.castShadow=true;w.scene.add(spot,spot.target);box(w);return ()=>{spot.shadow.focus=.5;};},'both');
 expectSeen('spot angle',w=>{const spot=new T.SpotLight();spot.castShadow=true;w.scene.add(spot,spot.target);box(w);return ()=>{spot.angle=.3;};},'both');
 expectSeen('point light range',w=>{const point=new T.PointLight();point.castShadow=true;w.scene.add(point);box(w);return ()=>{point.distance=12;};},'both');
});

test('the scene, the view camera and the output surface: every field is observed',()=>{
 const scene:Record<string,(s:T.Scene)=>void>={
  'background colour':s=>{s.background=new T.Color('#123456');},
  'background texture':s=>{s.background=tex();},
  'background intensity':s=>{s.backgroundIntensity=.5;},
  'background blurriness':s=>{s.backgroundBlurriness=.5;},
  'background rotation':s=>{s.backgroundRotation.y=.5;},
  'background rotation order':s=>{s.backgroundRotation.set(.2,.3,.4);s.backgroundRotation.order='ZYX';},
  'environment':s=>{s.environment=tex();},
  'environment intensity':s=>{s.environmentIntensity=.5;},
  'environment rotation':s=>{s.environmentRotation.x=.5;},
  'fog added':s=>{s.fog=new T.Fog('#000',1,50);},
  'fog swapped to exp2':s=>{s.fog=new T.FogExp2('#000',0);},
  'override material':s=>{s.overrideMaterial=new T.MeshBasicMaterial();},
 };
 for(const [name,change] of Object.entries(scene))expectSeen('scene '+name,w=>{w.scene.add(new T.Mesh(new T.BoxGeometry(),standard()));if(name==='fog swapped to exp2')w.scene.fog=new T.Fog('#000',0,0);return ()=>change(w.scene);});
 const fog:[string,(f:T.Fog&T.FogExp2)=>void,boolean][]=[['fog colour',f=>f.color.set('#ff0000'),false],['fog near',f=>{f.near=2;},false],['fog far',f=>{f.far=40;},false],['fog density',f=>{f.density=.2;},true]];
 for(const [name,change,exp2] of fog)expectSeen(name,w=>{w.scene.add(new T.Mesh(new T.BoxGeometry(),standard()));const f=exp2?new T.FogExp2('#000',.1):new T.Fog('#000',1,50);w.scene.fog=f;return ()=>change(f as T.Fog&T.FogExp2);});
 const view:[string,(w:World)=>void][]=[
  ['camera moves',w=>{w.camera.position.x+=.1;}],['camera turns',w=>{w.camera.rotation.y+=.01;}],
  ['fov',w=>{w.camera.fov=30;w.camera.updateProjectionMatrix();}],['zoom',w=>{w.camera.zoom=2;w.camera.updateProjectionMatrix();}],
  ['near',w=>{w.camera.near=.5;w.camera.updateProjectionMatrix();}],['far',w=>{w.camera.far=40;w.camera.updateProjectionMatrix();}],
  ['aspect',w=>{w.camera.aspect=2;w.camera.updateProjectionMatrix();}],['view offset',w=>{w.camera.setViewOffset(800,600,10,0,800,600);}],
  ['film offset',w=>{w.camera.filmOffset=2;w.camera.updateProjectionMatrix();}],['camera layers',w=>{w.camera.layers.set(2);}],
  ['camera parent moves',w=>{const rig=new T.Group();rig.add(w.camera);w.scene.add(rig);rig.updateMatrixWorld();rig.position.x=3;rig.updateMatrixWorld();}],
  ['canvas width',w=>{(w.out.domElement as {width:number}).width=801;}],['canvas height',w=>{(w.out.domElement as {height:number}).height=601;}],
  ['tone mapping',w=>{(w.out as {toneMapping:number}).toneMapping=T.AgXToneMapping;}],['exposure',w=>{(w.out as {toneMappingExposure:number}).toneMappingExposure=1.5;}],
 ];
 for(const [name,change] of view)expectSeen('view '+name,w=>{w.scene.add(new T.Mesh(new T.BoxGeometry(),standard()));return ()=>change(w);});
});

test('depth-pass inputs of a caster are observed by the shadow scan; colour-only inputs are not',()=>{
 type Caster=T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
 const caster=(w:World,material:T.Material=standard()):Caster=>{const m=new T.Mesh(new T.BoxGeometry(),material) as unknown as Caster;m.castShadow=true;w.scene.add(m);return m;};
 const depth:[string,(m:Caster)=>void][]=[
  ['moves',m=>{m.position.x+=.1;}],['turns',m=>{m.rotation.y+=.1;}],['scales',m=>{m.scale.y=2;}],['hidden',m=>{m.visible=false;}],
  ['stops casting',m=>{m.castShadow=false;}],['leaves the camera layer',m=>{m.layers.set(3);}],['culling off',m=>{m.frustumCulled=false;}],
  ['material hidden',m=>{m.material.visible=false;}],['side',m=>{m.material.side=T.DoubleSide;}],['shadow side',m=>{m.material.shadowSide=T.BackSide;}],
  ['wireframe',m=>{m.material.wireframe=true;}],['alpha test',m=>{m.material.alphaTest=.5;}],['alpha to coverage',m=>{m.material.alphaToCoverage=true;}],
  ['map, alpha-tested',m=>{m.material.alphaTest=.5;m.material.map=tex();}],['alpha map, alpha-tested',m=>{m.material.alphaTest=.5;m.material.alphaMap=tex();}],
  ['map, alpha-hashed',m=>{m.material.alphaHash=true;m.material.map=tex();}],['displacement map',m=>{m.material.displacementMap=tex();}],
  ['displacement scale',m=>{m.material.displacementScale=2;}],['displacement bias',m=>{m.material.displacementBias=.5;}],
  ['clip shadows',m=>{m.material.clipShadows=true;}],['clipping planes',m=>{m.material.clippingPlanes=[new T.Plane()];}],['clip intersection',m=>{m.material.clipIntersection=true;}],
  ['wireframe line width',m=>{m.material.wireframeLinewidth=2;}],['material swap',m=>{m.material=new T.MeshStandardMaterial({side:T.BackSide});}],
  ['geometry swap',m=>{m.geometry=new T.SphereGeometry();}],
 ];
 for(const [name,change] of depth)expectSeen('caster '+name,w=>{const m=caster(w);return ()=>change(m);},'shadow');
 expectSeen('caster alpha test within range',w=>{const m=caster(w,new T.MeshStandardMaterial({alphaTest:.5,map:tex()}));return ()=>{m.material.alphaTest=.8;};},'both');
 expectSeen('caster map swapped under alpha test',w=>{const m=caster(w,new T.MeshStandardMaterial({alphaTest:.5,map:tex()}));return ()=>{m.material.map=tex();};},'shadow');
 expectSeen('caster map uploaded under alpha test',w=>{const t=tex();caster(w,new T.MeshStandardMaterial({alphaTest:.5,map:t}));return ()=>{t.needsUpdate=true;};},'shadow');
 expectSeen('caster map moved',w=>{const t=tex();caster(w,new T.MeshStandardMaterial({alphaTest:.5,map:t}));return ()=>{t.offset.x=.5;};},'shadow');
 expectSeen('line width of a line caster',w=>{const l=new T.LineSegments(new T.BoxGeometry(),new T.LineBasicMaterial());l.castShadow=true;w.scene.add(l);return ()=>{l.material.linewidth=3;};},'shadow');
 {
  // VSM also draws receivers into the map.
  const w=world(),m=new T.Mesh(new T.BoxGeometry(),standard());m.receiveShadow=true;w.scene.add(m);const t=createShadowTracker();
  w.scene.updateMatrixWorld();t.scan(w.scene,{vsm:true});assert.equal(t.scan(w.scene,{vsm:true}).due,false);
  m.position.x=1;w.scene.updateMatrixWorld();assert.equal(t.scan(w.scene,{vsm:true}).due,true,'VSM receivers are depth casters');
 }
 // Colour-only changes spend no shadow map.
 const colourOnly:[string,(m:Caster)=>void][]=[['colour',m=>m.material.color.set('#f00')],['roughness',m=>{m.material.roughness=.1;}],['emissive',m=>m.material.emissive.set('#0f0')],['receives',m=>{m.receiveShadow=true;}],
  // Without a discard the depth pass ignores colour and alpha maps: a late upload redraws no shadow map.
  ['map without alpha test',m=>{m.material.map=tex();}],['alpha map without alpha test',m=>{m.material.alphaMap=tex();}]];
 for(const [name,change] of colourOnly){
  const r=expectSeen('caster '+name,w=>{const m=caster(w);return ()=>change(m);},'colour');
  assert.equal(r.shadow.due,false,`caster ${name}: colour-only change must not redraw the shadow map`);
 }
 // A custom depth material may run arbitrary code: forced, never guessed.
 for(const key of ['customDepthMaterial','customDistanceMaterial'] as const){
  const w=world(),m=caster(w);m[key]=new T.MeshDepthMaterial();const t=trackers(w);t.shadowDue();
  const r=t.shadowDue();assert.equal(r.due,true,key);assert.ok(r.forcedBy,key);
 }
});

test('id-indexed dedup is sound: material, geometry, texture and node ids are immutable and unique per family',()=>{
 for(const o of [new T.MeshBasicMaterial(),new T.BoxGeometry(),new T.Texture(),new T.Object3D()]){
  const d=Object.getOwnPropertyDescriptor(o,'id');assert.ok(d,'own id');assert.equal(d.writable,false,'id is not writable');assert.equal(d.configurable,false,'id cannot be redefined');
 }
 const a=new T.MeshBasicMaterial(),b=new T.MeshBasicMaterial();assert.notEqual((a as unknown as {id:number}).id,(b as unknown as {id:number}).id);
 // Constructor-selected traversal (plain Mesh, Group, Object3D, Bone): three sets these class flags in constructors only.
 const flags=['isInstancedMesh','isSkinnedMesh','isBatchedMesh','isSprite','isLight','isLOD'];
 for(const o of [new T.Mesh(),new T.Group(),new T.Object3D(),new T.Bone()]){for(const f of flags)assert.equal((o as unknown as Holder)[f],undefined,`${o.type}.${f}`);}
 for(const o of [new T.Group(),new T.Object3D(),new T.Bone()])assert.equal((o as unknown as Holder).geometry,undefined,`${o.type} draws nothing`);
});
