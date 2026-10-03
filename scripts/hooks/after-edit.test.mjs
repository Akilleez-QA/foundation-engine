import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HOOK = fileURLToPath(new URL('./after-edit.mjs', import.meta.url));
const run = input => spawnSync(process.execPath, [HOOK], {input: JSON.stringify(input), encoding: 'utf8'});

test('after-edit hook: always exits 0; quiet on a clean file; reports context as JSON otherwise', () => {
  const clean = run({
    tool_input: {file_path: fileURLToPath(new URL('../../templates/blank/game/main.ts', import.meta.url))},
  });
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout.trim(), '');
  assert.equal(run({}).status, 0);
  const noisy = run({
    tool_input: {file_path: fileURLToPath(new URL('../../scripts/lint/genericity.test.mjs', import.meta.url))},
  });
  assert.equal(noisy.status, 0, 'files outside the scanned areas are not checked');
});

test('after-edit hook: a wrong GAME_DIR in the environment does not break the always-exit-0 contract', () => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      tool_input: {file_path: fileURLToPath(new URL('../../templates/blank/game/budgets.json', import.meta.url))},
    }),
    encoding: 'utf8',
    env: {...process.env, GAME_DIR: 'templates/nope/game'},
  });
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
    writeFileSync(
      bad,
      "export const roll = () => Math.random();\nexport const show = (h: {line(id: string, t: string): void}, n: number) => h.line('coins', `Coins ${n}`);\n",
    );
    const tool = join(root, 'game', 'tools', 'gen.ts');
    writeFileSync(tool, 'export const r = Math.random();\n');
    const env = {...process.env, AFTER_EDIT_ROOT: root};
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({tool_input: {file_path: bad}}),
      encoding: 'utf8',
      env,
    });
    assert.equal(r.status, 0, r.stderr);
    const context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /game\/field\.ts:1 math-random: .*use ctx\.random\(\) \(seeded, replayable/);
    assert.match(context, /game\/field\.ts:2 literal-ui-text: .*defineGame\(\{ strings/);
    const quiet = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({tool_input: {file_path: tool}}),
      encoding: 'utf8',
      env,
    });
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout.trim(), '', 'tools/ is build-time Node code, not game code');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('after-edit hook: an unformatted file gets a format note; a file .prettierignore excludes does not', async () => {
  const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'after-edit-'));
  try {
    mkdirSync(join(root, 'game', 'tools'), {recursive: true});
    writeFileSync(join(root, '.prettierrc.json'), '{"singleQuote": true}\n');
    writeFileSync(join(root, '.prettierignore'), 'game/tools/kept.ts\n');
    const messy = join(root, 'game', 'tools', 'messy.ts');
    writeFileSync(messy, 'export const r={a:"b"}\n');
    const kept = join(root, 'game', 'tools', 'kept.ts');
    writeFileSync(kept, 'export const r={a:"b"}\n');
    const tidy = join(root, 'game', 'tools', 'tidy.ts');
    writeFileSync(tidy, "export const r = { a: 'b' };\n");
    const env = {...process.env, AFTER_EDIT_ROOT: root};
    const hook = file =>
      spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify({tool_input: {file_path: file}}),
        encoding: 'utf8',
        env,
      });
    const r = hook(messy);
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      JSON.parse(r.stdout).hookSpecificOutput.additionalContext,
      /game\/tools\/messy\.ts is not formatted; run npm run format/,
    );
    for (const file of [kept, tidy]) {
      const quiet = hook(file);
      assert.equal(quiet.status, 0);
      assert.equal(quiet.stdout.trim(), '', file);
    }
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
