import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeDom} from '../../testing/fake-dom';
import {checkReach, inputActionRegistry, type ActionEvent} from '../input/actions';
import {LayerManager} from './layers';
import {APP_INPUT_ACTIONS, APP_INPUT_OVERRIDES, createInput, installAppInput, type InputWindow} from './runtime';
import {must} from '../../testing/must';

/**
 * M mute runs through the app's one dispatcher. The fake document stands in for window (it is the root
 * of every event path, so its capture listener runs first), and a bubble listener on it stands in for
 * src/input/keyboard.ts, which marks the keyboard device on every key in the bubble phase.
 */
function app(registry?: ReturnType<typeof inputActionRegistry>, signal?: AbortSignal) {
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document;
  const header = doc.createElement('header'),
    main = doc.createElement('main');
  doc.body.append(header, main);
  const layers = new LayerManager(doc, {shell: () => [header]});
  const scene = doc.createElement('section'),
    mover = doc.createElement('button');
  scene.append(mover);
  main.append(scene);
  layers.open({id: 'scene', kind: 'scene', element: scene, owner: 'scene:home', cover: 'none', modal: false});
  const input = createInput(doc as unknown as InputWindow, layers, signal, registry);
  const muted: ActionEvent[] = [];
  input.onAction('core.mute', e => {
    muted.push(e);
  });
  const seen: {key: string; prevented: boolean}[] = [];
  doc.addEventListener('keydown', (e: KeyboardEvent) => {
    seen.push({key: e.key, prevented: e.defaultPrevented});
  });
  let t = 100;
  const send = (target: EventTarget, type: 'keydown' | 'keyup', key: string, extra: Record<string, unknown> = {}) =>
    target.dispatchEvent({
      type,
      key,
      code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
      timeStamp: (t += 16),
      repeat: false,
      ...extra,
    } as unknown as Event);
  const press = (target: EventTarget, key: string, extra: Record<string, unknown> = {}) => {
    send(target, 'keydown', key, extra);
    send(target, 'keyup', key, extra);
  };
  const modal = () => {
    const dialog = doc.createElement('div'),
      ok = doc.createElement('button');
    dialog.append(ok);
    doc.body.append(dialog);
    // A panel that stops keydown in the bubble phase (panel panels, a photo booth, a travel map).
    dialog.addEventListener('keydown', (e: Event) => e.stopPropagation());
    layers.open({id: 'modal.sound', kind: 'modal', element: dialog, cover: 'opaque'});
    return {dialog, ok};
  };
  return {fake, doc, layers, input, muted, seen, mover, send, press, modal, now: () => t};
}

test('focus capture retires keyboard holds for editable targets without consuming native focus and respects abort', () => {
  const ctl = new AbortController();
  const a = app(
    inputActionRegistry([
      {id: 'test.move', label: 'move', scope: 'global', kind: 'hold', defaults: {keys: ['w'], pad: ['ls-up']}},
    ]),
    ctl.signal,
  );
  const {fake, doc, input, mover: scene} = a;
  input.claimFrames('scene:home');
  const down = () => input.keyDown({key: 'w', code: 'KeyW', target: scene, preventDefault() {}, stopPropagation() {}});
  try {
    for (const tag of ['input', 'textarea', 'select', 'div']) {
      const field = doc.createElement(tag);
      if (tag === 'div') field.setAttribute('contenteditable', 'true');
      scene.append(field);
      down();
      assert.equal(input.held('test.move'), true);
      assert.equal(field.dispatchEvent({type: 'focusin'} as Event), true, 'native focus not prevented');
      assert.equal(input.held('test.move'), false, tag);
      assert.deepEqual(input.drain('scene:home'), []);
      input.keyUp({key: 'w', code: 'KeyW'});
    }
    const button = doc.createElement('button');
    scene.append(button);
    down();
    button.dispatchEvent({type: 'focusin'} as Event);
    assert.equal(input.held('test.move'), true, 'noneditable focus preserves hold');
    ctl.abort();
    const field = doc.createElement('input');
    scene.append(field);
    field.dispatchEvent({type: 'focusin'} as Event);
    assert.equal(input.held('test.move'), true, 'aborted bridge no longer observes focus');
  } finally {
    fake.restore();
  }
});

