import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStatusEffects, defineStatusRules, statusPresets, StatusError, type StatusEvent} from './index';

const kinds = (events: readonly StatusEvent[]) => events.map(e => `${e.kind}:${e.id}`);

test('rules refuse unknown transforms, cycles, bad policies and bounds', () => {
  assert.throws(() => defineStatusRules([]), StatusError);
  assert.throws(() => defineStatusRules([{id: 'a', threshold: {stacks: 1, become: 'b'}}]), /unknown status b/);
  assert.throws(
    () =>
      defineStatusRules([
        {id: 'a', maxStacks: 2, threshold: {stacks: 2, become: 'b'}},
        {id: 'b', maxStacks: 2, threshold: {stacks: 2, become: 'a'}},
      ]),
    /cycle/,
  );
  assert.throws(() => defineStatusRules([{id: 'a', policy: 'independent'}]), /need a duration/);
  assert.throws(() => defineStatusRules([{id: 'a', maxStacks: 300, duration: 5, policy: 'independent'}]), /maxStacks/);
  assert.throws(() => defineStatusRules([{id: 'a', threshold: {stacks: 2, trigger: 'x'}}]), /threshold.stacks/);
  assert.throws(() => defineStatusRules([{id: 'a'}, {id: 'a'}]), /duplicate/);
  assert.throws(() => defineStatusRules([{id: 'bad id'}]), /invalid status id/);
  for (const preset of Object.values(statusPresets)) defineStatusRules(preset);
});

test('durations run on the fixed clock with refresh, extend and keep policies', () => {
  const rules = defineStatusRules([
    {id: 'refresh', duration: 10},
    {id: 'extend', duration: 10, policy: 'extend', maxDuration: 15},
    {id: 'keep', duration: 10, policy: 'keep'},
  ]);
  const fx = createStatusEffects(rules);
  for (const id of ['refresh', 'extend', 'keep']) fx.apply('t', id);
  fx.advance(6);
  for (const id of ['refresh', 'extend', 'keep']) fx.apply('t', id);
  const expiry = Object.fromEntries(fx.list('t').map(s => [s.id, s.expiresAt]));
  assert.deepEqual(expiry, {extend: 10 + 10, keep: 10, refresh: 16});
  assert.deepEqual(kinds(fx.advance(4)), ['expired:keep']);
  assert.deepEqual(kinds(fx.advance(6)), ['expired:refresh']);
  assert.deepEqual(kinds(fx.advance(4)), ['expired:extend']);
  assert.deepEqual(fx.targets(), [], 'an empty target is forgotten');
});

test('independent stacks expire one by one, periodic events precede expiry', () => {
  const fx = createStatusEffects(defineStatusRules(statusPresets.damageOverTime));
  fx.apply('t', 'poison');
  fx.advance(30);
  fx.apply('t', 'poison', {stacks: 2});
  assert.equal(fx.stacks('t', 'poison'), 3);
  const events = fx.advance(270);
  const periodic = events.filter(e => e.kind === 'periodic');
  assert.deepEqual(
    periodic.map(e => e.stacks),
    [3, 3, 3, 3, 3],
    'pulses every 60 ticks from the first application while any stack lives',
  );
  assert.equal(fx.stacks('t', 'poison'), 2, 'the first stack expired at tick 300');
  assert.deepEqual(kinds(fx.advance(30)), ['expired:poison']);
  fx.apply('t', 'poison', {stacks: 5});
  fx.advance(100);
  fx.apply('t', 'poison');
  assert.equal(fx.stacks('t', 'poison'), 5, 'at the cap a new application refreshes the oldest timer');
  assert.equal(fx.list('t')[0]!.timers[4], fx.now + 300);
});

test('build-up decays, transforms at the threshold, grants immunity after the transformed status', () => {
  const fx = createStatusEffects(defineStatusRules(statusPresets.buildup));
  fx.apply('t', 'chill', {stacks: 60});
  fx.advance(24);
  assert.equal(fx.stacks('t', 'chill'), 50, 'two decay steps of 5');
  assert.deepEqual(fx.contributions('t'), [{key: 'moveSpeed', value: -0.004 * 50, source: 'status:chill'}]);
  const result = fx.apply('t', 'chill', {stacks: 60, source: 'frost-trap'});
  assert.equal(result.outcome, 'applied');
  assert.deepEqual(kinds(result.events), ['stacked:chill', 'consumed:chill', 'transformed:chill', 'applied:frozen']);
  assert.deepEqual(fx.flags('t'), ['disarmed', 'immobile']);
  assert.equal(fx.apply('t', 'chill').outcome, 'applied', 'not immune while frozen');
  fx.remove('t', 'chill');
  const end = fx.advance(180);
  assert.deepEqual(kinds(end), ['expired:frozen']);
  assert.equal(fx.apply('t', 'chill').outcome, 'immune');
  assert.equal(fx.isImmune('t', 'frozen'), true);
  fx.advance(120);
  assert.equal(fx.apply('t', 'chill').outcome, 'applied');
  const burn = fx.apply('u', 'burn', {stacks: 100});
  assert.deepEqual(
    burn.events.map(e => (e.kind === 'triggered' ? `${e.kind}:${e.trigger}` : `${e.kind}:${e.id}`)),
    ['applied:burn', 'triggered:ignite', 'consumed:burn'],
  );
});

