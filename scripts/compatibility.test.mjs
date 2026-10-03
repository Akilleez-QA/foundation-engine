import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import {TAP_REPORTER, childTestEnv, testTotals} from './lib/test-output.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = resolve(root, 'scripts/fixtures/compatibility/c0e73c9');
const manifest = JSON.parse(readFileSync(resolve(fixture, 'manifest.json'), 'utf8'));
const released = resolve(root, 'scripts/fixtures/compatibility/v0.2.0');
const releasedManifest = JSON.parse(readFileSync(resolve(released, 'manifest.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Throws when a retained file's bytes differ from its manifest hash. */
export function verifyManifest(dir, entries, read = file => readFileSync(resolve(dir, file))) {
  for (const entry of entries) {
    if (sha256(read(entry.file)) !== entry.sha256) throw new Error(`${entry.file} (${entry.sourcePath}) does not match its manifest hash`);
  }
}

/** Compiles retained files against today's tsconfig and author API; returns formatted diagnostics ('' when clean). */
function compile(files) {
  const configPath = resolve(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(files, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  assert.ok(program.getSourceFile(resolve(root, 'src/author/index.ts')), 'uses the current author API');
  return diagnostics.length ? ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }) : '';
}

/**
 * Runs one retained test file in its own Node test runner (no browser, server or temporary files) and returns its
 * totals. The reporter is named: Node 23+ no longer defaults to TAP when the output is piped.
 */
function runRetained(file) {
  const childEnv = { ...childTestEnv(), TSX_TSCONFIG_PATH: resolve(root, 'tsconfig.json') };
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--test', TAP_REPORTER, file], { cwd: root, timeout: 30_000, encoding: 'utf8', env: childEnv });
  const totals = testTotals(output);
  assert.ok(totals, `no test totals in the child runner's output:\n${output}`);
  return { tests: totals.tests, pass: totals.pass, fail: totals.fail };
}

test('retained first-public-source consumer compiles and behaves against current author API', () => {
  assert.equal(manifest.kind, 'public-source-snapshot-not-release');
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  assert.deepEqual(manifest.files.map(entry => entry.file), ['main.ts', 'turn.ts', 'main.test.ts']);
  verifyManifest(fixture, manifest.files);
  const errors = compile(manifest.files.map(entry => resolve(fixture, entry.file)));
  assert.equal(errors, '', errors);
  const totals = runRetained(resolve(fixture, 'main.test.ts'));
  assert.deepEqual(totals, { tests: '2', pass: '2', fail: '0' });
});

test('retained v0.2.0 arcade template compiles and passes its released tests against current @engine', () => {
  assert.equal(releasedManifest.kind, 'released-template-consumer');
  assert.equal(releasedManifest.release, 'v0.2.0');
  assert.equal(releasedManifest.revision, '071e3c2a2c9a99440088c8315aa0a1f099e0e841');
  assert.deepEqual(releasedManifest.files.map(entry => entry.file),
    ['game.ts', 'best.ts', 'components.ts', 'play.ts', 'restart.ts', 'steer.ts', 'build.brief.ts', 'play.test.ts']);
  verifyManifest(released, releasedManifest.files);
  // On failure: do not edit the retained bytes. Fix the engine, or document the break and its migration in
  // CHANGELOG.md and docs/guides/public-compatibility.md, then retain a separate migrated consumer.
  const errors = compile(releasedManifest.files.map(entry => resolve(released, entry.file)));
  assert.equal(errors, '', `v0.2.0 arcade no longer compiles; see docs/guides/public-compatibility.md#retained-v020-baseline\n${errors}`);
  const totals = runRetained(resolve(released, 'play.test.ts'));
  assert.deepEqual(totals, { tests: '4', pass: '4', fail: '0' });
});

test('a hash-mismatched retained fixture fails the manifest check', () => {
  const [first] = releasedManifest.files;
  const tampered = file => Buffer.concat([readFileSync(resolve(released, file)), Buffer.from('\n// edited\n')]);
  assert.throws(() => verifyManifest(released, [first], tampered), /does not match its manifest hash/);
});
