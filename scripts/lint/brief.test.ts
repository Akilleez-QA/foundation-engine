import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { check, checkGame } from './brief';
import { ROOT } from './layers.mjs';

test('brief: every game in the checkout matches its brief', async () => {
  assert.deepEqual(await check(), []);
});

test('brief: a budget above the ceiling, a missing GAME.md row and a missing test name are reported', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-brief-'));
  try {
    cpSync(join(ROOT, 'templates', 'blank'), tmp, { recursive: true });
    const b = join(tmp, 'game', 'budgets.json'), data = JSON.parse(readFileSync(b, 'utf8'));
    data.scenes.main.budget.draws = 5000; writeFileSync(b, JSON.stringify(data));
    writeFileSync(join(tmp, 'GAME.md'), readFileSync(join(tmp, 'GAME.md'), 'utf8').replace('| S3 |', '| S9 |'));
    writeFileSync(join(tmp, 'game', 'main.test.ts'), readFileSync(join(tmp, 'game', 'main.test.ts'), 'utf8').replace("test('S1:", "test('first:"));
    const problems = await checkGame(join(tmp, 'game'));
    assert.ok(problems.some(p => /main\.draws 5000 is above the brief's ceiling 100/.test(p)), problems.join('\n'));
    assert.ok(problems.some(p => /S3: GAME\.md/.test(p)));
    assert.ok(problems.some(p => /S1: game\/main\.test\.ts has no test named/.test(p)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('brief: an input whose binding overlaps the engine\'s shell menu fails check with the boot\'s message', async () => {
  // Regression: the input generator used to write pad ['x'], which shell.menu owns; the boot failed but check passed.
  const tmp = mkdtempSync(join(tmpdir(), 'engine-brief-input-'));
  try {
    cpSync(join(ROOT, 'templates', 'blank'), tmp, { recursive: true });
    writeFileSync(join(tmp, 'game', 'jump.ts'), "import { defineInput } from '@engine';\nexport default defineInput({ id: 'jump', label: 'Jump', keys: ['f'], pad: ['x'], tap: true });\n");
    const problems = await checkGame(join(tmp, 'game'));
    assert.ok(problems.some(p => /input bindings would stop the dev\/test boot .*pad x: shell\.menu \(global\) and game\.jump \(global\) overlap/.test(p)), problems.join('\n'));
    rmSync(join(tmp, 'game', 'jump.ts')); // a new file name: the module cache keeps the first jump.ts
    writeFileSync(join(tmp, 'game', 'jump-free.ts'), "import { defineInput } from '@engine';\nexport default defineInput({ id: 'jump', label: 'Jump', keys: ['f'], pad: ['y'], tap: true });\n");
    const fixed = await checkGame(join(tmp, 'game'));
    assert.deepEqual(fixed.filter(p => /input bindings/.test(p)), []);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('brief: each resource cap must be explicit, finite and nonnegative, with integer counts', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-brief-caps-'));
  try {
    cpSync(join(ROOT, 'templates', 'blank'), tmp, { recursive: true });
    const file = join(tmp, 'game', 'budgets.json'), original = readFileSync(file, 'utf8');
    for (const metric of ['draws', 'triangles', 'textureMiB', 'heapMiB']) {
      for (const value of [undefined, null, -1, '12', true, {}, []]) {
        const data = JSON.parse(original); data.scenes.main.budget[metric] = value;
        writeFileSync(file, JSON.stringify(data));
        const problems = await checkGame(join(tmp, 'game'));
        assert.ok(problems.some(p => p.startsWith(`main.${metric} must be`)), `${metric}=${String(value)}: ${problems}`);
      }
      // JSON permits exponents whose parsed Number overflows to Infinity.
      writeFileSync(file, original.replace(new RegExp(`"${metric}"\\s*:\\s*[0-9.]+`), `"${metric}": 1e999`));
      assert.ok((await checkGame(join(tmp, 'game'))).some(p => p.startsWith(`main.${metric} must be`)));
    }
    for (const metric of ['draws', 'triangles']) {
      const data = JSON.parse(original); data.scenes.main.budget[metric] = .5;
      writeFileSync(file, JSON.stringify(data));
      assert.ok((await checkGame(join(tmp, 'game'))).some(p => p.startsWith(`main.${metric} must be`)));
    }
    for (const value of [undefined, null, -1, 0, '12', true]) {
      const data = JSON.parse(original); data.app.firstLoadJsKiB = value;
      writeFileSync(file, JSON.stringify(data));
      assert.ok((await checkGame(join(tmp, 'game'))).some(p => p.startsWith('app.firstLoadJsKiB must be')));
    }
    writeFileSync(file, original.replace(/"firstLoadJsKiB"\s*:\s*[0-9.]+/, '"firstLoadJsKiB": 1e999'));
    assert.ok((await checkGame(join(tmp, 'game'))).some(p => p.startsWith('app.firstLoadJsKiB must be')));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('brief: malformed budget documents return actionable problems instead of throwing', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-brief-json-'));
  try {
    cpSync(join(ROOT, 'templates', 'blank'), tmp, { recursive: true });
    const file = join(tmp, 'game', 'budgets.json');
    for (const text of ['{broken', 'null', '[]', '{"scenes":null}', '{"scenes":{"main":null}}', '{"scenes":{"main":{"budget":[]}}}']) {
      writeFileSync(file, text);
      assert.ok((await checkGame(join(tmp, 'game'))).length > 0, text);
    }
    rmSync(file);
    assert.match((await checkGame(join(tmp, 'game')))[0], /budgets.json could not be read as JSON/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('brief: zero resource caps and custom authored ceilings remain valid contracts', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-brief-custom-'));
  try {
    cpSync(join(ROOT, 'templates', 'blank'), tmp, { recursive: true });
    const brief = join(tmp, 'game', 'build.brief.ts');
    writeFileSync(brief, readFileSync(brief, 'utf8').replace('  success:', '  performance: { perScene: { draws: 77, triangles: 321, textureMiB: 1.5, heapMiB: 2.5 }, firstLoadKiB: 42.5 },\n  success:'));
    const file = join(tmp, 'game', 'budgets.json'), data = JSON.parse(readFileSync(file, 'utf8'));
    Object.assign(data.scenes.main.budget, { draws: 0, triangles: 0, textureMiB: 0, heapMiB: 0 }); data.app.firstLoadJsKiB = 42.5;
    writeFileSync(file, JSON.stringify(data)); assert.deepEqual(await checkGame(join(tmp, 'game')), []);
    Object.assign(data.scenes.main.budget, { draws: 77, triangles: 321, textureMiB: 1.5, heapMiB: 2.5 });
    writeFileSync(file, JSON.stringify(data)); assert.deepEqual(await checkGame(join(tmp, 'game')), []);
    data.scenes.main.budget.draws = 78; data.app.firstLoadJsKiB = 43;
    writeFileSync(file, JSON.stringify(data));
    const problems = await checkGame(join(tmp, 'game'));
    assert.ok(problems.some(p => /ceiling 77/.test(p))); assert.ok(problems.some(p => /firstLoadKiB 42.5/.test(p)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
