#!/usr/bin/env node
// scripts/new-lab.mjs (`npm run new-lab -- <id> [--template <name>] [--kit <name>]... [--question "<text>"] [--force]`):
// start a lab: a small, isolated game in labs/<id>/ that exists to answer one question (a kit, a mechanic, a
// rendering technique, a pipeline step) before anything is built into a full game. Copies templates/<name>/game
// (blank by default) to labs/<id>/game and its GAME.md to labs/<id>/GAME.md, names the game `lab-<id>`, registers each
// --kit (and the kits it requires) in defineGame({ kits }), and writes the lab card (labs/<id>/README.md) and a
// tsconfig. Without an id it lists the templates and kits. See docs/guides/labs.md.
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './lib/game-dir.mjs';
import {gameOrigin, ORIGIN_FILE, quoted, templatesIn, withHeading} from './new-game.mjs';

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const camel = name => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Every kit with a public surface (src/kits/<name>/index.ts), sorted. */
export const kitsIn = root =>
  readdirSync(join(root, 'src', 'kits'))
    .filter(n => existsSync(join(root, 'src', 'kits', n, 'index.ts')))
    .sort();

/** A kit's registration: its factory name when index.ts exports one (`export function <camelName>(`), and the kits
 *  its defineKit call requires. A kit without a factory is a library: a lab imports its functions directly. */
export function kitInfo(root, name) {
  const src = readFileSync(join(root, 'src', 'kits', name, 'index.ts'), 'utf8');
  const factory = new RegExp(`export function ${camel(name)}\\(`).test(src) ? camel(name) : null;
  const requires = [...(/requires:\s*\[([^\]]*)\]/.exec(src)?.[1].matchAll(/'([a-z0-9-]+)'/g) ?? [])].map(m => m[1]);
  return {name, factory, requires};
}

/** The kits to register for `wanted`, dependencies first, each once. Throws on an unknown kit or a required kit that
 *  has no factory (defineGame would refuse the game). */
export function kitOrder(root, wanted) {
  const known = new Set(kitsIn(root));
  const out = [];
  const visit = (name, from) => {
    if (!known.has(name))
      throw Error(`No kit '${name}'${from ? ` (required by ${from})` : ''}. Kits: ${[...known].join(', ')}`);
    if (out.some(k => k.name === name)) return;
    const info = kitInfo(root, name);
    for (const r of info.requires) visit(r, name);
    if (from && !info.factory) throw Error(`Kit '${from}' requires '${name}', which has no ${camel(name)}() factory`);
    out.push(info);
  };
  for (const k of wanted) visit(k, null);
  return out;
}

