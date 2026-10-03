import test from 'node:test';
import assert from 'node:assert/strict';
import {defineComponent, defineEntity, defineScene, defineSystem, Transform} from '../../author';
import {World} from '../../core/ecs/world';
import steer from '../../../templates/arcade/game/steer';
import {compareDigests, createDigestTrace} from './digest';
import {explainDivergence} from './explain';
import {hashText} from './hash';
import type {OpenLimits} from './log';
import {recordSceneRun, replaySceneLog, sceneReplayDigest, worldDigest, WORLD_DIGEST_LIMITS} from './scene';
import {observeWorld, replayDigest, replayStateText, selectWorldState, toReplayDigest} from './state';
import {must} from '../../testing/must';

const Cosmetic = defineComponent('cosmetic', {});
const Score = defineComponent('score', {value: 0});

function world() {
  const w = new World();
  w.resources.round = 2;
  w.resources.secret = 'x';
  const a = w.spawn(Transform({x: 1}), Score({value: 3}));
  const orb = w.spawn(Transform({y: 1}), Cosmetic());
  const b = w.spawn(Score({value: 9}));
  return {w, a, orb, b};
}

test('SIM-02 replay digest: a selection lists chosen components per entity, without excluded entities', () => {
  const {w, a, b} = world();
  const t = (x = 1) => ({x, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1});
  assert.deepEqual(JSON.parse(JSON.stringify(selectWorldState(w, {exclude: [Cosmetic]}))), {
    entities: [[a, {transform: t()}]],
    resources: {round: 2, secret: 'x'},
  });
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        selectWorldState(w, {
          components: ['transform', 'score'],
          exclude: ['cosmetic'],
          resources: ['round', 'missing'],
          count: true,
        }),
      ),
    ),
    {
      entities: [
        [a, {transform: t(), score: {value: 3}}],
        [b, {score: {value: 9}}],
      ],
      resources: {round: 2},
      count: 3,
    },
  );
  assert.deepEqual(selectWorldState(w, {components: [], resources: false}), {entities: []});
  // Entities are in id order whatever the component order.
  const ids = (selectWorldState(w, {components: [Score, Transform]}).entities as [number][]).map(([e]) => e);
  assert.deepEqual(
    ids,
    [...ids].sort((x, y) => x - y),
  );
});

test('SIM-02 replay digest: ids describe the selection, long ones are hashed, and invalid digests are refused', () => {
  assert.equal(replayDigest().id, 'select:c=transform;x=;r=all');
  assert.equal(
    replayDigest({components: [Score], exclude: [Cosmetic], resources: ['b', 'a'], count: true}).id,
    'select:c=score;x=cosmetic;r=a,b;n',
  );
  assert.equal(replayDigest({resources: false, id: 'mine-v2'}).id, 'mine-v2');
  assert.match(replayDigest({resources: ['a key with spaces']}).id, /^select:[0-9a-f]{16}$/);
  assert.match(
    replayDigest({components: Array.from({length: 40}, (_, i) => `component-${i}`)}).id,
    /^select:[0-9a-f]{16}$/,
  );
  const named = {id: 'custom', state: (w: World) => w.count};
  assert.equal(toReplayDigest(named).id, 'custom');
  for (const bad of [
    {id: '', state: () => 1},
    {id: 'a'.repeat(129), state: () => 1},
    {id: 'ok', state: 1},
    {id: 'bad id'},
    {components: [1]},
    {components: ['x', 'x']},
    {resources: 'all'},
    {resources: Array.from({length: 257}, (_, i) => `k${i}`)},
    {count: 'yes'},
  ]) {
    assert.throws(() => toReplayDigest(bad as never), /replay digest/, JSON.stringify(bad));
  }
  assert.throws(() => replayDigest({components: ['Not-Kebab']}), /kebab/);
  assert.throws(
    () => defineScene({id: 'bad', title: 'Bad', replay: {digest: {id: 'no spaces allowed', state: () => 1}}}),
    /replay\.digest/,
  );
  assert.throws(() => defineScene({id: 'bad', title: 'Bad', replay: {digest: {id: 'ok'} as never}}), /replay\.digest/);
  assert.equal(defineScene({id: 'good', title: 'Good', replay: {digest: named}}).replay?.digest, named);
});

