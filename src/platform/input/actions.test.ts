import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {installFakeDom} from '../../testing/fake-dom';
import {LayerManager} from '../ui/layers';
import {defaultKeyBindings} from './keyboard';
import {
  BACK,
  CONFIRM,
  PAGE_NEXT,
  PAGE_PREV,
  CORE_INPUT_ACTIONS,
  defineInputActions,
  inputActionRegistry,
  InputActions,
  NINTENDO_SWAP,
  PAD_BUTTON_INDEX,
  SHELL_MENU,
  bindingConflicts,
  checkReach,
  comboOf,
  type ActionEvent,
  type ActionLayers,
  type InputActionDef,
  type KeyEventLike,
} from './actions';
import {openActionSource, ownActionSource} from './owned-action-source';
import {adminOf} from '../../core/registry';
import {must} from '../../testing/must';

/** A game's own rows (move, interact, camera, zoom): they used to be core rows and are now any game's or kit's. The
 *  dispatcher tests use them as a typical game's action set. */
const GAME_ROWS: InputActionDef[] = [
  {
    id: 'core.interact',
    label: 'input.interact',
    scope: 'global',
    kind: 'press',
    defaults: {keys: ['e', 'Enter', 'Space'], pad: ['a']},
  },
  {
    id: 'core.camera-mode',
    label: 'input.camera-mode',
    scope: 'global',
    kind: 'press',
    defaults: {keys: ['v'], pad: ['view']},
  },
  {
    id: 'core.camera-anchor',
    label: 'input.camera-anchor',
    scope: 'global',
    kind: 'press',
    defaults: {pad: ['r3']},
    via: {keyboard: ['core.camera-mode']},
  },
  {id: 'core.recentre', label: 'input.recentre', scope: 'global', kind: 'press', defaults: {keys: ['c'], pad: ['y']}},
  {
    id: 'core.zoom-in',
    label: 'input.zoom-in',
    scope: 'global',
    kind: 'hold',
    repeat: true,
    defaults: {keys: ['+', '=', 'i', 'code:NumpadAdd'], pad: ['rb', 'dpad-up']},
  },
  {
    id: 'core.zoom-out',
    label: 'input.zoom-out',
    scope: 'global',
    kind: 'hold',
    repeat: true,
    defaults: {keys: ['-', '_', 'o', 'code:NumpadSubtract'], pad: ['lb', 'dpad-down']},
  },
  {
    id: 'core.move-up',
    label: 'input.move-up',
    scope: 'global',
    kind: 'hold',
    defaults: {keys: ['code:KeyW', 'code:ArrowUp'], pad: ['ls-up']},
  },
  {
    id: 'core.move-down',
    label: 'input.move-down',
    scope: 'global',
    kind: 'hold',
    defaults: {keys: ['code:KeyS', 'code:ArrowDown'], pad: ['ls-down']},
  },
  {
    id: 'core.move-left',
    label: 'input.move-left',
    scope: 'global',
    kind: 'hold',
    defaults: {keys: ['code:KeyA', 'code:ArrowLeft'], pad: ['ls-left']},
  },
  {
    id: 'core.move-right',
    label: 'input.move-right',
    scope: 'global',
    kind: 'hold',
    defaults: {keys: ['code:KeyD', 'code:ArrowRight'], pad: ['ls-right']},
  },
];
const CORE_ROWS: readonly InputActionDef[] = [...CORE_INPUT_ACTIONS, ...GAME_ROWS];
const SWAP = {...NINTENDO_SWAP, 'core.interact': {pad: ['b']}} as typeof NINTENDO_SWAP;

/** The quick-slot feature's rows (they live in its folder, not in platform): digits on the keyboard, the shell menu on the pad. */
const QUICK_SLOT_ROWS: InputActionDef[] = [
  {
    id: 'shell.quick-slots',
    label: 'shell.quick-slots',
    scope: 'global',
    kind: 'press',
    defaults: {},
    via: {keyboard: ['core.focus-next'], pad: [SHELL_MENU]},
  },
  ...[1, 2, 3, 4, 5, 6].map((n): InputActionDef => ({
    id: `quick.slot${n}`,
    label: `quick.slot${n}`,
    scope: 'global',
    kind: 'press',
    defaults: {keys: [String(n)]},
    via: {pad: [SHELL_MENU, 'shell.quick-slots']},
  })),
];

type Ev = KeyEventLike & {prevented: boolean};
const key = (k: string, extra: Partial<KeyEventLike> = {}): Ev => {
  const e: Ev = {
    key: k,
    code: extra.code ?? (k.length === 1 ? 'Key' + k.toUpperCase() : k),
    prevented: false,
    target: null,
    ...extra,
    preventDefault() {
      e.prevented = true;
    },
    stopPropagation() {},
  };
  return e;
};

