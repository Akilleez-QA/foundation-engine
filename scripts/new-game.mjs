#!/usr/bin/env node
// scripts/new-game.mjs (`npm run new-game -- --template <name> [--id <game-id>] [--title "<Title>"] [--force]`):
// start a game from a template. Copies templates/<name>/game to ./game (its scripted playtests come with it, in
// game/playtest/) and its GAME.md to ./GAME.md, then renames the game (its id is the save namespace, so choose it
// once). --title also becomes GAME.md's first heading. Without --template it lists templates.
//
// --force replaces an existing game: it prints what will be replaced, then removes ./game and ./GAME.md before copying,
// so no file of the old game (a scene, a test, an input) is left mixed into the new one. The engine's root playtest/
// folder (evidence in playtest/latest/, engine scripts) is never written or removed.
import {cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './lib/game-dir.mjs';

export const templatesIn = root =>
  readdirSync(join(root, 'templates')).filter(n => existsSync(join(root, 'templates', n, 'game', 'game.ts')));

/** What `--force` would replace in `root`: the game folder (with its file count) and GAME.md, when they exist. */
export function replaced(root) {
  const out = [];
  if (existsSync(join(root, 'game')))
    out.push(
      `game/ (${readdirSync(join(root, 'game'), {recursive: true, withFileTypes: true}).filter(e => e.isFile()).length} files)`,
    );
  if (existsSync(join(root, 'GAME.md'))) out.push('GAME.md');
  return out;
}

/** GAME.md with its first `# ` heading replaced by `title` (one line; a missing heading is added at the top). */
export function withHeading(md, title) {
  const heading = `# ${title.replace(/\s+/g, ' ').trim()}`;
  return /^# .*$/m.test(md) ? md.replace(/^# .*$/m, () => heading) : `${heading}\n\n${md}`;
}

/** Starts a game in `root` from template `name`. Throws with a message for the author on a bad request. */
/** A string literal as Prettier prints it here (singleQuote): single quotes unless the text has more of them than
 *  double quotes, so the renamed game.ts stays formatted and `npm run check` (format:check) passes. */
export function quoted(text) {
  const q = (text.match(/'/g)?.length ?? 0) > (text.match(/"/g)?.length ?? 0) ? '"' : "'";
  return q + text.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q) + q;
}

export function startGame({root = ROOT, name, id = 'my-game', title, force = false, log = console.log}) {
  const named = title !== undefined;
  title ??= 'My game';
  const templates = templatesIn(root);
  if (!templates.includes(name)) throw Error(`No template '${name}'. Templates: ${templates.join(', ')}`);
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id))
    throw Error('--id must be lowercase kebab-case (it becomes the save namespace)');
  const old = replaced(root);
  if (existsSync(join(root, 'game')) && !force)
    throw Error(
      './game already exists; pass --force to replace it (the old game folder and GAME.md are removed first)',
    );
  if (old.length) {
    log(
      `Replacing the existing game: removing ${old.join(' and ')} (commit or copy anything you want to keep first; git restores tracked files).`,
    );
    rmSync(join(root, 'game'), {recursive: true, force: true});
    rmSync(join(root, 'GAME.md'), {force: true});
  }
  cpSync(join(root, 'templates', name, 'game'), join(root, 'game'), {recursive: true});
  cpSync(join(root, 'templates', name, 'GAME.md'), join(root, 'GAME.md'));
  if (named) {
    const md = join(root, 'GAME.md');
    writeFileSync(md, withHeading(readFileSync(md, 'utf8'), title));
  }
  const gameTs = join(root, 'game', 'game.ts');
  writeFileSync(
    gameTs,
    readFileSync(gameTs, 'utf8')
      .replace(/id: '[^']*'/, `id: '${id}'`)
      .replace(/title: '[^']*'/, () => `title: ${quoted(title)}`),
  );
  const scripts = existsSync(join(root, 'game', 'playtest'))
    ? readdirSync(join(root, 'game', 'playtest')).filter(f => f.endsWith('.json'))
    : [];
  log(
    `Started '${title}' (${id}) from the ${name} template in ./game (GAME.md at the root).` +
      (scripts.length
        ? `\nScripted playtests: ${scripts.map(f => `game/playtest/${f}`).join(', ')} (npm run play:script -- game/playtest/${scripts[0]}).`
        : '') +
      '\nNext: npm run play, then npm run check.',
  );
}

if (process.argv[1]?.endsWith('new-game.mjs')) {
  const args = process.argv.slice(2);
  const opt = k => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const name = opt('--template');
  if (!name) {
    console.log(
      `Templates: ${templatesIn(ROOT).join(', ')}\nUsage: npm run new-game -- --template <name> [--id <game-id>] [--title "<Title>"] [--force]`,
    );
    process.exit(0);
  }
  try {
    startGame({name, id: opt('--id'), title: opt('--title'), force: args.includes('--force')});
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
