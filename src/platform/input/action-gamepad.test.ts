import test from 'node:test';
import assert from 'node:assert/strict';
import {installActionGamepad} from './action-gamepad';
import {InputActions, inputActionRegistry, type ActionLayerInfo, type ActionLayers, type PadInput} from './actions';
import {FrameLoop, type TickerSpec} from '../../core/activity/loop';
import {LayerManager} from '../ui/layers';
import {installFakeDom} from '../../testing/fake-dom';
import {must} from '../../testing/must';
import type {PadLike} from './gamepad';

function rig() {
  const signal = new AbortController(),
    win = new EventTarget(),
    doc = Object.assign(new EventTarget(), {hidden: false, hasFocus: () => true});
  const ticks = new Set<TickerSpec>();
  let layers: ActionLayerInfo[] = [{id: 'scene', kind: 'scene', owner: 'scene#1', modal: false}];
  const changes = new Set<() => void>();
  const port: ActionLayers = {
    fromTop: () => layers,
    escape: () => false,
    cycleFocus: () => false,
    onChange(fn, signal) {
      changes.add(fn);
      const off = () => {
        changes.delete(fn);
      };
      signal?.addEventListener('abort', off, {once: true});
      return off;
    },
  };
  const actions = new InputActions(
    {
      registry: inputActionRegistry([
        {id: 'test.move', label: 'move', kind: 'hold', scope: 'global', defaults: {pad: ['a', 'ls-right']}},
      ]),
      layers: port,
      now: () => 0,
    },
    signal.signal,
  );
  const edges: {input: PadInput; pressed: boolean}[] = [];
  const original = actions.padFrame.bind(actions);
  actions.padFrame = incoming => {
    edges.push(...incoming);
    original(incoming);
  };
  const pad: PadLike = {
    index: 0,
    id: 'Xbox',
    mapping: 'standard',
    connected: true,
    buttons: Array.from({length: 17}, () => ({pressed: false, value: 0})),
    axes: [0, 0, 0, 0],
  };
  let pads: (PadLike | null)[] = [pad],
    reads = 0;
  const adapter = installActionGamepad({
    input: actions,
    layers: port,
    doc,
    win,
    signal: signal.signal,
    getPads: () => {
      reads++;
      return pads;
    },
    loop: {
      add(spec) {
        ticks.add(spec);
        let removed = false;
        return {
          invalidate() {},
          setMode() {},
          remove() {
            removed = true;
            ticks.delete(spec);
          },
          get removed() {
            return removed;
          },
        };
      },
    },
  });
  return {
    signal,
    win,
    doc,
    ticks,
    edges,
    pad,
    adapter,
    actions,
    reads: () => reads,
    setPads: (value: (PadLike | null)[]) => {
      pads = value;
    },
    button(i: number, value: number) {
      (pad.buttons as {pressed: boolean; value: number}[])[i] = {pressed: value > 0.5, value};
    },
    tick() {
      for (const t of [...ticks]) t.update?.({} as never);
    },
    layer() {
      layers = [{id: 'modal', kind: 'modal', owner: 'modal#2', modal: 'page'}];
      for (const fn of [...changes]) fn();
    },
  };
}

test('app controller emits position edges only, once per change, through current effective bindings', () => {
  const r = rig();
  try {
    assert.equal(r.ticks.size, 1);
    assert.equal(r.adapter.family, 'xbox');
    r.button(0, 1);
    r.tick();
    r.tick();
    assert.deepEqual(r.edges, [{input: 'a', pressed: true}]);
    r.button(0, 0);
    r.tick();
    assert.deepEqual(r.edges.at(-1), {input: 'a', pressed: false});
    r.actions.setOverrides({'test.move': {pad: ['x']}});
    r.tick();
    r.button(2, 1);
    r.tick();
    assert.deepEqual(r.edges.at(-1), {input: 'x', pressed: true});
    assert.equal(r.reads(), 6, 'one snapshot read per initialization/poll');
  } finally {
    r.signal.abort();
  }
  assert.equal(r.ticks.size, 0);
});

test('focus, hidden pages, connection replacement and owner changes demand neutral before new input', () => {
  const r = rig();
  try {
    r.button(0, 1);
    r.tick();
    r.win.dispatchEvent(new Event('blur'));
    assert.equal(r.ticks.size, 0);
    r.win.dispatchEvent(new Event('focus'));
    r.tick();
    assert.equal(r.edges.filter(e => e.pressed).length, 1);
    r.button(0, 0);
    r.tick();
    r.button(0, 1);
    r.tick();
    assert.equal(r.edges.filter(e => e.pressed).length, 2);
    r.layer();
    assert.equal(r.ticks.size, 1);
    assert.equal(must([...r.ticks][0]).owner, 'platform.input.gamepad');
    r.tick();
    assert.equal(r.edges.filter(e => e.pressed).length, 2);
    r.doc.hidden = true;
    r.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(r.ticks.size, 0);
    r.doc.hidden = false;
    r.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(r.ticks.size, 1);
    r.setPads([]);
    r.tick();
    assert.equal(r.ticks.size, 0);
    assert.equal(r.adapter.family, null);
    r.setPads([r.pad]);
    r.win.dispatchEvent(new Event('gamepadconnected'));
    r.tick();
    assert.equal(r.edges.filter(e => e.pressed).length, 2);
  } finally {
    r.signal.abort();
  }
  r.win.dispatchEvent(new Event('focus'));
  assert.equal(r.ticks.size, 0);
});

