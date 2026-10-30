import {createAssignments} from '../../src/kits/assignments/index.ts';

function expect(value, status) {
  if (value.status !== status) throw Error(`Expected ${status}, got ${value.status}`);
  return value;
}

/** One-shot repair requests: the consumer owns eligibility and request completion. */
export function serviceRequests() {
  const ledger = createAssignments({maxActors: 2, maxTargets: 2, maxClaims: 2, maxCapacity: 1, maxRetries: 1});
  try {
    const technician = expect(ledger.addActor('technician'), 'added').handle;
    const backup = expect(ledger.addActor('backup'), 'added').handle;
    const repair = expect(ledger.addTarget('repair-door', 1), 'added').handle;
    const first = expect(ledger.claim(technician, repair), 'claimed').token;
    expect(ledger.claim(backup, repair), 'full');
    // A route refusal withdraws the assignment. The consumer chooses the replacement.
    expect(ledger.retry(first), 'ready');
    const replacement = expect(ledger.claim(backup, repair), 'claimed').token;
    expect(ledger.complete(first), 'stale');
    expect(ledger.complete(replacement), 'completed');
    expect(ledger.removeTarget(repair), 'removed');
    return ledger.snapshot();
  } finally {
    ledger.dispose();
  }
}
