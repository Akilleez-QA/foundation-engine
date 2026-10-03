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

test('after-edit hook: a game file with Math.random() or literal HUD text gets lint:game notes naming the fix', async () => {
  const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'after-edit-'));
  try {
    mkdirSync(join(root, 'game', 'tools'), {recursive: true});
    const bad = join(root, 'game', 'field.ts');
    writeFileSync(bad, "export const roll = () => Math.random();\nexport const show = (h: {line(id: string, t: string): void}, n: number) => h.line('coins', `Coins ${n}`);\n");
    const tool = join(root, 'game', 'tools', 'gen.ts');
    writeFileSync(tool, 'export const r = Math.random();\n');
    const env = {...process.env, AFTER_EDIT_ROOT: root};
    const r = spawnSync(process.execPath, [HOOK], {input: JSON.stringify({tool_input: {file_path: bad}}), encoding: 'utf8', env});
    assert.equal(r.status, 0, r.stderr);
    const context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /game\/field\.ts:1 math-random: .*use ctx\.random\(\) \(seeded, replayable/);
    assert.match(context, /game\/field\.ts:2 literal-ui-text: .*defineGame\(\{ strings/);
    const quiet = spawnSync(process.execPath, [HOOK], {input: JSON.stringify({tool_input: {file_path: tool}}), encoding: 'utf8', env});
    assert.equal(quiet.status, 0); assert.equal(quiet.stdout.trim(), '', 'tools/ is build-time Node code, not game code');
  } finally { rmSync(root, {recursive: true, force: true}); }
});
