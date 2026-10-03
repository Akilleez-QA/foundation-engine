import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeDom} from '../../testing/fake-dom';
import {InputActions, inputActionRegistry} from '../../platform/input/actions';
import {actionRows} from '../../author/compile';
import {actionOf} from '../../author/ids';
import {createPressLatch} from '../../author/press-latch';
import {defineInput, defineScene, testScene, type SceneContext} from '../../author';
import {touchButton, TOUCH_BUTTON_MIN} from './index';

const jump = defineInput({id: 'jump', label: 'Jump', keys: ['Space'], pad: ['a'], hold: true});
const act = defineInput({id: 'act', label: 'Act', keys: ['e'], pad: ['x']});

/** A visit as the runtime wires it: the dispatcher, a press latch fed by its press events, an overlay and a visit signal. */
function visit(o: {coarse?: boolean} = {}) {
  const fake = installFakeDom();
  const doc = fake.document as unknown as Document;
  const win = Object.assign(new EventTarget(), {
    matchMedia: (q: string) => ({matches: q === '(any-pointer: coarse)' && (o.coarse ?? true)}),
    navigator: {maxTouchPoints: 0},
  });
  Object.defineProperty(doc, 'defaultView', {value: win, configurable: true});
  const input = new InputActions({
    registry: inputActionRegistry([...actionRows(jump), ...actionRows(act)]),
    layers: {fromTop: () => [], escape: () => false, cycleFocus: () => false, onChange: () => () => {}},
    now: () => 0,
  });
  const latch = createPressLatch(),
    life = new AbortController();
  for (const id of ['jump', 'act'])
    input.onAction(
      actionOf(id),
      e => {
        if (e.phase === 'press') latch.add(id, 1);
        return true;
      },
      {signal: life.signal},
    );
  const overlay = doc.createElement('div');
  doc.body.append(overlay);
  const ctx = {
    view: {overlay, signal: life.signal},
    service: (key: string) => {
      assert.equal(key, 'input');
      return input;
    },
  } as unknown as SceneContext;
  const fire = (el: HTMLElement, type: string, id: number, extra = {}) =>
    el.dispatchEvent({
      type,
      pointerId: id,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      ...extra,
    } as unknown as Event);
  const capturable = (el: HTMLElement) => {
    const captures = new Set<number>();
    el.setPointerCapture = id => {
      captures.add(id);
    };
    el.hasPointerCapture = id => captures.has(id);
    el.releasePointerCapture = id => {
      captures.delete(id);
    };
    return el;
  };
  /** One fixed tick: what `ctx.input.pressed(id)` answers inside it. */
  const tick = (id: string) => {
    latch.beginStep();
    const seen = latch.has(id);
    latch.endFrame();
    return seen;
  };
  return {fake, doc, win, input, ctx, life, overlay, fire, capturable, tick};
}

test('a touch button presses once, holds while the contact stays down and releases on lift', () => {
  const v = visit();
  try {
    const button = touchButton(v.ctx, 'jump', {label: 'Jump'});
    const el = v.capturable(button.element!);
    assert.equal(el.parentElement, v.overlay as unknown);
    assert.equal(el.getAttribute('aria-hidden'), 'true');
    assert.match(el.style.cssText, /min-width:48px;min-height:48px;/);
    assert.match(el.style.cssText, /touch-action:none/);
    assert.match(el.style.cssText, /pointer-events:auto/);
    v.fire(el, 'pointerdown', 7);
    assert.equal(v.input.held(actionOf('jump')), true);
    assert.equal(el.dataset.down, '');
    assert.deepEqual(
      [v.tick('jump'), v.tick('jump'), v.tick('jump')],
      [true, false, false],
      'the press is seen by exactly one fixed tick',
    );
    v.fire(el, 'pointermove', 7, {clientX: 20});
    assert.equal(v.input.held(actionOf('jump')), true);
    assert.equal(v.tick('jump'), false, 'moving on the button never re-presses');
    v.fire(el, 'pointerup', 7);
    assert.equal(v.input.held(actionOf('jump')), false);
    assert.equal(el.dataset.down, undefined);
    v.fire(el, 'pointerdown', 8);
    assert.equal(v.tick('jump'), true, 'a fresh touch is a fresh press');
  } finally {
    v.life.abort();
    v.fake.restore();
  }
});

