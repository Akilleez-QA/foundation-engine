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
export const CODE_ENV = 'CI_CODE_CHANGED';
export const CODE_EXPRESSION = '${{ needs.changes.outputs.code }}';
const CHANGES_JOB = 'changes';

/**
 * Result the aggregate accepts for one work job.
 * Pull requests skip node-current. The weekly schedule skips the Node 22 jobs.
 * Docs-only pushes and pull requests (`codeChanged === 'false'`) skip every work job.
 * Anything else, including an unknown code flag, requires success. Absence is never success.
 * @param {string} id
 * @param {string} [event]
 * @param {string} [codeChanged]
 */
export function expectedJobResult(id, event = '', codeChanged = '') {
  if (event === 'schedule') return id === 'node-current' ? 'success' : 'skipped';
  if (codeChanged === 'false' && (event === 'pull_request' || event === 'push')) return 'skipped';
  if (event === 'pull_request' && id === 'node-current') return 'skipped';
  return 'success';
}

function changesResult(event) {
  if (event === 'schedule') return 'skipped';
  if (event === 'pull_request' || event === 'push') return 'success';
  return '';
}

export function requireSuccessfulJobs(results, event = '', codeChanged = '') {
  const keys = results && typeof results === 'object' && !Array.isArray(results) ? Object.keys(results) : [];
  if (
    !results ||
    typeof results !== 'object' ||
    Array.isArray(results) ||
    WORK_JOBS.some(id => !Object.hasOwn(results, id)) ||
    keys.some(id => id !== CHANGES_JOB && !WORK_JOBS.includes(id))
  )
    throw Error('check: expected exactly ' + WORK_JOBS.join(', '));
  const changes = changesResult(event);
  if (changes && results[CHANGES_JOB]?.result !== changes)
    throw Error(
      `check: unsuccessful jobs: ${CHANGES_JOB}=${results[CHANGES_JOB]?.result ?? 'missing'}${event ? ` [${event}]` : ''}`,
    );
  const failed = WORK_JOBS.filter(id => results[id]?.result !== expectedJobResult(id, event, codeChanged));
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
    requireSuccessfulJobs(JSON.parse(process.env[RESULTS_ENV] ?? 'null'), event, process.env[CODE_ENV] ?? '');
    console.log(event === '' ? 'check: every work job succeeded' : `check: work jobs matched ${event}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
