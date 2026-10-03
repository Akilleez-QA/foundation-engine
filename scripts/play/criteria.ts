// scripts/play/criteria.ts (`npm run play:criteria [-- --gate]`): a playtest round reported against the brief's
// success criteria. Each criterion is checked the way the brief says:
//   test      its test file (tsx --test)                  playtest  its play script, in a muted, isolated browser
//   gate      only with --gate (runs npm run gate)         manual    listed for the author to judge
// Writes playtest/latest/criteria.json and prints a table to show the author. Exit 1 when a checked criterion fails.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gameDir, ROOT } from '../lib/game-dir.mjs';
import { npmCommand, toolCommand } from '../lib/tool.mjs';
import { TAP_REPORTER, childTestEnv, testTotals } from '../lib/test-output.mjs';
import { loadGame } from '../../src/app/game-files';

export interface CriterionResult { id: string; check: string; how: string; status: 'pass' | 'fail' | 'not run' | 'ask the author'; detail: string }

export async function checkCriteria(o: { gate?: boolean; dir?: string } = {}): Promise<CriterionResult[]> {
  const dir = o.dir ?? gameDir(), gameRoot = join(dir, '..');
  const { brief } = await loadGame(dir);
  const out: CriterionResult[] = [];
  let server: { url: string; close(): Promise<void> } | null = null;
  let gate: boolean | null = null;
  try {
    for (const c of brief.success) {
      const row: CriterionResult = { id: c.id, check: c.check, how: c.how, status: 'not run', detail: '' };
      if (c.how === 'test' && c.by) {
        // The reporter is named: Node 23+ prints spec, not TAP, to a pipe by default.
        const t = toolCommand('tsx', ['--test', TAP_REPORTER, '--test-name-pattern', `^${c.id}\\b`, join(gameRoot, c.by)]);
        const r = spawnSync(t.command, t.args, { cwd: ROOT, encoding: 'utf8', shell: t.shell, env: childTestEnv() });
        const ran = testTotals(r.stdout)?.pass;
        // A pattern that matches no test exits 0; a criterion is checked only when a test named after it ran.
        const none = r.status === 0 && !(Number(ran) > 0);
        row.status = r.status === 0 && !none ? 'pass' : 'fail';
        row.detail = none ? `${c.by}: no test named ${c.id} ran (name it test('${c.id}: …'))` : r.status === 0 ? `${c.by}: ${ran} test(s) named ${c.id}` : `${c.by}: ${(r.stdout + r.stderr).split('\n').filter(l => /not ok|error:|expected|actual/.test(l)).slice(0, 4).join(' | ')}`;
      } else if (c.how === 'playtest' && c.by) {
        const script = JSON.parse(readFileSync(join(gameRoot, c.by), 'utf8'));
        const { scriptProblems } = await import('./script-schema.mjs');
        const problems = scriptProblems(script);
        // A malformed script fails here, before any server or browser starts.
        if (problems.length) { row.status = 'fail'; row.detail = `${c.by}: ${problems.join('; ')}`; out.push(row); continue; }
        const { serve } = await import('./lib.mjs');
        const { runScript } = await import('./script.mjs');
        server ??= await serve();
        const r = await runScript(script, server.url);
        row.status = r.pass ? 'pass' : 'fail';
        row.detail = `${c.by}: ${r.steps.filter((s: { step: { expect?: unknown } }) => s.step.expect).length} expectation(s); evidence playtest/latest/${script.name}/`;
      } else if (c.how === 'gate') {
        if (o.gate) { const n = npmCommand(['run', '-s', 'gate']); gate ??= spawnSync(n.command, n.args, { cwd: ROOT, stdio: 'ignore', shell: n.shell, env: { ...process.env, GAME_DIR: relative(ROOT, dir) } }).status === 0; row.status = gate ? 'pass' : 'fail'; row.detail = 'npm run gate'; }
        else row.detail = 'run with --gate (or npm run gate)';
      } else { row.status = 'ask the author'; row.detail = 'a person judges this one'; }
      out.push(row);
    }
  } finally { await server?.close(); }
  return out;
}

if (process.argv[1]?.endsWith('criteria.ts')) {
  const rows = await checkCriteria({ gate: process.argv.includes('--gate') }).catch((error: { code?: string; message?: string }) => {
    // A missing test browser is one actionable line (scripts/perf/bench-browser.mjs), not a stack.
    if (error?.code !== 'ENGINE_NO_BROWSER') throw error;
    console.error(error.message);
    process.exit(1);
  });
  const dir = join(ROOT, 'playtest', 'latest');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'criteria.json'), JSON.stringify({ when: new Date().toISOString(), game: relative(ROOT, gameDir()), criteria: rows }, null, 2) + '\n');
  console.log('| Id | Criterion | How | Result |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} | ${r.check} | ${r.how} | ${r.status.toUpperCase()}: ${r.detail} |`);
  const failed = rows.filter(r => r.status === 'fail');
  console.log(`\nplay:criteria: ${rows.filter(r => r.status === 'pass').length} pass, ${failed.length} fail, ${rows.filter(r => r.status === 'not run').length} not run, ${rows.filter(r => r.status === 'ask the author').length} for the author · playtest/latest/criteria.json`);
  process.exitCode = failed.length ? 1 : 0;
}
