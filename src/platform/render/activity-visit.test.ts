import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityHost} from '../../core/activity/activity';
import {FrameLoop} from '../../core/activity/loop';
import type {Coverage} from '../../core/activity/ports';
import {prepareRenderMount, enterRenderVisit, type RenderVisit} from './activity-visit';
import {VisitFrames} from '../ui/visit-frames';

function fixture() {
  let serial = 0,
    coverage: Coverage = 'top',
    leases = 0,
    cleared = 0;
  const pending = new Map<number, (t: number) => void>(),
    listeners = new Set<() => void>(),
    dt: number[] = [],
    log: string[] = [];
  const layers = {
    coverage: () => coverage,
    onChange: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    closeOwned: () => {},
    push: () => {
      throw Error('not needed');
    },
  };
  const loop = new FrameLoop({
    layers,
    calm: () => false,
    now: () => 0,
    scheduler: {
      request: f => {
        pending.set(++serial, f);
        return serial;
      },
      cancel: id => {
        pending.delete(id);
      },
    },
  });
  const host = new ActivityHost({
    layers,
    loop,
    calm: () => false,
    surfaces: {
      acquire: req => {
        assert.equal(req.role, 'world');
        leases++;
        return {
          release() {
            leases--;
            log.push('surface');
          },
        };
      },
    },
  });
  let visit!: RenderVisit;
  const activation: (() => void)[] = [],
    screen = {inert: false};
  const open = () =>
    enterRenderVisit(
      host,
      'scene.fixture',
      screen,
      v => {
        visit = v;
        v.ctx.surface({role: 'world'});
        const frames = new VisitFrames(
          v.ctx,
          () => v.active,
          d => dt.push(d),
          () => cleared++,
          layers,
        );
        frames.start();
        return () => {
          log.push('scene');
          frames.stop();
        };
      },
      f => activation.push(f),
    );
  return {
    host,
    screen,
    dt,
    log,
    open,
    get visit() {
      return visit;
    },
    get leases() {
      return leases;
    },
    get cleared() {
      return cleared;
    },
    get listeners() {
      return listeners.size - 1;
    },
    activate() {
      for (const f of activation.splice(0)) f();
    },
    cover(c: Coverage) {
      coverage = c;
      for (const f of [...listeners]) f();
    },
    frame(t: number) {
      const work = [...pending.values()];
      pending.clear();
      for (const f of work) f(t);
    },
  };
}
test('dormant first draw, activation, coverage, fresh elapsed time and ordered lease cleanup', async () => {
  const f = fixture(),
    stop = f.open();
  await Promise.resolve();
  assert.equal(f.screen.inert, true);
  assert.equal(f.visit.input(), false);
  f.frame(0);
  f.frame(20);
  assert.deepEqual(f.dt, [0, 0]);
  f.activate();
  assert.equal(f.screen.inert, false);
  assert.equal(f.visit.input(), true);
  f.frame(40);
  assert.equal(f.dt.at(-1), 0.02);
  f.cover('scrim');
  assert.equal(f.cleared, 1);
  assert.equal(f.visit.input(), false);
  f.frame(80);
  assert.equal(f.dt.length, 3);
  f.cover('top');
  f.frame(3000);
  assert.equal(f.dt.at(-1), 0);
  stop();
  stop();
  assert.equal(f.leases, 0);
  assert.equal(f.listeners, 0);
  assert.deepEqual(f.log, ['scene', 'surface']);
  assert.equal(f.visit.input(), false);
});
test('stale activation, player retirement and repeated reentry never revive an old run', async () => {
  const f = fixture(),
    ids = new Set<string>();
  for (let n = 0; n < 5; n++) {
    const stop = f.open();
    ids.add(f.visit.ctx.runId);
    await Promise.resolve();
    stop();
    f.activate();
    f.frame(n * 100);
    assert.equal(f.visit.active, false);
    assert.equal(f.visit.input(), false);
    assert.equal(f.leases, 0);
    assert.equal(f.listeners, 0);
  }
  assert.equal(ids.size, 5);
  assert.equal(f.dt.length, 0);
  assert.equal(f.host.running().length, 0);
});
test('failed preparation releases an already acquired surface and never activates', async () => {
  const f = fixture();
  let failed: RenderVisit | undefined;
  let activate = () => {};
  assert.throws(
    () =>
      enterRenderVisit(
        f.host,
        'broken',
        f.screen,
        v => {
          failed = v;
          v.ctx.surface({role: 'world'});
          throw Error('build failed');
        },
        fn => {
          activate = fn;
        },
      ),
    /build failed/,
  );
  await Promise.resolve();
  assert.equal(f.leases, 0);
  activate();
  assert.equal(failed!.active, false);
  assert.equal(f.host.running().length, 0);
});

