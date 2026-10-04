#!/usr/bin/env node
// scripts/lab.mjs (`npm run lab -- [<id> [<command>] [args…]]`): work on one lab without typing its folder.
//   npm run lab                      lists the labs with the status line of each lab card
//   npm run lab -- <id>              npm run play for labs/<id>/game
//   npm run lab -- <id> <command>    npm run <command> with GAME_DIR=labs/<id>/game, for snap, script, criteria,
//                                    check, bench and gate (snap is play:snap, script is play:script, criteria is
//                                    play:criteria). GAME_DIR, not --game, so every step of a chained script sees it.
// Labs are started with `npm run new-lab -- <id>`; see docs/guides/labs.md.
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './lib/game-dir.mjs';

const COMMANDS = {
  play: 'play',
  snap: 'play:snap',
  script: 'play:script',
  criteria: 'play:criteria',
  check: 'check',
  bench: 'bench',
  gate: 'gate',
};

/** Every lab in `root` (labs/<id>/game/game.ts) with the `Status:` line of its card, sorted by id. */
export function labsIn(root = ROOT) {
  const dir = join(root, 'labs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(id => existsSync(join(dir, id, 'game', 'game.ts')))
    .sort()
    .map(id => {
      const card = join(dir, id, 'README.md');
      const text = existsSync(card) ? readFileSync(card, 'utf8') : '';
      return {
        id,
        status: /^Status:\s*(.+)$/m.exec(text)?.[1].trim() ?? 'no lab card',
        question: (/^\*\*Question:\*\*\s*(.+)$/m.exec(text)?.[1].trim() ?? '').replace(/^<.*>$/, '(no question yet)'),
      };
    });
}

/** `{args, gameDir}`: the npm arguments and the lab's game folder for `<id> [command] [args…]`. Throws with a message for the author on a bad request. */
export function labCommand(argv, root = ROOT) {
  const [id, command = 'play', ...rest] = argv;
  if (!existsSync(join(root, 'labs', id, 'game', 'game.ts')))
    throw Error(
      `No lab '${id}'. Labs: ${
        labsIn(root)
          .map(l => l.id)
          .join(', ') || 'none yet (npm run new-lab -- <id>)'
      }`,
    );
  const script = COMMANDS[command];
  if (!script) throw Error(`Unknown lab command '${command}'. Commands: ${Object.keys(COMMANDS).join(', ')}`);
  return {args: ['run', script, ...(rest.length ? ['--', ...rest] : [])], gameDir: `labs/${id}/game`};
}

if (process.argv[1]?.endsWith('lab.mjs')) {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    const labs = labsIn();
    console.log(
      labs.length
        ? labs
            .map(l => `${l.id.padEnd(24)} ${l.status}${l.question ? `\n${' '.repeat(25)}${l.question}` : ''}`)
            .join('\n')
        : 'No labs yet. Start one: npm run new-lab -- <id> [--template <name>] [--kit <name>]',
    );
  } else {
    try {
      const {args, gameDir} = labCommand(argv);
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      process.exitCode =
        spawnSync(npm, args, {
          stdio: 'inherit',
          shell: process.platform === 'win32',
          env: {...process.env, GAME_DIR: gameDir},
        }).status ?? 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