function world(extraRows: InputActionDef[] = []) {
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document;
  const header = doc.createElement('header'),
    main = doc.createElement('main');
  doc.body.append(header, main);
  const layers = new LayerManager(doc, {shell: () => [header]});
  const registry = inputActionRegistry([...CORE_ROWS, ...extraRows]);
  let clock = 0;
  const input = new InputActions({registry, layers, now: () => clock});
  const scene = doc.createElement('section');
  main.append(scene);
  layers.open({id: 'scene.home', kind: 'scene', element: scene, owner: 'home#1'});
  input.claimFrames('home#1');
  const layer = (id: string, kind: 'panel' | 'sheet' | 'modal', owner?: string, spec: {onClose?: () => void} = {}) => {
    const el = doc.createElement('div'),
      b = doc.createElement('button');
    el.append(b);
    (kind === 'modal' ? doc.body : scene).append(el);
    return layers.open({id, kind, element: el, owner, onClose: spec.onClose});
  };
  return {
    fake,
    doc,
    layers,
    registry,
    input,
    scene,
    layer,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}
const ids = (events: ActionEvent[]) => events.map(e => `${e.action}:${e.phase}`);

test('editable focus retires only prior non-text keyboard work, including released queued actions', () => {
  const w = world([
    {
      id: 'test.typing',
      label: 'typing',
      scope: 'global',
      kind: 'hold',
      inText: true,
      defaults: {keys: ['t'], pad: ['b']},
    },
  ]);
  try {
    w.input.keyDown(key('w'));
    w.input.keyUp(key('w')); // The undrained press and release must also retire.
    w.input.keyDown(key('a'));
    w.input.pad('ls-left', true); // Same action, independent device.
    w.input.keyDown(key('t'));
    const touch = ownActionSource(w.input, ['core.move-right'], 'touch');

    touch.set(['core.move-right']);
    w.input.activate('core.interact');
    const epoch = w.input.epoch;
    const field = w.doc.createElement('input');
    w.input.focusEntered(field);
    assert.equal(w.input.epoch, epoch);
    assert.equal(w.input.held('core.move-up'), false);
    assert.equal(w.input.held('core.move-left'), true, 'the pad hold survives');
    assert.equal(w.input.held('test.typing'), true);
    assert.equal(w.input.held('core.move-right'), true);
    assert.deepEqual(ids(w.input.drain('home#1')), [
      'core.move-left:press',
      'test.typing:press',
      'core.move-right:press',
      'core.interact:press',
    ]);
    w.input.pad('ls-left', false);
    assert.equal(w.input.held('core.move-left'), false);
    w.input.keyDown(key('a', {repeat: true}));
    assert.equal(w.input.held('core.move-left'), false, 'old repeat cannot resume after leaving the field');
    w.input.keyUp(key('a'));
    w.input.keyDown(key('a'));
    assert.equal(w.input.held('core.move-left'), true);
  } finally {
    w.fake.restore();
  }
});

test('editable focus inside a keyboard handler cannot publish a stale hold or fallback, but inText survives', () => {
  for (const inText of [false, true]) {
    const w = world([
      {id: 'test.focus', label: 'focus', scope: 'global', kind: 'hold', inText, defaults: {keys: ['f'], pad: ['b']}},
    ]);
    try {
      w.input.onAction('test.focus', () => {
        w.input.focusEntered(w.doc.createElement('textarea'));
        return false;
      });
      w.input.keyDown(key('f'));
      assert.equal(w.input.held('test.focus'), inText);
      assert.deepEqual(ids(w.input.drain('home#1')), inText ? ['test.focus:press'] : []);
    } finally {
      w.fake.restore();
    }
  }
});

test('targeted action descriptions snapshot remaps without exposing mutable bindings or discovering hidden rows', () => {
  const hidden: InputActionDef = {
    id: 'debug.inspect',
    label: 'input.inspect',
    scope: 'always',
    kind: 'press',
    hidden: true,
    defaults: {keys: ['Ctrl+i'], pad: ['l3']},
  };
  const w = world([hidden]);
  try {
    assert.equal(w.input.describeAction('unknown.action'), null);
    const first = w.input.describeAction(hidden.id)!;
    assert.deepEqual(first, {labelKey: hidden.label, keys: ['Ctrl+i'], pad: ['l3'], inContext: true});
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.keys));
    assert.ok(Object.isFrozen(first.pad));
    assert.throws(() => (first.keys as string[]).push('x'), TypeError);
    assert.throws(() => ((first.pad as string[])[0] = 'a'), TypeError);
    assert.deepEqual(w.input.effective(hidden.id), hidden.defaults);
    assert.equal(
      w.input.help().some(row => row.id === hidden.id),
      false,
    );
    w.input.setOverrides({[hidden.id]: {keys: ['Shift+i']}});
    assert.deepEqual(w.input.describeAction(hidden.id), {
      labelKey: hidden.label,
      keys: ['Shift+i'],
      pad: ['l3'],
      inContext: true,
    });
    assert.deepEqual(first.keys, ['Ctrl+i'], 'an earlier snapshot does not change after remapping');
    w.input.setOverrides({[hidden.id]: {keys: [], pad: []}});
    assert.deepEqual(w.input.describeAction(hidden.id), {labelKey: hidden.label, keys: [], pad: [], inContext: true});
  } finally {
    w.fake.restore();
  }
});

test('action descriptions follow modal context and restoration without claiming a live handler', () => {
  const w = world([
    {
      id: 'reading.inspect',
      label: 'input.inspect',
      scope: 'layer',
      context: ['sheet'],
      kind: 'press',
      defaults: {keys: ['q'], pad: ['y']},
    },
    {
      id: 'scene.inspect',
      label: 'input.inspect',
      scope: 'layer',
      context: ['scene.home'],
      kind: 'press',
      defaults: {keys: ['q'], pad: ['y']},
    },
  ]);
  try {
    assert.equal(w.input.describeAction('core.interact')?.inContext, true);
    assert.equal(w.input.describeAction('scene.inspect')?.inContext, true);
    assert.equal(w.input.describeAction('reading.inspect')?.inContext, false);
    const sheet = w.layer('sheet.reading', 'sheet');
    assert.equal(w.input.describeAction('core.interact')?.inContext, false);
    assert.equal(w.input.describeAction('scene.inspect')?.inContext, false);
    assert.equal(
      w.input.describeAction('reading.inspect')?.inContext,
      true,
      'scope alone matches even without a handler',
    );
    const modal = w.layer('modal.confirm', 'modal');
    assert.equal(w.input.describeAction('reading.inspect')?.inContext, false);
    modal.close();
    assert.equal(w.input.describeAction('reading.inspect')?.inContext, true);
    sheet.close();
    assert.equal(w.input.describeAction('core.interact')?.inContext, true);
    assert.equal(w.input.describeAction('scene.inspect')?.inContext, true);
    assert.equal(w.input.describeAction('reading.inspect')?.inContext, false);
  } finally {
    w.fake.restore();
  }
});

test("the LayerManager satisfies the dispatcher's structural layer view", () => {
  const fake = installFakeDom();
  try {
    const view: ActionLayers = new LayerManager(fake.document as unknown as Document);
    assert.equal(view.fromTop().length, 0);
  } finally {
    fake.restore();
  }
});

