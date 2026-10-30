import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeDom} from '../../testing/fake-dom';
import {LayerManager, LAYER_KINDS, LAYER_RANK, type CloseReason} from './layers';
import type {LayerPort} from '../../core/activity/ports';

function dom() {
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document;
  const header = doc.createElement('header'),
    main = doc.createElement('main');
  doc.body.append(header, main);
  const headerButton = doc.createElement('button');
  header.append(headerButton);
  return {fake, doc, header, main, headerButton};
}
const button = (doc: Document, parent: HTMLElement) => {
  const b = doc.createElement('button');
  parent.append(b);
  return b;
};

test('kinds are ranked scene < panel < sheet < modal < toast, and the manager satisfies the kernel LayerPort shape', () => {
  assert.deepEqual(
    [...LAYER_KINDS].sort((a, b) => LAYER_RANK[a] - LAYER_RANK[b]),
    ['scene', 'panel', 'sheet', 'modal', 'toast'],
  );
  const {fake, doc} = dom();
  try {
    const port: LayerPort = new LayerManager(doc);
    assert.equal(port.coverage('nobody'), 'top');
  } finally {
    fake.restore();
  }
});

test('a panel inside its scene makes the rest of the scene inert but not itself; the shell stays usable; focus returns', () => {
  const {fake, doc, header, main} = dom();
  try {
    const layers = new LayerManager(doc, {shell: () => [header]});
    const scene = doc.createElement('section'),
      walkPad = doc.createElement('div'),
      label = button(doc, scene);
    scene.append(walkPad);
    main.append(scene);
    layers.open({id: 'scene.hall', kind: 'scene', element: scene, owner: 'hall#1'});
    label.focus();
    const panel = doc.createElement('section'),
      exit = button(doc, panel);
    scene.append(panel);
    const h = layers.open({
      id: 'panel.falling',
      kind: 'panel',
      element: panel,
      owner: 'falling#2',
      narration: 'intro-0',
      music: 'calm',
    });
    assert.equal(doc.activeElement, exit, 'focus moves into the panel');
    assert.equal(walkPad.inert, true);
    assert.equal(label.inert, true);
    assert.notEqual(scene.inert, true, 'an ancestor of the panel is never inert');
    assert.notEqual(panel.inert, true);
    assert.notEqual(header.inert, true, "a panel ('scope') leaves the shell usable");
    assert.equal(layers.coverage('hall#1'), 'scrim');
    assert.equal(layers.coverage('falling#2'), 'top');
    assert.equal(layers.narration('hall-scene'), 'intro-0');
    assert.equal(layers.music('home'), 'calm');
    const dialog = doc.createElement('div'),
      ok = button(doc, dialog);
    doc.body.append(dialog);
    const modal = layers.open({id: 'modal.sound', kind: 'modal', element: dialog, cover: 'opaque'});
    assert.equal(doc.activeElement, ok);
    assert.equal(header.inert, true, "a 'page' modal makes the shell inert");
    assert.equal(panel.inert, true);
    assert.equal(layers.coverage('hall#1'), 'opaque');
    modal.close('exit');
    assert.notEqual(header.inert, true);
    assert.equal(doc.activeElement, exit, 'focus returns to the opener');
    h.close('exit');
    assert.notEqual(walkPad.inert, true, 'inert restored');
    assert.equal(doc.activeElement, label, 'focus returns to the panel label');
    assert.equal(layers.coverage('hall#1'), 'top');
    assert.equal(layers.narration('hall-scene'), 'hall-scene');
  } finally {
    fake.restore();
  }
});

test('inert that a page set itself is restored as it was, not cleared', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc),
      scene = doc.createElement('section'),
      side = doc.createElement('div');
    side.inert = true;
    scene.append(side);
    main.append(scene);
    const dialog = doc.createElement('div');
    button(doc, dialog);
    doc.body.append(dialog);
    layers.open({id: 'scene.x', kind: 'scene', element: scene});
    const m = layers.open({id: 'modal.x', kind: 'modal', element: dialog});
    assert.equal(scene.inert, true);
    m.close();
    assert.notEqual(scene.inert, true);
    assert.equal(side.inert, true, 'pre-existing inert kept');
  } finally {
    fake.restore();
  }
});

