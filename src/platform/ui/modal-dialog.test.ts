import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeDom} from '../../testing/fake-dom';
import {LayerManager} from './layers';
import {openModalDialog} from './modal-dialog';

/** A fake `<dialog>` whose showModal focuses its first button, as the browser does, and whose close queues 'close'. */
function fakeDialog(doc: Document) {
  const d = doc.createElement('dialog') as HTMLDialogElement & {open: boolean};
  const queued: (() => void)[] = [];
  Object.assign(d, {
    open: false,
    showModal() {
      d.open = true;
      d.querySelector<HTMLElement>('button')?.focus();
    },
    close() {
      if (!d.open) return;
      d.open = false;
      queued.push(() => d.dispatchEvent(new Event('close')));
    },
  });
  return {
    d,
    flush: () => {
      while (queued.length) queued.shift()!();
    },
  };
}
function setup() {
  const fake = installFakeDom(),
    doc = fake.document as unknown as Document;
  const header = doc.createElement('header'),
    main = doc.createElement('main');
  doc.body.append(header, main);
  const opener = doc.createElement('button');
  header.append(opener);
  const layers = new LayerManager(doc, {shell: () => [header]});
  const scene = doc.createElement('section'),
    traversal = doc.createElement('button');
  scene.append(traversal);
  main.append(scene);
  layers.open({id: 'scene', kind: 'scene', element: scene, owner: 'scene:home', cover: 'none', modal: false});
  const {d, flush} = fakeDialog(doc),
    x = doc.createElement('button'),
    slider = doc.createElement('button');
  d.append(x, slider);
  doc.body.append(d);
  return {fake, doc, header, opener, layers, scene, d, x, slider, flush};
}

test('a shell dialog opens as a page modal: shell and scene inert, focus where showModal put it, the scene covered by a scrim', () => {
  const {fake, doc, header, opener, layers, scene, d, x} = setup();
  try {
    opener.focus();
    const layer = openModalDialog(d, {id: 'modal.sound', layers});
    assert.equal(d.open, true);
    assert.equal(layer.kind, 'modal');
    assert.equal(layer.modal, 'page');
    assert.equal(doc.activeElement, x, "the browser's first focus is kept");
    assert.equal(header.inert, true);
    assert.equal(scene.inert, true);
    assert.equal(layers.coverage('scene:home'), 'scrim', 'the scene pauses per its whenCovered');
    assert.equal(layers.previewing('scene:home'), false, 'not a preview layer: only the Graphics screen keeps drawing');
    assert.equal(openModalDialog(d, {id: 'modal.sound', layers}), layer, 'opening it again returns its layer');
  } finally {
    fake.restore();
  }
});

test('Tab wraps inside it; Escape closes it once and focus returns to the opener', () => {
  const {fake, doc, header, opener, layers, scene, d, x, slider, flush} = setup();
  try {
    opener.focus();
    const layer = openModalDialog(d, {id: 'modal.comfort', layers});
    layers.cycleFocus(false);
    assert.equal(doc.activeElement, slider);
    layers.cycleFocus(false);
    assert.equal(doc.activeElement, x, 'wraps at the end');
    layers.cycleFocus(true);
    assert.equal(doc.activeElement, slider, 'and at the start');
    assert.equal(layers.escape(), true);
    assert.equal(layer.closed, true);
    assert.equal(d.open, false, 'closing the layer closes the dialog');
    assert.notEqual(header.inert, true);
    assert.notEqual(scene.inert, true);
    assert.equal(doc.activeElement, opener, 'focus returns to the opener');
    assert.equal(layers.escape(), false, 'nothing more closes: the scene never does');
    flush();
    assert.equal(layers.coverage('scene:home'), 'top');
  } finally {
    fake.restore();
  }
});

