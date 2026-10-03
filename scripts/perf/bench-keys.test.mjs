// W1-4 review (PR #59): an active window that draws nothing is dead (inconclusive) only when its held keys drive the
// scene. Expedition binds no arrow key, so its active windows are still; a game whose input actions take the arrows,
// or a row that names its activeKeys, keeps the dead-window refusal.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {heldKeyPlan} from './bench.mjs';
import {loadGame} from '../../src/app/game-files.ts';
import {gameInputRows} from '../../src/author/input-registry.ts';
import {classifyWindow} from '../../src/platform/perf/window-class.ts';
import {ROOT} from '../lib/game-dir.mjs';

const ARROWS = ['ArrowUp', 'ArrowLeft'];
const rowsOf = async template => {
  const {game, defs} = await loadGame(join(ROOT, 'templates', template, 'game'));
  return gameInputRows(game, defs);
};
const deadFacts = {
  mode: 'active',
  epochBreak: null,
  contextLost: false,
  frames: 60,
  renderedFrames: 0,
  complete: true,
  pendingAtStart: 0,
  requestsDuring: 0,
  uploads: [],
  programsCreated: 0,
};

test('expedition: the arrows press no game action, so an active window that draws nothing is a still window', async () => {
  const plan = heldKeyPlan({id: 'shelter'}, ARROWS, await rowsOf('expedition'));
  assert.deepEqual(plan, {keys: ARROWS, drive: false, source: 'bindings', actions: []});
  const {classification} = classifyWindow({...deadFacts, heldKeysDrive: plan.drive});
  assert.equal(classification.kind, 'steady');
  assert.equal(classification.comparable, true);
});

test("explorer: the arrows press the character kit's move actions, so a window that draws nothing stays dead", async () => {
  const plan = heldKeyPlan({id: 'garden'}, ARROWS, await rowsOf('explorer'));
  assert.equal(plan.drive, true);
  assert.ok(plan.actions.length > 0);
  assert.equal(classifyWindow({...deadFacts, heldKeysDrive: plan.drive}).classification.kind, 'inconclusive');
});

test("a row's activeKeys are held and declared to drive the scene: a window that draws nothing is dead", async () => {
  const plan = heldKeyPlan({id: 'field', activeKeys: ['KeyW', 'KeyA']}, ARROWS, await rowsOf('expedition'));
  assert.deepEqual(plan, {keys: ['KeyW', 'KeyA'], drive: true, source: 'activeKeys', actions: []});
  assert.equal(classifyWindow({...deadFacts, heldKeysDrive: plan.drive}).classification.kind, 'inconclusive');
});

test('unknown bindings (the game did not load in Node) never excuse a dead window', () => {
  const plan = heldKeyPlan({id: 'field'}, ARROWS, null);
  assert.equal(plan.drive, undefined);
  assert.equal(classifyWindow({...deadFacts, heldKeysDrive: plan.drive}).classification.kind, 'inconclusive');
});

test('a malformed activeKeys is refused, not silently replaced by the arrows', () => {
  assert.throws(() => heldKeyPlan({id: 'field', activeKeys: []}, ARROWS, null), /activeKeys must be a non-empty list/);
  assert.throws(
    () => heldKeyPlan({id: 'field', activeKeys: 'KeyW'}, ARROWS, null),
    /activeKeys must be a non-empty list/,
  );
});
