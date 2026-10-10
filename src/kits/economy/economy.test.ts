import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEconomy, defineEconomyRules, economyPresets, EconomyError, RATE_ONE} from './index';

const rules2 = (costModel: 'upfront' | 'streamed') =>
  defineEconomyRules({
    costModel,
    resources: [
      {id: 'metal', capacity: 1000, initial: 100},
      {id: 'energy', capacity: 1000, initial: 1000},
    ],
    items: [
      {id: 'unit', cost: {metal: 100, energy: 50}, work: 10},
      {id: 'lab', cost: {metal: 10}, work: 2, grants: ['tier-2']},
      {id: 'heavy', cost: {metal: 10}, work: 2, requires: ['tier-2']},
    ],
  });

test('rules refuse unknown resources, duplicates and bad numbers; owners need defined rules', () => {
  assert.throws(() => defineEconomyRules({resources: [], items: []}), EconomyError);
  assert.throws(
    () => defineEconomyRules({resources: [{id: 'a', capacity: 1}], items: [{id: 'x', cost: {b: 1}, work: 1}]}),
    /unknown resource b/,
  );
  assert.throws(() => defineEconomyRules({resources: [{id: 'a', capacity: 1, initial: 2}], items: []}), /initial/);
  assert.throws(
    () =>
      defineEconomyRules({
        resources: [
          {id: 'a', capacity: 1},
          {id: 'a', capacity: 1},
        ],
        items: [],
      }),
    /duplicate/,
  );
  assert.throws(
    () => defineEconomyRules({resources: [{id: 'a', capacity: 1}], items: [{id: 'x', cost: {}, work: 0}]}),
    /work/,
  );
  const rules = rules2('upfront');
  assert.throws(() => createEconomy({...rules}), /defineEconomyRules/);
  for (const preset of Object.values(economyPresets)) createEconomy(defineEconomyRules(preset));
});

test('income fills storage and wastes overflow; upkeep drains and reports shortfall', () => {
  const eco = createEconomy(rules2('upfront'));
  eco.setIncome('mine', {metal: 300});
  eco.setIncome('drain', {energy: -400});
  const {reports} = eco.advance(4);
  assert.deepEqual(
    reports.map(r => r.income),
    [{metal: 300, energy: -400}, {metal: 300, energy: -400}, {metal: 300, energy: -200}, {metal: 0}].map(x =>
      Object.fromEntries(Object.entries(x).filter(([, v]) => v !== 0)),
    ),
  );
  assert.deepEqual(reports[2]!.shortfall, {energy: 200});
  assert.deepEqual(reports[3]!.wasted, {metal: 300});
  assert.deepEqual(eco.stock(), {energy: 0, metal: 1000});
  eco.setStorage('silo', {metal: 500});
  eco.advance(1);
  assert.equal(eco.stock().metal, 1300);
  assert.equal(eco.removeSource('silo'), true);
  assert.equal(eco.stock().metal, 1300, 'shrinking storage keeps stock');
});

test('upfront queues wait for stock, pay once, complete after their work and repeat', () => {
  const eco = createEconomy(rules2('upfront'));
  eco.setQueue('factory');
  assert.equal(eco.enqueue('factory', 'unit', {count: 2}), true);
  eco.withdraw({metal: 50});
  let out = eco.advance(1);
  assert.equal(eco.queue('factory')!.state, 'waiting');
  eco.deposit({metal: 50});
  out = eco.advance(1);
  assert.deepEqual(out.events, [{kind: 'started', queue: 'factory', item: 'unit'}]);
  assert.deepEqual(out.reports[0]!.spent, {energy: 50, metal: 100});
  out = eco.advance(9);
  assert.deepEqual(out.events, [{kind: 'completed', queue: 'factory', item: 'unit'}], 'ten ticks at rate 1,000');
  assert.equal(eco.queue('factory')!.state, 'waiting', 'the second entry waits for metal');
  eco.setQueue('factory', 0);
  assert.equal(eco.queue('factory')!.state, 'paused');
});

