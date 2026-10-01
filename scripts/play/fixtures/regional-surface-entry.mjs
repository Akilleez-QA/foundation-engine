// Optional finite desktop consumer. Creator policy keeps four accepted regions coherent.
import * as THREE from 'three';
import {createWorkerHost} from '../../../src/platform/workers/host.ts';
import {prepareTerrainRegion} from '../../../src/kits/terrain/region-job.ts';
import {prepareTerrainRegionPatch} from '../../../src/kits/terrain/patch-job.ts';
import {prepareTerrainGeneration,createTerrainGenerationBuilder} from '../../../src/kits/terrain/generation.ts';
import {createTerrainCoverage} from '../../../src/kits/terrain/region-coverage.ts';
import {createTerrainOracle} from '../../../src/kits/terrain/test-oracles.ts';
const canvas=document.querySelector('canvas'),status=document.querySelector('#status');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(1000,600);renderer.setClearColor('#101827');
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1000/600,.1,100);
camera.position.set(10,9,12);camera.lookAt(.1,.3,.1);
scene.add(new THREE.HemisphereLight(0xd7eeff,0x26334b,2));
const sun=new THREE.DirectionalLight(0xffe5bd,3);sun.position.set(-8,18,10);scene.add(sun);
const profile={maxSlots:2,maxPending:8,maxReservedBytes:4*1024*1024,warm:1};
const lattice={id:'finite-lattice',baseX:.1,baseZ:.1,spacing:.5};
const layout=[[-8,-8],[0,-8],[-8,0],[0,0]].map(([startX,startZ],i)=>({id:`core-${i}`,startX,startZ,cellsX:8,cellsZ:8}));
const tiles=[{key:'fine',startX:0,startZ:0,cellsX:4,cellsZ:8,stride:1},{key:'coarse',startX:4,startZ:0,cellsX:4,cellsZ:8,stride:2}];
const colors=[0x49c9c0,0x619ff1,0xaf83e7,0xf2bc76],edit={gx:1,gz:0};
const plane=p=>p.x*.15+p.z*.08;
let host,owner,lifetime,session=0,ticket=0,version=0,phase='starting',accepted=null,candidate=null,request=null;
let closed=false,lateIgnored=0,publications=0,draws=0,lastOutcome='',settled=false;
const recipe=(region,revision,parameters='[0.15,0.08,0]')=>({formatVersion:1,evaluatorVersion:1,region:{...region,lattice:{...lattice,revision}},seed:7,parameters});
function startSession(){session++;host=createWorkerHost({profile});lifetime=new AbortController();owner={id:`regional-view-${session}`,signal:lifetime.signal};}
// This finite view owns its allocations until complete; only a complete group can publish.
const resourceCounts={geometriesCreated:0,geometriesDisposed:0,materialsCreated:0,materialsDisposed:0,duplicateDisposals:0};
const retiredResources=new WeakSet();
function retire(resource,kind){
 if(retiredResources.has(resource)){resourceCounts.duplicateDisposals++;throw Error('view resource disposed twice');}
 retiredResources.add(resource);resource.dispose();resourceCounts[`${kind}Disposed`]++;
}
function disposeView(view){for(const object of view.children){retire(object.geometry,'geometries');retire(object.material,'materials');}}
function makeView(generations,failAfterMeshes=0){
 const group=new THREE.Group(),geometries=[],materials=[];
 try{
  generations.forEach((generation,index)=>generation.chunks.forEach(({chunk})=>{
   const geometry=new THREE.BufferGeometry();geometries.push(geometry);resourceCounts.geometriesCreated++;
   geometry.setAttribute('position',new THREE.Float32BufferAttribute(chunk.mesh.positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(chunk.mesh.normals,3));geometry.setIndex(chunk.mesh.indices);
   const material=new THREE.MeshStandardMaterial({color:colors[index],roughness:.85,side:THREE.DoubleSide});materials.push(material);resourceCounts.materialsCreated++;
   group.add(new THREE.Mesh(geometry,material));
   if(failAfterMeshes&&group.children.length===failAfterMeshes)throw Error('Intentional diagnostic: candidate view preparation failed after two meshes');
  }));
  return group;
 }catch(error){
  for(const geometry of geometries)retire(geometry,'geometries');
  for(const material of materials)retire(material,'materials');
  group.clear();throw error;
 }
}
function validate(regions,generations,raised,view){
 let positionError=0,normalError=0,renderNormalError=0,contactError=0,rayError=0,haloLeaks=0,boundExcess=0;
 const refs=regions.map(region=>createTerrainOracle({...lattice,...region},p=>plane(p)+(raised&&p.gx===edit.gx&&p.gz===edit.gz?1.5:0)));
 let meshIndex=0;
 for(let ri=0;ri<regions.length;ri++){
  const region=regions[ri],surface=region.surface,ref=refs[ri],points=new Map();
  for(let z=0;z<=8;z++)for(let x=0;x<=8;x++){
   const actual=surface.vertex(x,z),expected=ref.vertex(x,z);points.set(`${expected.x},${expected.z}`,expected);
   for(const axis of ['x','y','z']){positionError=Math.max(positionError,Math.abs(actual[axis]-expected[axis]));normalError=Math.max(normalError,Math.abs(actual.normal[axis]-expected.normal[axis]));}
  }
  for(const {chunk} of generations[ri].chunks){
   const geometry=view.children[meshIndex++].geometry,pos=geometry.attributes.position,norm=geometry.attributes.normal;
   for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),z=pos.getZ(i),expected=points.get(`${x},${z}`);
    if(!expected)throw Error('rendered vertex is not a canonical core vertex');
    positionError=Math.max(positionError,Math.abs(pos.getY(i)-expected.y));
    renderNormalError=Math.max(renderNormalError,Math.abs(norm.getX(i)-expected.normal.x),Math.abs(norm.getY(i)-expected.normal.y),Math.abs(norm.getZ(i)-expected.normal.z));
   }
   for(let i=0;i<chunk.mesh.indices.length;i+=3){
    const ids=chunk.mesh.indices.slice(i,i+3),x=ids.reduce((n,id)=>n+pos.getX(id),0)/3,z=ids.reduce((n,id)=>n+pos.getZ(id),0)/3,y=ids.reduce((n,id)=>n+pos.getY(id),0)/3;
    boundExcess=Math.max(boundExcess,Math.abs(y-ref.sample(x,z).y)-chunk.maxError);
   }
  }
  const x=(ref.extent.minX+ref.extent.maxX)/2+.13,z=(ref.extent.minZ+ref.extent.maxZ)/2+.17;
  contactError=Math.max(contactError,Math.abs(surface.sample(x,z).height-ref.sample(x,z).y));
  for(const direction of [{x:0,y:-1,z:0},{x:.04,y:-1,z:.03}]){
   const origin={x,y:8,z},expected=ref.raycast(origin,direction),actual=surface.raycast(origin,direction);
   if(!expected||!actual)throw Error('core ray unexpectedly missed');
   rayError=Math.max(rayError,...['x','y','z','distance'].map(axis=>Math.abs(actual[axis]-expected[axis])));
  }
  const outsideX=ref.extent.minX-.1;
  if(surface.sample(outsideX,z)!==null||surface.raycast({x:outsideX,y:8,z},{x:0,y:-1,z:0})!==null)haloLeaks++;
 }
 const result={positionError,normalError,renderNormalError,contactError,rayError,haloLeaks,boundExcess};
 if(positionError>1e-7||normalError>1e-10||renderNormalError>1e-6||contactError>1e-7||rayError>1e-6||haloLeaks||boundExcess>1e-6)throw Error(`independent oracle mismatch ${JSON.stringify(result)}`);
 return result;
}
function assemble(regions,raised,patches,failAfterMeshes=0){
 const generations=regions.map((r,i)=>{
  if(!patches)return prepareTerrainGeneration(r.surface,tiles);
  const builder=createTerrainGenerationBuilder(r.surface,tiles,{previous:accepted.generations[i],patch:patches[i]});builder.step(2);return builder.result;
 });
 const view=makeView(generations,failAfterMeshes);
 try{return{regions,generations,view,raised,revision:regions[0].lattice.revision,coverage:createTerrainCoverage(regions.map(region=>({status:'ready',region}))),oracle:validate(regions,generations,raised,view)};}catch(error){disposeView(view);throw error;}
}
function paint(){
 status.textContent=`${closed?'Closed':phase} · accepted revision ${accepted?.revision??'none'} · ${lastOutcome||'real worker preparation'}${candidate?' · replacement ready for explicit publication':''}`;
 document.querySelector('#edit').disabled=closed||!accepted||!!request||!!candidate;
 document.querySelector('#retry').disabled=closed||!accepted||!!request||!!candidate;
 document.querySelector('#release').disabled=!request||!settled;
 document.querySelector('#cancel').disabled=!request&&!candidate;
 document.querySelector('#publish').disabled=closed||!candidate;
 document.querySelector('#close').disabled=closed||!accepted;
 document.querySelector('#reenter').disabled=!closed||!accepted;
 renderer.render(scene,camera);draws++;
}
function cancel(){ticket++;request?.abort.abort();request?.release();request=null;if(candidate){disposeView(candidate.view);candidate=null;}phase=closed?'closed':'cancelled';lastOutcome='Accepted render and query retained';paint();}
async function begin(mode){
 if(closed||request||candidate||!accepted)return;
 const current=++ticket,life=session,revision=++version,abort=new AbortController();
 let release;const held=new Promise(resolve=>{release=resolve;});request={abort,release};settled=false;phase='pending';lastOutcome='Preparing four dependencies';paint();
 let temporary;
 try{
  const selected=mode==='refusal'?(temporary=createWorkerHost({profile:{...profile,maxReservedBytes:1}})):host;
  const results=await Promise.all(accepted.regions.map(region=>mode==='failure'
   ?prepareTerrainRegion(selected,owner,recipe(layout.find(r=>r.id===region.id),revision,'[1]'),abort.signal)
   :prepareTerrainRegionPatch(selected,owner,region,revision,[{...edit,height:plane({x:Math.fround(.1+.5),z:Math.fround(.1)})+(accepted.raised?0:1.5)}],abort.signal)));
  if(current===ticket&&life===session){settled=true;paint();}
  await held;
  if(current!==ticket||life!==session||closed){lateIgnored++;return;}
  const unavailable=results.find(result=>result.status!=='done');
  if(unavailable){phase='refused';lastOutcome=unavailable.status;return;}
  candidate=assemble(results.map(r=>r.region),!accepted.raised,results.map(r=>r.patch),mode==='view-failure'?2:0);phase='ready';lastOutcome='Accepted render and query still unchanged';
 }catch(error){
  abort.abort(); // Promise.all may fail while sibling jobs are still running.
  if(current!==ticket||life!==session||closed){lateIgnored++;return;}
  phase='failed';lastOutcome=String(error.message??error);
 }finally{temporary?.dispose();if(current===ticket&&life===session){request=null;paint();}}
}
function publish(){if(closed||!candidate)return;const previous=accepted;accepted=candidate;candidate=null;scene.add(accepted.view);scene.remove(previous.view);disposeView(previous.view);publications++;phase='accepted';lastOutcome='Render and canonical query published together';paint();}
function close(){if(closed)return;closed=true;cancel();lifetime.abort();host.dispose();if(accepted){scene.remove(accepted.view);disposeView(accepted.view);}phase='closed';paint();}
function reenter(){if(!closed)return;closed=false;startSession();accepted={...accepted,view:makeView(accepted.generations)};scene.add(accepted.view);phase='accepted';lastOutcome='New lifetime; retained accepted document';paint();}
for(const [id,action] of Object.entries({edit:()=>begin(document.querySelector('#mode').value),retry:()=>begin('normal'),release:()=>request?.release(),cancel,publish,close,reenter}))document.querySelector(`#${id}`).addEventListener('click',action);
function state(){
 const probe={x:Math.fround(.1+.5),z:Math.fround(.1)},query=accepted?.coverage.query(probe.x+.01,probe.z+.01);
 return{resources:{...resourceCounts},phase,closed,session,revision:accepted?.revision,raised:accepted?.raised,publications,draws,lateIgnored,lastOutcome,settled,pending:!!request,candidate:!!candidate,queryHeight:query?.sample?.height,queryStatus:query?.status,oracle:accepted?.oracle,acceptedRevisions:accepted?.regions.map(r=>r.lattice.revision),renderRevision:accepted?.generations.map(g=>g.epoch),strides:accepted?.generations.flatMap(g=>g.chunks.map(c=>c.chunk.stride)),workers:host.stats(),leftHaloNormal:accepted?.regions[0].vertex(8,8).normal,sceneMeshes:scene.children.filter(c=>c.type==='Group').reduce((n,g)=>n+g.children.length,0)};
}
startSession();paint();
try{
 version=1;
 const result=await Promise.all(layout.map(region=>prepareTerrainRegion(host,owner,recipe(region,version),new AbortController().signal)));
 if(result.some(r=>r.status!=='done'))throw Error('Initial region unavailable');
 accepted=assemble(result.map(r=>r.region),false);scene.add(accepted.view);phase='accepted';lastOutcome='Real worker generation accepted';paint();
}catch(error){phase='failed';lastOutcome=String(error);paint();throw error;}
window.regionalSurface={state};
