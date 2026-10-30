import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../../core/rng';
import {createRollbackSyncTest} from './sync-test';
import {INPUTS, toyPorts, toyStep, type Toy} from './test-harness';
import type {SyncTestOptions} from './types';
import {must} from '../../testing/must';

const options = (ports: SyncTestOptions['ports'], o: Partial<SyncTestOptions> = {}): SyncTestOptions => ({
  checkDistance: 3,
  maxStateBytes: 4096,
  maxInputBytes: 8,
  players: 2,
  ports,
  ...o,
});
const drive = (frames: number, ports: SyncTestOptions['ports'], o: Partial<SyncTestOptions> = {}) => {
  const sync = createRollbackSyncTest(options(ports, o)),
    rng = createRng(11);
  let last: ReturnType<typeof sync.advance> | undefined;
  for (let f = 0; f < frames; f++) {
    last = sync.advance([must(INPUTS[rng.int(0, 3)]), must(INPUTS[rng.int(0, 3)])]);
    if (last.status !== 'checked') break;
  }
  return {sync, last: last!};
};

test('ROLLBACK sync test passes a deterministic simulation and bounds its work per frame', () => {
  for (const checkDistance of [1, 2, 8]) {
    const ports = toyPorts();
    const {sync, last} = drive(300, ports, {checkDistance});
    assert.equal(last.status, 'checked');
    assert.equal(sync.read().frame, 300);
    assert.equal(ports.calls.load, 300);
    // One original step plus at most checkDistance resimulated steps per frame.
    assert.ok(ports.calls.step <= 300 * (checkDistance + 1));
    assert.equal((last as {resimulated: number}).resimulated, checkDistance);
  }
});

test('ROLLBACK sync test finds hidden state that save does not capture', () => {
  const ports = toyPorts();
  let hidden = 0;
  const inner = ports.step;
  ports.step = (inputs, frame) => {
    inner(inputs, frame);
    hidden++;
    if (hidden % 7 === 0) ports.state.hits++;
  };
  const {sync, last} = drive(100, ports);
  assert.equal(last.status, 'desynced');
  assert.equal(sync.read().status, 'desynced');
  assert.ok(sync.read().desync!.frame > 0);
  assert.equal(sync.advance(['n', 'n']).status, 'desynced');
});

test('ROLLBACK sync test finds an incomplete load and a change made outside step', () => {
  const partial = toyPorts();
  partial.load = text => {
    const next = JSON.parse(text) as Toy;
    partial.state.x = next.x;
    partial.state.frame = next.frame;
  };
  assert.equal(drive(50, partial).last.status, 'desynced', 'velocity and hits not restored');

  const outside = toyPorts();
  const sync = createRollbackSyncTest(options(outside));
  assert.equal(sync.advance(['r', 'n']).status, 'checked');
  outside.state.hits += 1; // for example a presentation hook writing simulation state between ticks
  const r = sync.advance(['n', 'n']);
  assert.deepEqual({status: r.status, frame: (r as {frame: number}).frame}, {status: 'desynced', frame: 1});
});

test('ROLLBACK sync test refuses malformed input without stepping, fails closed on port errors, and retires', () => {
  const ports = toyPorts();
  const sync = createRollbackSyncTest(options(ports));
  for (const bad of [['n'], ['n', 'n', 'n'], ['n', 'x'.repeat(9)], ['n', 3], 'nn', null])
    assert.deepEqual(sync.advance(bad as unknown as string[]), {status: 'invalid'});
  assert.equal(ports.calls.step, 0);
  for (const [patch, reason] of [
    [
      {
        save: () => {
          throw Error('x');
        },
      },
      'save-failed',
    ],
    [
      {
        step: () => {
          throw Error('x');
        },
      },
      'step-failed',
    ],
    [
      {
        load: () => {
          throw Error('x');
        },
      },
      'load-failed',
    ],
    [{save: () => 'x'.repeat(5000)}, 'state-bytes'],
  ] as const) {
    const s = createRollbackSyncTest(options(Object.assign(toyPorts(), patch)));
    assert.deepEqual(s.advance(['n', 'n']), {status: 'failed', reason});
  }
  for (const bad of [{checkDistance: 0}, {checkDistance: 61}, {players: 0}, {maxStateBytes: 0}, {maxInputBytes: 1.5}])
    assert.throws(() => createRollbackSyncTest(options(toyPorts(), bad)), /rollback sync test: invalid/);
  assert.throws(
    () => createRollbackSyncTest(options({save: () => '', load: () => {}} as never)),
    /invalid configuration/,
  );
  const controller = new AbortController();
  const owned = createRollbackSyncTest(options(toyPorts(), {signal: controller.signal}));
  controller.abort();
  assert.deepEqual(owned.advance(['n', 'n']), {status: 'retired', reason: 'disposed'});
  let self!: ReturnType<typeof createRollbackSyncTest>;
  const reentrant = toyPorts();
  const seen: string[] = [];
  reentrant.step = (inputs, frame) => {
    seen.push(self.advance(['n', 'n']).status);
    toyStep(reentrant.state, inputs, frame);
  };
  self = createRollbackSyncTest(options(reentrant));
  assert.equal(self.advance(['n', 'n']).status, 'checked');
  assert.ok(seen.length > 0 && seen.every(s => s === 'busy'));
});

