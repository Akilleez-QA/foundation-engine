#!/usr/bin/env node
// scripts/gate-templates.mjs (`npm run gate:templates`): the full gate once per template (GAME_DIR set to each
// templates/<name>/game in turn), so every template keeps passing as the engine changes. Stops at the first failure.
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './lib/game-dir.mjs';
import {npmCommand} from './lib/tool.mjs';

const only = process.argv.slice(2);
const names = readdirSync(join(ROOT, 'templates')).filter(n => existsSync(join(ROOT, 'templates', n, 'game', 'game.ts')) && (!only.length || only.includes(n)));
const results = [];
for (const name of names) {
  const t0 = Date.now();
  console.log(`\n=== gate: template ${name} ===`);
  const npm = npmCommand(['run', '-s', 'gate']);
  const r = spawnSync(npm.command, npm.args, {cwd: ROOT, stdio: 'inherit', shell: npm.shell, env: {...process.env, GAME_DIR: `templates/${name}/game`}});
  results.push({name, ok: r.status === 0, s: Math.round((Date.now() - t0) / 1000)});
  if (r.status !== 0) break;
}
for (const r of results) console.log(`gate:templates ${r.name}: ${r.ok ? 'PASS' : 'FAIL'} (${r.s} s)`);
process.exitCode = results.length === names.length && results.every(r => r.ok) ? 0 : 1;
