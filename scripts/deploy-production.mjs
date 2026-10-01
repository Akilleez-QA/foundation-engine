#!/usr/bin/env node
// scripts/deploy-production.mjs (`npm run deploy:production`): the only way to release to production (AGENTS.md).
//
// It refuses unless every one of these holds, re-checking the tree after the upload and before promotion:
//   - it holds the exclusive release lock (shared by every worktree: it lives in the git common dir);
//   - the checkout is on `main`, with no uncommitted or untracked changes;
//   - `main` equals `origin/main` after a fresh fetch (never an old snapshot, never a feature worktree);
//   - the bundle check passes on a fresh build of that commit.
// The hosting provider is a hook: `deploy.config.mjs` at the repository root exports
//   deploy({sha, root}) → Promise<{url}>      upload a production build WITHOUT moving live traffic
//   promote({url, sha}) → Promise<void>      move production to it (optional: a provider that deploys live has none)
// so this guard stays the same whatever the game ships to.
//
//   npm run deploy:production -- --check    run every check, deploy nothing
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {acquireReleaseLock} from './lib/release-lock.mjs';

/** Why this checkout may not be released; [] when it may. */
export function releaseProblems({branch, porcelain, head, originMain}) {
  const out = [];
  if (branch !== 'main') out.push(`production requires main, not ${branch ? `'${branch}'` : 'a detached checkout'}`);
  if (porcelain) out.push('main must be clean: commit or integrate every change first');
  if (!originMain) out.push('origin/main is unknown: fetch failed or there is no remote');
  else if (head !== originMain) out.push(`main (${head.slice(0, 12)}) must match origin/main (${originMain.slice(0, 12)})`);
  return out;
}

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const state = () => {
  let originMain = null; try { originMain = git('rev-parse', 'origin/main'); } catch { /* no remote */ }
  return {branch: git('branch', '--show-current'), porcelain: git('status', '--porcelain'), head: git('rev-parse', 'HEAD'), originMain};
};

export async function main(argv = process.argv.slice(2)) {
  const root = git('rev-parse', '--show-toplevel'); process.chdir(root);
  const lock = path.resolve(git('rev-parse', '--git-common-dir'), 'engine-production.lock');
  let release = null;
  const stop = () => { release?.(); release = null; process.exit(1); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
  try {
    release = acquireReleaseLock(lock);
    git('fetch', 'origin', 'main');
    const before = state(), problems = releaseProblems(before);
    if (problems.length) throw Error('Not released:\n  ' + problems.join('\n  '));
    const bundle = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/perf/bundle-check.ts', '--build'], {stdio: 'inherit'});
    if (bundle.error) throw bundle.error;
    if (bundle.status !== 0) throw Error('The bundle check failed (npm run perf:bundle); production was not deployed.');
    if (argv.includes('--check')) { console.log('Release checks passed for ' + before.head); return 0; }
    const config = path.join(root, 'deploy.config.mjs');
    if (!existsSync(config)) throw Error('No deploy provider: add deploy.config.mjs exporting deploy({sha, root}) and optionally promote({url, sha}).');
    const provider = await import(pathToFileURL(config).href);
    const {url} = await provider.deploy({sha: before.head, root});
    if (typeof url !== 'string' || !url) throw Error('The provider returned no deployment URL; production was not moved.');
    git('fetch', 'origin', 'main');
    const after = state(), moved = releaseProblems(after);
    if (moved.length || after.head !== before.head) throw Error(`main changed during deployment; the unpromoted release ${url} was not promoted. Reconcile and retry.`);
    if (provider.promote) await provider.promote({url, sha: before.head});
    console.log(`Released ${before.head} → ${url}. Confirm the live commit and assets through the public UI.`);
    return 0;
  } catch (error) { console.error(error.message); return 1; }
  finally { release?.(); release = null; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exitCode = await main();