test('Escape closes only the top layer, once: autorepeat closes nothing more; a fresh press closes the next; pad B is the same Back', () => {
  const w = world();
  try {
    const closed: string[] = [];
    w.layer('panel.hockey', 'panel', 'hockey#2', {onClose: () => closed.push('hockey')});
    w.layer('sheet.map', 'sheet', undefined, {onClose: () => closed.push('map')});
    const first = key('Escape');
    assert.ok(w.input.keyDown(first));
    assert.ok(first.prevented);
    assert.deepEqual(closed, ['map'], 'only the top layer');
    assert.ok(w.input.keyDown(key('Escape', {repeat: true})), 'the held Escape stays owned');
    assert.ok(w.input.keyDown(key('Escape', {repeat: true})));
    assert.deepEqual(closed, ['map'], 'autorepeat never closes the layer below');
    w.input.keyUp(key('Escape'));
    assert.ok(w.input.pad('b', true));
    w.input.pad('b', false);
    assert.deepEqual(closed, ['map', 'hockey'], 'pad B is Back through the same layer traversal');
    assert.ok(w.input.keyDown(key('Escape')), 'at the scene, Back goes to the scene owner as an action');
    assert.deepEqual(ids(w.input.drain('home#1')), ['core.back:press']);
    assert.equal(w.layers.stack().length, 1, 'a scene never closes on Escape');
  } finally {
    w.fake.restore();
  }
});

test('focus returns to the opener when Back closes a layer', () => {
  const w = world();
  try {
    const opener = w.doc.createElement('button');
    w.scene.append(opener);
    opener.focus();
    w.layer('sheet.map', 'sheet');
    assert.notEqual(w.doc.activeElement, opener);
    w.input.keyDown(key('Escape'));
    assert.equal(w.doc.activeElement, opener);
  } finally {
    w.fake.restore();
  }
});

test('M-style always actions fire under any modal; typing protects them; single-key shortcuts can be switched off', () => {
  const w = world();
  try {
    const muted: ActionEvent[] = [];
    w.input.onAction('core.mute', e => {
      muted.push(e);
    });
    const modal = w.layer('modal.sound', 'modal');
    const m = key('m');
    assert.equal(w.input.keyDown(m), false, 'M is a passThrough row: it fires but leaves the event unconsumed');
    assert.equal(muted.length, 1, 'M mutes under a page modal');
    assert.equal(m.prevented, false);
    w.input.keyUp(key('m'));
    assert.equal(w.input.keyDown(key('p')), false, 'a global under a modal is blocked');
    assert.deepEqual(w.input.drain('home#1'), []);
    const field = w.doc.createElement('textarea');
    modal.element.append(field);
    assert.equal(w.input.keyDown(key('m', {target: field as unknown as EventTarget})), false, 'typing M types an m');
    assert.equal(muted.length, 1);
    const off = new InputActions({
      registry: w.registry,
      layers: w.layers,
      now: () => 0,
      singleKeyShortcuts: () => false,
    });
    let count = 0;
    off.onAction('core.mute', () => {
      count++;
    });
    assert.equal(off.keyDown(key('m')), false);
    assert.equal(count, 0);
  } finally {
    w.fake.restore();
  }
});

test('a layer owner binding wins over the traversal; one press is delivered once, to one consumer', () => {
  const w = world();
  try {
    const log: string[] = [];
    assert.ok(w.input.keyDown(key('e')));
    w.input.keyUp(key('e'));
    assert.deepEqual(
      ids(w.input.drain('home#1')),
      ['core.interact:press'],
      'the traversal reads interact from its frame',
    );
    w.layer('panel.hockey', 'panel', 'hockey#2');
    w.input.onAction(
      'core.move-left',
      () => {
        log.push('aim');
      },
      {owner: 'hockey#2'},
    );
    assert.ok(w.input.keyDown(key('ArrowLeft', {code: 'ArrowLeft'})));
    assert.deepEqual(log, ['aim']);
    assert.deepEqual(w.input.drain('home#1'), [], 'the traversal never sees the arrow');
    // A DOM subscriber and a frame owner for the same global action: exactly one delivery.
    w.layers.closeOwned('hockey#2');
    let dom = 0;
    const off = w.input.onAction('core.interact', () => {
      dom++;
    });
    w.input.keyDown(key('e'));
    w.input.keyUp(key('e'));
    assert.equal(dom, 1);
    assert.deepEqual(w.input.drain('home#1'), [], 'not also queued for the frame');
    off();
  } finally {
    w.fake.restore();
  }
});

test('an owner change cancels held actions: no release leaks to the new owner and the key must be released before it presses again', () => {
  const w = world();
  try {
    assert.ok(w.input.keyDown(key('w', {code: 'KeyW'})));
    assert.equal(w.input.held('core.move-up'), true);
    assert.deepEqual(ids(w.input.drain('home#1')), ['core.move-up:press']);
    const epoch = w.input.epoch;
    const panel = w.layer('panel.orrery', 'panel', 'orrery#2');
    assert.equal(w.input.epoch, epoch + 1, 'opening a layer starts a new owner epoch');
    assert.equal(w.input.held('core.move-up'), false, 'held state is cancelled');
    assert.ok(w.input.keyDown(key('w', {code: 'KeyW', repeat: true})), 'repeats of the old press are swallowed');
    panel.close();
    assert.ok(w.input.keyDown(key('w', {code: 'KeyW', repeat: true})), 'still the old press after the panel closes');
    assert.equal(w.input.held('core.move-up'), false, 'the traversal does not resume traversing from a stale hold');
    w.input.keyUp(key('w', {code: 'KeyW'}));
    assert.deepEqual(w.input.drain('home#1'), [], 'no release and no stale press reach the traversal');
    assert.ok(w.input.keyDown(key('w', {code: 'KeyW'})), 'a fresh press after release arms again');
    assert.equal(w.input.held('core.move-up'), true);
    w.input.keyUp(key('w', {code: 'KeyW'}));
    assert.deepEqual(ids(w.input.drain('home#1')), ['core.move-up:press', 'core.move-up:release']);
  } finally {
    w.fake.restore();
  }
});

test('confirm held while a menu opens and closes produces no stray action; later edges of the same poll are discarded', () => {
  const w = world(QUICK_SLOT_ROWS);
  try {
    const menus: ReturnType<typeof w.layer>[] = [];
    w.input.onAction(SHELL_MENU, () => {
      menus.push(w.layer('sheet.menu', 'sheet'));
    });
    // One poll: X opens the menu, then A in the same poll was meant for the traversal and must not reach anyone.
    w.input.padFrame([
      {input: 'x', pressed: true},
      {input: 'a', pressed: true},
    ]);
    assert.equal(menus.length, 1);
    assert.deepEqual(w.input.drain('home#1'), []);
    must(menus[0]).close();
    w.input.padFrame([
      {input: 'a', pressed: false},
      {input: 'x', pressed: false},
    ]);
    assert.deepEqual(w.input.drain('home#1'), [], 'releasing A after the menu closed is not an interact');
    w.input.pad('a', true);
    w.input.pad('a', false);
    assert.deepEqual(ids(w.input.drain('home#1')), ['core.interact:press'], 'a fresh A works');
  } finally {
    w.fake.restore();
  }
});

