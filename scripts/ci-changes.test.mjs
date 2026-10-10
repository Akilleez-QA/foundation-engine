import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {changedPaths, classify, codeChanged, diffArgs, diffRange, isCodePath, shasFromPayload} from './ci-changes.mjs';

const script = fileURLToPath(new URL('./ci-changes.mjs', import.meta.url));

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const before = 'c'.repeat(40);

test('docs and Markdown are not code; every other path is', () => {
  for (const path of ['README.md', 'docs/guide.md', 'docs/guide.ts', 'docs', 'changes/unreleased/note.md'])
    assert.equal(isCodePath(path), false, path);
  for (const path of ['src/a.ts', 'docs-extra/a.ts', 'src/docs/a.ts', '.github/workflows/ci.yml', '.MD'])
    assert.equal(isCodePath(path), true, path);
  assert.equal(codeChanged(['README.md', 'docs/guide.ts']), false);
  assert.equal(codeChanged(['README.md', 'src/a.ts']), true);
  assert.equal(codeChanged([]), false);
  assert.equal(codeChanged(['']), true);
});

test('pull requests diff base...head and pushes diff before..head; a missing sha fails open', () => {
  assert.deepEqual(diffRange('pull_request', {base, sha: head}), {from: base, to: head, dots: '...'});
  assert.deepEqual(diffRange('push', {before, sha: head}), {from: before, to: head, dots: '..'});
  assert.deepEqual(diffArgs(diffRange('pull_request', {base, sha: head})), [
    'diff',
    '--name-only',
    '--no-renames',
    `${base}...${head}`,
  ]);
  assert.throws(() => diffRange('push', {before: '0'.repeat(40), sha: head}));
  assert.throws(() => diffRange('schedule', {sha: head}));
  const open = classify('push', {before: '', sha: head}, () => {
    throw Error('should not list');
  });
  assert.equal(open.code, true);
  assert.match(open.reason, /before sha/);
  assert.deepEqual(shasFromPayload('pull_request', {pull_request: {base: {sha: base}, head: {sha: head}}}, 'ignored'), {
    base,
    before: '',
    sha: head,
  });
  assert.deepEqual(shasFromPayload('push', {before, after: head}, 'ignored'), {base: '', before, sha: head});
  assert.equal(classify('pull_request', {base, sha: head}, () => ['docs/a.md']).code, false);
  assert.equal(classify('pull_request', {base, sha: head}, () => ['src/a.ts']).code, true);
});

test('git diff lists a renamed code path and the cli writes code=', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-changes-'));
  const git = args => {
    const result = spawnSync('git', ['-c', 'user.email=ci@example.com', '-c', 'user.name=ci', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git(['init']);
    writeFileSync(join(dir, 'README.md'), 'docs\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'docs']);
    const docs = git(['rev-parse', 'HEAD']);
    writeFileSync(join(dir, 'src.txt'), 'code\n');
    git(['add', 'src.txt']);
    git(['commit', '-m', 'code']);
    const code = git(['rev-parse', 'HEAD']);
    assert.deepEqual(changedPaths({from: docs, to: code, dots: '..'}, dir), ['src.txt']);
    assert.equal(classify('push', {before: docs, sha: code}, range => changedPaths(range, dir)).code, true);
    git(['mv', 'src.txt', 'moved.md']);
    git(['commit', '-m', 'rename']);
    const renamed = git(['rev-parse', 'HEAD']);
    assert.deepEqual(changedPaths({from: code, to: renamed, dots: '..'}, dir).sort(), ['moved.md', 'src.txt']);
    const event = join(dir, 'event.json');
    const output = join(dir, 'output.txt');
    writeFileSync(event, JSON.stringify({before: docs, after: code}));
    const cli = spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: event,
        GITHUB_SHA: code,
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /^code=true\n$/);
    assert.equal(readFileSync(output, 'utf8'), 'code=true\n');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
