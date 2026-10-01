import test from 'node:test';
import assert from 'node:assert/strict';
import { displayUnitProblems, displayUnits, formatReadout, formatValue, type FormatText } from './format';

const text: FormatText = (key, vars, opts) => `${opts.level}:${key}:${vars.value ?? ''}`;

test('display units turn SI into what a person reads (grouping follows the locale; undefined is the browser\'s)', () => {
  assert.equal(formatValue(412_345, 'length.km', 'en'), '412 km');
  assert.equal(formatValue(384_400_000, 'length.km', 'en'), '384,400 km');
  assert.equal(formatValue(384_400_000, 'length.km', 'de'), '384.400 km');
  assert.equal(formatValue(384_400_000, 'length.km'), (384_400).toLocaleString() + ' km', 'undefined locale = toLocaleString()');
  assert.equal(formatValue(6_771_499, 'length.km-plain'), '6771 km');
  assert.equal(formatValue(7_673.4, 'speed.km-s-3'), '7.673 km/s');
  assert.equal(formatValue(7_673.4, 'speed.km-s-2'), '7.67 km/s');
  assert.equal(formatValue(3_150.6, 'speed.m-s', 'en'), '3,151 m/s');
  assert.equal(formatValue(Math.PI / 6, 'angle.deg-1'), '30.0°');
  assert.equal(formatValue(0.01234, 'ratio.3'), '0.012');
  for (const [id, u] of Object.entries(displayUnits)) assert.ok(u.per > 0 && u.digits >= 0, id);
});

test('formatReadout picks the standard or the detailed key, fills {value}, and shows <key>.none for null', () => {
  const r = { id: 'trip.distance', unit: 'length.km', format: { standard: 'std.ap', detailed: 'det.ap' } };
  assert.equal(formatReadout(r, 400_000, 'standard', text, 'en'), 'standard:std.ap:400 km');
  assert.equal(formatReadout(r, 400_000, 'detailed', text, 'en'), 'detailed:det.ap:400 km');
  assert.equal(formatReadout(r, null, 'detailed', text), 'detailed:det.ap.none:');
  assert.equal(formatReadout({ id: 'trip.landmark', format: { standard: 'k', detailed: 'g' } }, 'Tower', 'detailed', text), 'detailed:g:Tower', 'a text value is shown as it is');
});

test('a bad unit is a content error: formatReadout throws, displayUnitProblems names the row', () => {
  const bad = { id: 'trip.x', unit: 'length.furlongs', format: { standard: 'k', detailed: 'g' } };
  assert.throws(() => formatReadout(bad, 1, 'standard', text), /unknown display unit/);
  assert.throws(() => formatReadout({ ...bad, unit: 'length.km' }, 'far', 'standard', text), /must be a number/);
  assert.deepEqual(displayUnitProblems([bad, { ...bad, id: 'orbit.y', unit: 'length.km' }]), ['trip.x: unknown display unit "length.furlongs"']);
});
