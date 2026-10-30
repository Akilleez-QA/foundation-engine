#!/usr/bin/env node
// scripts/lint/types.mjs (`npm run lint:types`): type escapes stay out of the source.
//
// Reads every TypeScript file of src/, templates/, the game folder, scripts/ and perf/ with the TypeScript parser
// (so comments, strings and identifiers named `any` never count) and reports:
//   explicit-any   the `any` type in any position (`: any`, `as any`, `<any>`, `any[]`, `Foo<any>`). Strict: every one
//                  fails, in tests too. Use a real type, `unknown` with narrowing, or a generic.
//   unknown-cast   a double cast through unknown (`x as unknown as T`, `<T><unknown>x`). Strict outside tests. Test
//                  files (`*.test.ts`) keep a per-folder ratchet in lint-baseline/unknown-cast/<folder>.json: a count
//                  may fall but never rise.
// A genuinely unavoidable escape carries a written reason in a comment on the same line or the line above:
//   // lint:allow-any <reason>
//   // lint:allow-unknown-cast <reason>
// An escape without a reason does not count as one.
//
//   node scripts/lint/types.mjs            report + check
//   node scripts/lint/types.mjs --lower    rewrite unknown-cast shards whose count fell (never raises)
//   node scripts/lint/types.mjs --init     write the first unknown-cast shards when there are none (never rewrites)
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {gameDir} from '../lib/game-dir.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BASELINE = join(ROOT, 'lint-baseline', 'unknown-cast');
const SKIP_DIRS = new Set(['node_modules', 'generated', 'dist', 'fixtures', 'public']);

export const ESCAPES = {'explicit-any': 'lint:allow-any', 'unknown-cast': 'lint:allow-unknown-cast'};

const isTest = rel => /\.test\.[cm]?tsx?$/.test(rel);
const toPosix = p => p.split(sep).join('/');

/** Every TypeScript source under the scanned roots, as root-relative POSIX paths (generated files skipped). */
export function typeSourceFiles(root = ROOT) {
  const roots = ['src', 'templates', 'labs', 'scripts', 'perf'];
  const game = toPosix(relative(root, gameDir()));
  if (game && !game.startsWith('..') && !game.startsWith('templates/')) roots.push(game);
  const out = new Set();
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (/\.[cm]?tsx?$/.test(name) && !/\.gen\.ts$/.test(name)) out.add(toPosix(relative(root, p)));
    }
  };
  for (const r of roots) if (existsSync(join(root, r))) walk(join(root, r));
  return [...out].sort();
}

/** True when the line, or the line above, has `<marker> <reason>` in a comment. */
function escaped(lines, line, marker) {
  const re = new RegExp(
    `//.*\\b${marker.replace(/[:-]/g, '\\$&')}\\s+\\S.*$|/\\*.*\\b${marker.replace(/[:-]/g, '\\$&')}\\s+[^*\\s]`,
  );
  return re.test(lines[line] ?? '') || re.test(lines[line - 1] ?? '');
}

const isUnknown = node => node.kind === ts.SyntaxKind.UnknownKeyword;
/** `x as unknown as T` or `<T><unknown>x` (parentheses between the two casts included). */
function doubleCast(node) {
  if (!ts.isAsExpression(node) && !ts.isTypeAssertionExpression(node)) return false;
  let inner = node.expression;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  return (
    (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) && isUnknown(inner.type) && !isUnknown(node.type)
  );
}

