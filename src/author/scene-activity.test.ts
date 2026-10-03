import test from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import { createSceneActivity } from './scene-activity';
import { defineScene, type SceneActivityFacts } from './defs';
import { testScene } from './testing';
import { ActivityHost, type ActivityContext } from '../core/activity/activity';
import { FrameLoop } from '../core/activity/loop';

const initial = (): SceneActivityFacts => ({ phase: 'active', coverage: 'top', documentHidden: false });
test('headless activity follows enter, explicit synchronous facts and terminal exit without frames', async () => {
  const events: string[] = [], facts: SceneActivityFacts[] = [];
  const h = await testScene(defineScene({ id: 'activity', title: 'Activity', enter() { events.push('enter'); },
    activity(ctx, value) { assert.equal(ctx.time.frame, 0); assert(Object.isFrozen(value)); facts.push(value); events.push(value.phase); },
    exit() { events.push('exit'); },
  }));
  h.setActivity({ coverage: 'scrim', documentHidden: false });
  h.setActivity({ coverage: 'scrim', documentHidden: false });
  h.setActivity({ coverage: 'scrim', documentHidden: true });
  h.setActivity({ coverage: 'top', documentHidden: true });
  h.setActivity({ coverage: 'top', documentHidden: false });
  h.dispose(); h.dispose();
  assert.deepEqual(events, ['enter', 'active', 'active', 'active', 'active', 'active', 'retired', 'exit']);
  assert.equal(must(facts[3], 'fourth facts').documentHidden, true);
  assert.throws(() => h.setActivity({ coverage: 'top', documentHidden: false }), /disposed/);
});
test('hook failure is reported and does not prevent retirement or cleanup', async () => {
  let exits = 0;
  const h = await testScene(defineScene({ id: 'throws', title: 'Throws', activity() { throw Error('hook'); }, exit() { exits++; } }));
  assert.equal(h.activityErrors.length, 1);
  h.dispose();
  assert.equal(h.activityErrors.length, 2); assert.equal(exits, 1);
});
test('reentrant changes coalesce to latest facts, and retirement cannot be revived', () => {
  let value = initial(); const seen: SceneActivityFacts[] = [];
  const owner = createSceneActivity(() => value, facts => {
    seen.push(facts);
    if (seen.length === 1) { value = { ...value, coverage: 'scrim' }; owner.refresh(); value = { ...value, documentHidden: true }; owner.refresh(); }
    else if (seen.length === 2) owner.retire();
    else owner.refresh();
  }, error => { throw error; }, () => owner.retire());
  owner.refresh(); assert.equal(seen.length, 0); owner.start(); owner.start(); owner.refresh();
  assert.deepEqual(seen.map(x => [x.phase, x.coverage, x.documentHidden]), [['active', 'top', false], ['active', 'scrim', true], ['retired', 'scrim', true]]);
});
test('oscillating creator callbacks retire their owner within eight notifications plus terminal', () => {
  let value = initial(), calls = 0; const errors: unknown[] = [];
  const owner = createSceneActivity(() => value, facts => { calls++; if (facts.phase === 'active') { value = { ...value, documentHidden: !value.documentHidden }; owner.refresh(); } }, error => errors.push(error), () => { value = { ...value, phase: 'retired' }; owner.retire(); });
  owner.start(); assert.equal(calls, 9); assert.equal(errors.length, 1); assert.equal(value.phase, 'retired');
  owner.retire(); assert.equal(calls, 9);
});
test('direct activity stop exposes leaving before child cleanup can emit uncovered facts', async () => {
  const listeners = new Set<() => void>(); let coverage: SceneActivityFacts['coverage'] = 'top';
  const layers = { coverage: () => coverage, onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    push: () => { throw Error('unused'); }, closeOwned: () => { coverage = 'top'; for (const fn of listeners) fn(); } };
  const loop = new FrameLoop({ layers, calm: () => false, scheduler: { request: () => { throw Error('no ticker needed'); }, cancel() {} } });
  const host = new ActivityHost({ loop, layers, calm: () => false });
  const seen: string[] = []; let parent!: ActivityContext;
  const run = await host.start({ id: 'parent', kind: 'scene', enter(ctx) {
    parent = ctx;
    const events = createSceneActivity(() => ({ phase: ctx.leaving() ? 'retired' : 'active', coverage, documentHidden: false }), facts => seen.push(`${facts.phase}:${facts.coverage}`), error => { throw error; }, () => ctx.leave('error'));
    ctx.own(layers.onChange(() => { if (ctx.leaving()) events.retire(); else events.refresh(); }));
    events.start(); return { leave() { events.retire(); } };
  } }, undefined);
  await parent.start({ id: 'child', kind: 'widget', enter() { return {}; } }, undefined);
  coverage = 'scrim'; for (const fn of listeners) fn();
  run.stop('exit');
  assert.deepEqual(seen, ['active:top', 'active:scrim', 'retired:top']);
  assert.equal(parent.leaving(), true); loop.dispose(); assert.equal(listeners.size, 0);
});

