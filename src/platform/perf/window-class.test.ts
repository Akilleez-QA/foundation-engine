// ADR 0053 fixtures required by: recurring upload, unknown upload, unfinished initial load, first-use
// compilation and same-hash re-entry. Plus the plain steady window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWindow, CLASSIFICATION_VERSION, type WindowFacts } from './window-class';

const steady: WindowFacts = { mode: 'idle', epochBreak: null, contextLost: false, frames: 60, renderedFrames: 60, complete: true, pendingAtStart: 0, requestsDuring: 0, uploads: [], programsCreated: 0 };
const upload = (over: Partial<WindowFacts['uploads'][number]> = {}) => ({ resource: 7, bytes: 768 * 512 * 4, frame: 3, firstEver: false, count: 16, ...over });

test('a quiet window is steady play and comparable', () => {
  const { classification } = classifyWindow(steady);
  assert.deepEqual(classification, { kind: 'steady', version: CLASSIFICATION_VERSION, reasons: [], comparable: true });
});

test('recurring uploads (a scoreboard redrawn every .25 s) are steady play, kept in the cost', () => {
  const { classification, uploads } = classifyWindow({ ...steady, uploads: [upload()] });
  assert.equal(classification.kind, 'steady');
  assert.equal(uploads[0].purpose, 'recurring');
  assert.match(classification.reasons.join(), /recurring upload/);
});

test('an unfinished initial load is entry, not steady', () => {
  const pending = classifyWindow({ ...steady, pendingAtStart: 2 });
  assert.equal(pending.classification.kind, 'entry');
  const late = classifyWindow({ ...steady, requestsDuring: 1, uploads: [upload({ firstEver: true, count: 1 })] });
  assert.equal(late.classification.kind, 'entry');
  assert.equal(late.uploads[0].purpose, 'initial');
});

test('first use on the active route: new texture or program compiled is firstUse, never discarded', () => {
  const tex = classifyWindow({ ...steady, mode: 'active', uploads: [upload({ firstEver: true, count: 1 })] });
  assert.equal(tex.classification.kind, 'firstUse');
  assert.equal(tex.uploads[0].purpose, 'firstUse');
  const prog = classifyWindow({ ...steady, mode: 'active', programsCreated: 3 });
  assert.equal(prog.classification.kind, 'firstUse');
  assert.equal(prog.classification.comparable, true);
});

test('an unknown upload (new texture in a still, loaded window) fails comparability', () => {
  const { classification, uploads } = classifyWindow({ ...steady, uploads: [upload({ firstEver: true, count: 1 })] });
  assert.equal(uploads[0].purpose, 'unknown');
  assert.equal(classification.kind, 'unclassified');
  assert.equal(classification.comparable, false);
});

test('a same-hash re-entry (new scene element, same hash) invalidates the window', () => {
  const { classification } = classifyWindow({ ...steady, epochBreak: 'scene element replaced (re-entry or exit)' });
  assert.equal(classification.kind, 'invalid');
  assert.equal(classification.comparable, false);
  assert.match(classification.reasons[0], /re-entry/);
});

test('an incomplete window or a lost context is invalid', () => {
  assert.equal(classifyWindow({ ...steady, complete: false }).classification.kind, 'invalid');
  assert.equal(classifyWindow({ ...steady, contextLost: true }).classification.kind, 'invalid');
  const still = classifyWindow({ ...steady, renderedFrames: 0 });
  assert.equal(still.classification.kind, 'steady', 'a render-on-demand scene that draws nothing is a valid still window');
  assert.match(still.classification.reasons.join(), /no rendered frame/);
});

test('an active window that drew no frame is inconclusive: the scene ended, it measured nothing', () => {
  const { classification } = classifyWindow({ ...steady, mode: 'active', renderedFrames: 0 });
  assert.equal(classification.kind, 'inconclusive');
  assert.equal(classification.comparable, false);
  assert.match(classification.reasons.join(), /active window rendered no frame/);
});

test('an incomplete active window with no frame stays invalid, not inconclusive', () => {
  const { classification } = classifyWindow({ ...steady, mode: 'active', renderedFrames: 0, complete: false });
  assert.equal(classification.kind, 'invalid');
});
