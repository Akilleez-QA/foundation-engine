// scripts/lint/brief.ts (`npm run lint:brief`): the build brief is the contract (AGENTS.md). For every game in the
// checkout (./game and each templates/<name>/game) it checks that:
//   - the brief is valid (defineBuild already refuses a broken one; this reports it with the file);
//   - every scene has a budget row, and no budget is above the brief's per-scene ceiling for its minimum device;
//   - the first-load JS budget is within the brief's firstLoadKiB;
//   - every success criterion has a checkable `by` file that exists, and GAME.md mirrors every criterion id;
//   - every play:script file in the game's playtest/ folder is well formed and names scenes the game has;
//   - quality views, modes and a template's genre agree with the game;
//   - the input bindings pass the boot's inputActions validation (no overlap with the engine's or each other's rows);
//   - learn mode: every lesson meets the pedagogy rules (lessonProblems) with the brief's maxPassiveActions and ages.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gameDirs, ROOT } from './layers.mjs';
import { loadGame } from '../../src/app/game-files';
import type { SceneDefinition } from '../../src/author/defs';
import { lessonProblems, type LessonInput } from '../../src/kits/learn/lesson';
import { gameInputProblems } from '../../src/author/input-registry';
import { scriptProblems } from '../play/script-schema.mjs';

export interface BriefProblem { game: string; problem: string }
type Loaded = Awaited<ReturnType<typeof loadGame>>;
/** Extra checks a kit contributes (learn: lesson pacing). */
export type BriefCheck = (g: Loaded) => string[];
const extraChecks: BriefCheck[] = [];
export const addBriefCheck = (c: BriefCheck) => { extraChecks.push(c); };

const CEILING_KEYS = { draws: 'draws', triangles: 'triangles', textureMiB: 'textureMiB', heapMiB: 'heapMiB' } as const;