for (const failureAt of ['construction', 'observe', 'resize'] as const)
  test(`failed ${failureAt} rolls back private resources before returning the lease`, async () => {
    const f = fixture(),
      events = new EventTarget(),
      log: string[] = [];
    let controller: AbortController | undefined,
      heard = 0,
      activate = () => {};
    assert.throws(
      () =>
        enterRenderVisit(
          f.host,
          'broken',
          f.screen,
          v => {
            v.ctx.surface({role: 'world'});
            v.resource({
              dispose() {
                log.push('scene');
                assert.equal(f.leases, 1);
              },
            });
            if (failureAt === 'construction') throw Error('injected construction');
            controller = new AbortController();
            v.onMountFailure(() => {
              controller!.abort();
              log.push('abort');
            });
            events.addEventListener('input', () => heard++, {signal: controller.signal});
            const observer = {
              disconnect() {
                log.push('observer');
              },
              observe() {
                if (failureAt === 'observe') throw Error('injected observe');
              },
            };
            v.onMountFailure(() => observer.disconnect());
            observer.observe();
            throw Error('injected resize');
          },
          fn => {
            activate = fn;
          },
        ),
      new RegExp(`injected ${failureAt}`),
    );
    await Promise.resolve();
    activate();
    events.dispatchEvent(new Event('input'));
    assert.equal(heard, 0);
    assert.equal(f.leases, 0);
    assert.equal(f.host.running().length, 0);
    assert.deepEqual(log, failureAt === 'construction' ? ['scene'] : ['observer', 'abort', 'scene']);
    if (controller) assert.equal(controller.signal.aborted, true);
    assert.deepEqual(f.log, ['surface']);
  });
test('successful mount transfers cleanup to its existing disposer exactly once', async () => {
  const f = fixture(),
    log: string[] = [];
  const stop = enterRenderVisit(
    f.host,
    'ready',
    f.screen,
    v => {
      v.ctx.surface({role: 'world'});
      const scene = v.resource({
        dispose() {
          log.push('scene');
        },
      });
      v.onMountFailure(() => log.push('rollback'));
      return () => {
        log.push('normal');
        scene.dispose();
      };
    },
    () => {},
  );
  await Promise.resolve();
  stop();
  stop();
  assert.deepEqual(log, ['normal', 'scene']);
  assert.deepEqual(f.log, ['surface']);
  assert.equal(f.leases, 0);
});
test('activation registration failure releases the run and preserves the thrown value', async () => {
  const f = fixture();
  let mounted = false,
    caught = false;
  try {
    enterRenderVisit(
      f.host,
      'broken',
      f.screen,
      () => {
        mounted = true;
        return () => {};
      },
      () => {
        throw undefined;
      },
    );
  } catch (error) {
    caught = true;
    assert.equal(error, undefined);
  }
  await Promise.resolve();
  assert.equal(caught, true);
  assert.equal(mounted, false);
  assert.equal(f.screen.inert, false);
  assert.equal(f.host.running().length, 0);
});

test('a deferred temporary mount has a fresh rollback scope after its parent mounted', async () => {
  const f = fixture(),
    log: string[] = [];
  let visit!: RenderVisit;
  const stop = enterRenderVisit(
    f.host,
    'parent',
    f.screen,
    v => {
      visit = v;
      return () => log.push('parent');
    },
    () => {},
  );
  await Promise.resolve();
  assert.throws(
    () =>
      prepareRenderMount(visit, v => {
        v.ctx.surface({role: 'world'});
        v.resource({
          dispose() {
            log.push('child');
          },
        });
        throw Error('temporary resize');
      }),
    /temporary resize/,
  );
  stop();
  assert.deepEqual(log, ['child', 'parent']);
  assert.equal(f.leases, 0);
  assert.equal(f.host.running().length, 0);
});

test('preparation hands inert ownership to the real dormant layer without disabling its live screen', async () => {
  const {installFakeDom} = await import('../../testing/fake-dom');
  const {LayerManager} = await import('../ui/layers');
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document;
  try {
    for (const modalKind of ['none', 'external', 'nested'] as const) {
      const withModal = modalKind !== 'none';
      const layers = new LayerManager(doc),
        screen = doc.createElement('section'),
        launch = doc.createElement('button');
      screen.append(launch);
      doc.body.append(screen);
      const loop = new FrameLoop({layers, calm: () => false, scheduler: {request: () => 1, cancel() {}}});
      const host = new ActivityHost({layers, loop, calm: () => false}),
        activation: (() => void)[] = [];
      let visit!: RenderVisit;
      const stop = enterRenderVisit(
        host,
        'scene.rally',
        screen,
        v => {
          visit = v;
          return () => {};
        },
        fn => activation.push(fn),
      );
      await Promise.resolve();
      assert.equal(screen.inert, true, 'asynchronous preparation remains unreachable before it creates a layer');
      assert.equal(visit.input(), false);
      const request: import('../ui/layers').LayerSpec = {
        id: 'rally',
        kind: 'scene',
        element: screen,
        modal: false,
        dormant: true,
      };
      const layer = visit.ctx.layer(request) as import('../ui/layers').LayerHandle;
      activation.push(() => layer.activate());
      assert.equal(screen.inert, true, 'handoff remains dormant');
      const modalElement = doc.createElement('section');
      (modalKind === 'nested' ? screen : doc.body).append(modalElement);
      const modal = withModal
        ? layers.open({id: 'modal', kind: 'modal', element: modalElement, modal: 'page', cover: 'opaque'})
        : null;
      for (const fn of activation) fn();
      assert.equal(
        screen.inert,
        modalKind === 'external',
        'an external modal blocks the screen; a nested modal keeps its ancestor reachable',
      );
      assert.equal(launch.inert === true, modalKind === 'nested', 'a nested modal blocks the sibling launch control');
      assert.equal(visit.input(), !withModal);
      modal?.close();
      assert.equal(screen.inert, false, 'closing the higher layer restores the screen');
      assert.equal(visit.input(), true);
      stop();
      stop();
      assert.equal(screen.inert, false);
      assert.equal(visit.input(), false);
      screen.remove();
      modalElement.remove();
      loop.dispose();
    }
  } finally {
    fake.restore();
  }
});