test('SIM-02 replay digest: the digest is the hash of the canonical state text, which is also the detail', () => {
  const {w, orb} = world();
  const d = replayDigest({exclude: [Cosmetic]});
  const trace = createDigestTrace({
    identity: 'i',
    every: 1,
    maxEntries: 8,
    maxDigestLength: 16,
    detail: {from: 0, to: 8, maxChars: 1 << 16},
  });
  let calls = 0;
  const counted = {
    id: d.id,
    state: (x: World) => {
      calls++;
      return d.state(x);
    },
  };
  let seen: string | null = null;
  assert.equal(
    observeWorld(trace, 0, w, counted, WORLD_DIGEST_LIMITS, worldDigest, v => {
      seen = v;
    }),
    'sampled',
  );
  assert.equal(calls, 1, 'one state read serves both the digest and the detail');
  const snap = trace.read();
  assert.equal(must(snap.entries[0])[1], hashText(must(snap.details[0])[1]));
  assert.equal(seen, must(snap.entries[0])[1]);
  assert.equal(must(snap.details[0])[1], replayStateText(w, d, WORLD_DIGEST_LIMITS));
  // The cosmetic entity does not move the digest; a selected component does.
  w.get(orb, Transform)!.y = 5;
  assert.equal(hashText(replayStateText(w, d, WORLD_DIGEST_LIMITS)), must(snap.entries[0])[1]);
  w.get(1, Transform)!.x = 2;
  assert.notEqual(hashText(replayStateText(w, d, WORLD_DIGEST_LIMITS)), must(snap.entries[0])[1]);
  // Without a creator digest, the default world digest is kept and the detail shows its coverage.
  const plain = createDigestTrace({
    identity: 'i',
    every: 1,
    maxEntries: 8,
    maxDigestLength: 16,
    detail: {from: 0, to: 8, maxChars: 1 << 16},
  });
  observeWorld(plain, 0, w, null, WORLD_DIGEST_LIMITS, worldDigest);
  assert.equal(must(plain.read().entries[0])[1], worldDigest(w));
  assert.deepEqual(Object.keys(JSON.parse(must(plain.read().details[0])[1])), ['count', 'entities', 'resources']);
});

