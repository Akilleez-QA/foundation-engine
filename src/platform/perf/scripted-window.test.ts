import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WHOLE_ROUTE_POLICY, scriptedWindowProblems, type ScriptedWindow} from './scripted-window';
import {isComparable, checkBudgets} from './budget-check';
const window = (): ScriptedWindow => ({
  policy: WHOLE_ROUTE_POLICY,
  scriptComplete: true,
  complete: true,
  epochBreak: null,
  contextLost: false,
  frames: 240,
  elapsedMs: 4001,
  durationMs: 4000,
  resamples: 0,
  uploads: [{resource: 57, bytes: 327680, frame: 8, firstEver: true, count: 2}],
});
test('whole fixed workload retains unknown diagnostic classification and costs; regressions still fail', () => {
  const sample = {
    frames: 240,
    windowMs: 4001,
    uploads: {initial: 0, recurring: 0, firstUse: 0, unknown: 1, bytes: 327680},
    drawsPerRenderedFrame: 500,
    frameMs: 25,
    classification: {kind: 'unclassified', comparable: false},
    scriptedWindow: window(),
  };
  assert.equal(isComparable({...sample, scriptedWindow: undefined}), false);
  const before = structuredClone(sample);
  assert.equal(isComparable(sample), true);
  const result = checkBudgets(
    {route: sample},
    {home: {draws: 600, frameMs: 30}},
    [{sample: 'route', scene: 'home', metrics: ['draws', 'frameMs']}],
    {tier: 'reference', realHardware: true, baseline: {route: {...sample, drawsPerRenderedFrame: 300, frameMs: 16}}},
  );
  assert.ok(result.regressions === 2);
  assert.equal(result.ok, false);
  assert.deepEqual(sample, before);
});
test('broken or incomplete workload evidence never grants fallback comparability', () => {
  for (const mutation of [
    {complete: false},
    {epochBreak: 'player changed'},
    {contextLost: true},
    {frames: 1},
    {durationMs: 0},
    {durationMs: 1, elapsedMs: 1},
    {durationMs: 3999},
    {elapsedMs: 3999},
    {resamples: 1},
    {uploads: undefined},
    {uploads: [{resource: 1, bytes: NaN, frame: 0, count: 1, firstEver: true}]},
  ]) {
    const sample = {
      classification: {kind: 'unclassified', comparable: false},
      scriptedWindow: {...window(), ...mutation},
    };
    assert.ok(scriptedWindowProblems(sample).length, JSON.stringify(mutation));
    assert.equal(isComparable(sample), false);
  }
  assert.ok(scriptedWindowProblems({classification: {kind: 'invalid'}, scriptedWindow: window()}).length);
});

test('core comparability requires matching raw frame, time, byte and resource counts', () => {
  const sample = {
    classification: {kind: 'entry'},
    scriptedWindow: window(),
    frames: 240,
    windowMs: 4001,
    uploads: {initial: 1, recurring: 0, firstUse: 0, unknown: 0, bytes: 327680},
  };
  assert.equal(isComparable(sample), true);
  for (const bad of [
    {frames: 241},
    {windowMs: 4000},
    {uploads: {...sample.uploads, bytes: 0}},
    {uploads: {...sample.uploads, initial: 0}},
  ])
    assert.equal(isComparable({...sample, ...bad}), false);
});
