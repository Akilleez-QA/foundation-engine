import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareResourceChange} from './resource-values';

test('integer interval remapping agrees with an independent small-number arithmetic oracle', () => {
  // Small operands make every numerator/denominator exact Number integers. This
  // exercises the BigInt implementation without reusing its quotient/remainder code.
  for (let min = -4; min <= 2; min++)
    for (let max = min + 1; max <= 5; max++) {
      for (let current = min; current <= max; current++) {
        for (let nextMin = -3; nextMin <= 2; nextMin++)
          for (let nextMax = nextMin; nextMax <= 4; nextMax++) {
            const numerator = nextMin * (max - min) + (current - min) * (nextMax - nextMin);
            const denominator = max - min,
              target = numerator / denominator;
            for (const rounding of ['floor', 'ceil', 'nearest', 'reject'] as const) {
              const result = prepareResourceChange(
                {version: 1, mode: 'safe-integer', min, max, current},
                {kind: 'bounds', min: nextMin, max: nextMax, adjust: 'ratio'},
                {overflow: 'reject', rounding},
              );
              if (rounding === 'reject' && numerator % denominator !== 0) {
                assert.deepEqual(result, {ok: false, reason: 'precision'});
              } else {
                assert.equal(result.ok, true);
                if (!result.ok) continue;
                const expected =
                  rounding === 'floor'
                    ? Math.floor(target)
                    : rounding === 'ceil'
                      ? Math.ceil(target)
                      : rounding === 'nearest'
                        ? Math.floor(target + 0.5)
                        : target;
                assert.equal(result.state.current, expected === 0 ? 0 : expected);
                const delta = expected - current;
                assert.equal(result.calculation.actualDelta, delta === 0 ? 0 : delta);
              }
            }
          }
      }
    }
});
