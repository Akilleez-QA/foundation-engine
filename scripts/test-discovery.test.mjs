// npm test finds every test: a test file the `test` script's globs do not select never runs (the full suite and
// `check --all` both go through it), so a lab, a template or a tool fixture game would pass with its tests unrun.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {ROOT} from './lib/game-dir.mjs';

/** The quoted globs of the package's `test` script. */
export const testGlobs = (root = ROOT) =>
  [...JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.test.matchAll(/"([^"]+)"/g)].map(m => m[1]);

/** A glob as a RegExp over POSIX paths: `**` is any number of directories, `*` stays inside one segment. */
export function globRegExp(glob) {
  let re = '';
  for (const part of glob.split('/'))
    re += part === '**' ? '(?:[^/]+/)*' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '/';
  return new RegExp(`^${re.slice(0, -1)}$`);
}

const SKIP = new Set(['node_modules', 'dist', 'generated', 'playtest']);
/** Every *.test.{ts,mjs,…} file in the checkout, repository-relative (dependencies, builds and evidence skipped). */
export function testFiles(root = ROOT) {
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || SKIP.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.[cm]?[jt]s$/.test(name)) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

test('globRegExp: ** spans directories (including none) and * stays in one segment', () => {
  const re = globRegExp('src/**/*.test.ts');
  assert.ok(re.test('src/a.test.ts'));
  assert.ok(re.test('src/kits/ui/a.test.ts'));
  assert.equal(re.test('srcx/a.test.ts'), false);
  const lab = globRegExp('labs/*/game/**/*.test.ts');
  assert.ok(lab.test('labs/dash/game/dash.test.ts'));
  assert.equal(lab.test('labs/dash/tools/x.test.ts'), false);
});

test('npm test selects every test file in the checkout (labs, templates and tool fixture games included)', () => {
  const globs = testGlobs().map(globRegExp);
  const missed = testFiles().filter(f => !globs.some(g => g.test(f)));
  assert.deepEqual(missed, [], `add a glob for these to the test script in package.json: ${missed.join(', ')}`);
});
