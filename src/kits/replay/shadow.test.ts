import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../../core/rng';
import {INPUTS, toyPorts, type Toy, type ToyPorts} from '../rollback/test-harness';
import {must} from '../../testing/must';
import {explainDivergence, listDifferences} from './explain';
import {createReplayRecorder, openReplay} from './log';
import {
  createShadowRunner,
  nearestAnchor,
  replayInputs,
  type ShadowDivergence,
  type ShadowAnchor,
  type ShadowInputs,
  type ShadowSide,
} from './shadow';

/** A fixed, seeded two-input recording of `length` steps. */
const recording = (length: number, seed = 5): readonly (readonly string[])[] => {
  const rng = createRng(seed);
  return Array.from({length}, () => Object.freeze([must(INPUTS[rng.int(0, 3)]), must(INPUTS[rng.int(0, 3)])]));
};
const from =
  (log: readonly (readonly string[])[]): ShadowInputs =>
  step =>
    log[step];
/** An off-by-one in the candidate: after step `at` one coordinate is one unit further on. */
const offByOneAt = (at: number) => (state: Toy, frame: number) => {
  if (frame === at) state.x[1]! += 1;
};
const stateOf = (d: ShadowDivergence | null) => {
  assert.equal(d?.kind, 'state');
  return d as Extract<ShadowDivergence, {kind: 'state'}>;
};

test('SHADOW equal implementations agree over the whole log and keep anchors at the interval', () => {
  const log = recording(200);
  const a = toyPorts(),
    b = toyPorts();
  const runner = createShadowRunner({a, b, inputs: from(log), limits: {anchorEvery: 64}});
  const r = runner.run();
  assert.equal(r.status, 'agree');
  assert.equal(r.steps, 200);
  assert.equal(r.next, 200);
  assert.equal(r.divergence, null);
  assert.deepEqual(
    runner.anchors().map(x => x.step),
    [0, 64, 128, 192],
  );
  assert.deepEqual(a.state, b.state);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(runner.anchors()[0]));
  // Finished: further calls change nothing.
  assert.deepEqual(runner.step(), r);
});

test('SHADOW reports exactly the step, input and path of an off-by-one at step 37', () => {
  const log = recording(120);
  const runner = createShadowRunner({
    a: toyPorts(),
    b: toyPorts(2, offByOneAt(37)),
    inputs: from(log),
    limits: {anchorEvery: 16},
  });
  const r = runner.run();
  assert.equal(r.status, 'diverged');
  assert.equal(r.next, 37);
  assert.equal(r.steps, 37);
  const d = stateOf(r.divergence);
  assert.equal(d.step, 37);
  assert.deepEqual(d.inputs, log[37]);
  const first = must(d.differences[0]);
  assert.equal(first.path, 'x[1]');
  assert.equal(first.kind, 'value');
  assert.equal(Number(first.b) - Number(first.a), 1);
  assert.equal(d.differences.length, 1);
  assert.equal(d.truncated, false);
  assert.notEqual(d.a, d.b);
  // The last agreeing state is the boundary before step 37; the anchor is the newest at or before it.
  assert.equal(must(d.lastAgreed).step, 37);
  assert.equal((JSON.parse(must(d.lastAgreed).a) as Toy).frame, 37);
  assert.equal(must(d.anchor).step, 32);
  assert.deepEqual(
    runner.anchors().map(x => x.step),
    [0, 16, 32],
  );
});

