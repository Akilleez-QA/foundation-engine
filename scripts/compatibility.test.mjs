import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = resolve(root, 'scripts/fixtures/compatibility/c0e73c9');
const manifest = JSON.parse(readFileSync(resolve(fixture, 'manifest.json'), 'utf8'));

test('retained first-public-source consumer compiles and behaves against current author API', () => {
  assert.equal(manifest.kind, 'public-source-snapshot-not-release');
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  assert.deepEqual(manifest.files.map(entry => entry.file), ['main.ts', 'turn.ts', 'main.test.ts']);
  for (const entry of manifest.files) {
    const bytes = readFileSync(resolve(fixture, entry.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.sourcePath);
  }

  // Reuse all current strictness/module/path options, but root this check in the retained consumer.
  const configPath = resolve(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(manifest.files.map(entry => resolve(fixture, entry.file)), parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  assert.ok(program.getSourceFile(resolve(root, 'src/author/index.ts')), 'uses the current author API');

  // Synchronous execution rejects nonzero status or timeout; no browser/server or temporary files.
  const childEnv = { ...process.env, TSX_TSCONFIG_PATH: configPath };
  delete childEnv.NODE_TEST_CONTEXT; // This is an independent test runner, not a nested harness.
  const output = execFileSync(process.execPath, [
    '--import', 'tsx', '--test', resolve(fixture, 'main.test.ts'),
  ], { cwd: root, timeout: 30_000, encoding: 'utf8', env: childEnv });
  assert.match(output, /# tests 2\b/);
  assert.match(output, /# pass 2\b/);
  assert.match(output, /# fail 0\b/);
});
