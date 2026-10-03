import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkGameRules, checkSource, format} from './game-rules.mjs';

const SCRIPT = fileURLToPath(new URL('./game-rules.mjs', import.meta.url));

/** A throwaway game folder holding `files` ({path: source}); returns the folder and a cleanup. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'game-rules-'));
  const dir = join(root, 'game');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), {recursive: true});
    writeFileSync(join(dir, path), text);
  }
  return {root, dir, done: () => rmSync(root, {recursive: true, force: true})};
}

const HUD = "import { hud } from '@kits/ui';\nimport { defineSystem } from '@engine';\n";

test('lint:game: Math.random() in a game file fails and names ctx.random()', () => {
  const f = fixture({'field.ts': 'export const spawnX = () => (Math.random() * 2 - 1) * 4;\n'});
  try {
    const v = checkGameRules(f.dir, f.root);
    assert.deepEqual(
      v.map(x => [x.file, x.line, x.rule]),
      [['game/field.ts', 1, 'math-random']],
    );
    assert.match(format(v[0]), /use ctx\.random\(\) \(seeded, replayable with \?seed=\)/);
  } finally {
    f.done();
  }
});

test('lint:game: a literal HUD string fails and names defineGame({ strings }) and ctx.text', () => {
  const f = fixture({
    'field.ts':
      HUD +
      "export default defineSystem({ id: 'coins', phase: 'frame', run(ctx) {\n  hud(ctx).line('coins', `Coins ${ctx.state.coins}`);\n  hud(ctx).banner('You win');\n  hud(ctx).prompt(ctx.text('game.hint'));\n} });\n",
  });
  try {
    const v = checkGameRules(f.dir, f.root);
    assert.deepEqual(
      v.map(x => [x.line, x.rule]),
      [
        [4, 'literal-ui-text'],
        [5, 'literal-ui-text'],
      ],
    );
    assert.match(format(v[0]), /add a string key via defineGame\(\{ strings.*ctx\.text\(/);
  } finally {
    f.done();
  }
});

test('lint:game: literal DOM text fails; string keys, the strings table and input labels pass', () => {
  assert.deepEqual(
    checkSource("el.textContent = 'Game over';\nb.setAttribute('aria-label', 'Close');\n").map(v => v.line),
    [1, 2],
  );
  assert.deepEqual(
    checkSource(
      [
        "el.textContent = ctx.text('game.over');",
        "export default defineGame({ strings: { en: { 'game.hud.coins': 'Coins {n}' } } });",
        "export const jump = defineInput({ id: 'jump', label: 'Jump', keys: ['Space'] });",
        "hud(ctx).line('coins', null); hud(ctx).banner(null); h.line(id, `${n}`);",
        'const seeded = ctx.random(); // Math.random() in a comment is not code',
      ].join('\n'),
    ),
    [],
  );
});

test('lint:game: tools/, public/ and test files are not game code', () => {
  const f = fixture({
    'tools/make-atlas.ts': 'export const jitter = Math.random();\n',
    'public/decoder.js': 'var r = Math.random();\n',
    'field.test.ts': "const n = Math.random(); el.textContent = 'x ' + n;\n",
    'field.ts': 'export const n = 1;\n',
  });
  try {
    assert.deepEqual(checkGameRules(f.dir, f.root), []);
  } finally {
    f.done();
  }
});

test('lint:game: an escape comment with a reason allows one line; without a reason it does not', () => {
  assert.deepEqual(
    checkSource(
      [
        '// lint-game-allow math-random: cosmetic sparkle offset, never affects state',
        'const a = Math.random();',
        "el.textContent = '©'; hud(ctx).banner('v1.2 build'); // lint-game-allow literal-ui-text: build stamp, not translated",
      ].join('\n'),
    ),
    [],
  );
  assert.deepEqual(
    checkSource('// lint-game-allow math-random:\nconst a = Math.random();\n').map(v => v.rule),
    ['math-random'],
  );
  assert.deepEqual(
    checkSource('// lint-game-allow literal-ui-text: wrong rule\nconst a = Math.random();\n').map(v => v.rule),
    ['math-random'],
  );
});

test('lint:game: the command passes on every template game (they follow the rules)', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no Math\.random\(\) or literal UI text/);
});