test('SHADOW replay from the nearest anchor reproduces the same divergence in fewer steps', () => {
  const log = recording(120);
  const first = createShadowRunner({
    a: toyPorts(),
    b: toyPorts(2, offByOneAt(37)),
    inputs: from(log),
    limits: {anchorEvery: 16},
  }).run();
  const original = stateOf(first.divergence);
  const anchor = must(original.anchor);
  // Fresh sides at their own (wrong) start state: the anchor restore must set them up.
  const a = toyPorts(),
    b = toyPorts(2, offByOneAt(37));
  const again = createShadowRunner({a, b, inputs: from(log), from: anchor, limits: {anchorEvery: 16}}).run();
  assert.equal(again.status, 'diverged');
  assert.equal(again.from, 32);
  assert.equal(again.steps, 5);
  const d = stateOf(again.divergence);
  assert.equal(d.step, 37);
  assert.deepEqual(d.differences, original.differences);
  assert.equal(d.a, original.a);
  assert.equal(d.b, original.b);
  assert.equal(a.calls.step, 6);
  // The last agreeing state is itself an anchor: replaying from it diverges on the very first step.
  const once = createShadowRunner({
    a: toyPorts(),
    b: toyPorts(2, offByOneAt(37)),
    inputs: from(log),
    from: must(original.lastAgreed),
  }).run();
  assert.equal(once.steps, 0);
  assert.equal(stateOf(once.divergence).step, 37);
  assert.equal(nearestAnchor([anchor, must(original.lastAgreed)], 36), anchor);
  assert.equal(nearestAnchor([anchor], 31), null);
});

test('SHADOW finds a floating-point summation-order change at the step it first shows', () => {
  // The same arithmetic in a different order agrees until the operands make the rounding differ.
  const values = [0.5, 0.25, 0.125, 0.1, 0.2, 0.3];
  const side = (order: 'left' | 'right'): ShadowSide & {state: {t: number; sum: number}} => {
    const s = {
      state: {t: 0, sum: 0},
      save: () => JSON.stringify(s.state),
      load: (text: string) => {
        s.state = JSON.parse(text) as {t: number; sum: number};
      },
      step: (inputs: readonly string[], step: number) => {
        const [p, q, r] = inputs.map(i => must(values[Number(i)]));
        s.state.sum = order === 'left' ? p! + q! + r! : p! + (q! + r!);
        s.state.t = step + 1;
      },
    };
    return s;
  };
  // Exactly representable operands for 10 steps, then 0.1 + 0.2 + 0.3 at step 10.
  const log = Array.from({length: 20}, (_, i) => Object.freeze(i === 10 ? ['3', '4', '5'] : ['0', '1', '2']));
  const r = createShadowRunner({a: side('left'), b: side('right'), inputs: from(log)}).run();
  const d = stateOf(r.divergence);
  assert.equal(d.step, 10);
  assert.deepEqual(d.inputs, ['3', '4', '5']);
  assert.equal(must(d.differences[0]).path, 'sum');
});

test('SHADOW composes with a recorded replay log through replayInputs', () => {
  const header = {build: 'shadow-test@1', config: 'toy-1p', seed: 9, step: 0.01};
  const limits = {maxTicks: 1000, maxBytes: 1 << 16, input: {maxBytes: 64, maxNodes: 8, maxDepth: 2}};
  const recorder = createReplayRecorder({header, limits});
  const rng = createRng(3);
  for (let t = 0; t < 90; t++)
    assert.equal(recorder.record(t, JSON.stringify(INPUTS[rng.int(0, 3)])).status, 'recorded');
  const opened = openReplay(
    recorder.export(),
    {...limits, log: {maxBytes: 1 << 20, maxNodes: 1 << 12, maxDepth: 8}},
    {build: header.build, config: header.config, step: header.step},
  );
  assert.equal(opened.status, 'ready');
  const player = (opened as Extract<typeof opened, {status: 'ready'}>).player;
  // One player per step: the log's canonical JSON text decodes to that player's input.
  const oneInput = (inner: ToyPorts): ShadowSide => ({
    save: inner.save,
    load: inner.load,
    step: (inputs, step) => inner.step([JSON.parse(must(inputs[0])) as string], step),
  });
  const agree = createShadowRunner({a: oneInput(toyPorts(1)), b: oneInput(toyPorts(1)), inputs: replayInputs(player)});
  assert.equal(agree.run().status, 'agree');
  assert.equal(agree.read().steps, 90);
  const off = createShadowRunner({
    a: oneInput(toyPorts(1)),
    b: oneInput(
      toyPorts(1, (s, f) => {
        if (f === 61) s.v[0]! -= 1;
      }),
    ),
    inputs: replayInputs(player),
  }).run();
  const d = stateOf(off.divergence);
  assert.equal(d.step, 61);
  assert.deepEqual(d.inputs, [player.json(61)]);
  assert.deepEqual(
    d.differences.map(x => x.path),
    ['v[0]'],
  );
});

