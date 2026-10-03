import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verify} from './verify.mjs';
const source = new URL('./game/public/models/metre-block.glb', import.meta.url);
function variant(change, rehash = true) {
 const bytes=readFileSync(source), size=bytes.readUInt32LE(12);
 const json=JSON.parse(bytes.subarray(20,20+size)); change(json);
 let chunk=Buffer.from(JSON.stringify(json)); chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);
 const head=Buffer.from(bytes.subarray(0,20)), rest=bytes.subarray(20+size);
 head.writeUInt32LE(20+chunk.length+rest.length,8);head.writeUInt32LE(chunk.length,12);
 const result=Buffer.concat([head,chunk,rest]);
 const dir=mkdtempSync(join(tmpdir(),'foundation-blender-validator-')),file=join(dir,'sample.glb');
 const manifest=JSON.parse(readFileSync(new URL('./game/public/models/metre-block.provenance.json',import.meta.url)));
 if(rehash)manifest.sha256=createHash('sha256').update(result).digest('hex');
 writeFileSync(file,result);writeFileSync(join(dir,'sample.provenance.json'),JSON.stringify(manifest));
 return {file,close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('checked-in Blender sample meets the physical export contract',async()=>{
 const report=await verify(source.pathname);assert.equal(report.triangles,12);assert.equal(report.materials,2);
});
test('a changed artifact cannot retain the previous provenance hash',async()=>{
 const v=variant(j=>{j.asset.generator='changed';},false);
 try{await assert.rejects(verify(v.file),/asset hash/);}finally{v.close();}
});
test('rehashing a sample with an external buffer does not authorize a fetch',async()=>{
 const v=variant(j=>{j.buffers[0].uri='https://invalid.example/not-allowed.bin';});
 try{await assert.rejects(verify(v.file),/embedded/);}finally{v.close();}
});
test('rehashing a shifted export does not satisfy metre bounds and base pivot',async()=>{
 const v=variant(j=>{j.nodes[j.scenes[j.scene].nodes[0]].translation=[0,1,0];});
 try{await assert.rejects(verify(v.file));}finally{v.close();}
});
