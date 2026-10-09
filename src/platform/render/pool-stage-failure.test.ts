import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagePool, type StagePoolDeps} from './pool-stage';

function fixture() {
  const errors = {
    dispose: Error('renderer dispose'),
    profile: Error('profile'),
    copy: Error('copy'),
    wrapper: Error('wrapper'),
    audit: Error('audit'),
    lose: Error('lose'),
    deletion: Error('delete'),
    construct: Error('construct'),
    tracking: Error('tracking'),
    resize: Error('resize'),
  };
  const fail = {
    dispose: false,
    profile: false,
    copy: false,
    wrapper: false,
    audit: false,
    lose: false,
    deletion: false,
    construct: false,
    tracking: false,
    resize: false,
  };
  let disposed = 0,
    losses = 0,
    deleted = 0,
    draws = 0,
    wrappers = 0;
  const stats = {created: 0, contexts: 0, leases: 0, losses: 0, recreations: 0, recycles: 0, lastRelease: null};
  const canvas = () => {
    let width = 2;
    // lint:allow-unknown-cast Failure-only canvas supplies the stage methods; it does not simulate DOM rendering.
    const view = Object.assign(new EventTarget(), {
      width: 2,
      height: 2,
      parentNode: null,
      nextSibling: null,
      remove() {},
      getContext() {
        return {
          globalCompositeOperation: 'source-over',
          drawImage() {
            if (fail.copy) throw errors.copy;
            draws++;
          },
        };
      },
    }) as unknown as HTMLCanvasElement;
    Object.defineProperty(view, 'width', {
      get: () => width,
      set(n: number) {
        if (fail.resize) throw errors.resize;
        width = n;
      },
    });
    return view;
  };
  const live = new Map<object, string>();
  const deps: StagePoolDeps<object> = {
    stats,
    valve: {textures: 100, geometries: 100},
    // lint:allow-unknown-cast Stage only calls createElement on this injected document.
    doc: () => ({createElement: canvas}) as unknown as Document,
    createContext: () => ({canvas: canvas(), gl: {} as WebGL2RenderingContext}),
    backend: {
      track() {
        if (fail.tracking) throw errors.tracking;
        return {live, validation: {validate() {}, clear() {}}};
      },
      deleteObject() {
        deleted++;
        if (fail.deletion) throw errors.deletion;
      },
      isLost: () => false,
      lose() {
        losses++;
        if (fail.lose) throw errors.lose;
      },
      lostEvent: 'lost',
      restoredEvent: 'restored',
    },
    createRenderer(view, gl) {
      if (fail.construct) throw errors.construct;
      return {
        domElement: view,
        info: {
          autoReset: true,
          render: {frame: 0, calls: 0, triangles: 0, points: 0, lines: 0},
          update() {},
          reset() {},
          get memory() {
            if (fail.audit) throw errors.audit;
            return {textures: 0, geometries: 0};
          },
          programs: [],
        },
        getContext: () => gl,
        dispose() {
          disposed++;
          if (fail.dispose) throw errors.dispose;
        },
        forceContextLoss() {},
        resetState() {},
        render() {},
        getRenderTarget: () => null,
      };
    },
    pixelRatio(r) {
      const dispose = r.dispose;
      r.dispose = () => {
        wrappers++;
        if (fail.wrapper) throw errors.wrapper;
        dispose();
      };
    },
    applyProfile() {
      if (fail.profile) throw errors.profile;
    },
  };
  return {
    pool: createStagePool(deps),
    deps,
    fail,
    errors,
    live,
    stats,
    canvas,
    counts: () => ({disposed, losses, deleted, draws, wrappers}),
  };
}