test('real layer transitions notify while the only scene ticker is stopped', async () => {
  const { installFakeDom } = await import('../testing/fake-dom');
  const { LayerManager } = await import('../platform/ui/layers');
  const fake = installFakeDom(), doc = fake.document as unknown as Document;
  const layers = new LayerManager(doc);
  const pending = new Map<number, (t: number) => void>(); let serial = 0, updates = 0;
  const loop = new FrameLoop({ layers, calm: () => false, scheduler: {
    request(fn) { pending.set(++serial, fn); return serial; }, cancel(id) { pending.delete(id); },
  } });
  const seen: string[] = [];
  try {
    const element = doc.createElement('div'); doc.body.append(element);
    const scene = layers.open({ id: 'scene', owner: 'visit', kind: 'scene', element });
    loop.add({ owner: 'visit', mode: 'continuous', update() { updates++; } });
    const events = createSceneActivity(() => ({ phase: 'active', coverage: layers.coverage('visit'), documentHidden: false }), facts => seen.push(facts.coverage), error => { throw error; }, () => { scene.close(); events.retire(); });
    const off = layers.onChange(() => events.refresh()); events.start();
    const sheet = layers.open({ id: 'sheet', owner: 'child', kind: 'sheet', element: doc.createElement('div'), cover: 'scrim' });
    assert.equal(pending.size, 0); assert.equal(updates, 0); assert.deepEqual(seen, ['top', 'scrim']);
    sheet.set({ cover: 'opaque' }); assert.deepEqual(seen, ['top', 'scrim', 'opaque']);
    sheet.close(); assert.equal(pending.size, 1); assert.equal(updates, 0); assert.equal(seen.at(-1), 'top');
    off(); scene.close();
  } finally { loop.dispose(); fake.restore(); }
});

test('eighth top notification opening opaque retires the actual ActivityHost without another signal', async () => {
  const listeners = new Set<() => void>(); let coverage: SceneActivityFacts['coverage'] = 'top';
  const layers = { coverage: () => coverage, onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    push: () => { throw Error('unused'); }, closeOwned() {} };
  const loop = new FrameLoop({ layers, calm: () => false, scheduler: { request: () => { throw Error('no frame'); }, cancel() {} } });
  const host = new ActivityHost({ loop, layers, calm: () => false });
  let oscillate = false, changed = 0, exits = 0, terminal = 0, eligible = false;
  let ctx!: ActivityContext;
  const run = await host.start({ id: 'bounded', kind: 'scene', enter(context) {
    ctx = context;
    const events = createSceneActivity(() => ({ phase: ctx.leaving() ? 'retired' : 'active', coverage, documentHidden: false }), facts => {
      eligible = facts.phase === 'active' && facts.coverage === 'top';
      if (facts.phase === 'retired') { terminal++; ctx.leave('exit'); return; }
      if (!oscillate) return;
      changed++;
      // Starting with scrim: the eighth callback is top and opens opaque.
      if (changed === 8) { assert.equal(facts.coverage, 'top'); coverage = 'opaque'; }
      else coverage = facts.coverage === 'top' ? 'scrim' : 'top';
      for (const listener of listeners) listener();
    }, () => { throw Error('report itself failed'); }, () => ctx.leave('error'));
    ctx.own(layers.onChange(() => events.refresh()));
    ctx.own(() => events.retire());
    events.start(); return { leave() { exits++; events.retire(); } };
  } }, undefined);
  oscillate = true; coverage = 'scrim'; for (const listener of listeners) listener();
  assert.equal(changed, 8); assert.equal(coverage, 'opaque'); assert.equal(eligible, false);
  assert.equal(run.stopped, true); assert.equal(ctx.signal.aborted, true);
  assert.equal(await run.done, 'error'); assert.equal(terminal, 1); assert.equal(exits, 1);
  run.stop('exit'); assert.equal(terminal, 1); loop.dispose(); assert.equal(listeners.size, 0);
});

test('headless notification overload actually disposes and cannot resume stepping or input', async () => {
  let h: Awaited<ReturnType<typeof testScene>> | undefined, callbacks = 0, retired = 0, exits = 0;
  h = await testScene(defineScene({ id: 'overload', title: 'Overload', activity(_ctx, facts) {
    if (facts.phase === 'retired') { retired++; h?.dispose(); return; }
    if (!h) return;
    callbacks++; h.setActivity({ coverage: callbacks === 8 ? 'opaque' : facts.coverage === 'top' ? 'scrim' : 'top', documentHidden: false });
  }, exit() { exits++; } }));
  h.setActivity({ coverage: 'scrim', documentHidden: false });
  assert.equal(callbacks, 8); assert.equal(retired, 1); assert.equal(exits, 1);
  assert.equal(h.activityErrors.length, 1);
  assert.throws(() => h!.run(1), /disposed/); assert.throws(() => h!.press('x'), /disposed/);
  assert.throws(() => h!.setActivity({ coverage: 'top', documentHidden: false }), /disposed/);
  h.dispose(); assert.equal(exits, 1);
});

test('headless stepping does not fabricate native rendered notifications', async () => {
  let calls = 0;
  const h = await testScene(defineScene({ id: 'native-render', title: 'Native render', rendered() { calls++; } }));
  h.run(1); h.dispose(); assert.equal(calls, 0);
});
