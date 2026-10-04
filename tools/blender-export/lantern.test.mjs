// The lantern example: an original asset made by game/tools/lantern/export.py, checked against its contract.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readContract, verifyFile} from '../../scripts/asset-verify.mjs';

const glb = fileURLToPath(new URL('./game/public/models/lantern.glb', import.meta.url));

test('the lantern meets its contract: size, base pivot, budget, materials and provenance', async () => {
  const report = await verifyFile(glb);
  const contract = readContract(glb.replace(/\.glb$/, '.contract.json'));
  assert.ok(report.triangles <= contract.limits.triangles);
  assert.equal(report.materials, 2);
  assert.equal(report.textures, 0);
  assert.equal(report.licence, 'GPL-3.0-only');
  assert.equal(report.source, 'tools/blender-export/game/tools/lantern/export.py');
  assert.match(report.tool, /^Blender 5\.2\./);
  assert.equal(report.bounds[0][1], 0, 'rests on its base');
});
