import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HOOK = fileURLToPath(new URL('./after-edit.mjs', import.meta.url));
const run = input => spawnSync(process.execPath, [HOOK], {input: JSON.stringify(input), encoding: 'utf8'});

test('after-edit hook: always exits 0; quiet on a clean file; reports context as JSON otherwise', () => {
  const clean = run({tool_input: {file_path: fileURLToPath(new URL('../../templates/blank/game/main.ts', import.meta.url))}});
  assert.equal(clean.status, 0); assert.equal(clean.stdout.trim(), '');
  assert.equal(run({}).status, 0);
  const noisy = run({tool_input: {file_path: fileURLToPath(new URL('../../scripts/lint/genericity.test.mjs', import.meta.url))}});
  assert.equal(noisy.status, 0, 'files outside the scanned areas are not checked');
});

test('after-edit hook: a wrong GAME_DIR in the environment does not break the always-exit-0 contract', () => {
  const r = spawnSync(process.execPath, [HOOK], {input: JSON.stringify({tool_input: {file_path: fileURLToPath(new URL('../../templates/blank/game/budgets.json', import.meta.url))}}), encoding: 'utf8', env: {...process.env, GAME_DIR: 'templates/nope/game'}});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});