test('a target immune to the transform keeps its capped stacks instead', () => {
  const fx = createStatusEffects(defineStatusRules(statusPresets.buildup));
  assert.equal(fx.setImmunity('t', {key: 'charm', ids: ['frozen'], ticks: null}), true);
  const result = fx.apply('t', 'chill', {stacks: 150});
  assert.deepEqual(kinds(result.events), ['applied:chill']);
  assert.equal(fx.stacks('t', 'chill'), 100);
  assert.equal(fx.clearImmunity('t', 'charm'), true);
  assert.deepEqual(kinds(fx.apply('t', 'chill').events), [
    'stacked:chill',
    'consumed:chill',
    'transformed:chill',
    'applied:frozen',
  ]);
});

test('exclusive groups block or replace; tag immunity and cleanse', () => {
  const fx = createStatusEffects(defineStatusRules(statusPresets.exclusiveAilments));
  assert.equal(fx.apply('t', 'asleep').outcome, 'applied');
  const blocked = fx.apply('t', 'burned');
  assert.equal(blocked.outcome, 'blocked');
  assert.deepEqual(blocked.events, []);
  assert.equal(fx.has('t', 'burned'), false);
  const replacing = createStatusEffects(
    defineStatusRules([
      {id: 'a', group: 'stance'},
      {id: 'b', group: 'stance', groupPolicy: 'replace'},
    ]),
  );
  replacing.apply('t', 'a');
  assert.deepEqual(kinds(replacing.apply('t', 'b').events), ['replaced:a', 'applied:b']);
  assert.deepEqual(kinds(fx.cleanse('t', 'ailment')), ['removed:asleep']);
  fx.setImmunity('t', {key: 'charm', tags: ['ailment'], ticks: 10});
  assert.equal(fx.apply('t', 'poisoned').outcome, 'immune');
  fx.advance(10);
  assert.equal(fx.apply('t', 'poisoned').outcome, 'applied');
});

test('capacity outcomes change nothing; advance is bounded and atomic', () => {
  const rules = defineStatusRules([{id: 'a'}, {id: 'b'}, {id: 'c', duration: 1}]);
  const fx = createStatusEffects(rules, {maxTargets: 1, maxPerTarget: 2, maxAdvance: 10});
  fx.apply('t', 'a');
  fx.apply('t', 'b');
  const before = fx.snapshot();
  assert.equal(fx.apply('t', 'c').outcome, 'capacity');
  assert.equal(fx.apply('other', 'a').outcome, 'capacity');
  assert.equal(fx.setImmunity('other', {key: 'k', ids: ['a'], ticks: 5}), false);
  assert.deepEqual(fx.snapshot(), before);
  assert.throws(() => fx.advance(11), /1\.\.10/);
  assert.throws(() => fx.apply('t', 'nope'), /unknown status/);
  assert.throws(() => fx.apply('t', 'a', {stacks: 0}), /stacks/);
});

test('snapshot and restore continue identically; incompatible or malformed snapshots are refused', () => {
  const rules = defineStatusRules([...statusPresets.buildup, ...statusPresets.damageOverTime]);
  const run = (fx: ReturnType<typeof createStatusEffects>) => {
    const log: string[] = [];
    for (let i = 0; i < 40; i++) {
      if (i % 7 === 0) fx.apply('a', 'chill', {stacks: 30});
      if (i % 11 === 0) fx.apply('b', 'poison');
      for (const e of fx.advance(9)) log.push(`${fx.now}:${e.kind}:${e.target}:${e.id}`);
    }
    return log;
  };
  const original = createStatusEffects(rules);
  original.apply('a', 'burn', {stacks: 40});
  original.advance(5);
  const saved = JSON.parse(JSON.stringify(original.snapshot()));
  const expected = run(original);
  const restored = createStatusEffects(rules);
  restored.restore(saved);
  assert.deepEqual(run(restored), expected);
  const other = createStatusEffects(defineStatusRules(statusPresets.damageOverTime));
  assert.throws(() => other.restore(saved), /different status rules/);
  const broken = structuredClone(saved);
  broken.targets[0].statuses[0].stacks = 999;
  const fresh = createStatusEffects(rules);
  assert.throws(() => fresh.restore(broken), /invalid stacks/);
  assert.deepEqual(fresh.targets(), [], 'a refused restore changes nothing');
  const extra = structuredClone(saved);
  extra.targets[0].hack = 1;
  assert.throws(() => fresh.restore(extra), /unexpected fields/);
});