test('M mutes under a modal, even when the modal stops keydown, and the key is not consumed', () => {
  const a = app();
  try {
    const {ok} = a.modal();
    a.press(ok, 'm');
    assert.equal(a.muted.length, 1, 'M mutes under a page modal');
    assert.equal(must(a.muted[0]).t, a.now() - 16, 'the action carries the key event timeStamp');
    a.press(a.mover, 'm');
    assert.equal(a.muted.length, 2);
    assert.deepEqual(a.seen.at(-1), {key: 'm', prevented: false}, 'the bubble listener still sees M, not prevented');
  } finally {
    a.fake.restore();
  }
});

test('M never mutes while typing in a field', () => {
  const a = app();
  try {
    for (const tag of ['textarea', 'select']) {
      const field = a.doc.createElement(tag);
      a.doc.body.append(field);
      a.press(field, 'm');
    }
    const text = a.doc.createElement('input');
    text.setAttribute('type', 'text');
    a.doc.body.append(text);
    a.press(text, 'm');
    const editable = a.doc.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    a.doc.body.append(editable);
    a.press(editable, 'm');
    assert.equal(a.muted.length, 0);
    const {ok} = a.modal();
    const inModal = a.doc.createElement('input');
    ok.parentElement!.append(inModal);
    a.press(inModal, 'm');
    assert.equal(a.muted.length, 0, 'typing in a modal field types an m');
    for (const type of ['range', 'checkbox', 'radio']) {
      const control = a.doc.createElement('input');
      control.setAttribute('type', type);
      a.doc.body.append(control);
      a.press(control, 'm');
    }
    assert.equal(a.muted.length, 3, 'sliders and toggles are not typing');
  } finally {
    a.fake.restore();
  }
});

test('M mutes once per press: autorepeat never re-fires and is never consumed; a lost keyup rearms on the next press', () => {
  const a = app();
  try {
    a.send(a.mover, 'keydown', 'm');
    for (let i = 0; i < 5; i++) a.send(a.mover, 'keydown', 'm', {repeat: true});
    assert.equal(a.muted.length, 1);
    assert.ok(a.seen.every(s => !s.prevented) && a.seen.length === 6, 'every repeat reaches the page unprevented');
    a.send(a.mover, 'keyup', 'm');
    a.press(a.mover, 'm');
    assert.equal(a.muted.length, 2, 'a fresh press after the release mutes again');
    a.send(a.mover, 'keydown', 'm');
    a.send(a.mover, 'keydown', 'm');
    assert.equal(a.muted.length, 4, 'a press whose keyup was lost does not block the next press');
  } finally {
    a.fake.restore();
  }
});

test('blur cancels a held M: its repeats neither mute nor get consumed, and the next press mutes', () => {
  const a = app();
  try {
    a.send(a.mover, 'keydown', 'm');
    a.doc.dispatchEvent({type: 'blur'} as unknown as Event);
    a.send(a.mover, 'keydown', 'm', {repeat: true});
    assert.equal(a.muted.length, 1);
    assert.equal(a.seen.at(-1)?.prevented, false, 'a swallowed repeat of a pass-through key still reaches the page');
    a.send(a.mover, 'keyup', 'm');
    a.press(a.mover, 'm');
    assert.equal(a.muted.length, 2);
  } finally {
    a.fake.restore();
  }
});

test('M mutes with Shift or Caps Lock, never with Ctrl, Alt or Meta', () => {
  const a = app();
  try {
    a.press(a.mover, 'M', {shiftKey: true});
    a.press(a.mover, 'M');
    assert.equal(a.muted.length, 2);
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) a.press(a.mover, 'm', {[mod]: true});
    a.press(a.mover, 'm', {ctrlKey: true, shiftKey: true});
    assert.equal(a.muted.length, 2);
    assert.ok(a.seen.every(s => !s.prevented));
  } finally {
    a.fake.restore();
  }
});

test('other keys pass through untouched while only scene layers are live', () => {
  const a = app();
  try {
    for (const key of ['Escape', 'Tab', 'e', 'Enter', ' ', 'p', 'v', 'c', '+', '-', 'w', 'ArrowUp', '1'])
      a.press(a.mover, key);
    assert.ok(
      a.seen.every(s => !s.prevented),
      'no key is prevented',
    );
    assert.equal(a.seen.length, 13, 'every key reaches the bubble listener');
    assert.equal(a.layers.stack().length, 1, 'Escape closed nothing');
  } finally {
    a.fake.restore();
  }
});