test('a native close (the × button) closes the layer; a stale close event does not shut a reopened dialog', () => {
  const {fake, doc, opener, layers, d, flush} = setup();
  try {
    opener.focus();
    const first = openModalDialog(d, {id: 'modal.guide', layers});
    d.close();
    assert.equal(first.closed, false, 'the close event is a task');
    flush();
    assert.equal(first.closed, true);
    assert.equal(doc.activeElement, opener);
    const again = openModalDialog(d, {id: 'modal.guide', layers});
    d.close();
    d.showModal();
    flush();
    assert.equal(again.closed, false, 'the dialog is open again: the late close event is ignored');
    const reset = doc.createElement('button');
    d.append(reset);
    again.close('exit');
    const third = openModalDialog(d, {id: 'modal.reset', layers, initialFocus: () => reset});
    assert.equal(doc.activeElement, reset, 'initialFocus wins');
    third.close('escape');
    flush();
    assert.equal(doc.activeElement, opener);
  } finally {
    fake.restore();
  }
});

test("an opener in a menu that closed when it was pressed returns focus to the menu's summary", () => {
  const {fake, doc, header, layers, d, flush} = setup();
  try {
    const menu = doc.createElement('details'),
      summary = doc.createElement('summary'),
      content = doc.createElement('div'),
      item = doc.createElement('button');
    summary.tabIndex = 0; // a summary is focusable in a browser
    menu.append(summary, content);
    content.append(item);
    header.append(menu);
    item.focus();
    const layer = openModalDialog(d, {id: 'modal.sound', layers});
    content.hidden = true; // the menu closed on the press
    layer.close('escape');
    flush();
    assert.equal(doc.activeElement, summary);
  } finally {
    fake.restore();
  }
});

test('initial focus may close its opening layer without leaving a native modal behind', () => {
  const {fake, layers, d, flush} = setup();
  try {
    const layer = openModalDialog(d, {
      id: 'modal.early',
      layers,
      initialFocus() {
        layers.close('modal.early');
        return null;
      },
    });
    assert.equal(layer.closed, true);
    assert.equal(d.open, false);
    assert.equal(layers.stack().length, 1);
    flush();
    const retry = openModalDialog(d, {id: 'modal.early', layers});
    assert.equal(retry.closed, false);
    assert.equal(d.open, true);
    retry.close();
  } finally {
    fake.restore();
  }
});

test('initial focus replacement keeps the newer native dialog and layer identity', () => {
  const {fake, layers, d, flush} = setup();
  try {
    let replacement: ReturnType<typeof openModalDialog> | undefined;
    const first = openModalDialog(d, {
      id: 'modal.replace',
      layers,
      initialFocus() {
        layers.close('modal.replace');
        replacement = openModalDialog(d, {id: 'modal.replace', layers});
        return null;
      },
    });
    assert.equal(first.closed, true);
    assert.equal(replacement!.closed, false);
    assert.equal(d.open, true);
    assert.equal(openModalDialog(d, {id: 'modal.replace', layers}), replacement);
    flush();
    assert.equal(replacement!.closed, false, 'queued old close does not close the replacement');
    first.close();
    assert.equal(d.open, true);
    replacement!.close();
    assert.equal(d.open, false);
  } finally {
    fake.restore();
  }
});

test('failed initial focus rolls back its native and managed modal and permits retry', () => {
  const {fake, layers, d, flush} = setup();
  try {
    const failure = Error('focus failed');
    assert.throws(
      () =>
        openModalDialog(d, {
          id: 'modal.failed',
          layers,
          initialFocus() {
            throw failure;
          },
        }),
      error => error === failure,
    );
    assert.equal(d.open, false);
    assert.equal(layers.stack().length, 1);
    const next = openModalDialog(d, {id: 'modal.failed', layers});
    flush();
    assert.equal(next.closed, false);
    assert.equal(d.open, true);
    next.close();
  } finally {
    fake.restore();
  }
});