test('a stage-window panel (VAB bench) leaves its scene drawing; toasts never own input or cover', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc),
      scene = doc.createElement('section'),
      card = doc.createElement('div');
    main.append(scene);
    scene.append(card);
    layers.open({id: 'scene.workshop', kind: 'scene', element: scene, owner: 'workshop#1'});
    layers.open({id: 'panel.vab-paint', kind: 'panel', element: card, owner: 'vab#2', cover: 'none'});
    assert.equal(layers.coverage('workshop#1'), 'top');
    const toast = doc.createElement('div');
    doc.body.append(toast);
    layers.open({id: 'toast.notice', kind: 'toast', element: toast});
    assert.equal(layers.top()?.id, 'panel.vab-paint', 'a toast is never the top interactive layer');
    assert.equal(layers.coverage('vab#2'), 'top');
  } finally {
    fake.restore();
  }
});

test('Escape closes only the top layer, once; a scene never closes; a declining modal still owns Escape', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc),
      closes: string[] = [];
    const scene = doc.createElement('section');
    main.append(scene);
    layers.open({id: 'scene.home', kind: 'scene', element: scene});
    const mk = (id: string, kind: 'panel' | 'sheet') => {
      const el = doc.createElement('div');
      button(doc, el);
      scene.append(el);
      return layers.open({id, kind, element: el, onClose: r => closes.push(`${id}:${r}`)});
    };
    const panel = mk('panel.hockey', 'panel');
    mk('sheet.map', 'sheet');
    assert.equal(layers.escape(), true);
    assert.deepEqual(closes, ['sheet.map:escape'], 'only the top layer closed');
    assert.equal(panel.closed, false);
    // A handler that re-enters Escape (a legacy listener echoing it) does not close a second layer.
    const inner = doc.createElement('div');
    button(doc, inner);
    scene.append(inner);
    let reentered: boolean | null = null;
    const echo = layers.open({
      id: 'sheet.echo',
      kind: 'sheet',
      element: inner,
      onEscape: () => {
        reentered = layers.escape();
        echo.close('escape');
      },
    });
    assert.equal(layers.escape(), true);
    assert.equal(reentered, true, 'the nested Escape is swallowed');
    assert.equal(panel.closed, false, 'the panel below survived the echoed Escape');
    assert.equal(layers.escape(), true);
    assert.deepEqual(closes.at(-1), 'panel.hockey:escape');
    assert.equal(layers.escape(), false, 'a scene never closes on Escape');
    const d = doc.createElement('div');
    button(doc, d);
    doc.body.append(d);
    const stubborn = layers.open({id: 'modal.reset', kind: 'modal', element: d, onEscape: () => false});
    assert.equal(layers.escape(), true, 'a modal that declines Escape still owns it');
    assert.equal(stubborn.closed, false);
  } finally {
    fake.restore();
  }
});

test('focus returns on close: to returnFocus, else the opener, else the next top layer when the opener is gone', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc),
      scene = doc.createElement('section'),
      a = button(doc, scene),
      b = button(doc, scene);
    main.append(scene);
    layers.open({id: 'scene.p', kind: 'scene', element: scene});
    a.focus();
    const s1 = doc.createElement('div');
    button(doc, s1);
    scene.append(s1);
    layers.open({id: 'sheet.one', kind: 'sheet', element: s1, returnFocus: () => b}).close('exit');
    assert.equal(doc.activeElement, b, 'returnFocus wins');
    const s2 = doc.createElement('div');
    button(doc, s2);
    scene.append(s2);
    const h = layers.open({id: 'sheet.two', kind: 'sheet', element: s2});
    scene.tabIndex = 0;
    b.remove();
    h.close();
    assert.equal(doc.activeElement, scene, 'the opener left the page: focus goes to the layer now on top');
  } finally {
    fake.restore();
  }
});

