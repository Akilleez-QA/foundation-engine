// W1-5: a build ships the game it builds and only that game's static files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {conflicts, gamePublic, publicFiles, resolveRequest} from './game-public.mjs';
import {ROOT, templateGameDirs} from './game-dir.mjs';

const tree = files => {
  const dir = mkdtempSync(join(tmpdir(), 'game-public-'));
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), text); }
  return dir;
};
/** Runs the plugin's build hook with a fake Rollup context; returns the emitted files or the error. */
const build = (gameDir, shared) => {
  const emitted = {};
  const ctx = {emitFile: f => { emitted[f.fileName] = String(f.source); }, error: m => { throw Error(m); }};
  gamePublic({dir: () => gameDir, shared}).generateBundle.call(ctx);
  return emitted;
};

test('a build emits every file of the game\'s own public folder at its path, and nothing else', t => {
  const game = tree({'models/robot.glb': 'glb', 'sounds/a/b.wav': 'wav'}), shared = tree({});
  t.after(() => { rmSync(game, {recursive: true}); rmSync(shared, {recursive: true}); });
  assert.deepEqual(publicFiles(game), ['models/robot.glb', 'sounds/a/b.wav']);
  assert.deepEqual(build(game, shared), {'models/robot.glb': 'glb', 'sounds/a/b.wav': 'wav'});
});

test('a game without a public folder emits nothing (blank, arcade): no other template\'s files', () => {
  assert.deepEqual(publicFiles(join(tmpdir(), 'no-such-folder-' + process.pid)), []);
  assert.deepEqual(build(join(tmpdir(), 'no-such-folder-' + process.pid), join(tmpdir(), 'no-such-shared-' + process.pid)), {});
});

test('a file in both the game folder and the shared root folder stops the build, naming both', t => {
  const game = tree({'textures/x.png': 'game'}), shared = tree({'textures/x.png': 'shared', 'other.txt': 'ok'});
  t.after(() => { rmSync(game, {recursive: true}); rmSync(shared, {recursive: true}); });
  assert.deepEqual(conflicts(game, shared), ['textures/x.png']);
  assert.throws(() => build(game, shared), /1 file\(s\) are in both .*textures\/x\.png/);
});

test('the dev server resolves only files inside the game\'s public folder, under the base', t => {
  const game = tree({'models/robot.glb': 'glb'});
  t.after(() => rmSync(game, {recursive: true}));
  assert.equal(resolveRequest(game, '/models/robot.glb'), join(game, 'models/robot.glb'));
  assert.equal(resolveRequest(game, '/games/x/models/robot.glb', '/games/x/'), join(game, 'models/robot.glb'));
  assert.equal(resolveRequest(game, '/models/missing.glb'), null);
  assert.equal(resolveRequest(game, '/models'), null, 'a folder is not a file');
  assert.equal(resolveRequest(game, '/../' + game.split('/').pop() + '/models/robot.glb'), join(game, 'models/robot.glb'), 'normalised inside the folder');
  assert.equal(resolveRequest(game, '/%2e%2e/%2e%2e/etc/passwd'), null, 'never leaves the folder');
  assert.equal(resolveRequest(game, '/%E0%A4%A'), null, 'a malformed escape is not a file');
});

test('the engine keeps no file in the shared root public folder, so no template\'s files ship with another game', () => {
  assert.deepEqual(publicFiles(join(ROOT, 'public')), [], 'a template\'s files belong in templates/<name>/game/public/');
  const owned = templateGameDirs().filter(d => publicFiles(join(ROOT, d, 'public')).length);
  assert.deepEqual(owned, ['templates/mechanics/game'], 'only the mechanics template ships static files today');
});
