import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../testing/fake-dom';
import { InputActions, inputActionRegistry, type ActionEvent } from './actions';
import { bindPointerControl } from './pointer-control';

function fixture() {
  const fake = installFakeDom();
  const doc = fake.document as unknown as Document;
  Object.defineProperty(doc, 'defaultView', { value: new EventTarget(), configurable: true });
  const input = new InputActions({
    registry: inputActionRegistry([
      { id: 'sample.move', label: 'move', kind: 'hold', scope: 'global', defaults: {} },
      { id: 'sample.act', label: 'act', kind: 'press', scope: 'global', defaults: {} },
    ]),
    layers: { fromTop: () => [], escape: () => false, cycleFocus: () => false, onChange: () => () => {} },
    now: () => 0,
  });
  const events: ActionEvent[] = [];
  input.onAction('sample.move', e => { events.push(e); return true; });
  input.onAction('sample.act', e => { events.push(e); return true; });
  const life = new AbortController();
  const control = () => {
    const element = doc.createElement('button');
    doc.body.append(element);
    const captures = new Set<number>();
    element.setPointerCapture = id => { captures.add(id); };
    element.hasPointerCapture = id => captures.has(id);
    element.releasePointerCapture = id => { captures.delete(id); };
    return element;
  };
  const fire = (element: HTMLElement, type: string, id: number, extra = {}) => {
    element.dispatchEvent({ type, pointerId: id, pointerType: 'touch', button: 0, buttons: 1, clientX: 10, clientY: 10, isPrimary: false, ...extra } as unknown as Event);
  };
  return { fake, doc, input, events, life, control, fire };
}

test('pointer controls independently capture non-primary touch and release without disturbing another contact', () => {
  const w = fixture();
  try {
    const move = w.control(), action = w.control();
    bindPointerControl(move, { input: w.input, actions: ['sample.move'], signal: w.life.signal });
    bindPointerControl(action, { input: w.input, actions: ['sample.act'], signal: w.life.signal });
    w.fire(move, 'pointerdown', 7);
    w.fire(action, 'pointerdown', 9);
    w.fire(action, 'pointerup', 9);
    assert.equal(w.input.held('sample.move'), true);
    assert.equal(w.events.filter(e => e.action === 'sample.act').length, 1);
    w.fire(move, 'pointerdown', 1000);
    w.fire(move, 'pointerup', 1000);
    assert.equal(w.input.held('sample.move'), true);
    w.fire(move, 'lostpointercapture', 7);
    assert.equal(w.input.held('sample.move'), false);
    assert.equal(w.events.at(-1)?.device, 'touch');
    w.fire(move, 'pointerdown', 8);
    w.life.abort();
    assert.equal(w.input.held('sample.move'), false);
    assert.equal(move.hasPointerCapture(8), false);
    w.fire(move, 'pointerdown', 10);
    assert.equal(w.input.held('sample.move'), false);
  } finally { w.life.abort(); w.fake.restore(); }
});

test('cancel clears contact ownership and old movement cannot rearm; selectors cannot publish after owner changes', () => {
  const w = fixture();
  try {
    const move = w.control();
    let cancelDuringSelection = false;
    bindPointerControl(move, {
      input: w.input, actions: ['sample.move'], signal: w.life.signal,
      select: () => { if (cancelDuringSelection) w.input.cancel('overlay'); return ['sample.move']; },
    });
    w.fire(move, 'pointerdown', 1);
    w.input.cancel('overlay');
    w.fire(move, 'pointermove', 1);
    assert.equal(w.input.held('sample.move'), false);
    cancelDuringSelection = true;
    w.fire(move, 'pointerdown', 2);
    assert.equal(w.input.held('sample.move'), false);
    cancelDuringSelection = false;
    w.fire(move, 'pointerdown', 3);
    assert.equal(w.input.held('sample.move'), true);
    Object.defineProperty(w.doc, 'hidden', { value: true, configurable: true });
    w.doc.dispatchEvent({ type: 'visibilitychange' } as Event);
    assert.equal(w.input.held('sample.move'), false);
  } finally { w.life.abort(); w.fake.restore(); }
});

test('capture failure and non-touch pointers do not activate a touch control', () => {
  const w = fixture();
  try {
    const move = w.control();
    bindPointerControl(move, { input: w.input, actions: ['sample.move'], signal: w.life.signal });
    w.fire(move, 'pointerdown', 1, { pointerType: 'mouse' });
    assert.equal(w.events.length, 0);
    move.setPointerCapture = () => { throw new Error('capture refused'); };
    w.fire(move, 'pointerdown', 2);
    assert.equal(w.input.held('sample.move'), false);
    assert.equal(w.events.length, 0);
  } finally { w.life.abort(); w.fake.restore(); }
});

test('selector-triggered owner abort does not activate its returned selection', () => {
  const w = fixture();
  try {
    const move = w.control();
    bindPointerControl(move, {
      input: w.input, actions: ['sample.move'], signal: w.life.signal,
      select: () => { w.life.abort(); return ['sample.move']; },
    });
    w.fire(move, 'pointerdown', 1);
    assert.equal(w.events.length, 0);
    assert.equal(move.hasPointerCapture(1), false);
  } finally { w.life.abort(); w.fake.restore(); }
});

