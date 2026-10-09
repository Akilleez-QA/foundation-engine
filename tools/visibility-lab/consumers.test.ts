import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sensors} from './sensors';
import {facilities} from './facilities';
import {createVisibility, type VisibilitySource} from '../../src/kits/visibility';
type Ledger = ReturnType<typeof createVisibility>;
function add(v: Ledger) {
  const r = v.addSource();
  if (r.status !== 'added') throw Error(r.status);
  return r.source;
}
function put(v: Ledger, source: VisibilitySource, cells: number[]) {
  const r = v.begin(source);
  if (r.status !== 'prepared') throw Error(r.status);
  assert.equal(v.replace(r.ticket, cells), 'replaced');
}
test('sensor exploration and facility service consume the same owner with distinct policies', () => {
  const scout = sensors(),
    district = facilities();
  const a = add(scout.visibility),
    b = add(district.coverage);
  put(scout.visibility, a, [2]);
  put(district.coverage, b, [2]);
  assert.equal(scout.mapState(2), 'current');
  assert.equal(district.canServe(2), true);
  scout.visibility.removeSource(a);
  district.coverage.removeSource(b);
  assert.equal(scout.mapState(2), 'remembered');
  assert.equal(district.canServe(2), false);
  scout.visibility.dispose();
  district.coverage.dispose();
});
