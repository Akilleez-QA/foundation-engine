import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeDom} from '../testing/fake-dom';
import type {ReadingSheetOptions} from './defs';
import {LayerManager, type LayerSpec} from '../platform/ui/layers';
import {ActivityHost, type ActivityContext} from '../core/activity/activity';
import {FrameLoop} from '../core/activity/loop';
import {createReadingSheets} from './reading-sheet';

async function fixture() {
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document;
  const overlay = doc.createElement('div');
  doc.body.append(overlay);
  const layers = new LayerManager(doc);
  const requests = new Map<number, (time: number) => void>();
  let serial = 0,
    ticks = 0,
    canceled = 0;
  const loop = new FrameLoop({
    layers,
    calm: () => false,
    scheduler: {
      request(fn) {
        requests.set(++serial, fn);
        return serial;
      },
      cancel(id) {
        requests.delete(id);
      },
    },
  });
  const host = new ActivityHost({loop, layers, calm: () => false});
  let parent!: ActivityContext;
  const run = await host.start(
    {
      id: 'demo',
      kind: 'scene',
      enter(ctx) {
        parent = ctx;
        const spec: LayerSpec = {id: ctx.runId, kind: 'scene', element: overlay, cover: 'opaque'};
        ctx.layer(spec);
        return {
          frameMode: 'continuous',
          update() {
            ticks++;
          },
        };
      },
    },
    undefined,
  );
  const sheets = createReadingSheets(parent, overlay, {
    canOpen: () => parent.coverage() === 'top',
    cancelInput() {
      canceled++;
    },
  });
  parent.own(() => sheets.dispose());
  const options = (id = 'details'): ReadingSheetOptions => ({
    id,
    element: doc.createElement('section'),
    initialFocus: () => null,
    returnFocus: () => null,
  });
  const step = (time: number) => {
    const callbacks = [...requests.values()];
    requests.clear();
    callbacks.forEach(fn => fn(time));
  };
  return {
    fake,
    doc,
    overlay,
    layers,
    loop,
    host,
    parent,
    run,
    sheets,
    options,
    step,
    get ticks() {
      return ticks;
    },
    get canceled() {
      return canceled;
    },
    close() {
      run.stop('exit');
      loop.dispose();
      fake.restore();
    },
  };
}

test('reading sheet uses child ownership, pauses parent and returns to baseline after 100 toggles', async () => {
  const f = await fixture();
  try {
    f.step(1);
    const before = f.ticks;
    for (let i = 0; i < 100; i++) {
      const opts = f.options();
      const sheet = f.sheets.open(opts);
      await sheet.ready;
      assert.equal(f.host.running().length, 2);
      assert.equal(f.parent.coverage(), 'scrim');
      f.step(i + 10);
      assert.equal(f.ticks, before);
      assert.equal(opts.element.parentElement, f.overlay);
      sheet.close();
      sheet.close();
      assert.equal(sheet.signal.aborted, true);
      assert.equal(opts.element.parentElement, null);
      assert.equal(f.host.running().length, 1);
      assert.equal(f.parent.coverage(), 'top');
    }
    f.step(1000);
    assert.equal(f.ticks, before + 1);
    assert.equal(f.canceled, 100);
  } finally {
    f.close();
  }
});

test('reading sheet close before ready and replacement retire old child and element', async () => {
  const f = await fixture();
  try {
    const opts = f.options(),
      first = f.sheets.open(opts);
    first.close();
    await first.ready;
    assert.equal(first.signal.aborted, true);
    assert.equal(opts.element.parentElement, null);
    const second = f.sheets.open(f.options()),
      third = f.sheets.open(f.options('more'));
    await Promise.all([second.ready, third.ready]);
    assert.equal(second.signal.aborted, true);
    assert.equal(third.signal.aborted, false);
    assert.equal(f.host.running().length, 2);
    third.close();
  } finally {
    f.close();
  }
});

test('parent exit during child entry retires pending sheet and rejects later opening', async () => {
  const f = await fixture();
  try {
    const opts = f.options(),
      pending = f.sheets.open(opts);
    f.run.stop('exit');
    await pending.ready;
    assert.equal(pending.signal.aborted, true);
    assert.equal(opts.element.parentElement, null);
    assert.equal(f.host.running().length, 0);
    assert.throws(() => f.sheets.open(f.options()), /has left/);
  } finally {
    f.close();
  }
});

test('layer entry failure rejects ready and releases mounted element and child', async () => {
  const f = await fixture();
  try {
    const opts = f.options();
    opts.initialFocus = () => {
      throw Error('focus failed');
    };
    const sheet = f.sheets.open(opts);
    await assert.rejects(sheet.ready, /focus failed/);
    await Promise.resolve();
    assert.equal(sheet.signal.aborted, true);
    assert.equal(opts.element.parentElement, null);
    assert.equal(f.host.running().length, 1);
    assert.equal(f.parent.coverage(), 'top');
  } finally {
    f.close();
  }
});

