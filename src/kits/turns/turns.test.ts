import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnLog, restoreTurnLog, turns } from './index';
import { cardRules, limits, table, type Move } from './test-rules';
import { defineSaveSection } from '../../author';
import { authorSaveHandle } from '../../author/save-handle';
import { createSaveStore } from '../../core/save/store';
import { MemoryBackend } from '../../core/save/storage-port';

const open = (seed: number | string = 7) => createTurnLog({ rules: cardRules(), limits, seed, initial: table });
const play = (moves: Move[], seed: number | string = 7) => {
  const log = open(seed);
  for (const m of moves) assert.equal(log.submit(log.read().revision, m).status, 'applied');
  return log;
};
const moves: Move[] = [{ type: 'shuffle' }, { type: 'draw' }, { type: 'draw' }];

test('turns kit: headless kit declaration installs nothing', () => {
  const kit = turns();
  assert.equal(kit.id, 'turns');
});

test('same seed and commands replay to identical states; another seed shuffles differently', () => {
  const a = play(moves), b = play(moves), c = play(moves, 8);
  assert.equal(a.read().stateJson, b.read().stateJson);
  assert.notEqual(a.read().state.deck.join(), c.read().state.deck.join());
  assert.deepEqual([...a.read().state.deck, ...a.read().state.hand].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  // A string seed is a named stream: equal names, equal runs.
  assert.equal(play(moves, 'demo-seed').read().stateJson, play(moves, 'demo-seed').read().stateJson);
});

test('preview predicts exactly what submit applies and changes nothing (telegraphed outcome)', () => {
  const log = open(), before = log.read();
  const preview = log.preview({ type: 'shuffle' });
  assert.equal(preview.status, 'accepted');
  assert.deepEqual(log.read(), before);
  const applied = log.submit(before.revision, { type: 'shuffle' });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.status === 'applied' && applied.view.stateJson, preview.status === 'accepted' && preview.stateJson);
  assert.deepEqual(log.preview({ type: 'play', card: 99 }), { status: 'rejected', reason: 'card not in hand' });
});

test('undo and redo restore exact states, including random draws; a new command discards redo', () => {
  const log = play(moves), after = log.read();
  const states = [0, 1, 2, 3].map(k => { const r = log.replay(k); assert.equal(r.status, 'replayed'); return r.status === 'replayed' ? r.stateJson : ''; });
  assert.equal(states[3], after.stateJson);
  assert.equal(log.undo(after.revision).status, 'applied');
  assert.equal(log.read().stateJson, states[2]);
  assert.equal(log.undo(log.read().revision).status, 'applied');
  assert.equal(log.read().stateJson, states[1]);
  assert.equal(log.redo(log.read().revision).status, 'applied');
  assert.equal(log.redo(log.read().revision).status, 'applied');
  assert.equal(log.read().stateJson, after.stateJson);
  assert.equal(log.redo(log.read().revision).status, 'empty');
  log.undo(log.read().revision);
  const hand = log.read().state.hand;
  assert.equal(log.submit(log.read().revision, { type: 'play', card: hand[0] }).status, 'applied');
  assert.equal(log.read().canRedo, false);
  assert.equal(log.read().length, 3);
  for (let k = 3; k > 0; k--) log.undo(log.read().revision);
  assert.equal(log.undo(log.read().revision).status, 'empty');
  assert.deepEqual(log.read().state, table);
});

test('a domain rejection records nothing; stale revisions are refused', () => {
  const log = open(), view = log.read();
  assert.deepEqual(log.submit(view.revision, { type: 'play', card: 1 }), { status: 'rejected', reason: 'card not in hand' });
  assert.equal(log.read().revision, view.revision);
  assert.equal(log.read().length, 0);
  assert.equal(log.submit(view.revision, { type: 'draw' }).status, 'applied');
  assert.equal(log.submit(view.revision, { type: 'draw' }).status, 'stale');
  assert.equal(log.undo(view.revision).status, 'stale');
  assert.equal(log.read().length, 1);
});

