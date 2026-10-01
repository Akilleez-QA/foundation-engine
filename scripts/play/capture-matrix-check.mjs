#!/usr/bin/env node
/** Regression of optional tooling, not acceptance of application layouts or physical devices. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {captureMatrix} from './capture-matrix.mjs';
import {ROOT} from './lib.mjs';

const out = resolve(process.argv[2] ?? 'playtest/ui/capture-matrix');
const revision = execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
const workingTreeDirty = execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim().length > 0;
const manifest = JSON.parse(await readFile(new URL('./examples/capture-settings.json',import.meta.url),'utf8'));
const report = {revision,workingTreeDirty,passed:false,errors:[],
  limitations:['Selected stock fixture in browser emulation only; no physical-device or application usability acceptance.','Every matrix task and criterion must remain unverified.']};
await mkdir(out,{recursive:true});
const options = path => ({out:join(out,path),revision,workingTreeDirty});
const unverified = matrix => {
  for (const row of matrix.cases) {
    assert.equal(row.acceptance.status,'unverified');
    assert.ok(row.acceptance.criteria.every(c=>c.status==='unverified'));
    assert.equal(row.capture.cleanupError,undefined);
    assert.deepEqual(row.capture.errors,[]);
  }
  assert.deepEqual(matrix.errors,[]);
};
try {
  const settings = await captureMatrix(manifest,options('settings'));
  report.settings = 'settings/report.json';
  unverified(settings);
  assert.equal(settings.captureSucceeded,true);
  assert.deepEqual(settings.counts,{captured:3,skipped:0,failed:0,cancelled:0});
  for (const row of settings.cases) {
    assert.equal(row.steps.length,manifest.cases.find(c=>c.id===row.id).steps.length);
    assert.ok(row.steps.every(s=>s.status==='completed'));
    assert.ok((await stat(join(out,'settings',row.capture.screenshot))).size > 0);
  }

  const valid = manifest.cases.find(c=>c.profile==='desktop');
  assert.ok(valid);
  const failureManifest = {...manifest,cases:[
    {...valid,id:'deliberate-missing',steps:[{click:'#deliberately-missing',timeoutMs:200},{click:'#must-not-run'}]},
    {...valid,id:'valid-after-failure'},
  ]};
  await writeFile(join(out,'failure-manifest.json'),JSON.stringify(failureManifest,null,2)+'\n');
  const recovery = await captureMatrix(failureManifest,options('recovery'));
  report.recovery = 'recovery/report.json';
  unverified(recovery);
  assert.equal(recovery.captureSucceeded,false);
  assert.deepEqual(recovery.counts,{captured:1,skipped:0,failed:1,cancelled:0});
  const failed = recovery.cases[0];
  assert.equal(failed.steps.length,1);
  assert.equal(failed.steps[0].status,'failed');
  assert.match(failed.capture.error,/deliberately-missing/);
  assert.equal(failed.capture.screenshotError,undefined);
  assert.ok((await stat(join(out,'recovery',failed.capture.screenshot))).size > 0);
  assert.ok(recovery.cases[1].steps.every(s=>s.status==='completed'));
  report.passed = true;
} catch (error) {
  report.errors.push(String(error));
  process.exitCode = 1;
} finally {
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(`capture matrix regression: ${report.passed ? 'PASS' : 'FAIL'}; ${join(out,'report.json')}`);
