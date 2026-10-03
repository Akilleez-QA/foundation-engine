import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeFrames} from './minigame-input';
import type {SampledFrame} from '.';
const frame = (over: Partial<SampledFrame> = {}): SampledFrame => ({
  dt: 0.016,
  move: {x: 0, y: 0},
  moveStarted: false,
  look: {x: 0, y: 0},
  zoom: [],
  actions: [],
  pressed: new Set(),
  taps: [],
  cameraInput: false,
  dragging: false,
  pinching: false,
  device: 'touch',
  context: null,
  mine: true,
  ...over,
});
test('the canvas keeps its own drags, pinches and taps while the host scene supplies keys and the pad', () => {
  const local = frame({
    look: {x: 0.1, y: 0},
    zoom: [{notches: 1, source: 'pinch', t: 0}],
    taps: [{x: 5, y: 6, t: 0, duration: 40, pointerType: 'touch'}],
  });
  const out = mergeFrames(0.016, local, {
    move: {x: 1, y: 0},
    look: {x: 0.05, y: 0.02},
    zoom: -0.5,
    pressed: new Set(['interact']),
    device: 'gamepad',
  });
  assert.deepEqual(out.move, {x: 1, y: 0});
  assert.ok(Math.abs(out.look.x - 0.15) < 1e-12);
  assert.equal(out.look.y, 0.02);
  assert.equal(out.zoom, 0.5);
  assert.equal(out.taps.length, 1);
  assert.ok(out.pressed.has('interact'));
  assert.equal(out.device, 'gamepad');
});
test('standalone (no host) the local keyboard and pad frame passes straight through', () => {
  const out = mergeFrames(
    0.016,
    frame({move: {x: 0, y: -1}, pressed: new Set(['back']), device: 'keyboard-mouse'}),
    null,
  );
  assert.deepEqual(out.move, {x: 0, y: -1});
  assert.ok(out.pressed.has('back'));
  assert.equal(out.device, 'keyboard-mouse');
});
test('keyboard Escape reaches a hosted minigame through the keymap: tools menu first, then the game, once per press; nothing reaches the host', async () => {
  const {installFakeDom, keyEvent} = await import('../../testing/fake-dom');
  const {minigameEscape} = await import('./minigame-input');
  const {appLayers} = await import('../ui/runtime');
  const dom = installFakeDom(),
    doc = dom.document;
  try {
    const root = doc.createElement('section'),
      slider = doc.createElement('input');
    (slider as unknown as {type: string}).type = 'range';
    root.append(slider);
    doc.body.append(root);
    let host = 0,
      closes = 0,
      menuOpen = true;
    const abort = new AbortController();
    doc.addEventListener('keydown', (e: {key: string}) => {
      if (e.key === 'Escape') host++;
    });
    minigameEscape(
      'probe',
      root as unknown as HTMLElement,
      abort.signal,
      {
        get menuOpen() {
          return menuOpen;
        },
        closeMenu() {
          menuOpen = false;
        },
      },
      () => {
        closes++;
        abort.abort();
      },
    );
    const up = () => doc.dispatchEvent({type: 'keyup', key: 'Escape', code: 'Escape'});
    slider.dispatchEvent(keyEvent('Escape'));
    assert.equal(menuOpen, false, 'the tools menu closes first, even from a slider');
    assert.equal(closes, 0);
    doc.body.dispatchEvent(keyEvent('Escape', {repeat: true}));
    assert.equal(closes, 0, 'autorepeat closes nothing more');
    up();
    doc.body.dispatchEvent(keyEvent('Escape'));
    assert.equal(closes, 1, 'a fresh press closes the game');
    doc.body.dispatchEvent(keyEvent('Escape', {repeat: true}));
    doc.body.dispatchEvent(keyEvent('Escape', {repeat: true}));
    assert.equal(closes, 1);
    assert.equal(host, 0, 'the held Escape never repeats into the host');
    assert.equal(appLayers(doc as unknown as Document).top(), null, 'closing the game closed its layer');
    up();
    doc.body.dispatchEvent(keyEvent('Escape'));
    assert.equal(host, 1, "with the game gone Escape is the page's again");
  } finally {
    dom.restore();
  }
});
