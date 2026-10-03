import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeDom} from '../../testing/fake-dom';
import {FrameLoop} from '../../core/activity/loop';
import {createKnobRegistry, createQuality, coreKnobs, type GraphicsSettings, type KnobDef} from '../render/quality';
import {LayerManager} from './layers';
import {graphicsModel, installGraphicsScreen, optionWords} from './graphics-screen';
import {installGraphicsButton} from './graphics-button';
import {must} from '../../testing/must';

declare module '../render/quality-knobs' {
  interface GraphicsKnobs {
    'test.sparkle': 'off' | 'some' | 'lots';
  }
}
const sparkle: KnobDef<'test.sparkle'> = {
  id: 'test.sparkle',
  group: 'effects',
  label: 'graphics.effects.sparkle',
  control: {kind: 'choice', options: ['off', 'some', 'lots']},
  presets: {reference: 'lots', high: 'lots', medium: 'some', low: 'some'},
  applies: 'live',
  owner: 'test',
};

test('the screen is generated from the knob registry: a wired knob appears in its group with no screen edit, an unwired one stays hidden', () => {
  const registry = createKnobRegistry();
  const q = createQuality({registry});
  const before = graphicsModel(q);
  assert.deepEqual(
    before.map(g => g.group),
    ['resolution', 'shadows'],
  );
  assert.deepEqual(
    before.flatMap(g => g.knobs).map(k => k.def.id),
    ['resolution.scale', 'resolution.max-pixel-ratio', 'shadows.quality'],
  );
  registry.add(sparkle);
  assert.deepEqual(
    graphicsModel(q).map(g => g.group),
    ['resolution', 'shadows'],
    'registered but not read by the game: not shown',
  );
  assert.equal(q.knob('test.sparkle'), 'lots', 'still resolved for the profile');
  const registry2 = createKnobRegistry();
  registry2.add({...sparkle, wired: {by: 'sparkle'}});
  const after = graphicsModel(createQuality({registry: registry2})),
    effects = after.find(g => g.group === 'effects')!;
  assert.deepEqual(
    after.map(g => g.group),
    ['resolution', 'shadows', 'effects'],
  );
  assert.equal(must(effects.knobs[0]).label, 'Sparkle');
  assert.equal(must(effects.knobs[0]).value, 'lots');
  assert.equal(
    optionWords(
      coreKnobs.find(k => k.id === 'frame-rate.cap')!,
      0,
      0,
    ),
    'Display rate',
  );
  assert.equal(
    optionWords(
      coreKnobs.find(k => k.id === 'resolution.max-pixel-ratio')!,
      1.5,
      1,
    ),
    '1.5×',
  );
});

function screen(saved?: GraphicsSettings) {
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document;
  const header = doc.createElement('header'),
    menu = doc.createElement('div');
  header.className = 'topbar';
  menu.className = 'shell-menu-content';
  header.append(menu);
  doc.body.append(header);
  let store = saved;
  const q = createQuality({
    store: {
      read: () => store,
      write: v => {
        store = v;
      },
    },
    devicePixelRatio: () => 2,
  });
  const layers = new LayerManager(doc, {shell: () => [header]});
  const loop = new FrameLoop({layers, calm: () => false, scheduler: {request: () => 1, cancel: () => {}}});
  const s = installGraphicsScreen({quality: q, layers, loop, doc});
  return {fake, doc, q, layers, s, menu, stored: () => store};
}

test('the Graphics… button sits in the settings menu and opens a preview layer that covers nothing', () => {
  const {fake, q, layers, s, menu, doc} = screen();
  try {
    assert.equal(s.button.parentElement, menu);
    assert.equal(s.button.textContent, '◐ Graphics…');
    s.button.click();
    assert.ok(s.isOpen);
    const top = layers.top()!;
    assert.equal(top.id, 'modal.graphics');
    assert.equal(top.cover, 'none');
    assert.equal(top.modal, 'page');
    assert.equal(layers.coverage('scene#1'), 'top'); // the scene underneath keeps running
    assert.equal(layers.previewing('scene#1'), true); // and keeps drawing (STD-SET-14)
    assert.equal(doc.activeElement?.getAttribute('data-preset'), q.preset); // focus starts on the current preset
    assert.ok(s.dialog.getAttribute('aria-labelledby'));
    // every control has a name: choice groups are labelled, inputs have labels
    for (const g of Array.from(s.dialog.querySelectorAll('[role=group]'))) assert.ok(g.getAttribute('aria-labelledby'));
    assert.ok(layers.escape()); // Escape (the dispatcher's Back) closes it
    assert.equal(s.isOpen, false);
    assert.equal(layers.top(), null);
    assert.equal(layers.previewing('scene#1'), false);
  } finally {
    fake.restore();
  }
});