test('ROLLBACK sync test compares every replay with the live step, also at checkDistance 1', () => {
  // Unseeded randomness inside step.
  const random = toyPorts();
  const step = random.step;
  random.step = (inputs, frame) => {
    step(inputs, frame);
    if (Math.random() < 0.5) random.state.hits++;
  };
  assert.equal(drive(200, random, {checkDistance: 1}).last.status, 'desynced');

  // Hidden state outside save, and the incomplete load from the earlier test, at distance 1.
  const hiddenPorts = toyPorts();
  let hidden = 0;
  const hiddenStep = hiddenPorts.step;
  hiddenPorts.step = (inputs, frame) => {
    hiddenStep(inputs, frame);
    hidden++;
    if (hidden % 7 === 0) hiddenPorts.state.hits++;
  };
  assert.equal(drive(200, hiddenPorts, {checkDistance: 1}).last.status, 'desynced');
  const partial = toyPorts();
  partial.load = text => {
    const next = JSON.parse(text) as Toy;
    partial.state.x = next.x;
    partial.state.frame = next.frame;
  };
  assert.equal(drive(200, partial, {checkDistance: 1}).last.status, 'desynced');
});

test('ROLLBACK sync test catches a one-shot value consumed by the live step at every distance', () => {
  for (const checkDistance of [1, 3, 8]) {
    const ports = toyPorts();
    let pendingPress = false;
    const step = ports.step;
    // For example a press latch read directly instead of through the step's inputs: the live step consumes it,
    // a resimulation cannot see it again.
    ports.step = (inputs, frame) => {
      step(inputs, frame);
      if (pendingPress) {
        ports.state.hits += 5;
        pendingPress = false;
      }
    };
    const sync = createRollbackSyncTest(options(ports, {checkDistance}));
    for (let f = 0; f < 10; f++) assert.equal(sync.advance(['n', 'n']).status, 'checked');
    pendingPress = true;
    const r = sync.advance(['n', 'n']);
    assert.equal(r.status, 'desynced', `distance ${checkDistance}`);
    assert.equal((r as {frame: number}).frame, 11);
  }
});

test('ROLLBACK sync test catches -0 lost by a JSON codec when it later changes the result', () => {
  type Signed = {frame: number; v: number; sign: number};
  let state: Signed = {frame: 0, v: 1, sign: 0};
  const ports = {
    save: () => JSON.stringify(state),
    load: (text: string) => {
      state = JSON.parse(text) as Signed;
    },
    step: (_inputs: readonly string[], frame: number) => {
      if (frame === 3)
        state.v = -0; // JSON.stringify(-0) === '0'
      else state.sign += 1 / state.v > 0 ? 1 : -1;
      state.frame++;
    },
  };
  const sync = createRollbackSyncTest(options(ports, {checkDistance: 1}));
  const statuses: string[] = [];
  for (let f = 0; f < 8; f++) statuses.push(sync.advance(['n', 'n']).status);
  assert.ok(statuses.includes('desynced'), statuses.join());
  assert.equal(sync.read().desync!.frame, 5);
});
