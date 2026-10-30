/** Development-only admission of named check results. This does not execute or authenticate an oracle. */
const LIMIT = 256;
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const positive = value => Number.isSafeInteger(value) && value > 0;
const fields = ['artifact', 'configuration', 'oracle', 'environment'];
const identityOk = value => value && fields.every(key => label(value[key]));

/**
 * Caller owns the predeclared contract and the actual check runner. A missing, skipped, failed, duplicate,
 * foreign or insufficient result cannot become acceptance. Bounds: 256 cases, 512 characters per label.
 */
export function assessEvidence(contract, report) {
  const invalid = reason => Object.freeze({status: 'invalid', reason});
  if (contract?.format !== 'acceptance/1' || !identityOk(contract.identity)) return invalid('contract-identity');
  if (!Array.isArray(contract.required) || contract.required.length === 0 || contract.required.length > LIMIT)
    return invalid('required-cases');
  const required = new Map();
  for (const row of contract.required) {
    if (!row || !label(row.id) || !positive(row.minSamples) || required.has(row.id)) return invalid('required-case');
    required.set(row.id, row.minSamples);
  }
  if (report?.format !== 'acceptance/1' || !identityOk(report.identity)) return invalid('report-identity');
  if (fields.some(key => report.identity[key] !== contract.identity[key])) return invalid('identity-mismatch');
  if (!Array.isArray(report.cases) || report.cases.length > LIMIT) return invalid('reported-cases');
  const received = new Map();
  for (const row of report.cases) {
    if (
      !row ||
      !required.has(row.id) ||
      received.has(row.id) ||
      !['passed', 'failed', 'skipped'].includes(row.status) ||
      !Number.isSafeInteger(row.samples) ||
      row.samples < 0
    )
      return invalid('reported-case');
    received.set(row.id, row);
  }
  const cases = [];
  for (const [id, minSamples] of required) {
    const row = received.get(id);
    const reason = !row
      ? 'missing'
      : row.status !== 'passed'
        ? row.status
        : row.samples < minSamples
          ? 'insufficient-samples'
          : null;
    cases.push(Object.freeze({id, minSamples, samples: row?.samples ?? 0, reason}));
  }
  return Object.freeze({
    status: cases.every(row => row.reason === null) ? 'passed' : 'failed',
    cases: Object.freeze(cases),
  });
}
