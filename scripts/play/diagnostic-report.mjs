import {writeFileSync} from 'node:fs';

export const describeDiagnostic = value => {
  try {
    return String(value);
  } catch {
    return '[unprintable thrown value]';
  }
};

/** Owns terminal diagnostic evidence, not the browser/server themselves. */
export function diagnosticReport(report, path, write = writeFileSync) {
  const causes = [];
  report.passed = false;
  report.failures = [];
  const fail = (error, stage = 'scenario') => {
    causes.push(error);
    report.failures.push({stage, error: describeDiagnostic(error)});
    report.passed = false;
  };
  return {
    fail,
    async close(owner, stage) {
      if (!owner) return;
      try {
        await owner.close();
      } catch (error) {
        fail(error, stage);
      }
    },
    finish() {
      if (causes.length) report.passed = false;
      try {
        write(path, JSON.stringify(report, null, 2) + '\n');
      } catch (error) {
        fail(error, 'report write');
      }
      if (causes.length) throw new AggregateError(causes, 'Diagnostic failed; scenario and cleanup causes retained');
    },
  };
}

/** Preserve completed observations and prior failures when the final evidence file cannot be written. */
export function writeDiagnosticEvidence(report, write) {
  try {
    write();
  } catch (cause) {
    const prior = [...report.errors];
    report.errors.push('report write: ' + describeDiagnostic(cause));
    if ('pass' in report) {
      report.pass = false;
      report.terminal = true;
    }
    const error = new AggregateError(
      [...prior, cause],
      'Diagnostic evidence write failed: ' + report.errors.join(' | '),
      {cause},
    );
    error.report = report;
    throw error;
  }
}
