// Dependency install scripts are reviewed, not inherited: npm 12 and newer block every dependency's install script
// unless package.json's `allowScripts` approves it, and warn about each one it blocks. Every package in the lockfile
// that has an install script carries a reviewed entry (true to run it, false to skip it), and no entry outlives its
// package. esbuild's postinstall only re-checks the platform binary npm already installed as an optional dependency;
// fsevents (macOS) is flagged by the registry but its tarball ships fsevents.node prebuilt and runs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const pkg = read('package.json'),
  lock = read('package-lock.json');
const nameOf = path => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
const scripted = [
  ...new Set(
    Object.entries(lock.packages)
      .filter(([path, p]) => path && p.hasInstallScript)
      .map(([path]) => nameOf(path)),
  ),
].sort();
const entryName = key => key.replace(/(?<=.)@.*$/, '');

test('every dependency install script has a reviewed allowScripts entry, and every entry names such a dependency', () => {
  const entries = Object.keys(pkg.allowScripts ?? {});
  assert.deepEqual(
    scripted.filter(name => !entries.some(key => entryName(key) === name)),
    [],
    'review the install script, then run npm approve-scripts <pkg> or npm deny-scripts <pkg> (npm 12+)',
  );
  assert.deepEqual(
    entries.filter(key => !scripted.includes(entryName(key))),
    [],
    'remove allowScripts entries for packages without install scripts',
  );
});

test('esbuild runs without its postinstall: the platform binary comes from its optional dependency', async () => {
  assert.deepEqual(pkg.allowScripts, {esbuild: false, fsevents: false});
  const esbuild = await import('esbuild');
  assert.equal((await esbuild.transform('let a: number = 1', {loader: 'ts'})).code, 'let a = 1;\n');
});