for (const interruption of ['resize', 'blur', 'pagehide', 'pointercancel']) {
  test(`pointer control retires ${interruption} contacts and requires a fresh gesture`, () => {
    const w = fixture();
    try {
      const move = w.control();
      bindPointerControl(move, { input: w.input, actions: ['sample.move'], signal: w.life.signal });
      w.fire(move, 'pointerdown', 7);
      assert.equal(w.input.held('sample.move'), true);
      if (interruption === 'pointercancel') w.fire(move, interruption, 7);
      else w.doc.defaultView!.dispatchEvent(new Event(interruption));
      assert.equal(w.input.held('sample.move'), false);
      assert.equal(move.hasPointerCapture(7), false);
      w.fire(move, 'pointermove', 7); w.fire(move, 'pointerup', 7);
      assert.equal(w.input.held('sample.move'), false);
      w.fire(move, 'pointerdown', 8);
      assert.equal(w.input.held('sample.move'), true);
      w.life.abort();
      w.doc.defaultView!.dispatchEvent(new Event(interruption));
      w.fire(move, 'pointerdown', 9);
      assert.equal(w.input.held('sample.move'), false);
    } finally { w.life.abort(); w.fake.restore(); }
  });
}

test("leave: 'release' releases a contact that slides off the control; it cannot re-press until a fresh touch", () => {
  const w = fixture();
  try {
    const hold = w.control(), contact: boolean[] = [];
    bindPointerControl(hold, { input: w.input, actions: ['sample.move'], signal: w.life.signal, leave: 'release', onContact: down => contact.push(down) });
    w.fire(hold, 'pointerdown', 4);
    w.fire(hold, 'pointermove', 4, { clientX: 399, clientY: 299 });
    assert.equal(w.input.held('sample.move'), true, 'inside the bounds keeps the hold');
    w.fire(hold, 'pointermove', 4, { clientX: 401, clientY: 100 });
    assert.equal(w.input.held('sample.move'), false, 'outside the bounds releases');
    assert.equal(hold.hasPointerCapture(4), false);
    w.fire(hold, 'pointermove', 4, { clientX: 20, clientY: 20 });
    assert.equal(w.input.held('sample.move'), false, 'sliding back does not re-press');
    w.fire(hold, 'pointerup', 4);
    w.fire(hold, 'pointerdown', 5);
    assert.equal(w.input.held('sample.move'), true, 'a fresh touch presses again');
    w.fire(hold, 'pointerleave', 5);
    assert.equal(w.input.held('sample.move'), false, 'a reported leave releases');
    assert.deepEqual(contact, [true, false, true, false]);
    assert.deepEqual(w.events.map(e => e.phase), ['press', 'release', 'press', 'release']);
  } finally { w.life.abort(); w.fake.restore(); }
});

test('the default leave keeps a captured contact held wherever it moves, and onContact pairs only accepted contacts', () => {
  const w = fixture();
  try {
    const hold = w.control(), contact: boolean[] = [];
    bindPointerControl(hold, { input: w.input, actions: ['sample.move'], signal: w.life.signal, onContact: down => contact.push(down) });
    w.fire(hold, 'pointerdown', 1, { pointerType: 'mouse' });
    w.fire(hold, 'pointerdown', 2);
    w.fire(hold, 'pointermove', 2, { clientX: 900, clientY: 900 });
    assert.equal(w.input.held('sample.move'), true);
    w.input.cancel('overlay');
    assert.deepEqual(contact, [true, false]);
    hold.setPointerCapture = () => { throw new Error('capture refused'); };
    w.fire(hold, 'pointerdown', 3);
    assert.deepEqual(contact, [true, false], 'a refused capture reports nothing');
  } finally { w.life.abort(); w.fake.restore(); }
});

test('onContact reports only a press the dispatcher accepted', () => {
  const w = fixture();
  try {
    const empty = w.control(), stale = w.control(), refused = w.control(), contact: string[] = [];
    bindPointerControl(empty, { input: w.input, actions: ['sample.move'], signal: w.life.signal, select: () => [], onContact: down => contact.push(`empty:${down}`) });
    bindPointerControl(stale, { input: w.input, actions: ['sample.move'], signal: w.life.signal, onContact: down => contact.push(`stale:${down}`),
      select: () => { w.input.cancel('overlay'); return ['sample.move']; } });
    w.fire(empty, 'pointerdown', 1);
    w.fire(stale, 'pointerdown', 2);
    const declined = new InputActions({
      registry: inputActionRegistry([{ id: 'sample.none', label: 'none', kind: 'hold', scope: 'global', defaults: {} }]),
      layers: { fromTop: () => [], escape: () => false, cycleFocus: () => false, onChange: () => () => {} }, now: () => 0,
    });
    bindPointerControl(refused, { input: declined, actions: ['sample.none'], signal: w.life.signal, onContact: down => contact.push(`refused:${down}`) });
    w.fire(refused, 'pointerdown', 3);
    assert.equal(declined.held('sample.none'), false, 'no consumer: the dispatcher refused the press');
    assert.equal(refused.hasPointerCapture(3), true, 'the contact is still captured');
    w.fire(refused, 'pointerup', 3); w.fire(empty, 'pointerup', 1);
    assert.deepEqual(contact, [], 'no pressed look without an accepted press');
  } finally { w.life.abort(); w.fake.restore(); }
});
