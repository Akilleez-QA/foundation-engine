// new-game: a template becomes ./game with its playtests inside it, and --force replaces the old game completely.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ROOT} from './lib/game-dir.mjs';
import {quoted, startGame, withHeading} from './new-game.mjs';

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'engine-new-game-'));
  for (const t of ['blank', 'explorer'])
    cpSync(join(ROOT, 'templates', t), join(root, 'templates', t), {recursive: true});
  return root;
}

test("new-game: the template's playtests go into game/playtest, never the engine's root playtest/", () => {
  const root = scratch();
  try {
    startGame({root, name: 'explorer', id: 'garden-walk', title: 'Garden walk', log: () => {}});
    assert.ok(existsSync(join(root, 'game', 'playtest', 'door.json')));
    assert.equal(existsSync(join(root, 'playtest')), false);
    assert.match(readFileSync(join(root, 'game', 'game.ts'), 'utf8'), /id: 'garden-walk'/);
    // C10: lint:budgets ratchets the new game against the template it started from (no git here: commit null).
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'game', '.origin.json'), 'utf8')), {
      template: 'explorer',
      commit: null,
    });
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('new-game: --force removes the old game and GAME.md first, so no template files are mixed', () => {
  const root = scratch();
  try {
    startGame({root, name: 'blank', log: () => {}});
    writeFileSync(join(root, 'game', 'my-scene.ts'), "// the author's own file\n");
    assert.throws(() => startGame({root, name: 'explorer', log: () => {}}), /already exists; pass --force/);
    assert.ok(existsSync(join(root, 'game', 'main.ts')), 'without --force nothing changes');
    const lines = [];
    startGame({root, name: 'explorer', force: true, log: l => lines.push(l)});
    assert.match(lines[0], /removing game\/ \(\d+ files\) and GAME\.md/);
    for (const stale of ['main.ts', 'turn.ts', 'my-scene.ts', 'playtest/turn.json'])
      assert.equal(existsSync(join(root, 'game', stale)), false, `${stale} is gone`);
    assert.ok(existsSync(join(root, 'game', 'garden.ts')));
    assert.equal(
      readFileSync(join(root, 'GAME.md'), 'utf8'),
      readFileSync(join(root, 'templates', 'explorer', 'GAME.md'), 'utf8'),
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('new-game: a bad template or id is refused before anything is touched', () => {
  const root = scratch();
  try {
    assert.throws(() => startGame({root, name: 'nope', log: () => {}}), /No template 'nope'/);
    assert.throws(() => startGame({root, name: 'blank', id: 'Bad_Id', log: () => {}}), /kebab-case/);
    assert.equal(existsSync(join(root, 'game')), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("new-game: --title becomes GAME.md's heading as well as the game's title", () => {
  const root = scratch();
  try {
    startGame({root, name: 'explorer', id: 'orb-run', title: 'Orb Run', log: () => {}});
    const md = readFileSync(join(root, 'GAME.md'), 'utf8'),
      template = readFileSync(join(root, 'templates', 'explorer', 'GAME.md'), 'utf8');
    assert.equal(md.split('\n')[0], '# Orb Run');
    assert.equal(
      md.split('\n').slice(1).join('\n'),
      template.split('\n').slice(1).join('\n'),
      'only the heading changes',
    );
    assert.match(readFileSync(join(root, 'game', 'game.ts'), 'utf8'), /title: 'Orb Run'/);
    assert.equal(
      withHeading('# Old\n## Brief\n# Not this', 'A $& b'),
      '# A $& b\n## Brief\n# Not this',
      'first heading only, title taken literally',
    );
    assert.equal(withHeading('## Brief\n', 'New'), '# New\n\n## Brief\n');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('new-game: the renamed title is written the way Prettier prints it, so format:check stays green', async () => {
  const prettier = await import('prettier');
  const options = await prettier.resolveConfig(join(ROOT, 'package.json'));
  for (const title of ['Orb Run', "Kim's run", 'The "best" run', `It's "odd"`, "a 'b' \"c\" 'd'", 'back\\slash']) {
    const source = `export const game = {title: ${quoted(title)}};\n`;
    assert.equal(await prettier.format(source, {...options, parser: 'typescript'}), source, title);
    assert.equal(new Function(`return ${quoted(title)}`)(), title, title);
  }
});
