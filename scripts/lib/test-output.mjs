// scripts/lib/test-output.mjs: run Node's test runner in a named output format and read its totals.
// Node 23 changed the default reporter for piped (non-TTY) output from TAP (`# tests 4`) to spec (`ℹ tests 4`), and
// the supported range is Node 22.18 or newer. A script that reads test output therefore never relies on the default:
// it passes TAP_REPORTER, and testTotals() also reads spec summaries (`npm test` keeps the default reporter).
// A child runner started from inside a test must not inherit NODE_TEST_CONTEXT, or it reports to the parent harness
// in its private protocol instead of printing a report: use childTestEnv().

/** The explicit reporter for a child `node --test` / `tsx --test` whose output a script reads. */
export const TAP_REPORTER = '--test-reporter=tap';

/** The run summary keys Node's test runner prints, in its order. */
export const TOTAL_KEYS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'];

const SUMMARY = new RegExp(`^(?:#|ℹ) (${TOTAL_KEYS.join('|')}) (\\d+(?:\\.\\d+)?)$`);
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The final run totals in TAP or spec output, as {tests, pass, fail, ...} strings of digits; null when the output
 * holds no summary. Only unindented summary lines count, and the last value of each key wins (the run's own totals).
 */
export function testTotals(output) {
  const totals = {};
  for (const line of String(output).replace(ANSI, '').split(/\r?\n/)) {
    const m = SUMMARY.exec(line.trimEnd());
    if (m) totals[m[1]] = m[2];
  }
  return Object.keys(totals).length ? totals : null;
}

/** A copy of env for an independent child test runner (not a subtest of the current harness). */
export function childTestEnv(env = process.env) {
  const copy = {...env};
  delete copy.NODE_TEST_CONTEXT;
  return copy;
}