test('pause, blur, disconnect and remap cancel queued and held input; adapters hear the cancel', () => {
  const w = world();
  try {
    const heard: string[] = [];
    w.input.onCancel(r => heard.push(r));
    w.input.keyDown(key('e'));
    w.input.keyUp(key('e'));
    w.input.cancel('pause');
    assert.deepEqual(w.input.drain('home#1'), [], 'a queued press addressed to the old epoch is dropped');
    w.input.keyDown(key('i'));
    assert.equal(w.input.held('core.zoom-in'), true);
    w.input.setOverrides({'core.zoom-in': {keys: ['z']}});
    assert.equal(w.input.held('core.zoom-in'), false, 'remap while held cancels the hold');
    w.input.keyUp(key('i'));
    w.input.drain('home#1');
    assert.equal(w.input.keyDown(key('i')), false, 'the old key no longer zooms');
    assert.ok(w.input.keyDown(key('z')));
    w.input.keyUp(key('z'));
    assert.deepEqual(ids(w.input.drain('home#1')), ['core.zoom-in:press', 'core.zoom-in:release']);
    w.input.cancel('blur');
    w.input.cancel('disconnect');
    assert.deepEqual(heard, ['pause', 'remap', 'blur', 'disconnect']);
  } finally {
    w.fake.restore();
  }
});

test('press timing is unchanged: actions fire on the press edge; only repeat rows autorepeat', () => {
  const w = world();
  try {
    w.tick(16);
    w.input.pad('y', true);
    const [recentre] = w.input.drain('home#1');
    assert.ok(recentre);
    assert.equal(recentre.action, 'core.recentre');
    assert.equal(recentre.t, 16, 'Y recentres on press, not release');
    w.tick(180);
    w.input.pad('y', false);
    assert.deepEqual(w.input.drain('home#1'), [], 'a press row sends nothing on release');
    w.input.keyDown(key('i'));
    w.input.keyDown(key('i', {repeat: true}));
    w.input.keyUp(key('i'));
    assert.deepEqual(ids(w.input.drain('home#1')), [
      'core.zoom-in:press',
      'core.zoom-in:repeat',
      'core.zoom-in:release',
    ]);
    w.input.keyDown(key('v'));
    w.input.keyDown(key('v', {repeat: true}));
    w.input.keyUp(key('v'));
    assert.deepEqual(ids(w.input.drain('home#1')), ['core.camera-mode:press'], 'one physical press, one camera cycle');
  } finally {
    w.fake.restore();
  }
});

test('Tab cycles focus inside the top modal layer even from a text field; a shell button activates its action', () => {
  const w = world();
  try {
    const modal = w.layer('modal.reset', 'modal'),
      a = modal.element.querySelector('button');
    const field = w.doc.createElement('input');
    modal.element.append(field);
    assert.equal(w.doc.activeElement, a);
    assert.ok(w.input.keyDown(key('Tab')));
    assert.equal(w.doc.activeElement, field);
    assert.ok(w.input.keyDown(key('Tab', {shiftKey: true, target: field as unknown as EventTarget})));
    assert.equal(w.doc.activeElement, a);
    modal.close();
    assert.equal(w.input.keyDown(key('Tab')), false, 'with no modal layer, Tab stays native');
    let opened = 0;
    w.input.onAction(SHELL_MENU, () => {
      opened++;
    });
    assert.ok(w.input.activate(SHELL_MENU, 'touch'));
    assert.equal(opened, 1);
  } finally {
    w.fake.restore();
  }
});

test('reach: every core and quick-slot action is reachable from keyboard and pad, directly or by a declared menu path', () => {
  const registry = inputActionRegistry([...CORE_ROWS, ...QUICK_SLOT_ROWS]);
  const report = checkReach(registry);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.routes['quick.slot3'], {keyboard: 'direct', pad: [SHELL_MENU, 'shell.quick-slots']});
  assert.deepEqual(report.routes['core.mute'], {keyboard: 'direct', pad: [SHELL_MENU]});
  assert.deepEqual(report.routes[SHELL_MENU], {keyboard: ['core.focus-next'], pad: 'direct'});
  for (const row of registry.all())
    for (const device of ['keyboard', 'pad'] as const)
      assert.ok(must(report.routes[row.id])[device], `${row.id} by ${device}`);
  assert.deepEqual(
    checkReach(inputActionRegistry([...CORE_ROWS, ...QUICK_SLOT_ROWS]), SWAP).problems,
    [],
    'the Nintendo preset stays conflict-free',
  );
});

