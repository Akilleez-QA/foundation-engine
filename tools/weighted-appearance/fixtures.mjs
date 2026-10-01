// Original CC0 fixture, created for this diagnostic. No external asset bytes.
export const choices=['amber','cyan','reversed','missing','badbind','slow','failed'];
export function fixture(kind='amber') {
 const chunks=[],views=[],accessors=[];let size=0;
 const add=(array,type,componentType,count,extra={})=>{const bytes=Buffer.from(array.buffer);views.push({buffer:0,byteOffset:size,byteLength:bytes.length});chunks.push(bytes);size+=bytes.length;const pad=(4-size%4)%4;if(pad){chunks.push(Buffer.alloc(pad));size+=pad;}accessors.push({bufferView:views.length-1,componentType,count,type,...extra});return accessors.length-1;};
 const positions=add(new Float32Array([0,1,0,2,0,0,2,2,0]),'VEC3',5126,3,{min:[0,0,0],max:[2,2,0]});
 const reversed=kind==='reversed';
 const joints=add(new Uint16Array(reversed?[1,0,0,0,0,0,0,0,1,0,0,0]:[0,0,0,0,1,0,0,0,0,1,0,0]),'VEC4',5123,3);
 const weights=add(new Float32Array([1,0,0,0,1,0,0,0,.5,.5,0,0]),'VEC4',5126,3);
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],inverseB=[...identity];inverseB[12]=kind==='badbind'?-.5:-1;
 const inverse=add(new Float32Array(reversed?[...inverseB,...identity]:[...identity,...inverseB]),'MAT4',5126,2);
 const times=add(new Float32Array([0,1,2]),'SCALAR',5126,3,{min:[0],max:[2]});
 const rotations=add(new Float32Array([0,0,0,1,0,0,Math.SQRT1_2,Math.SQRT1_2,0,0,0,1]),'VEC4',5126,3);
 const g={asset:{version:'2.0',generator:'Foundation original weighted triangle'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'rig',children:[1,3]},{name:'A',children:[2]},{name:kind==='missing'?'other':'B',translation:[1,0,0]},{name:'surface',mesh:0,skin:0}],skins:[{joints:reversed?[2,1]:[1,2],inverseBindMatrices:inverse,skeleton:1}],meshes:[{primitives:[{attributes:{POSITION:positions,JOINTS_0:joints,WEIGHTS_0:weights},material:0}]}],materials:[{name:kind,alphaMode:kind==='source'?'BLEND':'OPAQUE',pbrMetallicRoughness:{baseColorFactor:kind==='source'?[.65,.65,.65,0]:kind==='amber'?[1,.6,.1,1]:[.1,.85,1,1],metallicFactor:0,roughnessFactor:1},doubleSided:true}],animations:kind==='source'?[{name:'bend',samplers:[{input:times,output:rotations,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:2,path:'rotation'}}]}]:[],accessors,bufferViews:views,buffers:[{byteLength:size}]};
 let json=Buffer.from(JSON.stringify(g));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const bin=Buffer.concat(chunks),head=Buffer.alloc(12);head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+bin.length,8);
 const chunk=(bytes,type)=>{const h=Buffer.alloc(8);h.writeUInt32LE(bytes.length);h.writeUInt32LE(type,4);return Buffer.concat([h,bytes]);};return Buffer.concat([head,chunk(json,0x4e4f534a),chunk(bin,0x004e4942)]);
}
// Independent scalar skinning reference: B rotates around (1,0), A is identity.
export function expectedVertices(angle,x=0){const c=Math.cos(angle),s=Math.sin(angle);return [[x,1,0],[x+1+c,s,0],[x+(2+1+c-2*s)/2,(2+s+2*c)/2,0]];}
