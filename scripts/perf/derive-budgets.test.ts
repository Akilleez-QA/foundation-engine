// perf:derive only derives budgets from comparable evidence (W1-4): a scene whose active window drew no frame (the
// scene had ended) or whose window was rejected gets no row, and says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRun, deriveFromRun } from './derive-budgets';
import { classifyWindow } from '../../src/platform/perf/window-class';
import type { PerfRun } from '../../src/platform/perf/perf-run';
import { must } from '../../src/testing/must';

const facts = { epochBreak: null, contextLost: false, frames: 120, complete: true, pendingAtStart: 0, requestsDuring: 0, uploads: [], programsCreated: 0 };
const sample = (id: string, scene: string, mode: 'idle' | 'active', renderedFrames: number, draws: number) => ({
  id, scene, mode, classification: classifyWindow({ ...facts, mode, renderedFrames }).classification, frames: 120, renderedFrames,
  drawsPerRenderedFrame: draws, trisPerRenderedFrame: draws * 100, offscreenDrawsPerRenderedFrame: 0, shadowPassDrawsMax: 0,
  textureMiB: 2, canvasMiB: 4, heapMB: 20, liveContexts: 1, taskMsPerFrame: 2,
});
const run = (samples: unknown[]) => ({ schema: 1, samples } as unknown as PerfRun);

test('a scene in play derives budgets from the worst of its windows', () => {
  const { rows, refused } = deriveRun(run([sample('arena', 'arena', 'idle', 6, 40), sample('arena:active', 'arena', 'active', 120, 55)]));
  assert.deepEqual(refused, {});
  assert.equal(must(rows.arena, 'the arena row').draws, 70, '55 + 10% rounded up to the step of 10');
});

test('an active window that rendered no frame (the scene ended) derives nothing, and says so', () => {
  const dead = run([sample('title', 'title', 'idle', 6, 12), sample('arena', 'arena', 'idle', 0, 0), sample('arena:active', 'arena', 'active', 0, 0)]);
  const { rows, refused } = deriveRun(dead);
  assert.ok(!('arena' in rows), 'no budget numbers from a dead window');
  assert.match(must(refused.arena, 'the arena refusal').join('\n'), /arena:active: inconclusive: the active window drew no frame/);
  assert.ok('title' in rows, 'other scenes still derive');
  assert.ok(!('arena' in deriveFromRun(dead)));
});

test('a rejected window refuses its scene instead of deriving from the rest', () => {
  const { rows, refused } = deriveRun(run([sample('arena', 'arena', 'idle', 6, 40), { id: 'arena:active', scene: 'arena', mode: 'active', error: 'rejected: epoch: left the scene' }]));
  assert.ok(!('arena' in rows));
  assert.match(must(refused.arena?.[0], 'the arena refusal'), /arena:active: rejected/);
});

test('a still idle-only scene that drew no frame leaves its per-frame counts unmeasured, not invented', () => {
  const { rows, refused, notes } = deriveRun(run([sample('menu', 'menu', 'idle', 0, 0)]));
  assert.deepEqual(refused, {});
  assert.equal(must(rows.menu, 'the menu row').draws, undefined);
  assert.equal(must(rows.menu, 'the menu row').triangles, undefined);
  assert.equal(must(rows.menu, 'the menu row').textureMiB, 8);
  assert.match(must(notes.menu, 'the menu note'), /no window drew a frame/);
});