test('removing a target is cancellation: no events and no after-immunity', () => {
  const fx = createStatusEffects(defineStatusRules(statusPresets.controlImmunity));
  fx.apply('t', 'stunned');
  assert.equal(fx.removeTarget('t'), true);
  assert.equal(fx.apply('t', 'stunned').outcome, 'applied');
  assert.deepEqual(kinds(fx.remove('t', 'stunned')), ['removed:stunned']);
  assert.equal(fx.apply('t', 'stunned').outcome, 'applied', 'manual removal grants no after-immunity');
  fx.advance(90);
  assert.equal(fx.apply('t', 'stunned').outcome, 'immune', 'expiry does');
});

test('review: a refused transform keeps the source capped and emits nothing beyond the stacking', () => {
  const rules = defineStatusRules([
    {id: 'chill', maxStacks: 3, threshold: {stacks: 3, become: 'frozen', trigger: 'shatter'}},
    {id: 'frozen', group: 'major', tags: ['cold']},
    {id: 'asleep', group: 'major'},
    {
      id: 'spark',
      maxStacks: 2,
      threshold: {stacks: 2, become: 'charged'},
      tags: ['volt'],
      afterImmunity: {tags: ['volt'], ticks: 5},
    },
    {id: 'charged', tags: ['volt']},
  ]);
  const fx = createStatusEffects(rules);
  fx.apply('t', 'asleep');
  const blocked = fx.apply('t', 'chill', {stacks: 5});
  assert.equal(blocked.outcome, 'applied');
  assert.deepEqual(kinds(blocked.events), ['applied:chill']);
  assert.equal(fx.stacks('t', 'chill'), 3);
  const self = fx.apply('u', 'spark', {stacks: 2});
  assert.deepEqual(
    kinds(self.events),
    ['applied:spark'],
    "the consumed status's own after-immunity refuses the transform",
  );
  assert.equal(fx.stacks('u', 'spark'), 2);
});

test('review: partial losses are events with remaining stacks; multiple cap refreshes', () => {
  const fx = createStatusEffects(
    defineStatusRules([
      {id: 'dot', maxStacks: 3, duration: 10, policy: 'independent'},
      {id: 'heap', maxStacks: 10, decay: {every: 2, stacks: 3}},
    ]),
  );
  fx.apply('t', 'dot');
  fx.advance(5);
  fx.apply('t', 'dot', {stacks: 2});
  fx.apply('t', 'heap', {stacks: 10});
  const events = fx.advance(5);
  assert.deepEqual(
    events.map(e => ('remaining' in e ? `${e.kind}:${e.id}:${e.stacks}:${e.remaining}` : e.kind)),
    ['decayed:heap:3:7', 'decayed:heap:3:4', 'expired:dot:1:2'],
  );
  fx.apply('t', 'dot', {stacks: 3});
  assert.deepEqual(
    fx.list('t').find(s => s.id === 'dot')!.timers,
    [20, 20, 20],
    'three surplus applications refresh three timers',
  );
  assert.deepEqual(
    fx.remove('t', 'heap', 1).map(e => ('remaining' in e ? e.remaining : -1)),
    [3],
  );
});

test('review: rules must come from defineStatusRules; bounds round-trip through snapshots', () => {
  const rules = defineStatusRules([
    {id: 'x'.repeat(64), duration: 5, afterImmunity: {tags: Array.from({length: 32}, (_, i) => `t${i}`), ticks: 9}},
  ]);
  assert.throws(() => createStatusEffects({statuses: rules.statuses, signature: rules.signature}), /defineStatusRules/);
  assert.ok(Object.isFrozen(rules.statuses));
  const fx = createStatusEffects(rules);
  fx.apply('t', 'x'.repeat(64));
  fx.setImmunity('t', {key: 'gear', tags: Array.from({length: 64}, (_, i) => `g${i}`), ticks: null});
  assert.throws(
    () => fx.setImmunity('t', {key: 'big', tags: Array.from({length: 65}, (_, i) => `g${i}`), ticks: 1}),
    /at most 64/,
  );
  assert.throws(() => fx.setImmunity('t', {key: 'after:x', tags: ['a'], ticks: 1}), /reserved/);
  fx.advance(5);
  const saved = JSON.parse(JSON.stringify(fx.snapshot()));
  assert.equal(saved.targets[0].immunities.length, 2);
  const again = createStatusEffects(rules);
  again.restore(saved);
  assert.deepEqual(again.snapshot(), fx.snapshot());
  const stretched = structuredClone(saved);
  stretched.targets[0].immunities[0].until = 2 ** 40;
  assert.doesNotThrow(() => createStatusEffects(rules).restore(stretched));
  const live = createStatusEffects(rules);
  live.apply('t', 'x'.repeat(64));
  const bad = JSON.parse(JSON.stringify(live.snapshot()));
  bad.targets[0].statuses[0].expiresAt = 2 ** 49;
  assert.throws(() => createStatusEffects(rules).restore(bad), /invalid expiry/);
  assert.throws(() => live.apply('t', 'x'.repeat(64), null as never), /object/);
});
