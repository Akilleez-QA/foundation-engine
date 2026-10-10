#!/usr/bin/env node
// Hosted path filter for ci.yml. Replaces workflow-level paths-ignore so the required check job still runs.
// A path is code unless it is under docs/ or ends in .md (the same globs as docs/** and **/*.md).
// When the diff cannot be proved, the result is code=true so the heavy jobs run.
import {spawnSync} from 'node:child_process';
import {appendFileSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CHANGES_COMMAND = 'node scripts/ci-changes.mjs';
export const CHANGES_OUTPUT_EXPRESSION = '${{ steps.paths.outputs.code }}';
const SHA = /^[0-9a-f]{40}$/i;

/** True when this path should start the heavy jobs. Unknown paths count as code. */
export function isCodePath(path) {
  if (typeof path !== 'string' || path === '') return true;
  const name = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (name === 'docs' || name.startsWith('docs/')) return false;
  if (name.endsWith('.md')) return false;
  return true;
}

/** True when any changed path is outside docs and Markdown. An empty diff is not a code change. */
export function codeChanged(paths) {
  return paths.some(isCodePath);
}

/**
 * Commits to compare. Pull requests use the triple-dot range from the base to the head.
 * Pushes use the two-dot range of the push. A missing or zero sha throws; the caller fails open.
 * @param {string} event
 * @param {{base?: string, before?: string, sha?: string}} shas
 */
export function diffRange(event, {base = '', before = '', sha = ''} = {}) {
  if (!SHA.test(sha)) throw Error('ci-changes: head sha');
  if (event === 'pull_request') {
    if (!SHA.test(base)) throw Error('ci-changes: base sha');
    return {from: base, to: sha, dots: '...'};
  }
  if (event === 'push') {
    if (!SHA.test(before) || /^0+$/.test(before)) throw Error('ci-changes: before sha');
    return {from: before, to: sha, dots: '..'};
  }
  throw Error('ci-changes: event');
}

/** git arguments for one range. Rename detection is off so a code path renamed to Markdown still counts. */
export function diffArgs(range) {
  return ['diff', '--name-only', '--no-renames', `${range.from}${range.dots}${range.to}`];
}

/** Shas from the Actions event payload. `sha` is GITHUB_SHA, used when the payload omits the head. */
export function shasFromPayload(event, payload, sha = '') {
  const body = payload && typeof payload === 'object' ? payload : {};
  if (event === 'pull_request') {
    const pull = body.pull_request;
    const head = pull && typeof pull === 'object' ? pull.head : null;
    const base = pull && typeof pull === 'object' ? pull.base : null;
    return {
      base: base && typeof base === 'object' && typeof base.sha === 'string' ? base.sha : '',
      before: '',
      sha: head && typeof head === 'object' && typeof head.sha === 'string' ? head.sha : sha,
    };
  }
  if (event === 'push') {
    return {
      base: '',
      before: typeof body.before === 'string' ? body.before : '',
      sha: typeof body.after === 'string' ? body.after : sha,
    };
  }
  return {base: '', before: '', sha};
}

/**
 * @param {string} event
 * @param {{base?: string, before?: string, sha?: string}} shas
 * @param {(range: {from: string, to: string, dots: string}) => string[]} listPaths
 */
export function classify(event, shas, listPaths) {
  try {
    const range = diffRange(event, shas);
    const paths = listPaths(range);
    if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string')) throw Error('ci-changes: paths');
    return {code: codeChanged(paths), reason: ''};
  } catch (error) {
    return {code: true, reason: error instanceof Error ? error.message : 'ci-changes: diff failed'};
  }
}

export function changedPaths(range, cwd) {
  const git = spawnSync('git', diffArgs(range), {cwd, encoding: 'utf8'});
  if (git.error) throw Error(`ci-changes: ${git.error.message}`);
  if (git.status !== 0) throw Error((git.stderr || 'ci-changes: git diff failed').trim());
  return git.stdout.split('\n').filter(Boolean);
}

function publish(code) {
  const line = `code=${code ? 'true' : 'false'}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  process.stdout.write(line);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let payload = {};
  let payloadFailed = false;
  if (process.env.GITHUB_EVENT_PATH) {
    try {
      payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'ci-changes: event payload');
      payloadFailed = true;
      publish(true);
    }
  }
  if (!payloadFailed) {
    const event = process.env.GITHUB_EVENT_NAME ?? '';
    const result = classify(event, shasFromPayload(event, payload, process.env.GITHUB_SHA ?? ''), range =>
      changedPaths(range, process.cwd()),
    );
    if (result.reason) console.error(result.reason);
    publish(result.code);
  }
}
