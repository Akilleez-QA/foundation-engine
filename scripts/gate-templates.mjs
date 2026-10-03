#!/usr/bin/env node
// Full unchanged gates per template. Optional shards select disjoint sorted names; --phone adds mobile smoke.
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from './lib/game-dir.mjs';
import {npmCommand} from './lib/tool.mjs';

export function discoverTemplates(root = ROOT) {
  const names = readdirSync(join(root, 'templates'), {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(join(root, 'templates', d.name, 'game'))).map(d => d.name).sort();
  for (const name of names) if (!existsSync(join(root, 'templates', name, 'game', 'game.ts'))) throw Error(`template ${name}: missing game/game.ts`);
  if (!names.length) throw Error('gate:templates: no templates discovered');
  return names;
}
export function selectTemplates(names, argv) {
  let shard = null, phone = false;
  const only = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--phone' && !phone) phone = true;
    else if (arg === '--shard' && !shard) {
      const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(argv[++i] ?? '');
      if (!match) throw Error('gate:templates: --shard needs index/count');
      shard = match.slice(1).map(Number);
      if (!shard.every(Number.isSafeInteger) || shard[0] > shard[1]) throw Error('gate:templates: invalid shard');
    } else if (arg.startsWith('-')) throw Error('gate:templates: unknown or repeated option ' + arg);
    else only.push(arg);
  }
  if (shard && only.length) throw Error('gate:templates: shard and template filters cannot be combined');
  for (const name of only) if (!names.includes(name)) throw Error('gate:templates: unknown template ' + name);
  const selected = [...names].sort().filter((name, i) => shard ? i % shard[1] === shard[0] - 1 : !only.length || only.includes(name));
  if (!selected.length) throw Error('gate:templates: empty selection');
  return {names: selected, phone};
}
export function runTemplates({names, phone}, {spawn = spawnSync, log = console.log, root = ROOT} = {}) {
  for (const name of names) {
    const t0 = Date.now();
    const commands = [['run', '-s', 'gate'], ...(phone ? [['run', '-s', 'play:snap', '--', '--mobile']] : [])];
    for (const args of commands) {
      log(`\n=== ${args[2]}: template ${name} ===`);
      const npm = npmCommand(args);
      const result = spawn(npm.command, npm.args, {cwd: root, stdio: 'inherit', shell: npm.shell, env: {...process.env, GAME_DIR: `templates/${name}/game`}});
      if (result.status !== 0) { log(`gate:templates ${name}: FAIL (${args[2]})`); return 1; }
    }
    log(`gate:templates ${name}: PASS (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runTemplates(selectTemplates(discoverTemplates(), process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