test('reach rejects unreachable actions, broken or cyclic paths, chord-only routes, missing Back and remap conflicts', () => {
  const base = CORE_ROWS.filter(r => r.id !== SHELL_MENU);
  const problems = (rows: InputActionDef[], overrides = {}) =>
    checkReach(inputActionRegistry(rows), overrides).problems;
  assert.ok(
    problems(base).some(p => p === 'core.mute: pad path names unregistered shell.menu'),
    'mute loses its pad route without the menu',
  );
  assert.ok(
    problems([
      ...CORE_ROWS,
      {id: 'pack.sails/deploy', label: 'x', scope: 'global', kind: 'press', defaults: {keys: ['k']}},
    ]).includes('pack.sails/deploy: unreachable by pad'),
  );
  const cyc: InputActionDef[] = [
    {id: 'pack.a', label: 'a', scope: 'global', kind: 'press', defaults: {keys: ['j']}, via: {pad: ['pack.b']}},
    {id: 'pack.b', label: 'b', scope: 'global', kind: 'press', defaults: {keys: ['k']}, via: {pad: ['pack.a']}},
  ];
  assert.ok(problems([...CORE_ROWS, ...cyc]).some(p => p.startsWith('pack.a: pad path pack.b has no reachable entry')));
  assert.ok(
    problems([
      ...CORE_ROWS,
      {id: 'pack.save', label: 's', scope: 'global', kind: 'press', defaults: {keys: ['Ctrl+s'], pad: ['rt']}},
    ]).includes('pack.save: a modifier chord is the only keyboard route'),
  );
  assert.ok(problems(CORE_ROWS.filter(r => r.id !== BACK)).includes('core.back: no Back action registered'));
  assert.ok(problems([...CORE_ROWS], {[BACK]: {pad: []}}).includes('core.back: no direct pad Back route'));
  assert.ok(
    problems([...CORE_ROWS], {'core.mute': {keys: ['e']}}).some(
      p => p.startsWith('key e:') && p.includes('core.interact (global)') && p.includes('core.mute (always)'),
    ),
    'a remap onto a taken key is a conflict',
  );
  const pointerOnly: InputActionDef = {
    id: 'pack.draw',
    label: 'd',
    scope: 'global',
    kind: 'press',
    defaults: {},
    reachability: 'pointer-only-by-design',
    reason: 'free drawing',
  };
  const report = checkReach(inputActionRegistry([...CORE_ROWS, pointerOnly]));
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.exceptions, [{id: 'pack.draw', reason: 'free drawing'}]);
  assert.ok(
    problems([...CORE_ROWS, {...pointerOnly, reason: undefined as never}]).includes(
      'pack.draw: a pointer-only exception needs a reason',
    ),
  );
  assert.ok(problems([...CORE_ROWS, must(CORE_ROWS[0])]).includes('core.back: registered twice'));
  assert.deepEqual(bindingConflicts(CORE_ROWS), [], 'the core defaults do not overlap');
});

test("defaults are today's bindings verbatim (src/input keyboard and gamepad)", () => {
  const modalRows = CORE_ROWS.filter(r => [CONFIRM, PAGE_NEXT, PAGE_PREV].includes(r.id));
  assert.deepEqual(
    modalRows.map(r => [r.id, r.scope, r.defaults.keys]),
    [
      [CONFIRM, 'layer', ['Enter']],
      [PAGE_NEXT, 'layer', ['PageDown']],
      [PAGE_PREV, 'layer', ['PageUp']],
    ],
  );
  const all = [...CORE_ROWS.filter(r => !modalRows.includes(r)), ...QUICK_SLOT_ROWS];
  const byKey = (chord: string) => all.filter(r => r.defaults.keys?.includes(chord)).map(r => r.id);
  const legacyId: Record<string, string> = {
    interact: 'core.interact',
    back: BACK,
    cameraMode: 'core.camera-mode',
    recentre: 'core.recentre',
    pause: 'core.pause',
    mute: 'core.mute',
  };
  const named: Record<string, string> = {enter: 'Enter', ' ': 'Space', escape: 'Escape'};
  for (const [k, command] of Object.entries(defaultKeyBindings.keys)) {
    const want =
      typeof command === 'string'
        ? (legacyId[command] ?? `quick.slot${command.slice(4)}`)
        : 'zoom' in command
          ? command.zoom < 0
            ? 'core.zoom-in'
            : 'core.zoom-out'
          : 'core.camera-mode';
    assert.deepEqual(byKey(named[k] ?? comboOf({key: k})), [want], `key ${JSON.stringify(k)}`);
  }
  for (const [code, command] of Object.entries(defaultKeyBindings.codes)) {
    assert.ok('zoom' in (command as object));
    assert.deepEqual(byKey('code:' + code), [(command as {zoom: number}).zoom < 0 ? 'core.zoom-in' : 'core.zoom-out']);
  }
  for (const [code, dir] of Object.entries(defaultKeyBindings.move))
    assert.deepEqual(byKey('code:' + code), [`core.move-${dir}`]);
  const legacyKeyCount =
    Object.keys(defaultKeyBindings.keys).length +
    Object.keys(defaultKeyBindings.codes).length +
    Object.keys(defaultKeyBindings.move).length;
  const newKeyCount = all.flatMap(r => r.defaults.keys ?? []).filter(k => k !== 'Tab' && k !== 'Shift+Tab').length;
  assert.equal(newKeyCount, legacyKeyCount, 'no key added outside focus cycling');
  // gamepad.ts STANDARD indices and README: A interact, B back, Start pause, View camera, R3 anchor, Y recentre, LB/RB and d-pad zoom.
  const pad = (id: string) => (all.find(r => r.id === id)!.defaults.pad ?? []).map(p => PAD_BUTTON_INDEX[p]);
  assert.deepEqual(pad('core.interact'), [0]);
  assert.deepEqual(pad(BACK), [1]);
  assert.deepEqual(pad('core.pause'), [9]);
  assert.deepEqual(pad('core.camera-mode'), [8]);
  assert.deepEqual(pad('core.camera-anchor'), [11]);
  assert.deepEqual(pad('core.recentre'), [3]);
  assert.deepEqual(pad('core.zoom-in'), [5, 12]);
  assert.deepEqual(pad('core.zoom-out'), [4, 13]);
});

test('inputActions is a core defineRegistry registry; a duplicate id or an unreachable action fails its problems', () => {
  const clean = defineInputActions();
  for (const row of CORE_ROWS) clean.add(row, 'core');
  adminOf(clean).freeze();
  assert.equal(clean.name, 'inputActions');
  assert.deepEqual(adminOf(clean).check('report'), [], 'the core rows pass validate and problems');
  assert.equal(inputActionRegistry(CORE_ROWS).all().length, CORE_ROWS.length);

  const dup = defineInputActions();
  dup.add(must(CORE_ROWS[0]), 'core');
  assert.throws(
    () => dup.add(must(CORE_ROWS[0]), 'pack.x'),
    /duplicate id 'core\.back'/,
    'core rejects a duplicate at add',
  );
  assert.ok(
    checkReach(inputActionRegistry([...CORE_ROWS, must(CORE_ROWS[0])])).problems.includes(
      'core.back: registered twice',
    ),
  );

  const lonely = defineInputActions();
  for (const row of CORE_ROWS) lonely.add(row, 'core');
  lonely.add({id: 'pack.kite', label: 'k', scope: 'global', kind: 'press', defaults: {keys: ['k']}}, 'pack.kites');
  const problems = adminOf(lonely).check('report');
  assert.deepEqual(
    problems.map(p => [p.id, p.source, p.problem]),
    [['pack.kite', 'pack.kites', 'unreachable by pad']],
    'the unreachable row is attributed to the pack that added it',
  );

  const bad = defineInputActions();
  bad.add(
    {id: 'pack.kite', label: 'k', scope: 'global', kind: 'press', defaults: {keys: ['k'], pad: ['zz' as never]}},
    'pack.kites',
  );
  assert.ok(
    adminOf(bad)
      .check('report')
      .some(p => p.id === 'pack.kite' && p.problem === "unknown pad input 'zz'"),
    'validate runs per row',
  );
});