test('prerequisites block until granted; destroying the grant blocks again', () => {
  const eco = createEconomy(rules2('upfront'));
  eco.setQueue('q');
  eco.enqueue('q', 'heavy');
  eco.advance(3);
  assert.equal(eco.queue('q')!.state, 'blocked');
  assert.equal(eco.canBuild('heavy'), false);
  eco.setQueue('lab-q');
  eco.enqueue('lab-q', 'lab');
  const out = eco.advance(2);
  assert.ok(out.events.some(e => e.kind === 'completed' && e.item === 'lab'));
  assert.deepEqual(eco.unlocks(), {'tier-2': 1});
  eco.advance(1);
  assert.equal(eco.queue('q')!.state, 'building');
  eco.adjustUnlock('tier-2', -1);
  eco.enqueue('q', 'heavy');
  eco.advance(2);
  assert.equal(eco.queue('q')!.state, 'blocked', 'the next entry needs the unlock again');
});

test('streamed cost: proportional payment, equal slowdown when short, exact totals at completion', () => {
  const rules = defineEconomyRules({
    costModel: 'streamed',
    resources: [{id: 'm', capacity: 10_000, initial: 0}],
    items: [{id: 'a', cost: {m: 1000}, work: 10}],
  });
  const eco = createEconomy(rules);
  eco.setQueue('q1');
  eco.setQueue('q2');
  eco.enqueue('q1', 'a');
  eco.enqueue('q2', 'a');
  eco.setIncome('flow', {m: 100}); // half of what two builders need per tick
  let spent = 0;
  for (let i = 0; i < 10; i++) spent += eco.advance(1).reports[0]!.spent.m ?? 0;
  const [q1, q2] = eco.queues();
  assert.equal(q1!.progress, q2!.progress, 'both slow equally');
  assert.equal(q1!.paid.m, Math.floor((1000 * q1!.progress) / (10 * RATE_ONE)));
  assert.equal(q1!.progress, 5000, 'half speed');
  assert.equal(spent + eco.stock().m!, 10 * 100, 'nothing is created or destroyed');
  let completed = 0;
  for (let i = 0; i < 30; i++) completed += eco.advance(1).events.filter(e => e.kind === 'completed').length;
  assert.equal(completed, 2);
  assert.equal(eco.stock().m, 40 * 100 - 2000, 'each item cost exactly 1000');
});

test('cancel refunds by percent and storage; failed operations change nothing', () => {
  const rules = defineEconomyRules({
    costModel: 'upfront',
    refundPercent: 50,
    resources: [{id: 'g', capacity: 100, initial: 100}],
    items: [{id: 'x', cost: {g: 80}, work: 5}],
  });
  const eco = createEconomy(rules, {maxQueueLength: 2, maxQueues: 1});
  eco.setQueue('q');
  assert.equal(eco.setQueue('second'), false);
  eco.enqueue('q', 'x', {count: 2});
  assert.equal(eco.enqueue('q', 'x'), false);
  eco.advance(1);
  const ev = eco.cancel('q', 0);
  assert.deepEqual(ev, {kind: 'cancelled', queue: 'q', item: 'x', refunded: {g: 40}, lost: {g: 40}});
  assert.equal(eco.stock().g, 60);
  const before = eco.snapshot();
  assert.equal(eco.withdraw({g: 61}), false);
  assert.throws(() => eco.enqueue('q', 'nope'), /unknown item/);
  assert.deepEqual(eco.snapshot(), before);
});

