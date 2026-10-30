import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assessEvidence} from './report.mjs';

const identity = {artifact: 'fixture-v1', configuration: 'case-v1', oracle: 'exact-v1', environment: 'node'};
const contract = {format: 'acceptance/1', identity, required: [{id: 'state', minSamples: 2}]};
const report = (cases = [{id: 'state', status: 'passed', samples: 2}]) => ({format: 'acceptance/1', identity, cases});

test('nonempty declared evidence accepts and returns detached frozen results', () => {
  const input = report();
  const result = assessEvidence(contract, input);
  assert.equal(result.status, 'passed');
  input.cases[0].samples = 0;
  assert.equal(result.cases[0].samples, 2);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.cases) && Object.isFrozen(result.cases[0]));
});

test('missing, skipped, failed and under-sampled evidence cannot pass', () => {
  for (const cases of [
    [],
    [{id: 'state', status: 'passed', samples: 0}],
    [{id: 'state', status: 'passed', samples: 1}],
    [{id: 'state', status: 'failed', samples: 2}],
    [{id: 'state', status: 'skipped', samples: 2}],
  ]) {
    assert.equal(assessEvidence(contract, report(cases)).status, 'failed');
  }
});

test('duplicates, unknown cases, invalid counts and empty requirements are invalid', () => {
  for (const cases of [
    [...report().cases, ...report().cases],
    [{id: 'other', status: 'passed', samples: 2}],
    [{id: 'state', status: 'passed', samples: NaN}],
    [{id: 'state', status: 'passed', samples: -1}],
    [{id: 'state', status: 'passed', samples: 0.5}],
    [{id: 'state', status: 'maybe', samples: 2}],
  ]) {
    assert.equal(assessEvidence(contract, report(cases)).status, 'invalid');
  }
  assert.equal(assessEvidence({...contract, required: []}, report()).status, 'invalid');
  assert.equal(
    assessEvidence({...contract, required: [...contract.required, ...contract.required]}, report()).status,
    'invalid',
  );
  assert.equal(
    assessEvidence({...contract, required: Array(257).fill(contract.required[0])}, report()).status,
    'invalid',
  );
});

test('every named identity dimension must match', () => {
  for (const key of Object.keys(identity)) {
    assert.equal(
      assessEvidence(contract, {...report(), identity: {...identity, [key]: 'different'}}).status,
      'invalid',
    );
    assert.equal(assessEvidence({...contract, identity: {...identity, [key]: ''}}, report()).status, 'invalid');
  }
});

test('CLI actually exits nonzero for absent, corrupt, mismatching and oversized evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundation-evidence-'));
  try {
    const cp = join(dir, 'contract.json'),
      rp = join(dir, 'report.json');
    writeFileSync(cp, JSON.stringify(contract));
    const run = text => {
      writeFileSync(rp, text);
      return spawnSync(process.execPath, [new URL('./cli.mjs', import.meta.url).pathname, cp, rp], {encoding: 'utf8'});
    };
    assert.equal(run(JSON.stringify(report())).status, 0);
    assert.equal(run(JSON.stringify(report([]))).status, 1);
    assert.equal(run(JSON.stringify(report([{id: 'state', status: 'failed', samples: 2}]))).status, 1);
    assert.equal(run('{').status, 2);
    assert.equal(run(' '.repeat((1 << 20) + 1)).status, 2);
    const missing = spawnSync(process.execPath, [
      new URL('./cli.mjs', import.meta.url).pathname,
      cp,
      join(dir, 'absent'),
    ]);
    assert.equal(missing.status, 2);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
