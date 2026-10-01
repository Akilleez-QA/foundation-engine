#!/usr/bin/env node
// scripts/new-game.mjs (`npm run new-game -- --template <name> [--id <game-id>] [--title "<Title>"] [--force]`):
// start a game from a template. Copies templates/<name>/game to ./game, its GAME.md to ./GAME.md and its playtest/
// scripts to ./playtest,
// then renames the game (its id is the save namespace, so choose it once). Without --template it lists templates.
import {cpSync, existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './lib/game-dir.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const templates = readdirSync(join(ROOT, 'templates')).filter(n => existsSync(join(ROOT, 'templates', n, 'game', 'game.ts')));
const name = opt('--template');
if (!name) { console.log(`Templates: ${templates.join(', ')}\nUsage: npm run new-game -- --template <name> [--id <game-id>] [--title "<Title>"]`); process.exit(0); }
if (!templates.includes(name)) { console.error(`No template '${name}'. Templates: ${templates.join(', ')}`); process.exit(1); }
const id = opt('--id') ?? 'my-game', title = opt('--title') ?? 'My game';
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) { console.error('--id must be lowercase kebab-case (it becomes the save namespace)'); process.exit(1); }
if (existsSync(join(ROOT, 'game')) && !args.includes('--force')) { console.error('./game already exists; pass --force to replace it'); process.exit(1); }
cpSync(join(ROOT, 'templates', name, 'game'), join(ROOT, 'game'), {recursive: true, force: true});
cpSync(join(ROOT, 'templates', name, 'GAME.md'), join(ROOT, 'GAME.md'), {force: true});
if (existsSync(join(ROOT, 'templates', name, 'playtest'))) cpSync(join(ROOT, 'templates', name, 'playtest'), join(ROOT, 'playtest'), {recursive: true, force: true});
const gameTs = join(ROOT, 'game', 'game.ts');
writeFileSync(gameTs, readFileSync(gameTs, 'utf8').replace(/id: '[^']*'/, `id: '${id}'`).replace(/title: '[^']*'/, `title: '${title.replace(/'/g, "\\'")}'`));
console.log(`Started '${title}' (${id}) from the ${name} template in ./game (GAME.md at the root).\nNext: npm run play, then npm run check.`);