test('standard stick positions use hysteresis and unsupported layouts do not manufacture bindings', () => {
  const r = rig();
  try {
    (r.pad.axes as number[])[0] = 0.6;
    r.tick();
    assert.deepEqual(r.edges.at(-1), {input: 'ls-right', pressed: true});
    (r.pad.axes as number[])[0] = 0.4;
    r.tick();
    assert.equal(r.edges.length, 1);
    (r.pad.axes as number[])[0] = 0.3;
    r.tick();
    assert.deepEqual(r.edges.at(-1), {input: 'ls-right', pressed: false});
    r.pad.mapping = '';
    r.tick();
    assert.equal(r.ticks.size, 0);
  } finally {
    r.signal.abort();
  }
});

test('a reentrant owner change discards simultaneous presses and leaves one neutral-gated ticker', () => {
  const r = rig();
  try {
    const original = r.actions.pad.bind(r.actions);
    let changed = false;
    r.actions.pad = (input, pressed) => {
      const result = original(input, pressed);
      if (input === 'a' && pressed && !changed) {
        changed = true;
        r.layer();
      }
      return result;
    };
    r.button(0, 1);
    r.button(2, 1);
    r.tick();
    assert.equal(r.ticks.size, 1);
    assert.equal(must([...r.ticks][0]).owner, 'platform.input.gamepad');
    r.button(0, 0);
    r.button(2, 0);
    r.tick();
    // A later discarded x edge must not stay blocked forever after the neutral sample.
    let presses = 0;
    const before = r.actions.pad.bind(r.actions);
    r.actions.pad = (input, pressed) => {
      if (input === 'x' && pressed) presses++;
      return before(input, pressed);
    };
    r.button(2, 1);
    r.tick();
    assert.equal(presses, 1);
  } finally {
    r.signal.abort();
  }
});

test('aborting the app from a dispatched edge leaves no ticker or restart listeners', () => {
  const r = rig();
  const original = r.actions.pad.bind(r.actions);
  r.actions.pad = (input, pressed) => {
    const result = original(input, pressed);
    if (pressed) r.signal.abort();
    return result;
  };
  r.button(0, 1);
  r.tick();
  assert.equal(r.ticks.size, 0);
  r.win.dispatchEvent(new Event('gamepadconnected'));
  r.win.dispatchEvent(new Event('focus'));
  assert.equal(r.ticks.size, 0);
  assert.equal(r.adapter.family, null);
});

test('held trigger below press threshold cannot rearm until it crosses the release threshold', () => {
  const r = rig();
  try {
    r.button(6, 0.7);
    r.tick();
    r.actions.cancel('owner');
    r.button(6, 0.5);
    r.tick();
    r.button(6, 0.56);
    r.tick();
    assert.equal(r.edges.filter(e => e.input === 'lt' && e.pressed).length, 1);
    r.button(6, 0.44);
    r.tick();
    r.button(6, 0.56);
    r.tick();
    assert.equal(r.edges.filter(e => e.input === 'lt' && e.pressed).length, 2);
  } finally {
    r.signal.abort();
  }
});

test('real loop keeps app controller polling beneath an ownerless opaque modal while scene updates pause', () => {
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document,
    win = new EventTarget(),
    ctl = new AbortController();
  const callbacks = new Map<number, (t: number) => void>();
  let serial = 0,
    sceneFrames = 0;
  const layers = new LayerManager(doc);
  const scene = doc.createElement('section');
  doc.body.append(scene);
  layers.open({id: 'scene', kind: 'scene', owner: 'scene#1', element: scene, modal: false});
  const loop = new FrameLoop({
    layers,
    calm: () => false,
    now: () => 0,
    scheduler: {
      request(fn) {
        callbacks.set(++serial, fn);
        return serial;
      },
      cancel(id) {
        callbacks.delete(id);
      },
    },
  });
  const frame = (t: number) => {
    const work = [...callbacks.values()];
    callbacks.clear();
    for (const fn of work) fn(t);
  };
  loop.add({
    owner: 'scene#1',
    mode: 'continuous',
    update() {
      sceneFrames++;
    },
  });
  const pad: PadLike = {
    index: 0,
    id: 'Xbox',
    mapping: 'standard',
    connected: true,
    buttons: Array.from({length: 17}, () => ({pressed: false, value: 0})),
    axes: [0, 0, 0, 0],
  };
  let reads = 0;
  const edges: {input: PadInput; pressed: boolean}[] = [];
  const input = {
    padFrame(batch: readonly {input: PadInput; pressed: boolean}[]) {
      edges.push(...batch);
    },
    cancel() {},
    onCancel() {
      return () => {};
    },
  };
  installActionGamepad({
    input,
    layers,
    loop,
    doc: Object.assign(new EventTarget(), {hidden: false, hasFocus: () => true}),
    win,
    signal: ctl.signal,
    getPads: () => {
      reads++;
      return [pad];
    },
  });
  try {
    frame(16);
    const before = sceneFrames;
    const modal = doc.createElement('section');
    doc.body.append(modal);
    layers.open({id: 'ownerless', kind: 'modal', element: modal, cover: 'opaque'});
    frame(32);
    const beforeReads = reads;
    (pad.buttons as {pressed: boolean; value: number}[])[0] = {pressed: true, value: 1};
    frame(48);
    assert.equal(sceneFrames, before);
    assert.equal(reads, beforeReads + 1);
    assert.deepEqual(edges.at(-1), {input: 'a', pressed: true});
    loop.setHidden(true);
    frame(64);
    assert.equal(reads, beforeReads + 1);
    ctl.abort();
    assert.equal(callbacks.size, 0);
  } finally {
    ctl.abort();
    loop.dispose();
    fake.restore();
  }
});