test('Tab cycles inside the top modal layer, and a focus guard pulls stray focus back in (not from the shell under a scope layer)', () => {
  const {fake, doc, header, headerButton} = dom();
  try {
    const layers = new LayerManager(doc, {shell: () => [header]});
    const d = doc.createElement('div'),
      a = button(doc, d),
      b = button(doc, d);
    doc.body.append(d);
    layers.open({id: 'panel.reset', kind: 'panel', element: d});
    assert.equal(doc.activeElement, a);
    layers.cycleFocus(false);
    assert.equal(doc.activeElement, b);
    layers.cycleFocus(false);
    assert.equal(doc.activeElement, a, 'wraps');
    layers.cycleFocus(true);
    assert.equal(doc.activeElement, b);
    const outside = button(doc, doc.body);
    assert.equal(layers.containFocus(outside), true);
    assert.equal(doc.activeElement, a);
    assert.equal(layers.containFocus(headerButton), false, "the shell stays usable under a 'scope' layer");
  } finally {
    fake.restore();
  }
});

test('a dormant layer is inert, covers nothing and owns nothing until it activates', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc),
      changes: string[] = [];
    layers.onChange(c => changes.push(`${c.reason}:${c.top?.id ?? '-'}`));
    const old = doc.createElement('section'),
      next = doc.createElement('section'),
      go = button(doc, next);
    main.append(old, next);
    layers.open({id: 'scene.old', kind: 'scene', element: old, owner: 'old#1', narration: 'old'});
    const h = layers.open({
      id: 'panel.next',
      kind: 'panel',
      element: next,
      owner: 'next#2',
      narration: 'new',
      dormant: true,
    });
    assert.equal(layers.top()?.id, 'scene.old');
    assert.equal(layers.coverage('old#1'), 'top');
    assert.equal(layers.narration('x'), 'old');
    assert.equal(next.inert, true);
    assert.notEqual(doc.activeElement, go);
    h.activate();
    assert.equal(layers.top()?.id, 'panel.next');
    assert.equal(layers.coverage('old#1'), 'scrim');
    assert.notEqual(next.inert, true);
    assert.equal(doc.activeElement, go);
    assert.equal(layers.narration('x'), 'new');
    assert.deepEqual(changes, ['push:scene.old', 'push:scene.old', 'activate:panel.next']);
  } finally {
    fake.restore();
  }
});

test('reopening an id replaces it; closeOwned closes an owner top first; a throwing listener is isolated', () => {
  const {fake, doc, main} = dom();
  try {
    const reported: unknown[] = [],
      layers = new LayerManager(doc, {report: e => reported.push(e)});
    const reasons: CloseReason[] = [],
      order: string[] = [];
    const scene = doc.createElement('section');
    main.append(scene);
    layers.open({id: 'scene.p', kind: 'scene', element: scene, owner: 'p#1', onClose: () => order.push('scene')});
    const el = doc.createElement('div');
    scene.append(el);
    layers.open({
      id: 'sheet.s',
      kind: 'sheet',
      element: el,
      owner: 'p#1',
      onClose: r => {
        reasons.push(r);
        order.push('sheet');
      },
    });
    layers.open({id: 'sheet.s', kind: 'sheet', element: el, owner: 'p#1', onClose: () => order.push('sheet2')});
    assert.deepEqual(reasons, ['replaced']);
    assert.equal(layers.stack().length, 2);
    let heard = 0;
    layers.onChange(() => {
      throw new Error('boom');
    });
    layers.onChange(() => {
      heard++;
    });
    layers.closeOwned('p#1');
    assert.deepEqual(order, ['sheet', 'sheet2', 'scene']);
    assert.equal(layers.stack().length, 0);
    assert.equal(heard, 2);
    assert.equal(reported.length, 2);
    assert.equal(layers.close('nope'), false);
  } finally {
    fake.restore();
  }
});