test('SHADOW reports a throwing side as a threw divergence naming the side and phase', () => {
  const log = recording(100);
  const throwing = (at: number) => {
    const p = toyPorts();
    const inner = p.step;
    p.step = (inputs, step) => {
      if (step === at) throw Error('boom');
      inner(inputs, step);
    };
    return p;
  };
  const one = createShadowRunner({a: toyPorts(), b: throwing(50), inputs: from(log), limits: {anchorEvery: 20}}).run();
  assert.equal(one.status, 'diverged');
  const d = one.divergence as Extract<ShadowDivergence, {kind: 'threw'}>;
  assert.equal(d.kind, 'threw');
  assert.equal(d.side, 'b');
  assert.equal(d.phase, 'step');
  assert.equal(d.step, 50);
  assert.deepEqual(d.inputs, log[50]);
  assert.match(d.message, /boom/);
  assert.equal(must(d.lastAgreed).step, 50);
  assert.equal(must(d.anchor).step, 40);

  const both = createShadowRunner({a: throwing(3), b: throwing(3), inputs: from(log)}).run();
  assert.equal((both.divergence as Extract<ShadowDivergence, {kind: 'threw'}>).side, 'both');

  const saving = toyPorts();
  saving.save = () => {
    if (saving.state.frame === 12) throw Error('cannot save');
    return JSON.stringify(saving.state);
  };
  const save = createShadowRunner({a: saving, b: toyPorts(), inputs: from(log)}).run();
  const s = save.divergence as Extract<ShadowDivergence, {kind: 'threw'}>;
  assert.deepEqual([s.kind, s.side, s.phase, s.step], ['threw', 'a', 'save', 11]);
});

test('SHADOW reports a restore that does not reproduce its anchor as anchor-mismatch', () => {
  const log = recording(80);
  const runner = createShadowRunner({a: toyPorts(), b: toyPorts(), inputs: from(log), limits: {anchorEvery: 32}});
  assert.equal(runner.run().status, 'agree');
  const anchor = must(runner.anchors().find(x => x.step === 32));
  // An incomplete load: velocities are not restored.
  const partial = toyPorts();
  partial.load = text => {
    const next = JSON.parse(text) as Toy;
    partial.state = {...next, v: next.v.map(() => 0)};
  };
  assert.ok(
    (JSON.parse(anchor.a) as Toy).v.some(v => v !== 0),
    'the anchor has non-zero velocities',
  );
  const r = createShadowRunner({a: toyPorts(), b: partial, inputs: from(log), from: anchor}).run();
  assert.equal(r.status, 'diverged');
  const m = r.divergence as Extract<ShadowDivergence, {kind: 'anchor-mismatch'}>;
  assert.deepEqual(
    [m.kind, m.step, m.side, m.expected, m.a],
    ['anchor-mismatch', 32, 'b', anchor.digest, anchor.digest],
  );
  assert.notEqual(m.b, anchor.digest);
  assert.equal(r.steps, 0);

  const ignoring = () => {
    const p = toyPorts();
    p.load = () => {};
    return p;
  };
  const both = createShadowRunner({a: ignoring(), b: ignoring(), inputs: from(log), from: anchor}).run();
  const bm = both.divergence as Extract<ShadowDivergence, {kind: 'anchor-mismatch'}>;
  assert.equal(bm.side, 'both');
  // Both sides' restored digests are reported (here both still hold the fresh start state).
  assert.equal(bm.a, bm.b);
  assert.notEqual(bm.a, anchor.digest);

  const refusing = toyPorts();
  refusing.load = () => {
    throw Error('bad text');
  };
  const load = createShadowRunner({a: refusing, b: toyPorts(), inputs: from(log), from: anchor}).run();
  const l = load.divergence as Extract<ShadowDivergence, {kind: 'threw'}>;
  assert.deepEqual([l.kind, l.side, l.phase, l.step], ['threw', 'a', 'load', 32]);
});

