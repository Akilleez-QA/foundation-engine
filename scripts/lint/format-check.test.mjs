import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIX_HINT, checkCommand} from './format-check.mjs';

const SCRIPT = fileURLToPath(new URL('./format-check.mjs', import.meta.url));

test('format:check: the hint names the fix command', () => {
  assert.match(FIX_HINT, /npm run format\b/);
});

test('format:check: the whole tree by default, only the named files otherwise', () => {
  assert.equal(checkCommand().args.at(-1), '.');
  assert.deepEqual(checkCommand(['a.ts', 'b.md']).args.slice(-3), ['--ignore-unknown', 'a.ts', 'b.md']);
});

test('format:check: a failed check prints the fix command; a passing one does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'format-check-'));
  try {
    const bad = join(dir, 'bad.ts');
    const good = join(dir, 'good.ts');
    writeFileSync(bad, 'const   a =  1\n');
    writeFileSync(good, 'const a = 1;\n');
    const fail = spawnSync(process.execPath, [SCRIPT, bad], {encoding: 'utf8'});
    assert.notEqual(fail.status, 0);
    assert.ok(fail.stderr.includes(FIX_HINT), fail.stderr);
    const pass = spawnSync(process.execPath, [SCRIPT, good], {encoding: 'utf8'});
    assert.equal(pass.status, 0, pass.stderr);
    assert.ok(!pass.stderr.includes(FIX_HINT));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
