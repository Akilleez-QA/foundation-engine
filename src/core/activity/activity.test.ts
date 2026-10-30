import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameLoop} from './loop';
import {ActivityHost, type Activity, type ActivityContext, type ActivityRun} from './activity';
import type {Coverage, LayerHandle, LayerRequest} from './ports';

function fakeFrames() {
  const pending = new Map<number, (t: number) => void>();
  let serial = 0;
  return {
    scheduler: {
      request(cb: (t: number) => void) {
        pending.set(++serial, cb);
        return serial;
      },
      cancel(id: number) {
        pending.delete(id);
      },
    },
    get pending() {
      return pending.size;
    },
    run(ms: number) {
      const work = [...pending.values()];
      pending.clear();
      for (const cb of work) cb(ms);
    },
  };
}

function fakeLayerPort(log: string[]) {
  const open = new Map<string, {req: LayerRequest; abort: AbortController}>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };
  const cover = (owner: string): Coverage => {
    const stack = [...open.values()];
    const mine = stack.findIndex(e => e.req.owner === owner);
    const above = mine < 0 ? [] : stack.slice(mine + 1).filter(e => e.req.owner !== owner);
    if (above.some(e => e.req.cover === 'opaque')) return 'opaque';
    if (above.some(e => e.req.cover === 'scrim')) return 'scrim';
    return 'top';
  };
  return {
    open,
    push(req: LayerRequest): LayerHandle {
      const abort = new AbortController();
      open.set(req.id, {req, abort});
      changed();
      return {
        id: req.id,
        signal: abort.signal,
        get closed() {
          return !open.has(req.id);
        },
        close() {
          if (open.delete(req.id)) {
            abort.abort();
            log.push(`layer ${req.id}`);
            changed();
          }
        },
      };
    },
    coverage: cover,
    closeOwned(owner: string) {
      for (const [id, e] of [...open].reverse())
        if (e.req.owner === owner) {
          open.delete(id);
          e.abort.abort();
          log.push(`layer ${id}`);
        }
      changed();
    },
    onChange(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

function setup() {
  const log: string[] = [],
    errors: string[] = [];
  const frames = fakeFrames(),
    layers = fakeLayerPort(log);
  const loop = new FrameLoop({scheduler: frames.scheduler, layers, calm: () => false, now: () => 0});
  const released: string[] = [];
  const host = new ActivityHost({
    loop,
    layers,
    calm: () => false,
    quality: () => 'high',
    report: id => errors.push(id),
    surfaces: {acquire: req => ({release: () => released.push(`${req.owner}:${req.role}`)})},
  });
  return {log, errors, frames, layers, loop, host, released};
}

/** An activity that logs what it owns and when it leaves. */
function logged(
  id: string,
  log: string[],
  extra: (ctx: ActivityContext) => Partial<ActivityRun> | Promise<Partial<ActivityRun>> = () => ({}),
): Activity {
  return {
    id,
    kind: 'panel',
    async enter(ctx) {
      ctx.layer({id: `${id}.layer`, kind: 'panel', cover: 'scrim'});
      ctx.own(() => log.push(`${id} own 1`));
      ctx.own({dispose: () => log.push(`${id} own 2`)});
      ctx.signal.addEventListener('abort', () => log.push(`${id} abort`));
      const more = await extra(ctx);
      return {leave: reason => log.push(`${id} leave ${reason}`), ...more};
    },
  };
}

test('disposal order: children first, then leave, layers, owned in reverse, then the signal', async () => {
  const {log, host, layers} = setup();
  let childCtx: ActivityContext | null = null;
  const child = logged('child', log, ctx => {
    childCtx = ctx;
    return {};
  });
  const grandchild = logged('grand', log);
  const sceneRun = await host.start(logged('scene', log), undefined);
  let started: Awaited<ReturnType<ActivityContext['start']>> | null = null;
  const hub = await host.start(
    {
      id: 'hub',
      kind: 'scene',
      async enter(ctx) {
        started = await ctx.start(child, undefined);
        await childCtx!.start(grandchild, undefined);
        ctx.own(() => log.push('hub own'));
        return {leave: r => log.push(`hub leave ${r}`)};
      },
    },
    undefined,
  );
  const panel = {parentHost: hub, started: started!};
  assert.equal(childCtx!.parent?.id, 'hub');
  assert.equal(host.running().length, 4, 'scene, hub, child and grandchild are live');
  log.length = 0;
  panel.parentHost.stop('route');
  assert.deepEqual(log, [
    'grand leave parent-left',
    'layer grand.layer',
    'grand own 2',
    'grand own 1',
    'grand abort',
    'child leave parent-left',
    'layer child.layer',
    'child own 2',
    'child own 1',
    'child abort',
    'hub leave route',
    'hub own',
  ]);
  assert.equal(await panel.parentHost.done, 'route');
  assert.equal(await panel.started.done, 'parent-left');
  assert.equal(panel.started.signal.aborted, true);
  assert.ok(![...layers.open.values()].some(e => e.req.owner === panel.started.runId));
  log.length = 0;
  sceneRun.stop('exit');
  sceneRun.stop('exit');
  assert.deepEqual(
    log,
    ['scene leave exit', 'layer scene.layer', 'scene own 2', 'scene own 1', 'scene abort'],
    'stop runs once',
  );
  assert.equal(host.running().length, 0);
});

test('a throwing enter releases what it owned and reports once', async () => {
  const {log, errors, host, layers, loop, frames} = setup();
  const bad: Activity = {
    id: 'bad',
    kind: 'scene',
    enter(ctx) {
      ctx.layer({id: 'bad.layer', kind: 'scene'});
      ctx.ticker({mode: 'continuous', update: () => log.push('tick')});
      ctx.own(() => log.push('bad own'));
      throw new Error('no scene');
    },
  };
  await assert.rejects(host.start(bad, undefined), /no scene/);
  assert.deepEqual(errors, ['bad']);
  assert.deepEqual(log, ['layer bad.layer', 'bad own']);
  assert.equal(layers.open.size, 0);
  frames.run(0);
  assert.equal(loop.stats.updates, 0);
  assert.equal(frames.pending, 0, 'its ticker is gone');
});

test('the main ticker renders on demand, pauses under a covering layer and resumes with dt = 0', async () => {
  const {frames, host} = setup();
  const dts: number[] = [];
  let ctxRef: ActivityContext | null = null;
  const scene = await host.start(
    {
      id: 'scene',
      kind: 'scene',
      enter(ctx) {
        ctxRef = ctx;
        ctx.layer({id: 'scene', kind: 'scene', cover: 'opaque'});
        return {frameMode: 'continuous', update: f => dts.push(f.dt), render: () => {}};
      },
    },
    undefined,
  );
  frames.run(0);
  frames.run(16);
  const modal = await ctxRef!.start(
    {
      id: 'modal',
      kind: 'widget',
      enter: ctx => {
        ctx.layer({id: 'm', kind: 'modal', cover: 'opaque'});
        return {};
      },
    },
    undefined,
  );
  assert.equal(ctxRef!.coverage(), 'opaque');
  frames.run(32);
  assert.equal(frames.pending, 0, 'nothing else wants a frame');
  modal.stop('exit');
  assert.equal(ctxRef!.coverage(), 'top');
  frames.run(9000);
  assert.deepEqual(
    dts.map(d => +d.toFixed(9)),
    [0, 0.016, 0],
  );
  ctxRef!.setFrameMode('on-demand');
  frames.run(9016);
  assert.equal(frames.pending, 0);
  ctxRef!.invalidate();
  assert.equal(frames.pending, 1);
  scene.stop('exit');
  assert.equal(frames.pending, 0);
});

test('context helpers: calm, quality, surfaces and extra tickers are owned by the run', async () => {
  const {host, released, frames} = setup();
  let ctxRef: ActivityContext | null = null;
  const run = await host.start(
    {
      id: 'bench',
      kind: 'panel',
      enter(ctx) {
        ctxRef = ctx;
        ctx.surface({role: 'stage'});
        ctx.ticker({mode: 'continuous', update: () => {}});
        ctx.setFrameMode('continuous');
        return {};
      },
    },
    undefined,
  );
  assert.equal(ctxRef!.calm(), false);
  assert.equal(ctxRef!.quality(), 'high');
  assert.equal(frames.pending, 1);
  run.stop('exit');
  assert.deepEqual(released, [`${run.runId}:stage`]);
  assert.equal(frames.pending, 0);
  ctxRef!.own(() => released.push('late'));
  assert.deepEqual(released.at(-1), 'late', 'owning after leave disposes at once');
  await assert.rejects(ctxRef!.start({id: 'x', kind: 'widget', enter: () => ({})}, undefined));
});

test('a parent that leaves while its child is entering stops the child, which never ticks', async () => {
  const {host, log, frames} = setup();
  let release!: () => void;
  const gate = new Promise<void>(r => {
    release = r;
  });
  let parentCtx: ActivityContext | null = null;
  const parent = await host.start(
    {
      id: 'p',
      kind: 'scene',
      enter: ctx => {
        parentCtx = ctx;
        return {};
      },
    },
    undefined,
  );
  const childStart = parentCtx!.start(
    logged('slow', log, async () => {
      await gate;
      return {frameMode: 'continuous', update: () => log.push('tick')};
    }),
    undefined,
  );
  await Promise.resolve();
  parent.stop('route');
  release();
  const child = await childStart;
  assert.equal(child.stopped, true);
  assert.equal(child.run, null);
  frames.run(0);
  assert.ok(!log.includes('tick'));
  assert.ok(log.includes('slow leave replaced'));
  assert.equal(await child.done, 'parent-left');
});

test('contextRestored reaches every live run and a throwing hook is reported', async () => {
  const {host, errors} = setup();
  const seen: string[] = [];
  await host.start({id: 'a', kind: 'scene', enter: () => ({contextRestored: () => seen.push('a')})}, undefined);
  await host.start(
    {
      id: 'b',
      kind: 'scene',
      enter: () => ({
        contextRestored: () => {
          throw new Error('x');
        },
      }),
    },
    undefined,
  );
  host.contextRestored();
  assert.deepEqual(seen, ['a']);
  assert.deepEqual(errors, ['b']);
});

test('reporter failure cannot interrupt failed entry or reverse ownership cleanup', async () => {
  const {loop, layers} = setup();
  const cleaned: string[] = [];
  let signal: AbortSignal | undefined;
  const host = new ActivityHost({
    loop,
    layers,
    calm: () => false,
    report() {
      throw Error('report failed');
    },
  });
  await assert.rejects(
    host.start(
      {
        id: 'failed',
        kind: 'panel',
        enter(ctx) {
          signal = ctx.signal;
          ctx.layer({id: 'failed.layer', kind: 'panel'});
          ctx.own(() => cleaned.push('first'));
          ctx.own(() => {
            cleaned.push('second');
            throw Error('dispose failed');
          });
          throw Error('enter failed');
        },
      },
      undefined,
    ),
    /enter failed/,
  );
  assert.deepEqual(cleaned, ['second', 'first']);
  assert.equal(signal?.aborted, true);
  assert.equal(layers.open.size, 0);
  assert.equal(host.running().length, 0);
});

test('reporter failure cannot prevent stopped run completion or later restoration hooks', async () => {
  const {loop, layers} = setup(),
    seen: string[] = [];
  const host = new ActivityHost({
    loop,
    layers,
    calm: () => false,
    report() {
      throw Error('report failed');
    },
  });
  const run = await host.start(
    {
      id: 'bad',
      kind: 'panel',
      enter(ctx) {
        ctx.own(() => {
          seen.push('owned');
          throw Error('cleanup failed');
        });
        return {
          leave() {
            throw Error('leave failed');
          },
          contextRestored() {
            throw Error('restore failed');
          },
        };
      },
    },
    undefined,
  );
  await host.start(
    {
      id: 'good',
      kind: 'panel',
      enter: () => ({
        contextRestored() {
          seen.push('restored');
        },
      }),
    },
    undefined,
  );
  host.contextRestored();
  run.stop('exit');
  assert.deepEqual(seen, ['restored', 'owned']);
  assert.equal(await run.done, 'exit');
  assert.equal(run.signal.aborted, true);
});

test('a reporter-triggered failing restoration cannot recursively report itself', async () => {
  const {loop, layers} = setup();
  let reports = 0;
  const host = new ActivityHost({
    loop,
    layers,
    calm: () => false,
    report() {
      reports++;
      host.contextRestored();
    },
  });
  await host.start(
    {
      id: 'bad',
      kind: 'panel',
      enter: () => ({
        contextRestored() {
          throw Error('restore failed');
        },
      }),
    },
    undefined,
  );
  host.contextRestored();
  assert.equal(reports, 1);
});