test('a scene layer (showActivity) never takes or returns focus and makes nothing inert', () => {
  const {fake, doc, main, headerButton} = dom();
  try {
    const layers = new LayerManager(doc, {shell: () => []});
    const scene = doc.createElement('section'),
      inside = button(doc, scene);
    main.append(scene);
    headerButton.focus();
    const h = layers.open({
      id: 'scene',
      kind: 'scene',
      element: scene,
      owner: 'scene:home',
      cover: 'none',
      modal: false,
    });
    assert.equal(doc.activeElement, headerButton, 'opening a scene leaves focus alone');
    inside.focus();
    h.close('exit');
    assert.equal(doc.activeElement, inside, 'closing a scene leaves focus alone');
    assert.notEqual(scene.inert, true);
  } finally {
    fake.restore();
  }
});

test('the frame loop reads coverage from the layer manager: a covered scene pauses, then resumes with dt = 0', async () => {
  const {fake, doc, main} = dom();
  try {
    const {createLoop} = await import('./runtime');
    const layers = new LayerManager(doc),
      pending = new Map<number, (t: number) => void>();
    let serial = 0;
    const loop = createLoop({
      layers,
      scheduler: {
        request: cb => {
          pending.set(++serial, cb);
          return serial;
        },
        cancel: id => {
          pending.delete(id);
        },
      },
    });
    const run = (t: number) => {
      const w = [...pending.values()];
      pending.clear();
      w.forEach(cb => cb(t));
    };
    const scene = doc.createElement('section');
    main.append(scene);
    layers.open({id: 'scene', kind: 'scene', element: scene, owner: 'scene:hall', modal: false});
    const dts: number[] = [];
    loop.add({owner: 'scene:hall', mode: 'continuous', render: f => dts.push(f.dt)});
    run(0);
    run(16);
    const sheet = doc.createElement('div');
    button(doc, sheet);
    doc.body.append(sheet);
    const cover = layers.open({id: 'modal.x', kind: 'modal', element: sheet, cover: 'scrim'});
    assert.equal(pending.size, 0, 'a paused scene asks for no frames');
    cover.close('exit');
    run(1000);
    run(1016);
    assert.deepEqual(dts, [0, 0.016, 0, 0.016]);
    loop.dispose();
  } finally {
    fake.restore();
  }
});

test("inertHost: a non-modal layer makes its host card's other children inert, keeps each one's own flag and moves no focus", () => {
  const {fake, doc, header, main} = dom();
  try {
    const layers = new LayerManager(doc, {shell: () => [header]});
    const card = doc.createElement('section'),
      canvas = doc.createElement('div');
    card.append(canvas);
    const hud = button(doc, card),
      hidden = doc.createElement('div');
    hidden.inert = true;
    card.append(hidden);
    main.append(card);
    const side = doc.createElement('div');
    main.append(side);
    hud.focus();
    const game = doc.createElement('section');
    button(doc, game);
    const h = layers.open({
      id: 'minigame-host:chair',
      kind: 'panel',
      element: game,
      cover: 'none',
      modal: false,
      inertHost: card,
      onEscape: () => false,
    });
    card.append(game);
    assert.equal(canvas.inert, true);
    assert.equal(hud.inert, true);
    assert.equal(hidden.inert, true);
    assert.notEqual(side.inert, true, 'only the host card: nothing beside it');
    assert.notEqual(header.inert, true);
    assert.equal(doc.activeElement, hud, 'a non-modal layer takes no focus');
    // A later layer recomputes the inert set: the game (now a child of the card) stays usable.
    const d = doc.createElement('div');
    button(doc, d);
    doc.body.append(d);
    layers.open({id: 'toast.x', kind: 'toast', element: d});
    assert.notEqual(game.inert, true, "the layer's own element is never inert");
    assert.equal(layers.escape(), false, 'it leaves Escape to the layer below it');
    h.close();
    h.close();
    assert.notEqual(canvas.inert, true);
    assert.notEqual(hud.inert, true);
    assert.equal(hidden.inert, true, 'pre-existing inert kept');
  } finally {
    fake.restore();
  }
});

