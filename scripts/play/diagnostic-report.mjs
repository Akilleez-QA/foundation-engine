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
