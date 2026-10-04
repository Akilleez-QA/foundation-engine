// scripts/play/playtests.ts (`npm run play:playtests`): every scripted playtest of the game, in a muted, isolated
// browser, on one dev server. The gate runs it (scripts/perf/gate.mjs), so a game whose browser playtests fail cannot
// pass the gate. It runs the union of:
//   - every <game>/playtest/*.json (the files lint:brief already checks against the script schema), and
//   - every success criterion with `how: 'playtest'` (its `by` file, wherever it is).
// A malformed script fails before any browser starts. Each script writes playtest/latest/<name>/ (report.json and
// its snaps); the summary is playtest/latest/playtests.json. Exit 1 when any script fails, 0 when every one passes or
// the game has none (said on one line, never as a pass of something that was not run).
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {gameDir, ROOT} from '../lib/game-dir.mjs';
import type {runScript} from './script.mjs';

export interface PlaytestFile {
  /** Path relative to the repository root, forward slashes. */
  file: string;
  /** Success criteria (ids) checked by this script. */
  criteria: string[];
}
export interface PlaytestResult extends PlaytestFile {
  name: string;
  pass: boolean;
  detail: string;
}
interface Criterion {
  id: string;
  how: string;
  by?: string | undefined;
}
type Runner = typeof runScript;
type Script = Parameters<Runner>[0];

const rel = (file: string) => relative(ROOT, file).split(sep).join('/');

/** The game's playtest scripts: playtest/*.json plus every playtest criterion's file, sorted, each listed once. */
export function playtestFiles(dir: string, success: readonly Criterion[]): PlaytestFile[] {
  const byFile = new Map<string, string[]>();
  const pt = join(dir, 'playtest');
  if (existsSync(pt))
    for (const f of readdirSync(pt).filter(n => n.endsWith('.json'))) byFile.set(rel(join(pt, f)), []);
  for (const c of success)
    if (c.how === 'playtest' && c.by) {
      const f = rel(join(dir, '..', c.by));
      byFile.set(f, [...(byFile.get(f) ?? []), c.id]);
    }
  return [...byFile].sort(([a], [b]) => a.localeCompare(b)).map(([file, criteria]) => ({file, criteria}));
}

/** Runs each script; a missing, unreadable or malformed file is a failure without a browser. */
export async function runPlaytests(
  files: readonly PlaytestFile[],
  o: {url: () => Promise<string>; run: Runner; problems: (s: unknown) => string[]},
): Promise<PlaytestResult[]> {
  const out: PlaytestResult[] = [];
  for (const f of files) {
    let script: Script;
    try {
      script = JSON.parse(readFileSync(join(ROOT, f.file), 'utf8')) as Script;
    } catch (error) {
      out.push({...f, name: f.file, pass: false, detail: `cannot read: ${(error as Error).message}`});
      continue;
    }
    const problems = o.problems(script);
    if (problems.length) {
      out.push({...f, name: String(script?.name ?? f.file), pass: false, detail: problems.join('; ')});
      continue;
    }
    const r = await o.run(script, await o.url());
    const failed = r.steps.filter(s => s.ok === false).length;
    out.push({
      ...f,
      name: script.name,
      pass: r.pass,
      detail: r.pass
        ? `${r.steps.length} step(s); evidence playtest/latest/${script.name}/`
        : `${failed} failing step(s)${r.errors?.length ? `, page errors: ${r.errors.slice(0, 2).join(' | ')}` : ''}; see playtest/latest/${script.name}/report.json`,
    });
  }
  return out;
}

if (process.argv[1]?.endsWith('playtests.ts')) {
  const dir = gameDir();
  const {loadGame} = await import('../../src/app/game-files');
  const {brief} = await loadGame(dir);
  const files = playtestFiles(dir, brief.success);
  const t0 = Date.now();
  if (!files.length) console.log(`play:playtests: ${rel(dir)} has no playtest scripts (nothing to run)`);
  else {
    const {serve} = await import('./lib.mjs');
    const {runScript} = await import('./script.mjs');
    const {scriptProblems} = await import('./script-schema.mjs');
    let server: {url: string; close(): Promise<void>} | null = null;
    try {
      const results = await runPlaytests(files, {
        url: async () => (server ??= await serve()).url,
        run: runScript,
        problems: scriptProblems,
      });
      for (const r of results)
        console.log(
          `  ${r.pass ? 'PASS' : 'FAIL'} ${r.file}${r.criteria.length ? ` (${r.criteria.join(', ')})` : ''}: ${r.detail}`,
        );
      const failed = results.filter(r => !r.pass);
      const out = join(ROOT, 'playtest', 'latest');
      mkdirSync(out, {recursive: true});
      writeFileSync(
        join(out, 'playtests.json'),
        JSON.stringify({when: new Date().toISOString(), game: rel(dir), results}, null, 2) + '\n',
      );
      console.log(
        `play:playtests: ${results.length - failed.length} pass, ${failed.length} fail in ${((Date.now() - t0) / 1000).toFixed(0)} s · playtest/latest/playtests.json`,
      );
      process.exitCode = failed.length ? 1 : 0;
    } catch (error) {
      // A missing test browser is one actionable line (scripts/perf/bench-browser.mjs), not a stack.
      if ((error as {code?: string})?.code !== 'ENGINE_NO_BROWSER') throw error;
      console.error((error as Error).message);
      process.exitCode = 1;
    } finally {
      await (server as {close(): Promise<void>} | null)?.close();
    }
  }
}
