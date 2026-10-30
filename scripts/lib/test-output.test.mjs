import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TAP_REPORTER, childTestEnv, testTotals} from './test-output.mjs';

const tap =
  'TAP version 13\n# Subtest: a\n    # Subtest: inner\n    ok 1 - inner\n    # tests 9\nok 1 - a\n1..1\n# tests 2\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 41.5\n';
const spec =
  '✔ a (1.2ms)\n\u001b[34mℹ tests 4\u001b[39m\nℹ suites 0\nℹ pass 3\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 3702.018711\n';

test('test totals: TAP (Node 22 piped default) and spec (Node 23+ default) summaries read the same', () => {
  assert.deepEqual(testTotals(tap), {
    tests: '2',
    suites: '0',
    pass: '2',
    fail: '0',
    cancelled: '0',
    skipped: '0',
    todo: '0',
    duration_ms: '41.5',
  });
  assert.deepEqual(testTotals(spec), {
    tests: '4',
    suites: '0',
    pass: '3',
    fail: '1',
    cancelled: '0',
    skipped: '0',
    todo: '0',
    duration_ms: '3702.018711',
  });
  assert.equal(
    testTotals('no summary here\n#tests 3\n  # tests 3\n'),
    null,
    'indented or malformed lines are not run totals',
  );
});

test('test totals: a real child runner with the named reporter reports its totals on this Node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-output-'));
  try {
    const file = join(dir, 'probe.test.mjs');
    writeFileSync(
      file,
      "import test from 'node:test';\ntest('one', () => {});\ntest('two', () => {});\ntest('skipped', {skip: true}, () => {});\n",
    );
    const output = execFileSync(process.execPath, ['--test', TAP_REPORTER, file], {
      encoding: 'utf8',
      env: childTestEnv(),
    });
    const totals = testTotals(output);
    assert.deepEqual(
      {tests: totals?.tests, pass: totals?.pass, fail: totals?.fail, skipped: totals?.skipped},
      {tests: '3', pass: '2', fail: '0', skipped: '1'},
      output,
    );
    assert.match(output, /^TAP version \d+$/m, 'the named reporter is TAP whatever the Node default');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('child test env drops only the parent harness context', () => {
  assert.deepEqual(childTestEnv({NODE_TEST_CONTEXT: 'child-v8', KEEP: '1'}), {KEEP: '1'});
});