test('SHADOW enforces the step budget, anchor ring, diff paths and state size', () => {
  const log = recording(100);
  const budget = createShadowRunner({a: toyPorts(), b: toyPorts(), inputs: from(log), limits: {maxSteps: 10}}).run();
  assert.deepEqual([budget.status, budget.steps, budget.next, budget.divergence], ['over-budget', 10, 10, null]);
  // Exactly maxSteps inputs is a pass, not over budget.
  const exact = createShadowRunner({
    a: toyPorts(),
    b: toyPorts(),
    inputs: from(log.slice(0, 10)),
    limits: {maxSteps: 10},
  });
  assert.equal(exact.run().status, 'agree');

  const ring = createShadowRunner({
    a: toyPorts(),
    b: toyPorts(),
    inputs: from(log),
    limits: {anchorEvery: 10, maxAnchors: 3},
  });
  ring.run();
  assert.deepEqual(
    ring.anchors().map(x => x.step),
    [80, 90, 100],
  );
  assert.equal(ring.read().anchorsTaken, 11);
  assert.equal(ring.read().anchorsEvicted, 8);

  const wide = (shift: number): ShadowSide => {
    let s = {t: 0, cells: new Array<number>(40).fill(0)};
    return {
      save: () => JSON.stringify(s),
      load: text => {
        s = JSON.parse(text) as typeof s;
      },
      step: (_inputs, step) => {
        s.t = step + 1;
        if (step === 4) s.cells = s.cells.map((c, i) => c + i + shift);
      },
    };
  };
  const paths = createShadowRunner({a: wide(0), b: wide(1), inputs: from(log), limits: {maxDiffPaths: 5}}).run();
  const d = stateOf(paths.divergence);
  assert.deepEqual(
    d.differences.map(x => x.path),
    ['cells[0]', 'cells[1]', 'cells[2]', 'cells[3]', 'cells[4]'],
  );
  assert.equal(d.truncated, true);

  // The saved state is bounded even when a view is compared.
  const viewed = (pad: number): ShadowSide & ToyPorts => {
    const p = toyPorts();
    return Object.assign(p, {
      save: () => JSON.stringify({...p.state, pad: 'x'.repeat(p.state.frame * pad)}),
      view: () => JSON.stringify(p.state),
    });
  };
  const size = createShadowRunner({
    a: viewed(20),
    b: viewed(0),
    inputs: from(log),
    limits: {state: {maxBytes: 400, maxNodes: 64, maxDepth: 4}},
  }).run();
  const u = size.divergence as Extract<ShadowDivergence, {kind: 'unreadable'}>;
  assert.equal(u.kind, 'unreadable');
  assert.equal(u.side, 'a');
  assert.equal(u.reason, 'over-limit-or-not-json');
  assert.ok(must(u.step) > 0);

  const text = toyPorts();
  text.save = () => 'not json';
  const notJson = createShadowRunner({a: text, b: toyPorts(), inputs: from(log)}).run();
  assert.deepEqual(
    [notJson.divergence?.kind, (notJson.divergence as {step: number | null}).step],
    ['unreadable', null],
  );
});