test('reclaim extracts proportionally, stops at storage, releases reclaimers; pools decay', () => {
  const rules = defineEconomyRules({resources: [{id: 'm', capacity: 50, initial: 0}], items: []});
  const eco = createEconomy(rules);
  eco.addPool('wreck', {amounts: {m: 100}, work: 10});
  eco.addPool('old', {amounts: {m: 30}, work: 10, decayTicks: 3});
  assert.equal(eco.setReclaimer('r1', 'wreck', 2 * RATE_ONE), true);
  const first = eco.advance(3);
  assert.deepEqual(
    first.reports.map(r => r.reclaimed.m),
    [20, 20, 10],
    'stops when storage is full',
  );
  assert.deepEqual(first.events, [{kind: 'pool-decayed', pool: 'old', lost: {m: 30}}]);
  eco.withdraw({m: 50});
  const rest = eco.advance(5);
  assert.equal(
    rest.reports.reduce((s, r) => s + (r.reclaimed.m ?? 0), 0),
    50,
  );
  assert.deepEqual(rest.events, [
    {kind: 'pool-exhausted', pool: 'wreck', lost: {}},
    {kind: 'reclaimer-released', reclaimer: 'r1', pool: 'wreck'},
  ]);
});

test('snapshot and restore continue identically; mismatched or inconsistent snapshots are refused', () => {
  const rules = defineEconomyRules(economyPresets.flowEconomy);
  const build = () => {
    const eco = createEconomy(rules);
    eco.setIncome('commander', {metal: 1000, energy: 20_000});
    eco.setQueue('base');
    eco.setQueue('yard', 1500);
    eco.enqueue('base', 'workshop');
    eco.enqueue('base', 'lab');
    eco.enqueue('yard', 'light-unit', {count: 3, repeat: true});
    eco.addPool('rock', {amounts: {metal: 90_000}, work: 400});
    eco.setReclaimer('builder', 'rock', 700);
    return eco;
  };
  const a = build();
  a.advance(500);
  const saved = JSON.parse(JSON.stringify(a.snapshot()));
  const tailA = JSON.stringify([a.advance(600), a.advance(600), a.snapshot()]);
  const b = createEconomy(rules);
  b.restore(saved);
  assert.equal(JSON.stringify([b.advance(600), b.advance(600), b.snapshot()]), tailA);
  const other = createEconomy(defineEconomyRules(economyPresets.upfrontBuilder));
  assert.throws(() => other.restore(saved), /different rules/);
  const bad = structuredClone(saved);
  const started = bad.queues.find((q: {started: boolean}) => q.started);
  started.progress += 1;
  assert.throws(() => createEconomy(rules).restore(bad), /paid does not match/);
});

test('review: two reclaimers emptying one pool in a tick; reserved names; unlock bounds; fresh queue states', () => {
  const rules = defineEconomyRules({resources: [{id: 'm', capacity: 100}], items: [{id: 'x', cost: {m: 10}, work: 1}]});
  const eco = createEconomy(rules);
  eco.addPool('p', {amounts: {m: 10}, work: 1});
  eco.setReclaimer('a', 'p');
  eco.setReclaimer('b', 'p');
  const out = eco.advance(1);
  assert.deepEqual(out.reports[0]!.reclaimed, {m: 10});
  assert.deepEqual(
    out.events.map(e => e.kind),
    ['pool-exhausted', 'reclaimer-released', 'reclaimer-released'],
  );
  assert.equal(eco.setReclaimer('a', null), false);
  assert.throws(
    () => defineEconomyRules({resources: [{id: 'constructor', capacity: 1}], items: []}),
    /invalid resource id/,
  );
  const gated = defineEconomyRules({
    resources: [{id: 'm', capacity: 100}],
    items: [
      {id: 'a', cost: {}, work: 1, grants: ['u1', 'u2']},
      {id: 'b', cost: {}, work: 1, requires: ['u3']},
    ],
  });
  assert.throws(() => createEconomy(gated, {maxUnlocks: 2}), /maxUnlocks/);
  const g = createEconomy(gated, {maxUnlocks: 3});
  assert.throws(() => g.adjustUnlock('elsewhere', 1), /not required or granted/);
  const up = createEconomy(rules);
  up.setQueue('q');
  up.enqueue('q', 'x');
  up.advance(1);
  assert.equal(up.queue('q')!.state, 'waiting');
  up.deposit({m: 10});
  assert.equal(up.queue('q')!.state, 'building', 'a deposit refreshes queue states');
  assert.throws(() => up.enqueue('q', 'x', null as never), /record/);
});