test('modal confirm activates focused Close once, and repeat never reaches the exposed scene', () => {
  const w = world();
  try {
    const element = w.doc.createElement('section'),
      close = w.doc.createElement('button');
    element.append(close);
    w.scene.append(element);
    const sheet = w.layers.open({
      id: 'reading',
      kind: 'sheet',
      owner: 'reading#1',
      element,
      modal: 'scope',
      initialFocus: () => close,
    });
    let clicks = 0;
    close.addEventListener('click', () => {
      clicks++;
      sheet.close();
    });
    const press = key('Enter', {target: close});
    assert.equal(w.input.keyDown(press), true);
    assert.equal(press.prevented, true);
    assert.equal(clicks, 1);
    assert.equal(sheet.closed, true);
    assert.equal(w.input.keyDown(key('Enter', {repeat: true, target: w.scene})), true);
    assert.deepEqual(w.input.drain('home#1'), []);
    w.input.keyUp(key('Enter'));
    w.input.keyDown(key('Enter', {target: w.scene}));
    assert.ok(w.input.drain('home#1').some(e => e.action === 'core.interact'));
  } finally {
    w.fake.restore();
  }
});

test('pad confirm activates a modal control and editable Enter keeps native semantics', () => {
  const w = world();
  try {
    const element = w.doc.createElement('section'),
      button = w.doc.createElement('button'),
      text = w.doc.createElement('textarea');
    element.append(button, text);
    w.scene.append(element);
    w.layers.open({id: 'reading', kind: 'sheet', element, modal: 'scope', initialFocus: () => button});
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks++;
    });
    assert.equal(w.input.pad('a', true), true);
    assert.equal(clicks, 1);
    w.input.pad('a', false);
    text.focus();
    const enter = key('Enter', {target: text});
    assert.equal(w.input.keyDown(enter), false);
    assert.equal(enter.prevented, false);
    assert.deepEqual(w.input.drain('home#1'), []);
    assert.deepEqual(w.input.effective(CONFIRM).keys, ['Enter']);
  } finally {
    w.fake.restore();
  }
});

test('modal page keys and pad shoulders page only the explicitly focused reading region', () => {
  const w = world();
  try {
    const element = w.doc.createElement('section'),
      region = w.doc.createElement('div');
    region.tabIndex = 0;
    region.setAttribute('tabindex', '0');
    region.setAttribute('data-ui-scroll', '');
    Object.defineProperties(region, {clientHeight: {value: 100}, scrollHeight: {value: 500}});
    region.scrollTop = 0;
    element.append(region);
    w.scene.append(element);
    w.layers.open({id: 'reading', kind: 'sheet', element, modal: 'scope', initialFocus: () => region});
    assert.equal(w.input.keyDown(key('PageDown', {target: region})), true);
    assert.equal(region.scrollTop, 80);
    assert.equal(w.input.keyDown(key('PageDown', {target: region, repeat: true})), true);
    assert.equal(region.scrollTop, 80);
    w.input.keyUp(key('PageDown'));
    w.input.pad('rb', true);
    w.input.pad('rb', false);
    assert.equal(region.scrollTop, 160);
    w.input.pad('lb', true);
    w.input.pad('lb', false);
    assert.equal(region.scrollTop, 80);
    assert.deepEqual(w.input.drain('home#1'), [], 'no gameplay zoom while reading');
  } finally {
    w.fake.restore();
  }
});

test('unhandled modal confirm and paging preserve native keys and same-layer custom handlers', () => {
  const w = world();
  try {
    const element = w.doc.createElement('section'),
      region = w.doc.createElement('div');
    region.tabIndex = 0;
    region.setAttribute('tabindex', '0');
    element.append(region);
    w.scene.append(element);
    w.layers.open({id: 'custom', kind: 'sheet', element, modal: 'scope', initialFocus: () => region});
    for (const name of ['Enter', 'PageDown', 'PageUp']) {
      const press = key(name, {target: region});
      assert.equal(w.input.keyDown(press), false);
      assert.equal(press.prevented, false, 'native handling remains available');
      const repeat = key(name, {target: region, repeat: true});
      assert.equal(w.input.keyDown(repeat), false, 'an unhandled first edge must not suppress native repeats');
      assert.equal(repeat.prevented, false);
      w.input.keyUp(key(name));
    }
    const received: string[] = [];
    for (const id of [CONFIRM, PAGE_NEXT, PAGE_PREV])
      w.input.onAction(
        id,
        () => {
          received.push(id);
          return true;
        },
        {layer: 'custom'},
      );
    for (const name of ['Enter', 'PageDown', 'PageUp']) {
      const press = key(name, {target: region});
      assert.equal(w.input.keyDown(press), true);
      assert.equal(press.prevented, true);
      w.input.keyUp(key(name));
    }
    assert.deepEqual(received, [CONFIRM, PAGE_NEXT, PAGE_PREV]);
    assert.deepEqual(w.input.drain('home#1'), [], 'the modal barrier still prevents gameplay fallback');
  } finally {
    w.fake.restore();
  }
});

test('a declining modal port that changes ownership cannot fall back to stale handlers or leak repeats', () => {
  for (const name of ['Enter', 'PageDown']) {
    const w = world();
    try {
      const layer = w.layer('custom', 'sheet');
      let stale = 0;
      w.input.onAction(
        name === 'Enter' ? CONFIRM : PAGE_NEXT,
        () => {
          stale++;
          return true;
        },
        {layer: 'custom'},
      );
      const decline = () => {
        layer.close();
        return false;
      };
      if (name === 'Enter') w.layers.activateFocus = decline;
      else w.layers.scrollFocus = decline;
      const press = key(name);
      assert.equal(w.input.keyDown(press), true);
      assert.equal(press.prevented, true);
      assert.equal(w.input.keyDown(key(name, {repeat: true})), true);
      assert.equal(stale, 0);
      assert.deepEqual(w.input.drain('home#1'), []);
      w.input.keyUp(key(name));
    } finally {
      w.fake.restore();
    }
  }
});