test('SHADOW rejects invalid configuration with RangeError', () => {
  const ok = {a: toyPorts(), b: toyPorts(), inputs: from(recording(4))};
  for (const limits of [
    {maxSteps: 0},
    {anchorEvery: 1.5},
    {maxAnchors: 5000},
    {maxDiffPaths: 0},
    {maxInputBytes: -1},
    {maxInputsPerStep: 65},
    {maxValueChars: 0},
    {state: {maxBytes: 17 << 20, maxNodes: 1, maxDepth: 1}},
    {state: {maxBytes: 1, maxNodes: 0, maxDepth: 1}},
  ])
    assert.throws(() => createShadowRunner({...ok, limits}), RangeError, JSON.stringify(limits));
  assert.throws(() => createShadowRunner({...ok, a: {save: () => '', load: () => {}} as never}), RangeError);
  assert.throws(() => createShadowRunner({...ok, inputs: [] as never}), RangeError);
  assert.throws(() => createShadowRunner({...ok, from: {step: -1, digest: '', a: '', b: ''}}), RangeError);
  assert.throws(() => createShadowRunner(ok).run(0), RangeError);
});

test('SHADOW stops on cancel or abort with its progress and anchors, and runs in caller slices', () => {
  const log = recording(100);
  const sliced = createShadowRunner({a: toyPorts(), b: toyPorts(), inputs: from(log), limits: {anchorEvery: 10}});
  assert.deepEqual([sliced.run(25).status, sliced.read().steps], ['running', 25]);
  assert.deepEqual([sliced.step().status, sliced.read().next], ['running', 26]);
  sliced.cancel();
  sliced.cancel();
  const c = sliced.run();
  assert.deepEqual([c.status, c.reason, c.steps], ['cancelled', 'cancelled', 26]);
  assert.equal(sliced.anchors().length, 3);

  const controller = new AbortController();
  const a = toyPorts();
  const inner = a.step;
  a.step = (inputs, step) => {
    inner(inputs, step);
    if (step === 40) controller.abort();
  };
  const aborted = createShadowRunner({a, b: toyPorts(), inputs: from(log), signal: controller.signal}).run();
  assert.deepEqual([aborted.status, aborted.reason, aborted.steps], ['cancelled', 'aborted', 41]);
  assert.equal(a.calls.step, 41);
});

test('SHADOW fails on an input source that breaks its contract and refuses re-entry from a side', () => {
  const bad = createShadowRunner({
    a: toyPorts(),
    b: toyPorts(),
    inputs: step => (step === 3 ? ['x'.repeat(20)] : ['n', 'n']),
    limits: {maxInputBytes: 8},
  }).run();
  assert.deepEqual([bad.status, bad.reason, bad.steps], ['failed', 'invalid-input', 3]);
  const empty = createShadowRunner({a: toyPorts(), b: toyPorts(), inputs: () => []}).run();
  assert.equal(empty.reason, 'invalid-input');
  const throwing = createShadowRunner({
    a: toyPorts(),
    b: toyPorts(),
    inputs: () => {
      throw Error('source');
    },
  }).run();
  assert.equal(throwing.status, 'failed');
  assert.match(must(throwing.reason), /inputs-threw: Error: source/);

  const re = toyPorts();
  re.step = () => {
    runner.step();
  };
  const runner = createShadowRunner({a: re, b: toyPorts(), inputs: from(recording(10))});
  const r = runner.run();
  const d = r.divergence as Extract<ShadowDivergence, {kind: 'threw'}>;
  assert.deepEqual([d.kind, d.side, d.phase], ['threw', 'a', 'step']);
  assert.match(d.message, /re-entrant/);
});

