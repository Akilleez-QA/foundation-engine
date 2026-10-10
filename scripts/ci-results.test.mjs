import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedJobResult, requireSuccessfulJobs, WORK_JOBS} from './ci-results.mjs';
const success = () => Object.fromEntries(WORK_JOBS.map(id => [id, {result: 'success'}]));
const withResult = (id, result) => ({...success(), [id]: {result}});
test('aggregate requires exactly all expected jobs and explicit success', () => {
  assert.doesNotThrow(() => requireSuccessfulJobs(success()));
  for (const value of [null, [], {}, {...success(), extra: {result: 'success'}}])
    assert.throws(() => requireSuccessfulJobs(value));
  for (const id of WORK_JOBS) {
    const missing = success();
    delete missing[id];
    assert.throws(() => requireSuccessfulJobs(missing));
    for (const result of ['failure', 'cancelled', 'skipped', 'pending', '', undefined])
      assert.throws(() => requireSuccessfulJobs(withResult(id, result)));
  }
});

test('pull requests accept a skipped node-current job and still require the Node 22 jobs', () => {
  const pull = withResult('node-current', 'skipped');
  assert.equal(expectedJobResult('node-current', 'pull_request'), 'skipped');
  assert.doesNotThrow(() => requireSuccessfulJobs(pull, 'pull_request'));
  assert.throws(() => requireSuccessfulJobs(success(), 'pull_request'), /node-current=success/);
  for (const id of ['browser', 'templates-1', 'templates-2']) {
    assert.throws(() => requireSuccessfulJobs(withResult(id, 'skipped'), 'pull_request'), new RegExp(`${id}=skipped`));
    assert.throws(() => requireSuccessfulJobs(withResult(id, 'failure'), 'pull_request'), new RegExp(`${id}=failure`));
  }
  assert.throws(
    () => requireSuccessfulJobs(withResult('node-current', 'failure'), 'pull_request'),
    /node-current=failure/,
  );
});

test('the weekly schedule accepts skipped Node 22 jobs and requires node-current success', () => {
  const weekly = {
    browser: {result: 'skipped'},
    'templates-1': {result: 'skipped'},
    'templates-2': {result: 'skipped'},
    'node-current': {result: 'success'},
  };
  assert.doesNotThrow(() => requireSuccessfulJobs(weekly, 'schedule'));
  assert.throws(() => requireSuccessfulJobs(success(), 'schedule'), /browser=success/);
  assert.throws(
    () => requireSuccessfulJobs({...weekly, 'node-current': {result: 'skipped'}}, 'schedule'),
    /node-current=skipped/,
  );
  assert.throws(
    () => requireSuccessfulJobs({...weekly, 'node-current': {result: 'failure'}}, 'schedule'),
    /node-current=failure/,
  );
});

test('a push still requires every work job to succeed', () => {
  assert.doesNotThrow(() => requireSuccessfulJobs(success(), 'push'));
  assert.throws(() => requireSuccessfulJobs(withResult('node-current', 'skipped'), 'push'), /node-current=skipped/);
});
