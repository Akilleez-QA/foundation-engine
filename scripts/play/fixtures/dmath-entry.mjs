// Deterministic-math evidence page: computes the golden vectors with dmath and with the browser's own Math, the
// seeded character-kit workload both ways, and timings. scripts/play/dmath-check.mjs compares the bits with Node.
import {dmath, platformMath} from '../../../src/core/dmath.ts';
import {computeGolden} from '../../../src/core/dmath-vectors.ts';
import {characterRun, timings} from '../../../tools/dmath-bench/workload.ts';

window.dmathResult = {
  golden: computeGolden(dmath),
  platformGolden: computeGolden(platformMath),
  character: {deterministic: characterRun(dmath), platform: characterRun(platformMath)},
  timings: timings(() => performance.now()),
  userAgent: navigator.userAgent,
};
window.dmathReady = true;
