#!/usr/bin/env node
// scripts/hooks/after-edit.mjs: a Claude Code PostToolUse hook (.claude/settings.json). After an agent edits a file it
// runs the cheap, file-local checks and hands any problem back as context. It never changes a file, never blocks the
// edit (always exit 0) and never opens a browser. The full check is `npm run check`.
//   - a game file: imports only @engine, @kits/<name>, its own files and JSON (lint:layers' game rule)
//   - an engine file in core/platform/author/app/dev: no genre vocabulary (lint:generic)
//   - budgets.json or build.brief.ts: the brief lint for that game
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* not a hook call */ }
const file = input.tool_input?.file_path ?? input.tool_input?.path;
if (!file) process.exit(0);
const rel = relative(ROOT, resolve(file)).split('\\').join('/');
const notes = [];
const gameDirOf = /^(game|templates\/[^/]+\/game)\//.exec(rel)?.[1];
if (gameDirOf && /\.(ts|mts)$/.test(rel)) {
  const {checkGame} = await import('../lint/layers.mjs');
  for (const v of checkGame(join(ROOT, gameDirOf)).filter(v => v.from === rel)) notes.push(`${rel}: imports ${v.to}; game code imports only @engine, @kits/<name>, its own files and JSON`);
}
if (/^src\/(core|platform|author|app|dev|features|domain|testing)\//.test(rel) || /^(README|AGENTS)\.md$|^docs\/(?!kits\/)/.test(rel)) {
  const {hits} = await import('../lint/genericity.mjs');
  let text = ''; try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { /* deleted */ }
  for (const h of hits(text).slice(0, 5)) notes.push(`${rel}:${h.line} uses the genre word "${h.word}" in the engine; move it to a kit or template, or rename`);
}
if (gameDirOf && /(budgets\.json|build\.brief\.ts)$/.test(rel)) {
  const {toolCommand} = await import('../lib/tool.mjs');
  const c = toolCommand('tsx', ['scripts/lint/brief.ts', gameDirOf]);
  const r = spawnSync(c.command, c.args, {cwd: ROOT, encoding: 'utf8', shell: c.shell});
  if (r.status !== 0) notes.push((r.stderr || r.stdout).trim());
}
if (notes.length) console.log(JSON.stringify({hookSpecificOutput: {hookEventName: 'PostToolUse', additionalContext: `after-edit checks:\n- ${notes.join('\n- ')}\nRun npm run check for the full picture.`}}));
process.exit(0);