test('SIM-02 replay digest: a divergence names the first differing entity, component and field', () => {
  const base = {
    entities: [
      [1, {score: {value: 3}, transform: {x: 1, y: 0}}],
      [4, {transform: {x: 0, y: 0}}],
    ],
    resources: {round: 2, nest: {a: [1, 2]}},
  };
  const text = (v: unknown) => JSON.stringify(v);
  const edit = (f: (v: typeof base) => void) => {
    const v = structuredClone(base);
    f(v);
    return text(v);
  };
  const found = (b: string) => explainDivergence(7, text(base), b);
  assert.deepEqual(
    found(
      edit(v => {
        (must(v.entities[1])[1] as {transform: {y: number}}).transform.y = 0.5;
      }),
    ),
    {
      status: 'found',
      tick: 7,
      kind: 'value',
      path: 'entities[1][1].transform.y',
      entity: 4,
      component: 'transform',
      field: 'y',
      resource: null,
      a: '0',
      b: '0.5',
    },
  );
  // The first difference in canonical order wins: entity 1 (score before transform), not entity 4.
  const two = found(
    edit(v => {
      (must(v.entities[0])[1] as {score: {value: number}}).score.value = 4;
      (must(v.entities[1])[1] as {transform: {x: number}}).transform.x = 9;
    }),
  );
  assert.deepEqual(two.status === 'found' && [two.entity, two.component, two.field], [1, 'score', 'value']);
  // A component present on one side only.
  const missing = found(
    edit(v => {
      delete (must(v.entities[0])[1] as {score?: unknown}).score;
    }),
  );
  assert.deepEqual(
    missing.status === 'found' && [
      missing.kind,
      missing.entity,
      missing.component,
      missing.field,
      missing.a,
      missing.b,
    ],
    ['removed', 1, 'score', null, '{"value":3}', null],
  );
  // Entity sets: an extra entity, a missing entity, a different entity at the same position.
  const extra = found(
    edit(v => {
      v.entities.push([9, {transform: {x: 0, y: 0}}]);
    }),
  );
  assert.deepEqual(extra.status === 'found' && [extra.kind, extra.entity, extra.path, extra.a], [
    'entity-set',
    9,
    'entities[2]',
    null,
  ]);
  const gone = found(
    edit(v => {
      v.entities.pop();
    }),
  );
  assert.deepEqual(gone.status === 'found' && [gone.kind, gone.entity, gone.b], ['entity-set', 4, null]);
  const swapped = found(
    edit(v => {
      must(v.entities[1])[0] = 5;
    }),
  );
  assert.deepEqual(swapped.status === 'found' && [swapped.kind, swapped.entity], ['entity-set', 4]);
  // Resources, nested fields, type changes.
  const res = found(
    edit(v => {
      v.resources.nest.a[1] = 3;
    }),
  );
  assert.deepEqual(res.status === 'found' && [res.kind, res.resource, res.field, res.entity], [
    'value',
    'nest',
    'a[1]',
    null,
  ]);
  const typed = found(
    edit(v => {
      (v.resources as Record<string, unknown>).round = '2';
    }),
  );
  assert.deepEqual(typed.status === 'found' && [typed.kind, typed.resource, typed.a, typed.b], [
    'type',
    'round',
    '2',
    '"2"',
  ]);
  // A shape that is not a selection: the path is still named.
  const generic = explainDivergence(1, '{"a":[1,{"b c":2}]}', '{"a":[1,{"b c":3}]}');
  assert.deepEqual(generic.status === 'found' && [generic.path, generic.entity, generic.component], [
    'a[1]["b c"]',
    null,
    null,
  ]);
  // Previews are bounded.
  const long = explainDivergence(1, text({s: 'x'.repeat(1000)}), text({s: 'y'}), {maxValueChars: 20});
  assert.equal(long.status === 'found' && long.a!.length, 20);
  // Unavailable explanations are explicit.
  assert.deepEqual(explainDivergence(3, null, '{}'), {status: 'unavailable', tick: 3, reason: 'no-detail'});
  assert.deepEqual(explainDivergence(3, '{"a":', '{}'), {status: 'unavailable', tick: 3, reason: 'detail-unreadable'});
  assert.deepEqual(explainDivergence(3, '{"a":[1]}', '{"a":[1]}'), {
    status: 'unavailable',
    tick: 3,
    reason: 'no-difference',
  });
  const deep = '['.repeat(40) + ']'.repeat(40);
  assert.deepEqual(
    explainDivergence(3, deep, deep),
    {status: 'unavailable', tick: 3, reason: 'detail-unreadable'},
    'depth is bounded',
  );
  assert.deepEqual(
    explainDivergence(3, text({s: 'x'.repeat(200)}), '{}', {limits: {maxBytes: 64, maxNodes: 16, maxDepth: 4}}),
    {status: 'unavailable', tick: 3, reason: 'detail-unreadable'},
    'size is bounded',
  );
});

// A headless scene in the demo's shape: a player steered on the fixed lane, a cosmetic orb bobbed on frame time.
const Orb = defineEntity({id: 'orb', components: [Transform({y: 1}), Cosmetic()]});
const Player = defineEntity({id: 'player', components: [Transform(), Score()]});
function orbScene(digest?: ReturnType<typeof replayDigest>) {
  return defineScene({
    id: 'orb-arena',
    title: 'Orb arena',
    entities: [Player, Orb],
    ...(digest ? {replay: {digest}} : {}),
    systems: [
      defineSystem({
        id: 'move',
        run(ctx, dt) {
          for (const [, t, s] of ctx.world.query(Transform, Score)) {
            t.x += ctx.input.axis('steer') * dt + ctx.random() * 0.001;
            if (t.x > 0.5) s.value = 1;
          }
        },
      }),
      defineSystem({
        id: 'bob',
        phase: 'frame',
        run(ctx) {
          for (const [, t] of ctx.world.query(Transform, Cosmetic)) t.y = 1 + Math.sin(ctx.time.t * 3) * 0.25;
        },
      }),
    ],
  });
}
const limits = {maxTicks: 400, maxBytes: 65536, input: {maxBytes: 512, maxNodes: 32, maxDepth: 4}};
const open: OpenLimits = {...limits, log: {maxBytes: 1 << 22, maxNodes: 1 << 18, maxDepth: 8}};
const trace = {every: 1, maxEntries: 400, maxDigestLength: 16, detail: {from: 0, to: 400, maxChars: 1 << 20}};
const script = (tick: number) => ({axes: {steer: tick < 100 ? 1 : -1}});
/** The browser's frame grouping is not in the log: the replay's frame-phase orb runs at another phase, as it would there. */
const regroup = defineSystem({
  id: 'regroup',
  run(ctx) {
    for (const [, t] of ctx.world.query(Transform, Cosmetic)) t.y += 0.01;
  },
});