export async function checkGame(dir: string): Promise<string[]> {
  const out: string[] = [];
  let g: Loaded;
  try { g = await loadGame(dir); } catch (e) { return [`the game does not load: ${(e as Error).message}`]; }
  const { brief, game, defs } = g;
  const scenes = defs.filter((d): d is SceneDefinition => d.kind === 'scene').map(s => s.id);
  const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(join(dir, 'budgets.json'), 'utf8')); }
  catch (error) { return [`budgets.json could not be read as JSON: ${(error as Error).message}; restore a valid budget document with explicit scene and startup caps`]; }
  if (!record(raw)) return ['budgets.json must be an object with app and scenes budget objects'];
  const sceneBudgets = record(raw.scenes) ? raw.scenes : {};
  if (!record(raw.scenes)) out.push('budgets.json.scenes must be an object with an explicit budget row for every scene');
  for (const id of scenes) if (!Object.hasOwn(sceneBudgets, id)) out.push(`scene ${id} has no row in budgets.json (npm run new -- scene adds one)`);
  for (const [id, row] of Object.entries(sceneBudgets)) {
    if (!scenes.includes(id)) out.push(`budgets.json lists '${id}', which is not a scene`);
    const budget = record(row) && record(row.budget) ? row.budget : {};
    for (const [metric, key] of Object.entries(CEILING_KEYS)) {
      const v = budget[metric], ceiling = brief.performance.perScene[key];
      const count = metric === 'draws' || metric === 'triangles';
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (count && !Number.isInteger(v))) {
        out.push(`${id}.${metric} must be an explicit finite nonnegative ${count ? 'integer' : 'number'} in budgets.json`);
      } else if (v > ceiling) out.push(`${id}.${metric} ${v} is above the brief's ceiling ${ceiling} for a ${brief.devices.minimum} (lower the budget, or change the brief's minimum device with the author)`);
    }
  }
  const firstLoad = record(raw.app) ? raw.app.firstLoadJsKiB : undefined;
  if (typeof firstLoad !== 'number' || !Number.isFinite(firstLoad) || firstLoad <= 0) out.push('app.firstLoadJsKiB must be an explicit finite positive number in budgets.json');
  else if (firstLoad > brief.performance.firstLoadKiB) out.push(`app.firstLoadJsKiB ${firstLoad} is above the brief's firstLoadKiB ${brief.performance.firstLoadKiB}`);
  const gameRoot = join(dir, '..');
  const md = existsSync(join(gameRoot, 'GAME.md')) ? readFileSync(join(gameRoot, 'GAME.md'), 'utf8') : null;
  if (md === null) out.push('GAME.md is missing next to the game folder');
  for (const c of brief.success) {
    if (c.by && !existsSync(join(gameRoot, c.by))) out.push(`${c.id}: ${c.by} does not exist`);
    else if (c.how === 'test' && c.by && !new RegExp(`test\\(\\s*['"\`]${c.id}\\b`).test(readFileSync(join(gameRoot, c.by), 'utf8'))) out.push(`${c.id}: ${c.by} has no test named '${c.id}: …' (play:criteria runs tests by that name)`);
    if (md !== null && !md.includes(`| ${c.id} |`)) out.push(`${c.id}: GAME.md's brief does not mirror this success criterion`);
  }
  const playtests = join(dir, 'playtest');
  for (const name of existsSync(playtests) ? readdirSync(playtests).filter(f => f.endsWith('.json')).sort() : []) {
    const file = `game/playtest/${name}`;
    let script: unknown;
    try { script = JSON.parse(readFileSync(join(playtests, name), 'utf8')); } catch (error) { out.push(`${file}: not valid JSON: ${(error as Error).message}`); continue; }
    const problems = scriptProblems(script);
    for (const p of problems) out.push(`${file}: ${p} (docs/recipes/write-a-playtest-script.md)`);
    if (problems.length || !record(script)) continue;
    const named = [script.scene, ...(script.steps as Record<string, unknown>[]).map(s => s.goto)].filter((s): s is string => typeof s === 'string');
    for (const id of named) if (!scenes.includes(id)) out.push(`${file}: scene '${id}' does not exist (scenes: ${scenes.join(', ')})`);
  }
  if (md !== null && !md.includes(brief.goal)) out.push('GAME.md does not mirror the brief\'s goal (update its Brief block)');
  for (const v of brief.quality.views) if (!scenes.includes(v.scene)) out.push(`quality view ${v.id} names unknown scene '${v.scene}'`);
  const modes = defs.filter(d => d.kind === 'mode').map(d => d.id);
  for (const m of brief.modes) if (m !== 'play' && !modes.includes(m)) out.push(`the brief ships mode '${m}' but no defineMode has that id`);
  const template = /[\\/]templates[\\/]([^\\/]+)[\\/]game$/.exec(dir)?.[1];
  if (template && brief.genre !== template) out.push(`the template '${template}' has genre '${brief.genre}'`);
  if (!scenes.includes(game.firstScene)) out.push(`the first scene '${game.firstScene}' does not exist`);
  // The boot's inputActions validation (engine rows + game and kit inputs): a dev/test boot throws on it; production
  // drops the row with a warning, so the action silently does not work.
  for (const p of gameInputProblems(game, defs)) out.push(`input bindings would stop the dev/test boot (production drops the row): ${p} (give the game's defineInput another key or pad button)`);
  // Learn mode: every lesson meets the pedagogy rules with the brief's numbers (AGENTS.md, "Teaching").
  const strings = { ...Object.assign({}, ...(game.kits ?? []).map(k => k.strings?.en ?? {})), ...game.strings?.en };
  for (const d of defs) {
    const lesson = (d as { lesson?: LessonInput }).lesson;
    if (d.kind === 'scene' && lesson) for (const p of lessonProblems(lesson, { maxPassive: brief.pedagogy.maxPassiveActions, ages: brief.audience.ages, text: k => strings[k] ?? k })) out.push(`lesson ${lesson.id}: ${p}`);
  }
  for (const c of extraChecks) out.push(...c(g));
  return out;
}

export async function check(dirs = gameDirs()): Promise<BriefProblem[]> {
  const out: BriefProblem[] = [];
  for (const d of dirs) for (const problem of await checkGame(d)) out.push({ game: relative(ROOT, d).split('\\').join('/'), problem });
  return out;
}

if (process.argv[1]?.endsWith('brief.ts')) {
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const problems = await check(only.length ? only.map(d => join(ROOT, d)) : undefined);
  if (problems.length) { console.error(`lint:brief: ${problems.length} problem(s)\n` + problems.map(p => `  ${p.game}: ${p.problem}`).join('\n')); process.exitCode = 1; }
  else console.log(`lint:brief: every game matches its brief (${(only.length ? only : gameDirs()).length} game(s))`);
}
