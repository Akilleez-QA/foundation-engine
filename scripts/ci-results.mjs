#!/usr/bin/env node
// Terminal CI check: every declared work job must report success; absence is never success.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const WORK_JOBS = ['browser', 'templates-1', 'templates-2', 'node-current'];
export const AGGREGATE_COMMAND = 'node scripts/ci-results.mjs';
export const RESULTS_ENV = 'CI_JOB_RESULTS';
export const RESULTS_EXPRESSION = '${{ toJSON(needs) }}';
export function requireSuccessfulJobs(results) {
  if (!results || typeof results !== 'object' || Array.isArray(results)
    || Object.keys(results).length !== WORK_JOBS.length
    || WORK_JOBS.some(id => !Object.hasOwn(results, id))) throw Error('check: expected exactly ' + WORK_JOBS.join(', '));
  const failed = WORK_JOBS.filter(id => results[id]?.result !== 'success');
  if (failed.length) throw Error('check: unsuccessful jobs: ' + failed.map(id => `${id}=${results[id]?.result ?? 'missing'}`).join(', '));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { requireSuccessfulJobs(JSON.parse(process.env[RESULTS_ENV] ?? 'null')); console.log('check: every work job succeeded'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
