// W1-5: a build ships the game it builds and only that game's static files, and the dev server serves the same ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RESERVED, gamePublic, gamePublicDir, publicFiles, publicProblems} from './game-public.mjs';
import {ROOT, templateGameDirs} from './game-dir.mjs';

const tree = files => {
  const dir = mkdtempSync(join(tmpdir(), 'game-public-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), {recursive: true});
    writeFileSync(join(dir, path), text);
  }
  return dir;
};
const none = name => join(tmpdir(), `no-such-${name}-${process.pid}`);
/** Runs the plugin's build hook with a fake Rollup context, as Vite does when a build starts. */
const build = (publicDir, shared) => {
  const plugin = gamePublic({shared});
  plugin.configResolved({publicDir});
  plugin.buildStart.call({
    error: m => {
      throw Error(m);
    },
  });
};
/** Runs the plugin's dev-server hook, as Vite does before the server listens. */
const serve = (publicDir, shared) => {
  const plugin = gamePublic({shared});
  plugin.configResolved({publicDir});
  plugin.configureServer({});
};

test("the public folder is the game's own when it has one, else the shared root folder", t => {
  const game = tree({'models/robot.glb': 'glb'}),
    shared = tree({});
  t.after(() => {
    rmSync(game, {recursive: true});
    rmSync(shared, {recursive: true});
  });
  assert.equal(gamePublicDir({game, shared}), game);
  assert.equal(
    gamePublicDir({game: none('game'), shared}),
    shared,
    'a game without public/ (blank, arcade) uses the root folder',
  );
  assert.deepEqual(publicFiles(game), ['models/robot.glb']);
  assert.doesNotThrow(() => build(game, shared));
  assert.doesNotThrow(() => serve(game, shared));
});

test('reserved names the build writes itself (the page and the licence notices) stop the build and the dev server', t => {
  for (const name of RESERVED) {
    const game = tree({[name]: 'replacement', 'models/ok.glb': 'glb'}),
      shared = none('shared');
    t.after(() => rmSync(game, {recursive: true}));
    assert.throws(
      () => build(game, shared),
      new RegExp(`holds ${name.replace('.', '\\.')}: the build writes this name itself`),
    );
    assert.throws(() => serve(game, shared), new RegExp(name.replace('.', '\\.')));
  }
  const nested = tree({'docs/LICENSE.txt': 'a model licence in a subfolder is fine'});
  t.after(() => rmSync(nested, {recursive: true}));
  assert.doesNotThrow(() => build(nested, none('shared')));
  const cased = tree({'license.TXT': 'x'});
  t.after(() => rmSync(cased, {recursive: true}));
  assert.throws(() => build(cased, none('shared')), /license\.TXT/, 'case-insensitive file systems would collide too');
});

test('a symbolic link is refused in dev and build alike: dev would follow it, the build copies the link', t => {
  const target = tree({'robot.glb': 'glb'}),
    game = tree({'models/real.glb': 'glb'});
  symlinkSync(join(target, 'robot.glb'), join(game, 'models/robot.glb'));
  t.after(() => {
    rmSync(game, {recursive: true});
    rmSync(target, {recursive: true});
  });
  assert.deepEqual(publicFiles(game), ['models/real.glb'], 'a link is not a file');
  assert.match(publicProblems(game, none('shared')).join(), /1 symbolic link\(s\) \(models\/robot\.glb\)/);
  assert.throws(() => build(game, none('shared')), /symbolic link/);
  assert.throws(() => serve(game, none('shared')), /symbolic link/);
});

test('files left in the root folder while the game has its own folder stop the build: no one would ship them', t => {
  const game = tree({'textures/x.png': 'game'}),
    shared = tree({'other.txt': 'left behind'});
  t.after(() => {
    rmSync(game, {recursive: true});
    rmSync(shared, {recursive: true});
  });
  assert.throws(() => build(game, shared), /root .* \(other\.txt\) would be served and built by no one/);
  assert.doesNotThrow(() => build(shared, shared), 'the root folder alone (an older game without public/) is fine');
});

test('no public folder at all is fine', () => {
  assert.deepEqual(publicProblems(none('game'), none('shared')), []);
  assert.doesNotThrow(() => build('', none('shared')), 'publicDir: false');
});

test("the engine keeps no file in the shared root public folder, so no template's files ship with another game", () => {
  assert.deepEqual(publicFiles(join(ROOT, 'public')), [], "a template's files belong in templates/<name>/game/public/");
  const owned = templateGameDirs().filter(d => publicFiles(join(ROOT, d, 'public')).length);
  assert.deepEqual(
    owned,
    ['templates/explorer/game', 'templates/mechanics/game', 'templates/showcase/game'],
    'only the explorer, mechanics and showcase templates ship static files today',
  );
  for (const d of owned) assert.deepEqual(publicProblems(join(ROOT, d, 'public')), [], d);
});