test('change subscriptions reject retired signals and manual removal detaches abort ownership', () => {
  const {fake, doc} = dom();
  try {
    const layers = new LayerManager(doc),
      ctl = new AbortController();
    let calls = 0,
      attached = 0;
    const add = ctl.signal.addEventListener.bind(ctl.signal),
      remove = ctl.signal.removeEventListener.bind(ctl.signal);
    ctl.signal.addEventListener = (...args: Parameters<AbortSignal['addEventListener']>) => {
      attached++;
      add(...args);
    };
    ctl.signal.removeEventListener = (...args: Parameters<AbortSignal['removeEventListener']>) => {
      attached--;
      remove(...args);
    };
    layers.onChange(() => {
      calls++;
    }, AbortSignal.abort());
    const off = layers.onChange(() => {
      calls++;
    }, ctl.signal);
    assert.equal(attached, 1);
    off();
    assert.equal(attached, 0);
    layers.open({id: 'owned', kind: 'scene', element: doc.createElement('section')});
    assert.equal(calls, 0);
    ctl.abort();
    assert.equal(attached, 0);
  } finally {
    fake.restore();
  }
});

test('modal activation rejects disabled, inert, outside and nonactionable focused elements', () => {
  const {fake, doc, main, headerButton} = dom();
  try {
    const layers = new LayerManager(doc),
      panel = doc.createElement('section');
    main.append(panel);
    const action = button(doc, panel),
      passive = doc.createElement('div');
    passive.tabIndex = 0;
    passive.setAttribute('tabindex', '0');
    panel.append(passive);
    layers.open({id: 'reading', kind: 'sheet', element: panel, modal: 'scope'});
    let clicks = 0;
    for (const el of [action, passive, headerButton])
      el.addEventListener('click', () => {
        clicks++;
      });
    action.focus();
    action.disabled = true;
    assert.equal(layers.activateFocus(), false);
    assert.equal(clicks, 0);
    action.disabled = false;
    action.inert = true;
    assert.equal(layers.activateFocus(), false);
    assert.equal(clicks, 0);
    action.inert = false;
    action.setAttribute('aria-disabled', 'true');
    assert.equal(layers.activateFocus(), false);
    assert.equal(clicks, 0);
    action.removeAttribute('aria-disabled');
    passive.focus();
    assert.equal(layers.activateFocus(), false);
    headerButton.focus();
    assert.equal(layers.activateFocus(), false);
    assert.equal(clicks, 0);
    action.focus();
    assert.equal(layers.activateFocus(), true);
    assert.equal(clicks, 1);
  } finally {
    fake.restore();
  }
});

test('page movement requires focused marked region and clamps to its bounds', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc),
      panel = doc.createElement('section'),
      region = doc.createElement('div');
    region.tabIndex = 0;
    region.setAttribute('tabindex', '0');
    region.setAttribute('data-ui-scroll', '');
    panel.append(region);
    main.append(panel);
    Object.defineProperties(region, {clientHeight: {value: 100}, scrollHeight: {value: 250}});
    region.scrollTop = 0;
    const outside = button(doc, panel);
    layers.open({id: 'reading', kind: 'sheet', element: panel, modal: 'scope', initialFocus: () => region});
    layers.scrollFocus(1);
    assert.equal(region.scrollTop, 80);
    layers.scrollFocus(1);
    assert.equal(region.scrollTop, 150);
    assert.equal(layers.scrollFocus(1), true, 'a scrollable boundary stays owned');
    assert.equal(region.scrollTop, 150);
    layers.scrollFocus(-1);
    assert.equal(region.scrollTop, 70);
    outside.focus();
    assert.equal(layers.scrollFocus(1), false);
    assert.equal(region.scrollTop, 70);
    region.focus();
    region.removeAttribute('data-ui-scroll');
    assert.equal(layers.scrollFocus(1), false);
    assert.equal(region.scrollTop, 70);
  } finally {
    fake.restore();
  }
});