test("the app's rows pass the reach check", () => {
  const report = checkReach(inputActionRegistry(APP_INPUT_ACTIONS), APP_INPUT_OVERRIDES);
  assert.deepEqual(report.problems, []);
});

test('polled pad timestamps advance after keyboard dispatch while nested keys restore the outer timestamp', () => {
  const win = new EventTarget();
  let clock = 900;
  const layers = {fromTop: () => [], escape: () => false, cycleFocus: () => false, onChange: () => () => {}};
  const registry = inputActionRegistry([
    {id: 'test.first', label: 'first', kind: 'press', scope: 'always', defaults: {keys: ['a'], pad: ['a']}},
    {id: 'test.second', label: 'second', kind: 'press', scope: 'always', defaults: {keys: ['b'], pad: ['b']}},
  ]);
  const ctl = new AbortController(),
    input = createInput(win, layers, ctl.signal, registry, () => clock);
  const seen: number[] = [];
  const key = (letter: string, t: number) => {
    const e = new Event('keydown');
    Object.assign(e, {key: letter, code: 'Key' + letter.toUpperCase(), repeat: false});
    Object.defineProperty(e, 'timeStamp', {value: t});
    win.dispatchEvent(e);
  };
  input.onAction('test.second', e => {
    seen.push(e.t);
  });
  input.onAction('test.first', e => {
    seen.push(e.t);
    if (e.device === 'keyboard-mouse') {
      key('b', 20);
      input.pad('b', true);
      input.pad('b', false);
    }
  });
  try {
    key('a', 10);
    assert.deepEqual(seen, [10, 20, 10]);
    clock = 1200;
    input.pad('a', true);
    input.pad('a', false);
    assert.equal(seen.at(-1), 1200);
    clock = 1300;
    input.pad('a', true);
    assert.equal(seen.at(-1), 1300);
  } finally {
    ctl.abort();
  }
});

for (const boundary of ['hidden', 'pagehide'] as const) {
  test(`installed keyboard dispatcher cancels ${boundary} input without a controller adapter`, () => {
    const fake = installFakeDom(),
      doc = fake.document as unknown as Document;
    const owner = new AbortController();
    try {
      let hidden = false;
      Object.defineProperty(doc, 'hidden', {configurable: true, get: () => hidden});
      const registry = inputActionRegistry([
        {
          id: 'test.hold',
          label: 'input.hold',
          scope: 'global',
          kind: 'hold',
          defaults: {keys: ['code:KeyW']},
        },
      ]);
      const input = installAppInput(doc, registry, owner.signal);
      input.onAction('test.hold', () => true, {signal: owner.signal});
      const down = (repeat = false) =>
        doc.dispatchEvent({type: 'keydown', key: 'w', code: 'KeyW', repeat, timeStamp: 1} as unknown as Event);
      const up = () => doc.dispatchEvent({type: 'keyup', key: 'w', code: 'KeyW', timeStamp: 2} as unknown as Event);
      down();
      assert.equal(input.held('test.hold'), true);
      if (boundary === 'hidden') {
        hidden = true;
        doc.dispatchEvent(new Event('visibilitychange'));
      } else doc.dispatchEvent(new Event('pagehide'));
      assert.equal(input.held('test.hold'), false);
      const cancelled = input.epoch;
      hidden = false;
      doc.dispatchEvent(new Event('visibilitychange'));
      assert.equal(input.epoch, cancelled, 'becoming visible does not invent another cancellation');
      down(true);
      assert.equal(input.held('test.hold'), false, 'stale autorepeat cannot revive old input');
      up();
      down();
      assert.equal(input.held('test.hold'), true, 'a fresh press works after returning');
      up();
      owner.abort();
      const ended = input.epoch;
      hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
      doc.dispatchEvent(new Event('pagehide'));
      assert.equal(input.epoch, ended, 'lifecycle listeners detach with the installed dispatcher');
    } finally {
      owner.abort();
      fake.restore();
    }
  });
}