test('owned digital sources hold independently of each other and keyboard; cancel requires neutral', () => {
  const w = world();
  try {
    const first = ownActionSource(w.input, ['core.move-up'], 'touch');
    const second = ownActionSource(w.input, ['core.move-up', 'core.interact'], 'touch');
    first.set(['core.move-up']);
    second.set(['core.move-up', 'core.interact']);
    assert.equal(w.input.held('core.move-up'), true);
    assert.equal(w.input.drain('home#1').filter(e => e.action === 'core.interact').length, 1);
    first.dispose();
    assert.equal(w.input.held('core.move-up'), true);
    w.input.cancel('overlay');
    second.set(['core.move-up', 'core.interact']);
    assert.equal(w.input.held('core.move-up'), false);
    second.set([]);
    second.set(['core.move-up']);
    assert.equal(w.input.held('core.move-up'), true);
    w.input.keyDown(key('w'));
    second.dispose();
    assert.equal(w.input.held('core.move-up'), true);
    w.input.keyUp(key('w'));
    assert.equal(w.input.held('core.move-up'), false);
  } finally {
    w.fake.restore();
  }
});

test('owned source rejects unknown actions, enforces capacity, and releases capacity on abort', () => {
  const w = world();
  try {
    const input = new InputActions({registry: w.registry, layers: w.layers, now: () => 0, maxOwnedSources: 1});
    assert.throws(() => ownActionSource(input, ['unknown.action'], 'touch'), /registered/);
    const life = new AbortController();
    const source = ownActionSource(input, ['core.move-up'], 'touch', life.signal);
    assert.throws(() => ownActionSource(input, [], 'touch'), /capacity/);
    assert.throws(() => source.set(['core.interact']), /not owned/);
    life.abort();
    ownActionSource(input, [], 'touch').dispose();
    source.set(['core.move-up']);
    assert.equal(input.held('core.move-up'), false);
  } finally {
    w.fake.restore();
  }
});

test('owned source cannot commit a press after synchronous neutral or disposal', () => {
  const w = world();
  try {
    const source = ownActionSource(w.input, ['core.move-up'], 'touch');
    const life = new AbortController();
    w.input.onAction(
      'core.move-up',
      () => {
        source.set([]);
        return true;
      },
      {signal: life.signal},
    );
    source.set(['core.move-up']);
    assert.equal(w.input.held('core.move-up'), false);
    life.abort();
    w.input.onAction('core.move-up', () => {
      source.dispose();
      return true;
    });
    source.set(['core.move-up']);
    assert.equal(w.input.held('core.move-up'), false);
  } finally {
    w.fake.restore();
  }
});

test('declining reentrant handlers cannot send stale owned presses to frame fallback', () => {
  for (const operation of ['dispose', 'neutral', 'layer'] as const) {
    const w = world();
    try {
      const source = ownActionSource(w.input, ['core.move-up'], 'touch');
      w.input.onAction(
        'core.move-up',
        () => {
          if (operation === 'dispose') source.dispose();
          else if (operation === 'neutral') source.set([]);
          else w.layer('dialog', 'modal');
          return false;
        },
        {owner: 'home#1'},
      );
      source.set(['core.move-up']);
      assert.equal(w.input.held('core.move-up'), false, operation);
      assert.deepEqual(w.input.drain('home#1'), [], operation);
    } finally {
      w.fake.restore();
    }
  }
});

test('a newer reentrant source update survives completion of the older press', () => {
  const w = world();
  try {
    const source = ownActionSource(w.input, ['core.move-up'], 'touch');
    let nested = false;
    w.input.onAction('core.move-up', () => {
      if (!nested) {
        nested = true;
        source.set([]);
        source.set(['core.move-up']);
      }
      return true;
    });
    source.set(['core.move-up']);
    assert.equal(w.input.held('core.move-up'), true);
    source.set([]);
    assert.equal(w.input.held('core.move-up'), false);
    source.dispose();
  } finally {
    w.fake.restore();
  }
});

test('fixed source ports reject undeclared slots and respect neutral, stale epochs and disposal', () => {
  const w = world();
  try {
    const port = openActionSource(w.input, ['core.move-up'], 'touch');
    assert.throws(() => port.press('core.interact', w.input.epoch), /not owned/);
    assert.throws(() => port.release('arbitrary.pointer-id'), /not owned/);
    const before = w.input.epoch;
    port.press('core.move-up', before);
    port.press('core.move-up', before);
    assert.equal(w.input.drain('home#1').length, 1);
    w.input.cancel('overlay');
    port.press('core.move-up', w.input.epoch);
    assert.equal(w.input.held('core.move-up'), false);
    port.release('core.move-up');
    port.press('core.move-up', before);
    assert.equal(w.input.held('core.move-up'), false);
    port.release('core.move-up');
    port.press('core.move-up', w.input.epoch);
    assert.equal(w.input.held('core.move-up'), true);
    port.dispose();
    port.press('core.move-up', w.input.epoch);
    assert.equal(w.input.held('core.move-up'), false);
  } finally {
    w.fake.restore();
  }
});

test('direct source release during a declining callback invalidates pending delivery', () => {
  const w = world();
  try {
    const port = openActionSource(w.input, ['core.move-up'], 'touch');
    w.input.onAction(
      'core.move-up',
      () => {
        port.release('core.move-up');
        return false;
      },
      {owner: 'home#1'},
    );
    port.press('core.move-up', w.input.epoch);
    assert.equal(w.input.held('core.move-up'), false);
    assert.deepEqual(w.input.drain('home#1'), []);
    port.dispose();
  } finally {
    w.fake.restore();
  }
});

test('source disposal retires every slot and admission even when release reporting throws', () => {
  const w = world();
  try {
    let reports = 0;
    const input = new InputActions({
      registry: w.registry,
      layers: w.layers,
      now: () => 0,
      maxOwnedSources: 1,
      report: error => {
        reports++;
        throw error;
      },
    });
    for (const id of ['core.move-up', 'core.move-down']) {
      input.onAction(id, event => {
        if (event.phase === 'release') throw new Error('release failed');
        return true;
      });
    }
    const source = ownActionSource(input, ['core.move-up', 'core.move-down'], 'touch');
    source.set(['core.move-up', 'core.move-down']);
    assert.doesNotThrow(() => source.dispose());
    assert.equal(reports, 2);
    assert.equal(input.held('core.move-up'), false);
    assert.equal(input.held('core.move-down'), false);
    source.dispose();
    ownActionSource(input, [], 'touch').dispose();
  } finally {
    w.fake.restore();
  }
});