test('initial focus callback cannot steal focus back after opening a replacement modal', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc),
      first = doc.createElement('section'),
      next = doc.createElement('section');
    main.append(first, next);
    const oldButton = button(doc, first),
      nextButton = button(doc, next);
    layers.open({
      id: 'first',
      kind: 'sheet',
      element: first,
      initialFocus: () => {
        layers.open({id: 'next', kind: 'sheet', element: next, initialFocus: () => nextButton});
        return oldButton;
      },
    });
    assert.equal(doc.activeElement, nextButton);
  } finally {
    fake.restore();
  }
});

test('paging declines marked regions without overflow and native edit controls', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc),
      panel = doc.createElement('section'),
      region = doc.createElement('div');
    region.tabIndex = 0;
    region.setAttribute('tabindex', '0');
    region.setAttribute('data-ui-scroll', '');
    Object.defineProperties(region, {clientHeight: {value: 100}, scrollHeight: {value: 100}});
    region.scrollTop = 0;
    panel.append(region);
    main.append(panel);
    layers.open({id: 'short', kind: 'sheet', element: panel, modal: 'scope', initialFocus: () => region});
    assert.equal(layers.scrollFocus(1), false);
    assert.equal(layers.scrollFocus(-1), false);
    assert.equal(region.scrollTop, 0);
    const input = doc.createElement('input');
    region.append(input);
    input.focus();
    assert.equal(layers.scrollFocus(1), false);
    assert.equal(layers.activateFocus(), false);
  } finally {
    fake.restore();
  }
});

for (const callback of ['onClose', 'abort'] as const) {
  test(`same-id replacement from ${callback} supersedes an unadmitted outer open`, () => {
    const {fake, doc, main} = dom();
    try {
      const layers = new LayerManager(doc);
      const oldElement = doc.createElement('section');
      const outerElement = doc.createElement('section');
      const newestElement = doc.createElement('section');
      main.append(oldElement, outerElement, newestElement);
      const newestFocus = button(doc, newestElement);
      let newest: ReturnType<typeof layers.open> | undefined;
      let outerFocused = 0,
        outerClosed = 0;
      const replace = () => {
        newest = layers.open({id: 'sheet.shared', kind: 'sheet', element: newestElement});
      };
      const old = layers.open({
        id: 'sheet.shared',
        kind: 'sheet',
        element: oldElement,
        ...(callback === 'onClose' ? {onClose: replace} : {}),
      });
      if (callback === 'abort') old.signal.addEventListener('abort', replace, {once: true});
      const outer = layers.open({
        id: 'sheet.shared',
        kind: 'sheet',
        element: outerElement,
        initialFocus() {
          outerFocused++;
          return outerElement;
        },
        onClose() {
          outerClosed++;
        },
      });
      assert.equal(old.closed, true);
      assert.equal(outer.closed, true);
      assert.notEqual(outer, newest);
      assert.equal(newest!.closed, false);
      assert.deepEqual(layers.stack(), [newest]);
      assert.equal(doc.activeElement, newestFocus);
      assert.equal(outerFocused, 0);
      assert.equal(outerClosed, 0, 'an unadmitted request has no layer-close side effects');
      outer.close();
      assert.deepEqual(layers.stack(), [newest]);
      newest!.close();
      assert.equal(layers.stack().length, 0);
      const retry = layers.open({id: 'sheet.shared', kind: 'sheet', element: outerElement});
      assert.equal(retry.closed, false, 'completed admission does not reserve the id');
      retry.close();
    } finally {
      fake.restore();
    }
  });
}

test('ordinary replacement captures return focus after the old close callback', () => {
  const {fake, doc, main} = dom();
  try {
    const layers = new LayerManager(doc);
    const opener = button(doc, main);
    const first = doc.createElement('section'),
      second = doc.createElement('section');
    main.append(first, second);
    button(doc, first);
    button(doc, second);
    layers.open({
      id: 'sheet.replace',
      kind: 'sheet',
      element: first,
      onClose() {
        opener.focus();
      },
    });
    const replacement = layers.open({id: 'sheet.replace', kind: 'sheet', element: second});
    replacement.close();
    assert.equal(doc.activeElement, opener);
  } finally {
    fake.restore();
  }
});