test('changing a preset or a knob applies at once and is saved; the reset returns to Reference', () => {
  const {fake, q, s, stored} = screen();
  try {
    s.open();
    const medium = s.dialog.querySelector<HTMLButtonElement>('[data-preset=medium]')!;
    medium.click();
    assert.equal(q.preset, 'medium');
    assert.equal(q.pixelRatio(1.7), 1.5);
    assert.equal(stored()?.preset, 'medium');
    assert.equal(medium.getAttribute('aria-pressed'), 'true');
    assert.equal(s.dialog.querySelector('[data-preset=reference]')!.getAttribute('aria-pressed'), 'false');
    const shadowRow = Array.from(s.dialog.querySelectorAll('[data-knob]')).find(
      e => e.getAttribute('data-knob') === 'shadows.quality',
    )!;
    const shadowsLow = shadowRow.querySelector<HTMLButtonElement>('[data-value=low]')!; // Medium's own value is 'high'
    shadowsLow.click();
    assert.equal(q.knob('shadows.quality'), 'low');
    assert.deepEqual(stored()?.overrides, {'shadows.quality': 'low'});
    assert.equal(shadowsLow.getAttribute('aria-pressed'), 'true');
    s.dialog.querySelector<HTMLButtonElement>('[data-reset=reference]')!.click();
    assert.equal(q.preset, 'reference');
    assert.deepEqual(stored()?.overrides, {});
    assert.equal(q.pixelRatio(1.7), 1.7);
    s.close();
  } finally {
    fake.restore();
  }
});

test('the detected preset is badged and explained, and "use the pick" returns to it', () => {
  const {fake, q, s} = screen({
    preset: 'low',
    overrides: {},
    governor: false,
    detected: {preset: 'high', reasons: ['desktop GPU Radeon'], build: 'x'},
  });
  try {
    s.open();
    assert.match(
      s.dialog.querySelector('.graphics-detected')!.textContent!,
      /Picked High for this device: desktop GPU Radeon/,
    );
    assert.equal(
      s.dialog.querySelector('[data-preset=high]')!.querySelector('.graphics-tag')!.textContent,
      'Picked for this device',
    );
    s.dialog.querySelector<HTMLButtonElement>('[data-reset=detected]')!.click();
    assert.equal(q.preset, 'high');
    s.close();
  } finally {
    fake.restore();
  }
});

test("a weak device keeps today's preset; the screen only suggests the lighter one", () => {
  const {fake, q, s} = screen({
    preset: 'high',
    overrides: {},
    governor: false,
    detected: {
      preset: 'high',
      reasons: ['desktop GPU SwiftShader', 'software GL (SwiftShader)'],
      build: 'x',
      suggested: 'low',
    },
  });
  try {
    s.open();
    assert.equal(q.preset, 'high');
    const hint = s.dialog.querySelector('.graphics-suggestion')!,
      tryIt = s.dialog.querySelector<HTMLButtonElement>('[data-suggested]')!;
    assert.match(hint.textContent!, /Low may run smoother/);
    assert.equal(tryIt.textContent, 'Try Low');
    assert.equal(tryIt.hidden, false);
    tryIt.click();
    assert.equal(q.preset, 'low');
    assert.equal(hint.textContent, '');
    assert.equal(tryIt.hidden, true); // already there: nothing to suggest
    s.close();
  } finally {
    fake.restore();
  }
});

test('the boot installs only the Graphics… button; its first press builds the screen around that button, which then opens it', async () => {
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document;
  try {
    const header = doc.createElement('header'),
      menu = doc.createElement('div');
    header.className = 'topbar';
    menu.className = 'shell-menu-content';
    header.append(menu);
    doc.body.append(header);
    const q = createQuality({});
    const layers = new LayerManager(doc, {shell: () => [header]});
    const loop = new FrameLoop({layers, calm: () => false, scheduler: {request: () => 1, cancel: () => {}}});
    let loads = 0,
      screen: ReturnType<typeof installGraphicsScreen> | undefined;
    const button = installGraphicsButton(async b => {
      loads++;
      return (screen = installGraphicsScreen({quality: q, layers, loop, doc, button: b}));
    }, doc);
    assert.equal(button.textContent, '◐ Graphics…');
    assert.equal(button.id, 'graphics-button');
    assert.equal(doc.querySelector('#graphics-settings'), null, 'no screen until the first press');
    button.click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(loads, 1);
    assert.ok(screen?.isOpen, 'the first press opens it');
    assert.equal(screen?.button, button);
    assert.ok(layers.escape());
    assert.equal(screen?.isOpen, false);
    button.click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(loads, 1, 'loaded once');
    assert.ok(screen?.isOpen, 'each press opens it, once');
    assert.ok(layers.escape());
  } finally {
    fake.restore();
  }
});