/** The findings of one file's text: [{rule, line (1-based), escaped}]. */
export function scan(text, file = 'x.ts') {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lines = text.split('\n');
  const found = [];
  const add = (rule, node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    found.push({rule, line: line + 1, escaped: escaped(lines, line, ESCAPES[rule])});
  };
  const visit = node => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) add('explicit-any', node);
    else if (doubleCast(node)) add('unknown-cast', node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The ratchet folder of a test file: src/<top>, or the first path segment. */
export const folderOf = rel => (rel.startsWith('src/') ? rel.split('/').slice(0, 2).join('/') : rel.split('/')[0]);
const shardName = folder => folder.replace(/\//g, '-');

function readShards() {
  const shards = {};
  if (!existsSync(BASELINE)) return shards;
  for (const f of readdirSync(BASELINE))
    if (f.endsWith('.json')) {
      const body = JSON.parse(readFileSync(join(BASELINE, f), 'utf8'));
      shards[body.folder] = body;
    }
  return shards;
}

/** Problems for a set of files: strict findings, and test-file unknown casts above the folder baseline. */
export function check(files = typeSourceFiles(), {root = ROOT, shards = readShards()} = {}) {
  const failures = [],
    counts = {};
  let escapes = 0;
  for (const rel of files) {
    for (const f of scan(readFileSync(join(root, rel), 'utf8'), rel)) {
      if (f.escaped) {
        escapes++;
        continue;
      }
      if (f.rule === 'unknown-cast' && isTest(rel)) {
        const bucket = (counts[folderOf(rel)] ??= {count: 0, files: {}, hits: []});
        bucket.count++;
        bucket.files[rel] = (bucket.files[rel] ?? 0) + 1;
        bucket.hits.push(`${rel}:${f.line}`);
        continue;
      }
      failures.push(
        `${f.rule}: ${rel}:${f.line}` +
          (f.rule === 'explicit-any'
            ? ' (use a real type, `unknown` with narrowing, or a generic)'
            : ' (use a type guard or a typed helper; an unavoidable cast needs `// lint:allow-unknown-cast <reason>`)'),
      );
    }
  }
  const lowered = [];
  for (const folder of new Set([...Object.keys(shards), ...Object.keys(counts)])) {
    const now = counts[folder] ?? {count: 0, files: {}, hits: []},
      was = shards[folder]?.count ?? 0;
    if (now.count > was) {
      const grew = Object.entries(now.files)
        .filter(([f, n]) => n > (shards[folder]?.files?.[f] ?? 0))
        .map(([f]) => f);
      failures.push(
        `unknown-cast in test files of ${folder}/: ${now.count} > baseline ${was} (grew in: ${grew.join(', ')})\n      ` +
          now.hits
            .filter(h => grew.some(f => h.startsWith(f + ':')))
            .slice(0, 12)
            .join('\n      '),
      );
    } else if (now.count < was) lowered.push(folder);
  }
  return {failures, counts, lowered, escapes};
}

function writeShard(folder, bucket) {
  mkdirSync(BASELINE, {recursive: true});
  const files = Object.fromEntries(Object.entries(bucket.files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    join(BASELINE, `${shardName(folder)}.json`),
    `${JSON.stringify({rule: 'unknown-cast', folder, count: bucket.count, files}, null, 2)}\n`,
  );
}

function main() {
  const lower = process.argv.includes('--lower');
  if (process.argv.includes('--init')) {
    if (Object.keys(readShards()).length) {
      console.error('lint:types: shards exist; --init never rewrites them (use --lower)');
      process.exit(1);
    }
    const {counts} = check(typeSourceFiles(), {shards: {}});
    for (const [folder, bucket] of Object.entries(counts)) writeShard(folder, bucket);
  }
  const {failures, counts, lowered, escapes} = check();
  const total = Object.values(counts).reduce((a, b) => a + b.count, 0);
  console.log(
    `Type escapes: explicit any fails everywhere; double casts through unknown fail outside tests and may only fall in tests (${total} in tests; ${escapes} escape(s) with a written reason).`,
  );
  if (lowered.length) {
    if (lower)
      for (const folder of lowered) {
        if (counts[folder]?.count) writeShard(folder, counts[folder]);
        else rmSync(join(BASELINE, `${shardName(folder)}.json`), {force: true});
      }
    console.log(
      lower
        ? `lint:types: lowered ${lowered.length} shard(s): ${lowered.join(', ')}`
        : `lint:types: ${lowered.length} shard(s) can be lowered (run \`npm run lint:types -- --lower\`): ${lowered.join(', ')}`,
    );
  }
  if (failures.length) {
    console.error(`\nlint:types: FAILED — ${failures.length} problem(s):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('lint:types: ok');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
