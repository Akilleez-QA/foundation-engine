// docs/recipes/art-direction.md shows excerpts of the showcase template, which is compiled, tested and gated like every
// template. This keeps the two in step: every code block names its file on its first line (`// game/<file>`), and each
// part of it between `// …` lines appears in that file of templates/showcase/game, in order (whitespace aside).
// Every picture the recipe shows exists.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RECIPE = `${ROOT}docs/recipes/art-direction.md`;
const GAME = `${ROOT}templates/showcase/game/`;
const recipe = readFileSync(RECIPE, 'utf8');
const squash = text => text.replace(/\s+/g, '');

const blocks = [...recipe.matchAll(/```(ts|js)\n([\s\S]*?)```/g)].map(m => m[2]);

test('art direction: the recipe shows code', () => {
  assert.ok(blocks.length >= 15, `${blocks.length} code blocks`);
});

for (const [i, block] of blocks.entries()) {
  const [first, ...rest] = block.split('\n');
  const file = first.match(/^\/\/ game\/(\S+)/)?.[1];
  test(`art direction: block ${i + 1} (${file ?? first}) is the template's own code`, () => {
    assert.ok(file, `the block's first line names its file: // game/<file>, got ${first}`);
    assert.ok(existsSync(GAME + file), `templates/showcase/game/${file} exists`);
    const source = squash(readFileSync(GAME + file, 'utf8'));
    let from = 0;
    for (const part of rest.join('\n').split(/^\s*\/\/ …\s*$/m)) {
      const wanted = squash(part);
      if (!wanted) continue;
      const at = source.indexOf(wanted, from);
      assert.ok(at >= 0, `not found in ${file} (in order):\n${part.trim()}`);
      from = at + wanted.length;
    }
  });
}

test('art direction: every picture it shows exists', () => {
  const pictures = [...recipe.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
  assert.ok(pictures.length >= 9);
  for (const p of pictures) assert.ok(existsSync(new URL(p, `file://${RECIPE}`)), p);
});
