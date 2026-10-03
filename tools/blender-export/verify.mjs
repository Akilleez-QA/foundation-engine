// Sample-specific offline acceptance, not a general untrusted-asset validator.
import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Box3, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(new URL('./export.py', import.meta.url));
export async function verify(file) {
  assert.ok(statSync(file).size <= 65536, 'sample exceeds 64 KiB');
  const bytes = readFileSync(file), manifest = JSON.parse(readFileSync(file.replace(/\.glb$/, '.provenance.json')));
  assert.equal(manifest.sourceSha256, digest(source), 'export source changed: regenerate');
  assert.equal(manifest.sha256, digest(bytes), 'asset hash disagrees with provenance');
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.source, 'tools/blender-export/export.py');
  assert.equal(manifest.author, 'Foundation Engine contributors');
  assert.equal(manifest.units, 'metres'); assert.equal(manifest.up, '+Y');
  assert.equal(manifest.pivot, 'base centre');
  assert.deepEqual(manifest.bounds, [[-.5,0,-.5],[.5,1,.5]]);
  assert.equal(manifest.triangles,12); assert.equal(manifest.materials,2); assert.equal(manifest.textures,0);
  assert.equal(manifest.licence, 'GPL-3.0-only');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  assert.equal(json.buffers.length, 1); assert.ok(!json.buffers[0].uri, 'buffer must be embedded');
  assert.equal(json.images?.length ?? 0, 0, 'sample texture budget is zero');
  assert.equal(json.textures?.length ?? 0, 0);
  assert.equal(json.animations?.length ?? 0, 0);
  assert.equal(json.materials.length, 2);
  assert.equal(json.extensionsRequired?.length ?? 0, 0);
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) assert.equal(primitive.mode ?? 4,4,'triangle primitives only');
  assert.deepEqual(json.materials.map(m=>m.name).sort(), ['body-blue','top-gold']);
  for (const m of json.materials) {
    assert.equal(m.alphaMode ?? 'OPAQUE','OPAQUE');
    const expected=m.name==='body-blue'?[.04,.35,.8,1]:[.9,.5,.03,1];
    assert.ok(m.pbrMetallicRoughness.baseColorFactor.every((v,i)=>Math.abs(v-expected[i])<1e-6),'material colour');
  }
  const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  asset.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(asset.scene, true), near = (a,b) => Math.abs(a-b) < 1e-6;
  assert.ok(bounds.min.toArray().every((v,i)=>near(v, [-.5,0,-.5][i])));
  assert.ok(bounds.max.toArray().every((v,i)=>near(v, [.5,1,.5][i])));
  const root = asset.scene.getObjectByName('metre-block'); assert.ok(root);
  assert.deepEqual(root.getWorldPosition(new Vector3()).toArray(), [0,0,0], 'base pivot');
  const geometry = []; let triangles = 0;
  asset.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry; triangles += (g.index?.count ?? g.attributes.position.count) / 3;
    const m = o.material; assert.ok(!Array.isArray(m));
    assert.equal(m.metalness,0); assert.equal(m.roughness,1); assert.equal(m.opacity,1);
    assert.equal(m.transparent,false);
    geometry.push({matrix:o.matrixWorld.toArray(), positions:Array.from(g.attributes.position.array),
      normals:Array.from(g.attributes.normal.array), indices:g.index ? Array.from(g.index.array) : null,
      material:{name:m.name,colour:m.color.toArray(),metalness:m.metalness,roughness:m.roughness}});
  });
  assert.equal(triangles,12); assert.equal(geometry.length,2);
  for (const o of asset.scene.children) o.traverse(n=>{ if(n.isMesh){n.geometry.dispose();n.material.dispose();} });
  return {bytes:bytes.length, triangles, primitives:geometry.length, materials:json.materials.length, textures:0,
    bounds:[bounds.min.toArray(),bounds.max.toArray()], sha256:digest(bytes), semanticSha256:digest(JSON.stringify(geometry)), blender:manifest.blender};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2); assert.ok(files.length, 'pass one or two GLB paths');
  assert.ok(files.length <= 2);
  const reports = await Promise.all(files.map(verify));
  if (reports.length === 2) assert.equal(reports[0].semanticSha256, reports[1].semanticSha256, 'exports differ semantically');
  console.log(JSON.stringify({passed:true,reports},null,2));
}
