import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSuccessfulJobs, WORK_JOBS} from './ci-results.mjs';
const success = () => Object.fromEntries(WORK_JOBS.map(id => [id, {result: 'success'}]));
test('aggregate requires exactly all expected jobs and explicit success', () => {
  assert.doesNotThrow(() => requireSuccessfulJobs(success()));
  for (const value of [null, [], {}, {...success(), extra: {result:'success'}}]) assert.throws(() => requireSuccessfulJobs(value));
  for (const id of WORK_JOBS) {
    const missing = success(); delete missing[id]; assert.throws(() => requireSuccessfulJobs(missing));
    for (const result of ['failure','cancelled','skipped','pending','',undefined]) assert.throws(() => requireSuccessfulJobs({...success(), [id]: {result}}));
  }
});
