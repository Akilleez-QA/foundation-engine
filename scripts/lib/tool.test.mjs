import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {binEntry, npmCommand, toolCommand, TOOL_PACKAGES} from './tool.mjs';

test('tools run as this Node plus the package\'s JS bin entry: no npx, no shell, arguments passed unchanged', () => {
  for (const name of Object.keys(TOOL_PACKAGES)) {
    const c = toolCommand(name, ['--flag', 'a b', 'src/**/*.test.ts']);
    assert.equal(c.command, process.execPath);
    assert.equal(c.shell, false);
    assert.ok(isAbsolute(c.args[0]) && existsSync(c.args[0]), `${name}: ${c.args[0]}`);
    assert.match(c.args[0], /\.(c|m)?js$|[\\/]bin[\\/]tsc$/, `${name} runs a JS file under node, never a .cmd shim`);
    assert.deepEqual(c.args.slice(1), ['--flag', 'a b', 'src/**/*.test.ts']);
  }
  assert.throws(() => toolCommand('npx'), /unknown tool npx/);
  assert.throws(() => binEntry('typescript', 'missing'), /declares no "missing" command/);
});

test('the resolved tool entries actually start under this Node', () => {
  for (const [name, args, out] of [['tsc', ['--version'], /Version \d/], ['tsx', ['--version'], /tsx v\d/], ['vite', ['--version'], /vite\/\d/]]) {
    const c = toolCommand(name, args);
    const r = spawnSync(c.command, c.args, {encoding: 'utf8', shell: c.shell});
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.match(r.stdout, out);
  }
});

test('npm runs as npm\'s own CLI when npm started us, else npm (POSIX) or npm.cmd through the shell (Windows)', () => {
  const underNpm = npmCommand(['run', 'lint'], {env: {npm_execpath: 'C:\\npm\\bin\\npm-cli.js'}, platform: 'win32', execPath: 'C:\\node.exe'});
  assert.deepEqual(underNpm, {command: 'C:\\node.exe', args: ['C:\\npm\\bin\\npm-cli.js', 'run', 'lint'], shell: false});
  assert.deepEqual(npmCommand(['test'], {env: {}, platform: 'win32'}), {command: 'npm.cmd', args: ['test'], shell: true});
  assert.deepEqual(npmCommand(['test'], {env: {}, platform: 'linux'}), {command: 'npm', args: ['test'], shell: false});
  assert.deepEqual(npmCommand(['test'], {env: {npm_execpath: '/usr/bin/npm'}, platform: 'darwin'}), {command: 'npm', args: ['test'], shell: false}, 'a non-JS npm_execpath is not run under node');
});

test('package scripts quote globs with double quotes, which sh and cmd.exe both strip (single quotes reach Windows tools literally)', () => {
  const {scripts} = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  for (const [name, line] of Object.entries(scripts)) assert.ok(!line.includes("'"), `${name} uses single quotes: ${line}`);
  assert.match(scripts.test, /tsx --test "src\/\*\*\/\*\.test\.ts"/, 'npm test globs are expanded by node --test, not the shell');
});

test('the check, gate, criteria, hook, template-gate and packaging scripts start tools through this helper, never bare npx or npm', () => {
  for (const file of ['scripts/check.mjs', 'scripts/hooks/after-edit.mjs', 'scripts/play/criteria.ts', 'scripts/perf/gate.mjs', 'scripts/gate-templates.mjs', 'scripts/perf/learn-isolation.test.ts', 'scripts/package-pure.mjs', 'scripts/package-pure.test.mjs']) {
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /(spawn|exec|execFile)(Sync)?\(\s*['"](npx|npm|npm\.cmd)['"]|\(\s*\w+\s*,\s*['"](npx|npm)['"]\s*,/, file);
  }
});