test('SIM-02 replay digest: headless, the demo case diverges by default and replays exactly with the scene digest', async () => {
  const inputs = [steer];
  const plain = orbScene();
  const recorded = await recordSceneRun(plain, {inputs, seed: 3, ticks: 200, limits, script, trace});
  const diverged = await replaySceneLog(plain, {inputs, log: recorded.log, limits: open, trace, systems: [regroup]});
  assert.equal(diverged.status, 'replayed');
  if (diverged.status !== 'replayed') return;
  assert.deepEqual(
    diverged.comparison &&
      diverged.comparison.status === 'diverged' && [diverged.comparison.tick, diverged.comparison.exact],
    [0, true],
  );
  const d = diverged.divergence;
  assert.deepEqual(d?.status === 'found' && [d.entity, d.component, d.field], [2, 'transform', 'y'], JSON.stringify(d));

  const digest = replayDigest({components: [Transform, Score], exclude: [Cosmetic]});
  const scene = orbScene(digest);
  assert.equal(sceneReplayDigest(scene)?.id, digest.id);
  const rec = await recordSceneRun(scene, {inputs, seed: 3, ticks: 200, limits, script, trace});
  assert.match(rec.digests.identity, /\|digest:select:c=transform,score;x=cosmetic;r=all$/);
  const exact = await replaySceneLog(scene, {inputs, log: rec.log, limits: open, trace, systems: [regroup]});
  assert.equal(exact.status, 'replayed');
  if (exact.status !== 'replayed') return;
  assert.deepEqual(exact.comparison, {status: 'equal', from: 0, through: 199, samples: 200});
  assert.equal(exact.divergence, null);
  assert.ok(
    new Set(exact.digests.entries.map(([, h]) => h)).size > 150,
    'the selected state does change: the pass is not vacuous',
  );

  // A gameplay fault is still found and named under the scene digest.
  let n = 0;
  const fault = defineSystem({
    id: 'fault',
    run(ctx) {
      if (n++ === 42) for (const [, s] of ctx.world.query(Score)) s.value = 7;
    },
  });
  const caught = await replaySceneLog(scene, {inputs, log: rec.log, limits: open, trace, systems: [regroup, fault]});
  assert.equal(caught.status === 'replayed' && caught.comparison?.status, 'diverged');
  const f = caught.status === 'replayed' ? caught.divergence : null;
  assert.deepEqual(f?.status === 'found' && [f.tick, f.entity, f.component, f.field, f.a, f.b], [
    42,
    1,
    'score',
    'value',
    '1',
    '7',
  ]);

  // A log recorded under the scene digest is not comparable with the default digest (identity differs).
  const other = await replaySceneLog(scene, {
    inputs,
    log: rec.log,
    limits: open,
    trace,
    digest: ctx => worldDigest(ctx.world),
  });
  assert.deepEqual(other.status === 'replayed' && other.comparison, {status: 'incomparable', reason: 'identity'});
  // The caller's selection overrides the scene's and must match the log's.
  const overridden = await replaySceneLog(scene, {
    inputs,
    log: rec.log,
    limits: open,
    trace,
    replayDigest: {components: [Score]},
  });
  assert.deepEqual(overridden.status === 'replayed' && overridden.comparison, {
    status: 'incomparable',
    reason: 'identity',
  });
  const same = await replaySceneLog(plain, {
    inputs,
    log: rec.log,
    limits: open,
    trace,
    replayDigest: digest,
    systems: [regroup],
  });
  assert.deepEqual(same.status === 'replayed' && same.comparison?.status, 'equal');
});