/** game.ts with `kits` imported and listed in defineGame({ kits }), keeping kits it already lists. */
export function withKits(code, kits) {
  const add = kits.filter(k => k.factory && !new RegExp(`\\b${k.factory}\\(`).test(code));
  if (!add.length) return code;
  const imports = add.map(k => `import {${k.factory}} from '@kits/${k.name}';`).join('\n');
  const lastImport = [...code.matchAll(/^import .*;$/gm)].at(-1);
  code = lastImport
    ? code.slice(0, lastImport.index + lastImport[0].length) +
      '\n' +
      imports +
      code.slice(lastImport.index + lastImport[0].length)
    : `${imports}\n${code}`;
  const calls = add.map(k => `${k.factory}()`).join(', ');
  const listed = /\bkits\s*:\s*\[/.exec(code);
  if (listed) {
    // Append before the array's closing bracket (kit options may hold arrays of their own).
    let depth = 1,
      i = listed.index + listed[0].length;
    for (; i < code.length && depth; i++) depth += code[i] === '[' ? 1 : code[i] === ']' ? -1 : 0;
    const close = i - 1;
    const before = code.slice(0, close).trimEnd();
    const sep = before.endsWith('[') || before.endsWith(',') ? '' : ', ';
    return before + sep + calls + code.slice(close);
  }
  const end = code.lastIndexOf('})');
  const before = code.slice(0, end).trimEnd();
  return `${before}${before.endsWith(',') ? '' : ','} kits: [${calls}]${code.slice(end)}`;
}

/** The lab card: the question, what it tries, how it is judged and where it may graduate. */
export function labCard({id, title, question, template, kits}) {
  const kitLine = kits.length
    ? kits.map(k => `\`${k.name}\`${k.factory ? '' : ' (library: import its functions)'}`).join(', ')
    : 'none yet';
  return `# ${title} (lab)

Status: exploring

**Question:** ${question ?? '<one sentence: what this lab exists to find out>'}

| | |
|---|---|
| Started from | \`templates/${template}\` |
| Kits | ${kitLine} |
| Run | \`npm run lab -- ${id}\` (dev server) · \`npm run lab -- ${id} snap\` · \`npm run lab -- ${id} check\` |

## What it tries

- <the smallest version of the idea; one system, one scene>

## How it is judged

- <the evidence that answers the question: a test named after a criterion id, a play:snap, a measurement>

## Findings

| Date | Finding | Evidence |
|---|---|---|

## Graduation

Where the proven system belongs (\`src/\`, a kit in \`src/kits/<name>\`, a tool in \`tools/<name>\`, or a game's own
code) and what is still missing against the [graduation checklist](../../docs/guides/labs.md#graduating-a-system).
A game never imports lab code: it uses what graduated.
`;
}

/** Starts lab `id` in `root`. Returns the lab folder. Throws with a message for the author on a bad request. */
export function startLab({
  root = ROOT,
  id,
  template = 'blank',
  kits = [],
  question,
  title,
  force = false,
  log = console.log,
}) {
  if (!id || !ID.test(id)) throw Error('The lab id must be lowercase kebab-case, e.g. npm run new-lab -- crowd-motion');
  const templates = templatesIn(root);
  if (!templates.includes(template)) throw Error(`No template '${template}'. Templates: ${templates.join(', ')}`);
  const order = kitOrder(root, kits);
  const dir = join(root, 'labs', id);
  if (existsSync(dir)) {
    if (!force) throw Error(`labs/${id} already exists; pass --force to replace it`);
    log(`Replacing labs/${id} (git restores tracked files).`);
    rmSync(dir, {recursive: true, force: true});
  }
  title ??= id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
  cpSync(join(root, 'templates', template, 'game'), join(dir, 'game'), {recursive: true});
  writeFileSync(
    join(dir, 'GAME.md'),
    withHeading(readFileSync(join(root, 'templates', template, 'GAME.md'), 'utf8'), `${title} (lab)`),
  );
  writeFileSync(join(dir, 'game', ORIGIN_FILE), JSON.stringify(gameOrigin(root, template), null, 2) + '\n');
  writeFileSync(join(dir, 'tsconfig.json'), '{"extends": "../../tsconfig.json", "include": ["game/**/*.ts"]}\n');
  writeFileSync(join(dir, 'README.md'), labCard({id, title, question, template, kits: order}));
  const gameTs = join(dir, 'game', 'game.ts');
  writeFileSync(
    gameTs,
    withKits(
      readFileSync(gameTs, 'utf8')
        .replace(/id: '[^']*'/, `id: 'lab-${id}'`)
        .replace(/title: '[^']*'/, () => `title: ${quoted(title)}`),
      order,
    ),
  );
  log(
    `Started the ${title} lab in labs/${id} from the ${template} template` +
      (order.length ? ` with ${order.map(k => k.name).join(', ')}` : '') +
      `.\nWrite its question in labs/${id}/README.md, then: npm run lab -- ${id}`,
  );
  return dir;
}

/** game.ts and the other generated TypeScript formatted as `npm run format:check` expects. */
async function formatLab(dir) {
  const prettier = await import('prettier');
  const file = join(dir, 'game', 'game.ts');
  const options = await prettier.resolveConfig(file);
  writeFileSync(file, await prettier.format(readFileSync(file, 'utf8'), {...options, filepath: file}));
  for (const name of ['README.md', 'tsconfig.json']) {
    const p = join(dir, name);
    writeFileSync(
      p,
      await prettier.format(readFileSync(p, 'utf8'), {...(await prettier.resolveConfig(p)), filepath: p}),
    );
  }
}

if (process.argv[1]?.endsWith('new-lab.mjs')) {
  const args = process.argv.slice(2);
  const values = k => args.flatMap((a, i) => (a === k && args[i + 1] ? [args[i + 1]] : []));
  const flagged = new Set(args.flatMap((a, i) => (a.startsWith('--') && a !== '--force' ? [i, i + 1] : [])));
  const id = args.find((a, i) => !a.startsWith('--') && !flagged.has(i));
  if (!id) {
    console.log(
      `Usage: npm run new-lab -- <id> [--template <name>] [--kit <name>]... [--question "<text>"] [--title "<Title>"] [--force]\n` +
        `Templates: ${templatesIn(ROOT).join(', ')}\nKits: ${kitsIn(ROOT).join(', ')}`,
    );
    process.exit(0);
  }
  try {
    const dir = startLab({
      id,
      template: values('--template')[0],
      kits: values('--kit'),
      question: values('--question')[0],
      title: values('--title')[0],
      force: args.includes('--force'),
    });
    await formatLab(dir);
    // A template and a kit can bind the same key or button; say so now rather than at the first boot.
    const brief = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lint/brief.ts', `labs/${id}/game`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (brief.status !== 0)
      console.log(
        `\nThe lab does not boot yet; fix these in labs/${id}/game (rebind the game's own action):\n` +
          `${(brief.stdout + brief.stderr).trim()}`,
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