test('snapshot round-trips through a real save section and a fresh store reload', () => {
  const section = defineSaveSection({ id: 'turns.match', scope: 'device', initial: { json: '' } });
  const backend = new MemoryBackend();
  const store = (tab: number) => createSaveStore({ local: backend.port(tab), session: new MemoryBackend().port(tab, 'session'), namespace: 'turns-test', build: 'test', timers: { set: () => 0, clear: () => {}, now: () => 0 } });
  const log = play(moves);
  log.undo(log.read().revision); // keep one redo entry in the save
  const first = store(0);
  assert.equal(authorSaveHandle(first, section).update(d => { d.json = JSON.stringify(log.snapshot()); }, { now: true }), 'saved');
  first.dispose();
  const second = store(1), saved = authorSaveHandle(second, section).get().json;
  const restored = restoreTurnLog({ rules: cardRules(), limits }, JSON.parse(saved));
  assert.equal(restored.status, 'restored');
  if (restored.status !== 'restored') return;
  assert.equal(restored.log.read().stateJson, log.read().stateJson);
  assert.equal(restored.log.redo(restored.log.read().revision).status, 'applied');
  assert.equal(log.redo(log.read().revision).status, 'applied');
  assert.equal(restored.log.read().stateJson, log.read().stateJson);
  second.dispose();
});

test('restore refuses foreign, malformed, tampered and rules-drifted snapshots without throwing', () => {
  const snap = play(moves).snapshot();
  assert.equal(restoreTurnLog({ rules: cardRules('other@1'), limits }, snap).status, 'foreign');
  assert.equal(restoreTurnLog({ rules: cardRules(), limits }, { ...snap, format: 'turns/0' }).status, 'invalid');
  assert.equal(restoreTurnLog({ rules: cardRules(), limits }, { ...snap, cursor: 9 }).status, 'invalid');
  assert.equal(restoreTurnLog({ rules: cardRules(), limits }, { ...snap, commands: [{ type: 'teleport' }] }).status, 'invalid');
  assert.equal(restoreTurnLog({ rules: cardRules(), limits }, null).status, 'invalid');
  assert.equal(restoreTurnLog({ rules: cardRules(), limits }, { ...snap, checksum: snap.checksum ^ 1 }).status, 'diverged');
  // Same rules id, changed behaviour: detected rather than silently loading another game.
  const drifted = play([{ type: 'draw' }, { type: 'play', card: 1 }]).snapshot();
  assert.equal(restoreTurnLog({ rules: cardRules('test-cards@1', 5), limits }, drifted).status, 'diverged');
  // Commands the changed rules now reject also diverge.
  assert.equal(restoreTurnLog({ rules: { ...cardRules(), reduce: () => ({ accept: false, reason: 'no' }) }, limits }, drifted).status, 'diverged');
});

test('bounded history: full log refuses, checkpoint folds history and keeps absolute random positions', () => {
  const log = open();
  for (let i = 0; i < limits.maxCommands; i++) assert.equal(log.submit(log.read().revision, { type: 'shuffle' }).status, 'applied');
  assert.equal(log.submit(log.read().revision, { type: 'shuffle' }).status, 'full');
  const full = log.read();
  // Undo frees capacity because submit discards redo entries.
  log.undo(full.revision);
  assert.equal(log.submit(log.read().revision, { type: 'shuffle' }).status, 'applied');
  assert.equal(log.read().stateJson, full.stateJson);
  const cp = log.checkpoint(log.read().revision);
  assert.equal(cp.status, 'applied');
  assert.equal(log.read().position, limits.maxCommands);
  assert.equal(log.read().canUndo, false);
  assert.equal(log.submit(log.read().revision, { type: 'shuffle' }).status, 'applied');
  // A log that never checkpointed, with more capacity, reaches the same state at the same position.
  const wide = createTurnLog({ rules: cardRules(), limits: { ...limits, maxCommands: 32 }, seed: 7, initial: table });
  for (let i = 0; i <= limits.maxCommands; i++) wide.submit(wide.read().revision, { type: 'shuffle' });
  assert.equal(wide.read().stateJson, log.read().stateJson);
  const restored = restoreTurnLog({ rules: cardRules(), limits }, log.snapshot());
  assert.equal(restored.status === 'restored' && restored.log.read().position, limits.maxCommands + 1);
});