test('failed renderer cleanup retires only its lease, preserves siblings, and refuses new sharing until idle', async () => {
  const f = fixture(),
    a = f.pool.lease({role: 'stage'})!,
    b = f.pool.lease({role: 'stage'})!;
  f.live.set({}, 'deleteTexture');
  f.fail.dispose = true;
  assert.throws(
    () => a.release(),
    e => e === f.errors.dispose,
  );
  assert.deepEqual(f.pool.counts(), {contexts: 1, views: 1});
  assert.equal(f.pool.lease({role: 'stage'}), null);
  assert.equal(f.counts().deleted, 0);
  assert.equal(f.counts().losses, 0);
  a.release();
  a.renderer.dispose();
  assert.equal(f.counts().disposed, 1);
  f.fail.dispose = false;
  b.renderer.render({} as never, {} as never);
  await Promise.resolve();
  assert.equal(f.counts().draws, 1);
  b.release();
  assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
  assert.equal(f.counts().deleted, 1);
  assert.equal(f.stats.contexts, 0);
  f.pool.settle();
  assert.equal(f.counts().losses, 1);
});

test('release preserves flush, audit, wrapper and raw disposal errors while retiring registration', async () => {
  const f = fixture(),
    a = f.pool.lease({role: 'stage'})!;
  a.renderer.render({} as never, {} as never);
  f.fail.copy = f.fail.audit = f.fail.wrapper = f.fail.dispose = true;
  assert.throws(
    () => a.release(),
    e => {
      assert.ok(e instanceof AggregateError);
      assert.deepEqual(e.errors, [f.errors.copy, f.errors.audit, f.errors.wrapper, f.errors.dispose]);
      return true;
    },
  );
  assert.equal(f.stats.lastRelease, null, 'no fabricated audit after getter failure');
  assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
  a.release();
  await Promise.resolve();
  assert.equal(f.counts().disposed, 1);
  assert.equal(f.counts().draws, 0, 'pending copy does not resurrect a retired view');
});

test('setup failure rolls back registered resources, preserving the setup cause and cleanup causes', () => {
  const f = fixture();
  f.fail.profile = true;
  assert.throws(
    () => f.pool.lease({role: 'stage'}),
    e => e === f.errors.profile,
  );
  assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
  assert.equal(f.counts().disposed, 1);
  assert.equal(f.counts().wrappers, 1);
  f.fail.dispose = true;
  assert.throws(
    () => f.pool.lease({role: 'stage'}),
    e => {
      assert.ok(e instanceof AggregateError);
      assert.deepEqual(e.errors, [f.errors.profile, f.errors.dispose]);
      return true;
    },
  );
  assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
});

test('borrowed canvas attachment is restored after host or owner setup fails', () => {
  for (const at of ['host', 'owner']) {
    const f = fixture(),
      canvas = f.canvas(),
      cause = Error(at);
    let restored = 0;
    const parent = {
      insertBefore(node: unknown, next: unknown) {
        assert.equal(node, canvas);
        assert.equal(next, sibling);
        assert.equal(canvas.parentNode, host);
        Object.defineProperty(canvas, 'parentNode', {value: parent, configurable: true});
        restored++;
      },
    };
    const sibling = {parentNode: parent};
    Object.defineProperties(canvas, {parentNode: {value: parent, configurable: true}, nextSibling: {value: sibling}});
    // lint:allow-unknown-cast The host injects append failure; the borrowed parent separately observes restoration.
    const host = {
      append() {
        Object.defineProperty(canvas, 'parentNode', {value: host, configurable: true});
        if (at === 'host') throw cause;
      },
    } as unknown as HTMLElement;
    assert.throws(
      () =>
        f.pool.lease({
          role: 'stage',
          canvas,
          host,
          ctx: {
            own() {
              throw cause;
            },
          },
        }),
      e => e === cause,
    );
    assert.equal(restored, 1);
    assert.equal(canvas.parentNode, parent);
    assert.equal(f.counts().disposed, 1);
    assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
  }
});