test('native open failure leaves no managed layer or stale dialog registration', () => {
  const {fake, layers, d} = setup();
  try {
    const original = d.showModal;
    d.showModal = () => {
      throw Error('native failed');
    };
    assert.throws(() => openModalDialog(d, {id: 'modal.failed', layers}), /native failed/);
    assert.equal(layers.stack().length, 1);
    assert.equal(d.open, false);
    d.showModal = original;
    const next = openModalDialog(d, {id: 'modal.failed', layers});
    assert.equal(next.closed, false);
    next.close();
  } finally {
    fake.restore();
  }
});

test('native showModal focus reentry adopts the replacement without a second layer', () => {
  const {fake, layers, d} = setup();
  try {
    const original = d.showModal;
    let replacement: ReturnType<typeof openModalDialog> | undefined;
    d.showModal = () => {
      original.call(d);
      replacement = openModalDialog(d, {id: 'modal.native-focus', layers});
    };
    const result = openModalDialog(d, {id: 'modal.native-focus', layers});
    assert.equal(result, replacement);
    assert.equal(layers.stack().length, 2);
    assert.equal(d.open, true);
    result.close();
  } finally {
    fake.restore();
  }
});

test('a failed old focus callback cannot roll back its admitted replacement', () => {
  const {fake, layers, d, flush} = setup();
  try {
    let replacement: ReturnType<typeof openModalDialog> | undefined;
    assert.throws(
      () =>
        openModalDialog(d, {
          id: 'modal.replace',
          layers,
          initialFocus() {
            replacement = openModalDialog(d, {id: 'modal.replace', layers});
            throw Error('old focus failed');
          },
        }),
      /old focus failed/,
    );
    assert.equal(layers.stack().length, 2);
    assert.equal(replacement!.closed, false);
    assert.equal(d.open, true);
    assert.equal(openModalDialog(d, {id: 'modal.replace', layers}), replacement);
    flush();
    assert.equal(replacement!.closed, false);
    replacement!.close();
  } finally {
    fake.restore();
  }
});

for (const fails of [false, true]) {
  test(`different-id replacement retires the pending outer modal${fails ? ' even when old focus throws' : ''}`, () => {
    const {fake, layers, d, flush} = setup();
    try {
      let replacement: ReturnType<typeof openModalDialog> | undefined;
      const create = () =>
        openModalDialog(d, {
          id: 'modal.old',
          layers,
          initialFocus() {
            replacement = openModalDialog(d, {id: 'modal.new', layers});
            if (fails) throw Error('old callback failed');
            return null;
          },
        });
      if (fails) assert.throws(create, /old callback failed/);
      else assert.equal(create().closed, true);
      assert.deepEqual(
        layers.stack().map(layer => layer.id),
        ['scene', 'modal.new'],
      );
      assert.equal(replacement!.closed, false);
      assert.equal(d.open, true);
      flush();
      assert.equal(replacement!.closed, false);
      replacement!.close();
      assert.deepEqual(
        layers.stack().map(layer => layer.id),
        ['scene'],
      );
      assert.equal(d.open, false);
    } finally {
      fake.restore();
    }
  });
}

test('an unadmitted modal closes its native dialog without closing a different-dialog replacement', () => {
  const {fake, doc, layers, d} = setup();
  try {
    const {d: replacementDialog} = fakeDialog(doc);
    doc.body.append(replacementDialog);
    let replacement: ReturnType<typeof openModalDialog> | undefined;
    const previousElement = doc.createElement('section');
    doc.body.append(previousElement);
    layers.open({
      id: 'modal.shared',
      kind: 'modal',
      element: previousElement,
      onClose() {
        replacement = openModalDialog(replacementDialog, {id: 'modal.shared', layers});
      },
    });
    const stale = openModalDialog(d, {id: 'modal.shared', layers});
    assert.equal(stale.closed, true);
    assert.equal(d.open, false);
    assert.equal(replacementDialog.open, true);
    assert.deepEqual(
      layers.stack().map(layer => layer.id),
      ['scene', 'modal.shared'],
    );
    assert.equal(layers.top(), replacement);
    replacement!.close();
    assert.equal(replacementDialog.open, false);
    assert.equal(layers.stack().length, 1);
  } finally {
    fake.restore();
  }
});
