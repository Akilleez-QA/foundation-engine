import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveableRng, defineScene, defineSystem, testScene } from '../../author';
import { createRollbackSyncTest } from '../rollback';
import { createInputHistory, sampleActions } from './index';
import type { InputHistorySnapshot } from './types';

const ACTIONS = ['down', 'right', 'p'];

/**
 * A tiny deterministic simulation whose whole state, including the input history and the random generator word,
 * goes through save/load: the shape a rollback game uses. `step` decodes the frame's input mask, records it, and
 * fires a buffered move with a random damage roll.
 */
function simulation(o: { saveHistory: boolean; saveRng: boolean }) {
  const history = createInputHistory({ actions: ACTIONS, capacity: 16 });
  const motion = history.sequence([{ all: ['down'] }, { all: ['down', 'right'] }, { all: ['right'], pressed: ['p'] }]);
  const rng = createSaveableRng('fixture');
  let sim = { frame: 0, hp: 1000, moves: 0 };
  return {
    save: () => JSON.stringify({ sim, history: o.saveHistory ? history.save() : null, rng: o.saveRng ? rng.state() : null }),
    load: (text: string) => {
      const data = JSON.parse(text) as { sim: typeof sim; history: InputHistorySnapshot | null; rng: number | null };
      sim = data.sim;
      if (data.history) history.load(data.history);
      if (data.rng !== null) rng.restore(data.rng);
    },
    step: (inputs: readonly string[], frame: number) => {
      const recorded = history.record(frame, Number(inputs[0]));
      assert.equal(recorded.status, 'recorded');
      const found = history.match(motion, { within: 10, maxGap: 4 });
      if (found && history.consume('p', found.end)) { sim.hp -= rng.int(5, 15); sim.moves++; }
      sim.frame++;
    },
  };
}
/** Scripted inputs: the motion every 12 frames, plus noise. */
const script = (frame: number) => {
  const phase = frame % 12;
  const names = phase === 2 || phase === 3 ? ['down'] : phase === 4 ? ['down', 'right'] : phase === 5 ? ['right', 'p'] : phase === 9 ? ['p'] : [];
  return String(names.reduce((m, n) => m | (1 << ACTIONS.indexOf(n)), 0));
};

test('INPUT-HISTORY + RNG-01: history and generator word in the saved state pass the rollback sync test', () => {
  const ports = simulation({ saveHistory: true, saveRng: true });
  const sync = createRollbackSyncTest({ checkDistance: 7, players: 1, maxStateBytes: 8192, maxInputBytes: 8, ports });
  for (let f = 0; f < 240; f++) assert.equal(sync.advance([script(f)]).status, 'checked', `frame ${f}`);
  const state = JSON.parse(ports.save()) as { sim: { moves: number; hp: number } };
  assert.equal(state.sim.moves, 20, 'each scripted motion fired once (consumption survives rollback)');
  assert.ok(state.sim.hp < 1000 - 20 * 4);
});

test('INPUT-HISTORY + RNG-01: leaving either outside the saved state is caught by the sync test', () => {
  // An unsaved history refuses the replayed (stale) frames, so the step throws and the sync test fails it;
  // an unsaved generator word draws different damage on replay, which is a checksum desync.
  for (const [o, expected, reason] of [[{ saveHistory: false, saveRng: true }, 'failed', 'step-failed'], [{ saveHistory: true, saveRng: false }, 'desynced', 'checksum-mismatch']] as const) {
    const sync = createRollbackSyncTest({ checkDistance: 3, players: 1, maxStateBytes: 8192, maxInputBytes: 8, ports: simulation(o) });
    let status = 'checked';
    for (let f = 0; f < 120 && status === 'checked'; f++) status = sync.advance([script(f)]).status;
    assert.equal(status, expected, JSON.stringify(o));
    assert.equal(sync.read().reason, reason);
  }
});

test('INPUT-HISTORY in the fixed lane: sampled through ctx.input, a tap inside one tick is recorded once', async () => {
  const history = createInputHistory({ actions: ['p', 'k'], capacity: 8 });
  let tick = 0;
  const record = defineSystem({ id: 'input-history-record', run(ctx) {
    const { held, taps } = sampleActions(ctx.input, history);
    assert.equal(history.record(tick++, held, taps).status, 'recorded');
  } });
  const t = await testScene(defineScene({ id: 'input-history-consumer', title: 'Input history consumer', systems: [record] }));
  t.run(2 / 60);
  t.press('p');                 // pressed for the next tick only, never held
  t.run(1 / 60);
  t.hold('k'); t.run(3 / 60); t.release('k'); t.run(1 / 60);
  assert.equal(history.latest(), 6);
  assert.ok(history.pressed('p', 2) && history.released('p', 3), 'tap captured as a one-frame hold');
  assert.equal(history.lastEdge('p', 'press', 8), 2);
  assert.ok(history.pressed('k', 3) && history.held('k', 5) && history.released('k', 6));
  t.dispose();
});
