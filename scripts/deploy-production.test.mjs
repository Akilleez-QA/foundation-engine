import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseProblems} from './deploy-production.mjs';

const ok = {branch: 'main', porcelain: '', head: 'a'.repeat(40), originMain: 'a'.repeat(40)};

test('only a clean main equal to origin/main may be released', () => {
  assert.deepEqual(releaseProblems(ok), []);
  assert.match(releaseProblems({...ok, branch: 'feature/x'}).join(), /requires main, not 'feature\/x'/);
  assert.match(releaseProblems({...ok, branch: ''}).join(), /detached checkout/);
  assert.match(releaseProblems({...ok, porcelain: ' M src/app/main.ts'}).join(), /must be clean/);
  assert.match(releaseProblems({...ok, originMain: 'b'.repeat(40)}).join(), /must match origin\/main/);
  assert.match(releaseProblems({...ok, originMain: null}).join(), /origin\/main is unknown/);
});