test('SIM-02 replay digest: identities without a named digest are unchanged', async () => {
  const rec = await recordSceneRun(orbScene(), {
    inputs: [steer],
    seed: 3,
    ticks: 5,
    limits,
    script,
    trace: {every: 1, maxEntries: 5, maxDigestLength: 16},
  });
  assert.equal(rec.digests.identity, 'test|scene:orb-arena;inputs:steer~|seed:3');
  assert.deepEqual(rec.digests.details, [], 'no detail without a window');
  assert.equal(compareDigests(rec.digests, rec.digests).status, 'equal');
});

test('SIM-02 replay digest: inherited key names (constructor, toString) are ordinary keys to the explainer', async () => {
  const removed = explainDivergence(1, '{"constructor":1}', '{}');
  assert.deepEqual(removed.status === 'found' && [removed.kind, removed.path, removed.a, removed.b], [
    'removed',
    'constructor',
    '1',
    null,
  ]);
  const added = explainDivergence(1, '{}', '{"toString":{"valueOf":2}}');
  assert.deepEqual(added.status === 'found' && [added.kind, added.path], ['added', 'toString']);
  const rows = (k: string) => JSON.stringify({entities: [[1, {[k]: {x: 1}}]]});
  const comp = explainDivergence(1, rows('constructor'), rows('hasOwnProperty'));
  assert.deepEqual(comp.status === 'found' && [comp.kind, comp.entity, comp.component], ['removed', 1, 'constructor']);
  // Headless: a resource called `constructor` present only in the recording is reported, not thrown.
  const digest = {id: 'resources-v1', state: (w: World) => ({...w.resources})};
  const scene = orbScene();
  const mark = defineSystem({
    id: 'mark',
    run(ctx) {
      Object.assign(ctx.world.resources, {constructor: 1});
    },
  });
  const rec = await recordSceneRun(scene, {
    inputs: [steer],
    seed: 3,
    ticks: 20,
    limits,
    script,
    trace,
    replayDigest: digest,
    systems: [mark],
  });
  const replayed = await replaySceneLog(scene, {
    inputs: [steer],
    log: rec.log,
    limits: open,
    trace,
    replayDigest: digest,
  });
  assert.equal(replayed.status, 'replayed');
  const d = replayed.status === 'replayed' ? replayed.divergence : null;
  assert.deepEqual(d?.status === 'found' && [d.tick, d.kind, d.path], [0, 'removed', 'constructor']);
});

test('SIM-02 replay digest: coverage flags a selected component no entity has (a misspelt id)', async () => {
  const typo = replayDigest({components: ['transform', 'scroe'], exclude: [Cosmetic]});
  const rec = await recordSceneRun(orbScene(), {
    inputs: [steer],
    seed: 3,
    ticks: 30,
    limits,
    script,
    trace,
    replayDigest: typo,
  });
  assert.deepEqual(rec.coverage, {
    firstTick: 0,
    samples: 30,
    entities: 1,
    components: {transform: 1, scroe: 0},
    unmatched: ['scroe'],
  });
  const replayed = await replaySceneLog(orbScene(), {
    inputs: [steer],
    log: rec.log,
    limits: open,
    trace,
    replayDigest: typo,
  });
  assert.deepEqual(
    replayed.status === 'replayed' && [replayed.comparison?.status, replayed.coverage?.unmatched],
    ['equal', ['scroe']],
    'equal, but flagged: the misspelt part of the digest was constant',
  );
  const good = await recordSceneRun(orbScene(), {
    inputs: [steer],
    seed: 3,
    ticks: 5,
    limits,
    script,
    trace,
    replayDigest: {components: [Transform, Score]},
  });
  assert.deepEqual(good.coverage?.unmatched, []);
  assert.equal(good.coverage?.entities, 2, 'without an exclusion the cosmetic orb is listed too');
  const custom = await recordSceneRun(orbScene(), {
    inputs: [steer],
    seed: 3,
    ticks: 5,
    limits,
    script,
    trace,
    replayDigest: {id: 'c', state: w => w.count},
  });
  assert.equal(custom.coverage, null, 'a creator function owns its coverage');
  assert.equal(
    (await recordSceneRun(orbScene(), {inputs: [steer], seed: 3, ticks: 5, limits, script, trace})).coverage,
    null,
  );
});