test('a throwing cancellation reporter cannot strand sibling source cleanup', () => {
  const w = world();
  try {
    let reports = 0;
    const input = new InputActions({
      registry: w.registry,
      layers: w.layers,
      now: () => 0,
      report: () => {
        reports++;
        throw new Error('reporter failed');
      },
    });
    const source = ownActionSource(input, ['core.move-up'], 'touch');
    input.onAction('core.move-up', () => true);
    input.onCancel(() => {
      throw new Error('first cleanup failed');
    });
    input.onCancel(() => source.set([]));
    source.set(['core.move-up']);
    assert.doesNotThrow(() => input.cancel('overlay'));
    assert.equal(reports, 1);
    source.set(['core.move-up']);
    assert.equal(input.held('core.move-up'), true, 'sibling cleanup delivered neutral before restart');
    source.dispose();
  } finally {
    w.fake.restore();
  }
});

test('optional producers reject invalid capacity declarations before admission', () => {
  const w = world();
  try {
    for (const maxOwnedSources of [0, -1, 1.5, Infinity, NaN]) {
      const input = new InputActions({registry: w.registry, layers: w.layers, now: () => 0, maxOwnedSources});
      assert.throws(() => ownActionSource(input, [], 'touch'), /positive safe integer/);
    }
  } finally {
    w.fake.restore();
  }
});

for (const kind of ['action', 'cancel', 'frames'] as const) {
  test(`${kind} subscription rejects expired ownership and detaches manual-off abort listener`, () => {
    const w = world();
    try {
      const input = new InputActions({registry: w.registry, layers: w.layers, now: () => 0});
      let delivered = 0;
      const register = (signal: AbortSignal) =>
        kind === 'action'
          ? input.onAction(
              'core.interact',
              () => {
                delivered++;
              },
              {signal},
            )
          : kind === 'cancel'
            ? input.onCancel(() => {
                delivered++;
              }, signal)
            : input.claimFrames('home#1', signal);
      const dispatch = () => {
        if (kind === 'cancel') input.cancel('pause');
        else {
          input.keyDown(key('e'));
          input.keyUp(key('e'));
          if (kind === 'frames') delivered += input.drain('home#1').length;
        }
      };
      const expired = new AbortController();
      expired.abort();
      const expiredAdd = mock.method(expired.signal, 'addEventListener');
      register(expired.signal)();
      dispatch();
      assert.equal(delivered, 0, 'expired owner cannot receive actions or retain frame ownership');
      assert.equal(expiredAdd.mock.callCount(), 0);

      const life = new AbortController();
      const add = mock.method(life.signal, 'addEventListener');
      const remove = mock.method(life.signal, 'removeEventListener');
      const off = register(life.signal);
      dispatch();
      assert.equal(delivered, 1, 'live registration still receives input');
      assert.equal(add.mock.callCount(), 1);
      off();
      off();
      assert.equal(remove.mock.callCount(), 1, 'manual disposal is idempotent and removes the abort listener');
      dispatch();
      life.abort();
      assert.equal(remove.mock.callCount(), 1, 'later abort does not repeat disposed ownership cleanup');
      assert.equal(delivered, 1);

      const next = new AbortController();
      register(next.signal);
      next.abort();
      dispatch();
      assert.equal(delivered, 1, 'normal signal abort still ends ownership');
    } finally {
      w.fake.restore();
    }
  });
}

test('expired frame claim does not revoke existing live ownership with the same name', () => {
  const w = world();
  try {
    const life = new AbortController();
    life.abort();
    const off = w.input.claimFrames('home#1', life.signal);
    off();
    w.input.keyDown(key('e'));
    assert.equal(w.input.drain('home#1').length, 1);
  } finally {
    w.fake.restore();
  }
});

test('native shell activation does not enter scene actions while modified chords remain explicit', () => {
  const w = world([
    {
      id: 'game.modified',
      label: 'Modified',
      scope: 'global',
      kind: 'press',
      defaults: {keys: ['Ctrl+Enter'], pad: ['y']},
    },
  ]);
  try {
    const button = w.doc.createElement('button');
    w.doc.body.append(button);
    button.focus();
    for (const name of ['Enter', ' ']) {
      const event = key(name, {target: button});
      assert.equal(w.input.keyDown(event), false);
      assert.equal(event.prevented, false);
      assert.deepEqual(w.input.drain('home#1'), []);
      w.input.keyUp(event);
    }
    const modified = key('Enter', {target: button, ctrlKey: true});
    assert.equal(w.input.keyDown(modified), true);
    assert.ok(w.input.drain('home#1').some(event => event.action === 'game.modified'));
    w.input.keyUp(modified);
    assert.equal(w.input.keyDown(key('Enter', {target: w.scene})), true);
    assert.ok(w.input.drain('home#1').some(event => event.action === 'core.interact'));
  } finally {
    w.fake.restore();
  }
});

test('native activation distinguishes link Enter from Space and resolves a button descendant', () => {
  const w = world();
  try {
    const link = w.doc.createElement('a'),
      button = w.doc.createElement('button'),
      child = w.doc.createElement('span');
    link.setAttribute('href', '#target');
    button.append(child);
    w.doc.body.append(link, button);
    const enter = key('Enter', {target: link});
    assert.equal(w.input.keyDown(enter), false);
    assert.equal(enter.prevented, false);
    w.input.keyUp(enter);
    assert.equal(w.input.keyDown(key(' ', {target: link})), true, 'Space is not native link activation');
    assert.ok(w.input.drain('home#1').some(event => event.action === 'core.interact'));
    w.input.keyUp(key(' '));
    const space = key(' ', {target: child});
    assert.equal(w.input.keyDown(space), false);
    assert.equal(space.prevented, false);
    assert.deepEqual(w.input.drain('home#1'), []);
  } finally {
    w.fake.restore();
  }
});