test('a touch button releases on cancel, slide-off and blur, ignores mouse and pen, and keeps each finger to its own button', () => {
  const v = visit();
  try {
    const hold = v.capturable(touchButton(v.ctx, 'jump', {label: 'Jump'}).element!);
    const press = v.capturable(touchButton(v.ctx, 'act', {label: 'Act', inset: {left: 24, bottom: 24}}).element!);
    for (const pointerType of ['mouse', 'pen']) v.fire(hold, 'pointerdown', 1, {pointerType});
    assert.equal(v.input.held(actionOf('jump')), false);
    assert.equal(v.tick('jump'), false);
    v.fire(hold, 'pointerdown', 2);
    v.fire(press, 'pointerdown', 3);
    v.fire(hold, 'pointerdown', 4); // a second finger on the same button is ignored
    v.fire(press, 'pointerup', 3);
    assert.equal(v.input.held(actionOf('jump')), true, 'lifting another button keeps this hold');
    v.fire(hold, 'pointerup', 4);
    assert.equal(v.input.held(actionOf('jump')), true, 'the ignored finger cannot release it');
    v.fire(hold, 'pointercancel', 2);
    assert.equal(v.input.held(actionOf('jump')), false);
    v.fire(hold, 'pointerdown', 5);
    v.fire(hold, 'pointermove', 5, {clientX: 500});
    assert.equal(v.input.held(actionOf('jump')), false, 'sliding off releases');
    v.fire(hold, 'pointerup', 5);
    v.fire(hold, 'pointerdown', 6);
    (v.doc.defaultView as unknown as EventTarget).dispatchEvent(new Event('blur'));
    assert.equal(v.input.held(actionOf('jump')), false, 'blur releases');
  } finally {
    v.life.abort();
    v.fake.restore();
  }
});

test('the visit end and its own signal remove the button and release its hold', () => {
  const v = visit();
  try {
    const own = new AbortController();
    const first = touchButton(v.ctx, 'jump', {label: 'Jump', signal: own.signal});
    const el = v.capturable(first.element!);
    v.fire(el, 'pointerdown', 1);
    own.abort();
    assert.equal(v.input.held(actionOf('jump')), false);
    assert.equal(el.isConnected, false);
    const second = v.capturable(touchButton(v.ctx, 'jump', {label: 'Jump'}).element!);
    v.fire(second, 'pointerdown', 2);
    v.life.abort();
    assert.equal(v.input.held(actionOf('jump')), false);
    assert.equal(second.isConnected, false);
    assert.equal(touchButton(v.ctx, 'jump', {label: 'Jump'}).element, null, 'an ended visit gets nothing');
  } finally {
    v.life.abort();
    v.fake.restore();
  }
});

test('touch buttons are absent without touch, in headless scenes, and refuse undersized or unregistered inputs', async () => {
  const v = visit({coarse: false});
  try {
    assert.equal(touchButton(v.ctx, 'jump', {label: 'Jump'}).element, null, 'no coarse pointer and no touch points');
    assert.notEqual(touchButton(v.ctx, 'jump', {label: 'Jump', show: 'always'}).element, null);
    (v.win.navigator as {maxTouchPoints: number}).maxTouchPoints = 5;
    assert.notEqual(touchButton(v.ctx, 'jump', {label: 'Jump'}).element, null, 'touch points count as touch');
    assert.throws(() => touchButton(v.ctx, 'jump', {label: 'Jump', size: TOUCH_BUTTON_MIN - 1}), /size/);
    assert.throws(() => touchButton(v.ctx, 'jump', {label: 'Jump', inset: {right: -1}}), /inset\.right/);
    assert.throws(() => touchButton(v.ctx, 'missing', {label: 'Missing'}), /registered press\/hold action/);
    assert.equal(v.overlay.childNodes.length, 2, 'a refused button leaves nothing behind');
  } finally {
    v.life.abort();
    v.fake.restore();
  }
  const t = await testScene(defineScene({id: 'start', title: 'Start'}));
  assert.equal(touchButton(t.ctx, 'jump', {label: 'Jump'}).element, null, 'testScene has no overlay');
});
