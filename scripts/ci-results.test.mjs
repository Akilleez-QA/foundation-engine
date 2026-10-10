import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedJobResult, requireSuccessfulJobs, WORK_JOBS} from './ci-results.mjs';
const success = () => Object.fromEntries(WORK_JOBS.map(id => [id, {result: 'success'}]));
const withResult = (id, result) => ({...success(), [id]: {result}});
const hosted = (work, changes = 'success') => ({...work, changes: {result: changes}});
const docsOnly = () =>
  hosted({
    browser: {result: 'skipped'},
    'templates-1': {result: 'skipped'},
    'templates-2': {result: 'skipped'},
    'node-current': {result: 'skipped'},
  });
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
  const pull = hosted(withResult('node-current', 'skipped'));
  assert.equal(expectedJobResult('node-current', 'pull_request'), 'skipped');
  assert.doesNotThrow(() => requireSuccessfulJobs(pull, 'pull_request', 'true'));
  assert.throws(() => requireSuccessfulJobs(hosted(success()), 'pull_request', 'true'), /node-current=success/);
  assert.throws(() => requireSuccessfulJobs(success(), 'pull_request', 'true'), /changes=missing/);
  for (const id of ['browser', 'templates-1', 'templates-2']) {
    assert.throws(
      () => requireSuccessfulJobs(hosted(withResult(id, 'skipped')), 'pull_request', 'true'),
      new RegExp(`${id}=skipped`),
    );
    assert.throws(
      () => requireSuccessfulJobs(hosted(withResult(id, 'failure')), 'pull_request', 'true'),
      new RegExp(`${id}=failure`),
    );
  }
  assert.throws(
    () => requireSuccessfulJobs(hosted(withResult('node-current', 'failure')), 'pull_request', 'true'),
    /node-current=failure/,
  );
});

test('the weekly schedule accepts skipped Node 22 jobs and requires node-current success', () => {
  const weekly = hosted(
    {
      browser: {result: 'skipped'},
      'templates-1': {result: 'skipped'},
      'templates-2': {result: 'skipped'},
      'node-current': {result: 'success'},
    },
    'skipped',
  );
  assert.doesNotThrow(() => requireSuccessfulJobs(weekly, 'schedule'));
  assert.throws(() => requireSuccessfulJobs(hosted(success(), 'skipped'), 'schedule'), /browser=success/);
  assert.throws(
    () => requireSuccessfulJobs({...weekly, 'node-current': {result: 'skipped'}}, 'schedule'),
    /node-current=skipped/,
  );
  assert.throws(
    () => requireSuccessfulJobs({...weekly, 'node-current': {result: 'failure'}}, 'schedule'),
    /node-current=failure/,
  );
  assert.throws(() => requireSuccessfulJobs(hosted(weekly, 'success'), 'schedule'), /changes=success/);
});

test('a push still requires every work job to succeed when code changed', () => {
  assert.doesNotThrow(() => requireSuccessfulJobs(hosted(success()), 'push', 'true'));
  assert.throws(
    () => requireSuccessfulJobs(hosted(withResult('node-current', 'skipped')), 'push', 'true'),
    /node-current=skipped/,
  );
  assert.throws(() => requireSuccessfulJobs(success(), 'push', 'true'), /changes=missing/);
});

test('docs-only pushes and pull requests accept skipped heavy jobs and still require changes to succeed', () => {
  assert.doesNotThrow(() => requireSuccessfulJobs(docsOnly(), 'pull_request', 'false'));
  assert.doesNotThrow(() => requireSuccessfulJobs(docsOnly(), 'push', 'false'));
  assert.throws(() => requireSuccessfulJobs(docsOnly(), 'pull_request', 'true'), /browser=skipped/);
  assert.throws(() => requireSuccessfulJobs(docsOnly(), 'push', ''), /browser=skipped/);
  assert.throws(() => requireSuccessfulJobs(hosted(docsOnly(), 'failure'), 'pull_request', 'false'), /changes=failure/);
});
