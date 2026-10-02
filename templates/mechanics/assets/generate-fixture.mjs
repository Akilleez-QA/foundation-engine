// Original deterministic test asset: two skinned segments and a named animated hand node.
import { writeFileSync, mkdirSync } from 'node:fs';
const chunks=[], views=[], accessors=[];let size=0;
const add=(array,type,componentType,count,extra={})=>{const bytes=Buffer.from(array.buffer);const offset=size;chunks.push(bytes);size+=bytes.length;const pad=(4-size%4)%4;if(pad){chunks.push(Buffer.alloc(pad));size+=pad;}views.push({buffer:0,byteOffset:offset,byteLength:bytes.length});accessors.push({bufferView:views.length-1,componentType,count,type,...extra});return accessors.length-1;};
const points=[];for(let part=0;part<2;part++)for(const [x,y,z]of [[-1,0,-1],[1,0,-1],[1,1,-1],[-1,1,-1],[-1,0,1],[1,0,1],[1,1,1],[-1,1,1]])points.push(x*.1,(part+y)*.6,z*.1);
const positions=add(new Float32Array(points),'VEC3',5126,16,{min:[-.1,0,-.1],max:[.1,1.2,.1]});
const normals=add(new Float32Array(Array.from({length:48},(_,i)=>i%3===1?0:points[i]*5)),'VEC3',5126,16);
const joints=add(new Uint16Array(Array.from({length:64},(_,i)=>i%4===0&&i>=32?1:0)),'VEC4',5123,16);
const weights=add(new Float32Array(Array.from({length:64},(_,i)=>i%4===0?1:0)),'VEC4',5126,16);
const face=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5];
const indices=add(new Uint16Array([...face,...face.map(i=>i+8)]),'SCALAR',5123,72);
const inverse=add(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0,0,0,1,0,0,-.6,0,1]),'MAT4',5126,2);
const times=add(new Float32Array([0,.5,1]),'SCALAR',5126,3,{min:[0],max:[1]});
const translations=add(new Float32Array([0,0,0,0,.3,0,0,0,0]),'VEC3',5126,3);
const gltf={asset:{version:'2.0',generator:'Foundation Engine original fixture generator'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'fixture',children:[1,2]},{name:'beacon',mesh:0,skin:0},{name:'shoulder',children:[3]},{name:'elbow',translation:[0,.6,0],children:[4]},{name:'hand',translation:[0,.6,0]}],skins:[{inverseBindMatrices:inverse,joints:[2,3],skeleton:2}],meshes:[{primitives:[{attributes:{POSITION:positions,NORMAL:normals,JOINTS_0:joints,WEIGHTS_0:weights},indices,material:0}]}],materials:[{name:'fixture-yellow',pbrMetallicRoughness:{baseColorFactor:[.95,.65,.1,1],metallicFactor:0,roughnessFactor:1},doubleSided:true}],animations:[{name:'pulse',samplers:[{input:times,output:translations,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:2,path:'translation'}}]}],accessors,bufferViews:views,buffers:[{byteLength:size}]};
let json=Buffer.from(JSON.stringify(gltf));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const bin=Buffer.concat(chunks);
const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+bin.length,8);
const chunk=(data,type)=>{const h=Buffer.alloc(8);h.writeUInt32LE(data.length,0);h.writeUInt32LE(type,4);return Buffer.concat([h,data]);};
const out=new URL('../game/public/models/mechanics/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('beacon.glb',out),Buffer.concat([header,chunk(json,0x4e4f534a),chunk(bin,0x004e4942)]));