test('SHADOW compares a creator view so scratch fields do not count, while anchors keep the full state', () => {
  const log = recording(60);
  const scratchy = (salt: number): ShadowSide & ToyPorts => {
    const p = toyPorts();
    let scratch = salt;
    const inner = p.step;
    return Object.assign(p, {
      save: () => JSON.stringify({...p.state, scratch}),
      load: (text: string) => {
        const {scratch: kept, ...rest} = JSON.parse(text) as Toy & {scratch: number};
        p.state = rest;
        scratch = kept;
      },
      step: (inputs: readonly string[], step: number) => {
        inner(inputs, step);
        scratch += salt;
      },
      view: () => JSON.stringify(p.state),
    });
  };
  const runner = createShadowRunner({a: scratchy(1), b: scratchy(2), inputs: from(log), limits: {anchorEvery: 30}});
  assert.equal(runner.run().status, 'agree');
  const anchor = must(runner.anchors()[1]);
  assert.equal((JSON.parse(anchor.a) as {scratch: number}).scratch, 31);
  assert.equal((JSON.parse(anchor.b) as {scratch: number}).scratch, 62);
  assert.equal(
    createShadowRunner({a: scratchy(1), b: scratchy(2), inputs: from(log), from: anchor}).run().status,
    'agree',
  );
  // Without the view the scratch field is compared and the start already differs.
  const plain = (salt: number): ShadowSide => {
    const {view: _view, ...rest} = scratchy(salt);
    return rest;
  };
  const start = createShadowRunner({a: plain(1), b: plain(2), inputs: from(log)}).run();
  const d = stateOf(start.divergence);
  assert.deepEqual([d.step, d.inputs, d.lastAgreed, must(d.differences[0]).path], [null, null, null, 'scratch']);
});

test('SHADOW difference lists follow the first-difference order and stay bounded', () => {
  const a = JSON.stringify({b: [1, 2, 3], a: {x: 1, y: 'q'}, c: true});
  const b = JSON.stringify({a: {x: 2, z: 0}, b: [1, 5], c: 'yes'});
  const listed = listDifferences(a, b, {maxPaths: 10});
  assert.equal(listed.status, 'listed');
  const all = (listed as Extract<typeof listed, {status: 'listed'}>).differences;
  assert.deepEqual(
    all.map(d => [d.path, d.kind]),
    [
      ['a.x', 'value'],
      ['a.y', 'removed'],
      ['a.z', 'added'],
      ['b[1]', 'value'],
      ['b[2]', 'removed'],
      ['c', 'type'],
    ],
  );
  const first = explainDivergence(0, a, b);
  assert.equal(first.status === 'found' && first.path, must(all[0]).path);
  const two = listDifferences(a, b, {maxPaths: 2});
  assert.equal(two.status === 'listed' && two.truncated, true);
  assert.equal(two.status === 'listed' && two.differences.length, 2);
  assert.deepEqual(listDifferences(a, a), {status: 'unavailable', reason: 'no-difference'});
  assert.deepEqual(listDifferences('{', a), {status: 'unavailable', reason: 'detail-unreadable'});
  const long = listDifferences('{"s":"' + 'x'.repeat(50) + '"}', '{"s":"y"}', {maxValueChars: 10});
  assert.equal(long.status === 'listed' && must(long.differences[0]).a, '"xxxxxxxx…');
  assert.throws(() => listDifferences(a, b, {maxPaths: 0}), RangeError);
});

