#!/usr/bin/env node
// Terminal CI check: every declared work job must report success; absence is never success.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const WORK_JOBS = ['browser', 'templates-1', 'templates-2', 'node-current'];
export const AGGREGATE_COMMAND = 'node scripts/ci-results.mjs';
export const RESULTS_ENV = 'CI_JOB_RESULTS';
export const RESULTS_EXPRESSION = '${{ toJSON(needs) }}';
export const EVENT_ENV = 'CI_EVENT_NAME';
export const EVENT_EXPRESSION = '${{ github.event_name }}';

/**
 * Result the aggregate accepts for one work job.
 * Pull requests skip node-current. The weekly schedule skips the Node 22 jobs.
 * A push, a local run, or any other event requires every job to succeed.
 * @param {string} id
 * @param {string} [event]
 */
export function expectedJobResult(id, event = '') {
  if (event === 'pull_request') return id === 'node-current' ? 'skipped' : 'success';
  if (event === 'schedule') return id === 'node-current' ? 'success' : 'skipped';
  return 'success';
}

export function requireSuccessfulJobs(results, event = '') {
  if (
    !results ||
    typeof results !== 'object' ||
    Array.isArray(results) ||
    Object.keys(results).length !== WORK_JOBS.length ||
    WORK_JOBS.some(id => !Object.hasOwn(results, id))
  )
    throw Error('check: expected exactly ' + WORK_JOBS.join(', '));
  const failed = WORK_JOBS.filter(id => results[id]?.result !== expectedJobResult(id, event));
  if (failed.length)
    throw Error(
      'check: unsuccessful jobs: ' +
        failed.map(id => `${id}=${results[id]?.result ?? 'missing'}`).join(', ') +
        (event ? ` [${event}]` : ''),
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const event = process.env[EVENT_ENV] ?? '';
    requireSuccessfulJobs(JSON.parse(process.env[RESULTS_ENV] ?? 'null'), event);
    console.log(event === '' ? 'check: every work job succeeded' : `check: work jobs matched ${event}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
