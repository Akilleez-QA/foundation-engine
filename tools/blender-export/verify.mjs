// The metre-block sample's acceptance: the general model-contract check (scripts/asset-verify.mjs) with the sample's
// own strict contract, game/public/models/metre-block.contract.json. That contract keeps every original sample rule:
// a 64 KiB cap, exact bounds and base pivot, no node transforms, exactly the exported material and PBR properties and
// colours, box-corner vertices, a two-triangle top-gold top and the pinned decoded semantic hash below.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readContract, verifyModel} from '../../scripts/asset-verify.mjs';
// Decoded geometry and materials of the checked-in export. A deliberate model change regenerates the
// GLB and provenance and updates this pin and the contract's in the same commit; rehashing an edited GLB alone
// cannot pass, and editing the contract alone cannot loosen the sample.
export const EXPECTED_SEMANTIC_SHA256 = '2b74ca47d75e1fde93ab35ad467f0e20374902b116c32b72ab29143fd00dd901';
const CONTRACT = fileURLToPath(new URL('./game/public/models/metre-block.contract.json', import.meta.url));
export async function verify(file) {
  const contract = readContract(CONTRACT);
  assert.equal(contract.semanticSha256, EXPECTED_SEMANTIC_SHA256, 'the sample contract must pin the sample hash');
  assert.equal(contract.limits.fileBytes, 65536, 'sample cap stays 64 KiB');
  return verifyModel(file, contract, {provenance: file.replace(/\.glb$/, '.provenance.json')});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  assert.ok(files.length, 'pass one or two GLB paths');
  assert.ok(files.length <= 2);
  const reports = await Promise.all(files.map(verify));
  if (reports.length === 2)
    assert.equal(reports[0].semanticSha256, reports[1].semanticSha256, 'exports differ semantically');
  console.log(JSON.stringify({passed: true, reports}, null, 2));
}
