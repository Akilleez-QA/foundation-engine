import {createAssignments} from '../../src/kits/assignments/index.ts';

function expect(value, status) {
  if (value.status !== status) throw Error(`Expected ${status}, got ${value.status}`);
  return value;
}

/** Long-lived worksite occupancy: a worker may consume multiple capacity units. */
export function worksiteSlots() {
  const ledger = createAssignments({maxActors: 2, maxTargets: 2, maxClaims: 2, maxCapacity: 3});
  try {
    const team = expect(ledger.addActor('assembly-team'), 'added').handle;
    const inspector = expect(ledger.addActor('inspector'), 'added').handle;
    const assembly = expect(ledger.addTarget('assembly', 3), 'added').handle;
    const finishing = expect(ledger.addTarget('finishing', 2), 'added').handle;
    const old = expect(ledger.claim(team, assembly, 2), 'claimed').token;
    const occupied = expect(ledger.claim(inspector, finishing), 'claimed').token;
    expect(ledger.transfer(old, finishing, 2), 'full');
    const refused = ledger.snapshot();
    expect(ledger.cancel(occupied), 'cancelled');
    const moved = expect(ledger.transfer(old, finishing, 2), 'claimed').token;
    expect(ledger.complete(old), 'stale');
    const transferred = ledger.snapshot();
    expect(ledger.removeTarget(finishing), 'removed');
    expect(ledger.complete(moved), 'stale');
    return {refused, transferred, removed: ledger.snapshot()};
  } finally {
    ledger.dispose();
  }
}