test('setup hooks can synchronously retire without a partial surface escaping', () => {
  const f = fixture();
  assert.equal(
    f.pool.lease({
      role: 'stage',
      ctx: {
        own(d) {
          d.dispose();
          return d;
        },
      },
    }),
    null,
  );
  f.pool.settle();
  assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
  f.deps.pixelRatio = r => r.dispose();
  assert.equal(f.pool.lease({role: 'stage'}), null);
  f.pool.settle();
  assert.equal(f.counts().disposed, 2);
});

test('creation unavailability returns null only after clean rollback', () => {
  const f = fixture();
  f.fail.construct = true;
  assert.equal(f.pool.lease({role: 'stage'}), null);
  assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
  f.fail.lose = true;
  assert.throws(
    () => f.pool.lease({role: 'stage'}),
    e => {
      assert.ok(e instanceof AggregateError);
      assert.deepEqual(e.errors, [f.errors.construct, f.errors.lose]);
      return true;
    },
  );
  f.fail.construct = false;
  f.fail.tracking = true;
  assert.throws(
    () => f.pool.lease({role: 'stage'}),
    e => {
      assert.ok(e instanceof AggregateError);
      assert.deepEqual(e.errors, [f.errors.tracking, f.errors.lose]);
      return true;
    },
  );
  assert.equal(f.stats.contexts, 0);
});

test('idle deletion and context-loss failures cannot strand tracker or context accounting', () => {
  const f = fixture(),
    a = f.pool.lease({role: 'stage'})!;
  f.live.set({}, 'deleteTexture');
  f.live.set({}, 'deleteTexture');
  f.fail.deletion = f.fail.lose = true;
  assert.throws(
    () => a.release(),
    e => {
      assert.ok(e instanceof AggregateError);
      assert.deepEqual(e.errors, [f.errors.deletion, f.errors.deletion, f.errors.lose]);
      return true;
    },
  );
  assert.equal(f.counts().deleted, 2);
  assert.equal(f.live.size, 0);
  assert.equal(f.stats.contexts, 0);
  f.pool.settle();
  assert.equal(f.counts().losses, 1);
});

test('settle attempts every idle slot even when one backend retirement fails', () => {
  const f = fixture(),
    a = f.pool.lease({role: 'stage', antialias: false})!,
    b = f.pool.lease({role: 'stage'})!;
  a.release();
  b.release();
  f.fail.lose = true;
  assert.throws(
    () => f.pool.settle(),
    e => e instanceof AggregateError && e.errors.length === 2,
  );
  assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
  assert.equal(f.stats.contexts, 0);
  f.pool.settle();
  assert.equal(f.counts().losses, 2);
});

test('idle resize and lost-state inspection failures retire rather than park uncertain contexts', () => {
  for (const mode of ['resize', 'inspect']) {
    const f = fixture(),
      a = f.pool.lease({role: 'stage'})!;
    const cause = Error(mode);
    if (mode === 'resize') f.fail.resize = true;
    else
      f.deps.backend.isLost = () => {
        throw cause;
      };
    assert.throws(
      () => a.release(),
      e => e === (mode === 'resize' ? f.errors.resize : cause),
    );
    assert.deepEqual(f.pool.counts(), {contexts: 0, views: 0});
    assert.equal(f.stats.contexts, 0);
    assert.equal(f.counts().losses, 1);
    a.release();
    assert.equal(f.counts().disposed, 1);
  }
});

test('partial pixel-ratio setup uses installed wrapper cleanup and preserves an existing sibling', () => {
  const f = fixture(),
    sibling = f.pool.lease({role: 'stage'})!;
  const setup = Error('pixel ratio setup');
  const original = f.deps.pixelRatio;
  f.deps.pixelRatio = (r, max) => {
    original(r, max);
    throw setup;
  };
  assert.throws(
    () => f.pool.lease({role: 'stage'}),
    e => e === setup,
  );
  assert.equal(f.counts().wrappers, 1);
  assert.equal(f.counts().disposed, 1);
  assert.deepEqual(f.pool.counts(), {contexts: 1, views: 1});
  assert.equal(f.counts().losses, 0);
  sibling.release();
  assert.equal(f.counts().losses, 1);
});