test('SHADOW reads each input once into its own copy (getter and Proxy cannot swap a value after validation)', () => {
  const seen: unknown[][] = [];
  const recordingSide = (): ShadowSide => {
    const p = toyPorts();
    const inner = p.step;
    p.step = (inputs, step) => {
      seen.push([...inputs]);
      inner(
        inputs.map(i => (i === 'n' || i === 'l' || i === 'r' || i === 'a' ? i : 'n')),
        step,
      );
    };
    return p;
  };
  // A getter that answers 'n' once, then a huge string or a number.
  let reads = 0;
  const tricky: string[] = ['n', 'n'];
  Object.defineProperty(tricky, 0, {
    get: () => (++reads === 1 ? 'n' : reads === 2 ? 'x'.repeat(10 << 20) : 7),
  });
  const getter = createShadowRunner({
    a: recordingSide(),
    b: recordingSide(),
    inputs: s => (s === 0 ? tricky : undefined),
  });
  assert.equal(getter.run().status, 'agree');
  assert.equal(reads, 1);
  assert.deepEqual(seen, [
    ['n', 'n'],
    ['n', 'n'],
  ]);

  seen.length = 0;
  let proxyReads = 0;
  const proxy = new Proxy(['n', 'l'], {
    get(target, key, receiver) {
      if (key === '1') return ++proxyReads === 1 ? 'l' : 42;
      if (key === 'length') return proxyReads === 0 ? 2 : 1e9;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  const proxied = createShadowRunner({
    a: recordingSide(),
    b: recordingSide(),
    inputs: s => (s === 0 ? proxy : undefined),
  });
  assert.equal(proxied.run().status, 'agree');
  assert.equal(proxyReads, 1);
  assert.deepEqual(seen, [
    ['n', 'l'],
    ['n', 'l'],
  ]);

  // Multi-byte inputs are measured in UTF-8 bytes, not code units.
  const euro = (text: string) =>
    createShadowRunner({
      a: toyPorts(),
      b: toyPorts(),
      inputs: s => (s === 0 ? [text, 'n'] : undefined),
      limits: {maxInputBytes: 8},
    }).run();
  assert.equal(euro('\u20ac\u20ac\u20ac').reason, 'invalid-input'); // 9 bytes in 3 code units
  assert.equal(euro('ab\u20ac').status, 'agree'); // 5 bytes
});

test('SHADOW verifyAnchors restores each anchor as it is taken and reports an incomplete load early', () => {
  const log = recording(100);
  const partial = () => {
    const p = toyPorts();
    p.load = text => {
      const next = JSON.parse(text) as Toy;
      p.state = {...next, hits: 0, v: next.v.map(() => 0)};
    };
    return p;
  };
  // Off by default: the live run never calls load, so the incomplete load goes unseen.
  const quiet = createShadowRunner({a: toyPorts(), b: partial(), inputs: from(log), limits: {anchorEvery: 10}}).run();
  assert.equal(quiet.status, 'agree');
  const a = toyPorts();
  const checked = createShadowRunner({
    a,
    b: partial(),
    inputs: from(log),
    limits: {anchorEvery: 10, verifyAnchors: true},
  }).run();
  const m = checked.divergence as Extract<ShadowDivergence, {kind: 'anchor-mismatch'}>;
  assert.equal(m.kind, 'anchor-mismatch');
  assert.equal(m.side, 'b');
  assert.equal(m.step % 10, 0);
  assert.equal(m.a, m.expected);
  assert.notEqual(m.b, m.expected);
  assert.equal(checked.next, m.step);
  assert.ok(a.calls.load >= 1);
  // A complete load passes verification and keeps every anchor.
  const ok = createShadowRunner({
    a: toyPorts(),
    b: toyPorts(),
    inputs: from(log),
    limits: {anchorEvery: 10, verifyAnchors: true},
  });
  assert.equal(ok.run().status, 'agree');
  assert.equal(ok.read().anchorsTaken, 11);
  assert.throws(
    () => createShadowRunner({a: toyPorts(), b: toyPorts(), inputs: from(log), limits: {verifyAnchors: 1 as never}}),
    RangeError,
  );
});

test('SHADOW cancellation from inside a step takes effect after that step, and never hides its divergence', () => {
  const log = recording(60);
  let runner: ReturnType<typeof createShadowRunner>;
  const cancelling = (at: number, diverge: boolean) => {
    const p = toyPorts(2, diverge ? offByOneAt(at) : undefined);
    const inner = p.step;
    p.step = (inputs, step) => {
      inner(inputs, step);
      if (step === at) runner.cancel();
    };
    return p;
  };
  runner = createShadowRunner({a: toyPorts(), b: cancelling(20, true), inputs: from(log)});
  const diverged = runner.run();
  assert.deepEqual([diverged.status, diverged.reason, diverged.divergence?.kind], ['diverged', null, 'state']);
  assert.equal((diverged.divergence as {step: number}).step, 20);

  runner = createShadowRunner({a: toyPorts(), b: cancelling(20, false), inputs: from(log)});
  const cancelled = runner.run();
  assert.deepEqual(
    [cancelled.status, cancelled.reason, cancelled.steps, cancelled.divergence],
    ['cancelled', 'cancelled', 21, null],
  );
  assert.deepEqual(runner.step(), cancelled);
});

test('SHADOW reads anchor fields and side functions once at creation', () => {
  const log = recording(40);
  const source = createShadowRunner({a: toyPorts(), b: toyPorts(), inputs: from(log), limits: {anchorEvery: 16}});
  source.run();
  const anchor = must(source.anchors()[1]);
  const reads: Record<string, number> = {};
  const counted = Object.create(null) as Record<string, unknown>;
  for (const key of ['step', 'digest', 'a', 'b'] as const)
    Object.defineProperty(counted, key, {
      get: () => {
        reads[key] = (reads[key] ?? 0) + 1;
        return anchor[key];
      },
    });
  const a = toyPorts();
  let viewReads = 0;
  const side = Object.defineProperty(toyPorts(), 'view', {
    get: () => {
      viewReads++;
      return () => JSON.stringify(side.state);
    },
  }) as ToyPorts & ShadowSide;
  const runner = createShadowRunner({a, b: side, inputs: from(log), from: counted as ShadowAnchor});
  // Swapping a function after creation has no effect.
  a.step = () => {
    throw Error('swapped');
  };
  assert.equal(runner.run().status, 'agree');
  assert.deepEqual(reads, {step: 1, digest: 1, a: 1, b: 1});
  assert.equal(viewReads, 1);
  // A throwing accessor is a configuration error at creation, not an escape from step().
  const bad = Object.defineProperty(toyPorts(), 'view', {
    get: () => {
      throw Error('getter');
    },
  });
  assert.throws(() => createShadowRunner({a: toyPorts(), b: bad, inputs: from(log)}), /getter/);
});

test('SHADOW bounds the state by nodes and by depth as well as bytes', () => {
  const log = recording(20);
  const shaped = (make: (frame: number) => unknown): ShadowSide & ToyPorts => {
    const p = toyPorts();
    return Object.assign(p, {save: () => JSON.stringify({...p.state, extra: make(p.state.frame)})});
  };
  const nodes = createShadowRunner({
    a: shaped(f => new Array<number>(f * 4).fill(1)),
    b: shaped(f => new Array<number>(f * 4).fill(1)),
    inputs: from(log),
    limits: {state: {maxBytes: 1 << 16, maxNodes: 40, maxDepth: 8}},
  }).run();
  assert.deepEqual([nodes.divergence?.kind, (nodes.divergence as {side: string}).side], ['unreadable', 'both']);
  assert.ok(nodes.steps > 0 && nodes.steps < 20);
  const nest = (d: number): unknown => (d === 0 ? 1 : [nest(d - 1)]);
  const depth = createShadowRunner({
    a: shaped(f => nest(f)),
    b: shaped(() => 1),
    inputs: from(log),
    limits: {state: {maxBytes: 1 << 16, maxNodes: 1 << 12, maxDepth: 6}},
  }).run();
  // Only side a nests, so the views differ (a state divergence) before a reaches the depth limit.
  assert.equal(depth.divergence?.kind, 'state');
  const deep = createShadowRunner({
    a: shaped(f => nest(f)),
    b: shaped(f => nest(f)),
    inputs: from(log),
    limits: {state: {maxBytes: 1 << 16, maxNodes: 1 << 12, maxDepth: 6}},
  }).run();
  const u = deep.divergence as Extract<ShadowDivergence, {kind: 'unreadable'}>;
  assert.deepEqual([u.kind, u.side, u.reason], ['unreadable', 'both', 'over-limit-or-not-json']);
  assert.ok(deep.steps >= 3 && deep.steps <= 6);
});

test('SHADOW difference lists reject invalid limits and preview bounds', () => {
  assert.throws(() => listDifferences('1', '2', {limits: {maxBytes: 0, maxNodes: 1, maxDepth: 1}}), RangeError);
  assert.throws(() => listDifferences('1', '2', {maxValueChars: 5000}), RangeError);
  assert.equal(listDifferences('1', '2', {maxValueChars: 4096}).status, 'listed');
});