test('invalid id and foreign host rejection leave current sheet intact', async () => {
  const f = await fixture();
  try {
    const current = f.sheets.open(f.options());
    await current.ready;
    assert.throws(() => f.sheets.open(f.options('INVALID')), /local id/);
    assert.throws(() => f.sheets.open({...f.options(), element: f.overlay}), /host/);
    assert.equal(current.signal.aborted, false);
    current.close();
  } finally {
    f.close();
  }
});

test('Back retires child and restores focus through the existing layer manager', async () => {
  const f = await fixture();
  try {
    const opener = f.doc.createElement('button');
    f.overlay.append(opener);
    opener.focus();
    const opts = f.options(),
      close = f.doc.createElement('button');
    opts.element.append(close);
    opts.initialFocus = () => close;
    opts.returnFocus = () => opener;
    const sheet = f.sheets.open(opts);
    await sheet.ready;
    assert.equal(f.doc.activeElement, close);
    assert.equal(f.layers.escape(), true);
    assert.equal(sheet.signal.aborted, true);
    assert.equal(f.doc.activeElement, opener);
    assert.equal(f.host.running().length, 1);
  } finally {
    f.close();
  }
});

test('cancel before delayed child adoption prevents late mounting', async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const wait = new Promise<void>(resolve => {
      release = resolve;
    });
    const delayed: ActivityContext = {
      ...f.parent,
      async start(child, params) {
        await wait;
        return f.parent.start(child, params);
      },
    };
    const sheets = createReadingSheets(delayed, f.overlay, {canOpen: () => true, cancelInput() {}});
    const opts = f.options(),
      pending = sheets.open(opts);
    pending.close();
    await pending.ready;
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opts.element.parentElement, null);
    assert.equal(f.host.running().length, 1);
    sheets.dispose();
  } finally {
    f.close();
  }
});

test('cancellation callbacks cannot make a sheet steal input from a newly opened layer', async () => {
  const f = await fixture();
  try {
    const sheets = createReadingSheets(f.parent, f.overlay, {
      canOpen: () => f.parent.coverage() === 'top',
      cancelInput() {
        f.layers.open({id: 'other', kind: 'modal', element: f.doc.createElement('section'), cover: 'opaque'});
      },
    });
    const opts = f.options(),
      sheet = sheets.open(opts);
    await assert.rejects(sheet.ready, /lost input ownership/);
    assert.equal(sheet.signal.aborted, true);
    assert.equal(opts.element.parentElement, null);
    assert.equal(f.layers.top()?.id, 'other');
    assert.equal(f.host.running().length, 1);
    sheets.dispose();
    f.layers.close('other');
  } finally {
    f.close();
  }
});

test('delayed entry uses admitted options and checks current input ownership', async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const wait = new Promise<void>(resolve => {
      release = resolve;
    });
    const delayed: ActivityContext = {
      ...f.parent,
      async start(child, params) {
        await wait;
        return f.parent.start(child, params);
      },
    };
    const sheets = createReadingSheets(delayed, f.overlay, {
      canOpen: () => f.parent.coverage() === 'top',
      cancelInput() {},
    });
    const opts = f.options(),
      admitted = opts.element,
      pending = sheets.open(opts);
    opts.element = f.overlay;
    opts.id = 'INVALID';
    opts.initialFocus = () => {
      throw Error('mutated');
    };
    release();
    await pending.ready;
    assert.equal(admitted.parentElement, f.overlay);
    assert.equal(pending.signal.aborted, false);
    pending.close();
    const blocked = sheets.open(f.options());
    f.layers.open({id: 'other', kind: 'modal', element: f.doc.createElement('section'), cover: 'opaque'});
    await assert.rejects(blocked.ready, /lost input ownership/);
    assert.equal(blocked.signal.aborted, true);
    assert.equal(f.host.running().length, 1);
    sheets.dispose();
    f.layers.close('other');
  } finally {
    f.close();
  }
});

test('replacement opened during cancellation keeps ownership of the pending sheet slot', async () => {
  const f = await fixture();
  try {
    let replace = true,
      replacement: ReturnType<typeof f.sheets.open> | undefined;
    const sheets = createReadingSheets(f.parent, f.overlay, {
      canOpen: () => f.parent.coverage() === 'top',
      cancelInput() {
        if (replace) {
          replace = false;
          replacement = sheets.open(f.options('replacement'));
        }
      },
    });
    const firstOptions = f.options(),
      first = sheets.open(firstOptions);
    await Promise.all([first.ready, replacement!.ready]);
    assert.equal(first.signal.aborted, true);
    assert.equal(firstOptions.element.parentElement, null);
    assert.equal(replacement!.signal.aborted, false);
    assert.equal(f.host.running().length, 2);
    sheets.dispose();
    assert.equal(replacement!.signal.aborted, true);
    assert.equal(f.host.running().length, 1);
  } finally {
    f.close();
  }
});
