import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {gameArg, gameDir, gameDirProblem, ROOT, templateGameDirs} from './game-dir.mjs';

test('--game <dir> and --game=<dir> select the game on any shell; absent means the environment decides', () => {
  assert.equal(gameArg(['--mobile', '--game', 'templates/arcade/game']), 'templates/arcade/game');
  assert.equal(gameArg(['--game=templates/learn/game', '--scene', 'x']), 'templates/learn/game');
  assert.equal(gameArg(['--scene', 'x']), undefined);
});

test('a GAME_DIR without game.ts is one line that lists the template game folders', () => {
  assert.ok(templateGameDirs().includes('templates/blank/game'));
  assert.equal(gameDirProblem({GAME_DIR: 'templates/arcade/game'}), null);
  assert.equal(gameDir({GAME_DIR: 'templates/arcade/game'}), join(ROOT, 'templates/arcade/game'));
  const problem = gameDirProblem({GAME_DIR: 'templates/nope/game'});
  assert.ok(problem && !problem.includes('\n') && problem.includes('templates/nope/game') && problem.includes('templates/blank/game'));
  assert.throws(() => gameDir({GAME_DIR: 'templates/nope/game'}), e => e.code === 'ENGINE_GAME_DIR' && e.message === problem);
});

test('an entry point given a wrong game stops with that one line and no stack; --game reaches child processes', () => {
  const lib = new URL('./game-dir.mjs', import.meta.url).href;
  const bad = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(lib)})`, '--', 'entry.mjs', '--game', 'templates/nope/game'], {encoding: 'utf8', env: {...process.env, GAME_DIR: ''}});
  assert.equal(bad.status, 2);
  assert.equal(bad.stderr.trim().split('\n').length, 1, bad.stderr);
  assert.match(bad.stderr, /^GAME_DIR templates\/nope\/game has no game\.ts\. .*templates\/blank\/game/);
  const good = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(lib)}); const {execFileSync} = await import('node:child_process'); process.stdout.write(execFileSync(process.execPath, ['-p', 'process.env.GAME_DIR'], {encoding: 'utf8'}))`,
    '--', 'entry.mjs', '--game', 'templates/arcade/game'], {encoding: 'utf8', env: {...process.env, GAME_DIR: ''}});
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout.trim(), 'templates/arcade/game');
});
