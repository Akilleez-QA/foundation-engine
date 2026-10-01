import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../testing/fake-dom';
import { Shell } from './shell';
import { compactShellMenu, configureCompactShell } from './compact-shell';

function bar() {
  const fake = installFakeDom(), doc = fake.document as unknown as Document;
  const header = doc.createElement('header'), right = doc.createElement('div');
  header.className = 'topbar'; right.className = 'header-right'; header.append(right); doc.body.append(header);
  const button = (id: string) => { const b = doc.createElement('button'); b.id = id; return b; };
  const ids = (el: Element | null) => Array.from(el?.children ?? []).map(c => c.id || c.className);
  return { fake, doc, right, button, ids, shell: new Shell(doc) };
}

test('rows land in order whatever order they register in, around content that is not a row', () => {
  const { fake, doc, right, button, ids, shell } = bar();
  try {
    const tag = doc.createElement('span'); tag.className = 'level-tag'; right.append(tag);
    shell.add({ id: 'shell.listen', zone: 'header', order: 60, element: button('listen') });
    shell.add({ id: 'shell.level', zone: 'header', order: 50, element: tag });
    shell.add({ id: 'shell.sound-quick', zone: 'header', order: 40, element: button('quick') });
    shell.add({ id: 'shell.comfort', zone: 'menu', order: 20, element: button('comfort') });
    shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: button('sound') });
    shell.add({ id: 'shell.graphics', zone: 'menu', order: 70, element: button('graphics') });
    assert.deepEqual(ids(right), ['shell-menu', 'quick', 'level-tag', 'listen']);
    assert.deepEqual(ids(doc.querySelector('.shell-menu-content')), ['sound', 'comfort', 'graphics']);
    assert.deepEqual(shell.list('header').map(r => r.id), ['shell.menu', 'shell.sound-quick', 'shell.level', 'shell.listen']);
    // A module that still prepends outside the shell keeps its scene in front.
    right.children[0].before(button('map'));
    shell.add({ id: 'shell.late', zone: 'header', order: 45, element: button('late') });
    assert.deepEqual(ids(right), ['map', 'shell-menu', 'quick', 'late', 'level-tag', 'listen']);
  } finally { fake.restore(); }
});

test('the settings menu is the shell\'s own row: it closes on a button press or a click outside', () => {
  const { fake, doc, button, shell } = bar();
  try {
    const sound = button('sound');
    shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: sound });
    const menu = doc.querySelector('details.shell-menu') as HTMLDetailsElement;
    assert.equal(menu.querySelector('summary')?.textContent, 'Settings');
    menu.open = true; sound.click(); assert.equal(menu.open, false, 'a button inside closes it');
    menu.open = true; doc.body.click(); assert.equal(menu.open, false, 'a click outside closes it');
    menu.open = true; menu.querySelector<HTMLElement>('summary')!.click(); assert.equal(menu.open, true);
  } finally { fake.restore(); }
});

test('ids are unique, and removing a row takes its element out', () => {
  const { fake, right, button, ids, shell } = bar();
  try {
    const row = shell.add({ id: 'shell.listen', zone: 'header', order: 60, element: button('listen') });
    assert.throws(() => shell.add({ id: 'shell.listen', zone: 'header', order: 10, element: button('other') }), /already registered/);
    row.remove();
    assert.deepEqual(ids(right), []);
    assert.deepEqual(shell.list('header'), []);
  } finally { fake.restore(); }
});

test('compact shell opts in, retains registered rows and disposes its owned layer', async () => {
  const { LayerManager } = await import('./layers');
  const { fake, doc, button, shell } = bar();
  try {
    const layers = new LayerManager(doc);
    const signal = new AbortController();
    let cancelled = 0;
    const compact = configureCompactShell(shell, { layers, signal: signal.signal, closeLabel: 'Close settings', cancelInput: () => { cancelled++; } });
    const sound = button('sound');
    shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: sound });
    const summary = doc.querySelector<HTMLElement>('summary')!;
    summary.click();
    assert.equal(cancelled, 1);
    assert.equal(layers.stack().length, 1);
    assert.equal(layers.stack()[0].modal, 'page');
    assert.equal(doc.querySelector('.shell-compact-panel')?.contains(sound), true);
    const graphics = button('graphics');
    shell.add({ id: 'shell.graphics', zone: 'menu', order: 70, element: graphics });
    assert.equal(doc.querySelector('.shell-compact-panel')?.contains(graphics), true);
    compact.close();
    assert.equal(layers.stack().length, 0);
    assert.equal(doc.querySelector('details.shell-menu')?.contains(sound), true);
    summary.click();
    signal.abort();
    assert.equal(layers.stack().length, 0);
    assert.equal(doc.querySelector('.shell-compact-panel'), null);
    compact.dispose();
  } finally { fake.restore(); }
});

test('compact acquisition restores rows after failure and cannot strand a layer during abort', async () => {
  const { LayerManager } = await import('./layers');
  const { compactShellMenu } = await import('./compact-shell');
  const { fake, doc, button, shell } = bar();
  try {
    const sound = button('sound');
    shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: sound });
    const menu = doc.querySelector<HTMLDetailsElement>('details.shell-menu')!;
    const summary = menu.querySelector<HTMLElement>('summary')!;
    const layers = new LayerManager(doc);
    const actual = layers.open.bind(layers);
    const life = new AbortController();
    let calls = 0;
    layers.open = spec => {
      calls++;
      if (calls === 1) throw Error('acquisition failed');
      summary.click(); // Synchronous reentry during acquisition must be ignored.
      const handle = actual(spec);
      life.abort();
      return handle;
    };
    compactShellMenu({ menu, layers, signal: life.signal, closeLabel: 'Close', cancelInput() {} });
    assert.throws(() => summary.click(), /acquisition failed/);
    assert.equal(menu.contains(sound), true);
    assert.equal(doc.querySelector('.shell-compact-panel'), null);
    summary.click();
    assert.equal(calls, 2);
    assert.equal(layers.stack().length, 0);
    assert.equal(doc.querySelector('.shell-compact-panel'), null);
    assert.equal(menu.contains(sound), true);
  } finally { fake.restore(); }
});

test('compact shell declares its input dependency without changing expanded composition', async () => {
  const { shellModule } = await import('./shell-module');
  const { sceneId } = await import('../../author/ids');
  const home = sceneId('sample');
  assert.equal(shellModule({ home }).requires?.includes('platform.input'), false);
  assert.equal(shellModule({ home, menuPresentation: 'compact' }).requires?.includes('platform.input'), true);
});

test('stale compact handles cannot close or dispose a replacement before or after menu creation', async () => {
  const { LayerManager } = await import('./layers');
  for (const pending of [true, false]) {
    const { fake, doc, button, shell } = bar();
    try {
      const layers = new LayerManager(doc);
      const options = { layers, signal: new AbortController().signal, closeLabel: 'Close', cancelInput() {} };
      if (!pending) shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: button('sound') });
      const a = configureCompactShell(shell, options);
      const b = configureCompactShell(shell, options);
      a.close(); a.dispose();
      if (pending) shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: button('sound') });
      const summary = doc.querySelector<HTMLElement>('summary')!;
      summary.click();
      a.close(); a.dispose();
      assert.equal(layers.stack().length, 1);
      b.close();
      assert.equal(layers.stack().length, 0);
      summary.click();
      assert.equal(layers.stack().length, 1);
      b.dispose();
      assert.equal(layers.stack().length, 0);
    } finally { fake.restore(); }
  }
});

test('focus callback replacing configuration during disposal retains the newest owner', async () => {
  const { LayerManager } = await import('./layers');
  const { fake, doc, button, shell } = bar();
  try {
    const layers = new LayerManager(doc);
    const options = { layers, signal: new AbortController().signal, closeLabel: 'Close', cancelInput() {} };
    shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: button('sound') });
    configureCompactShell(shell, options);
    const summary = doc.querySelector<HTMLElement>('summary')!;
    summary.click();
    let newest: ReturnType<typeof configureCompactShell> | undefined;
    summary.focus = () => { if (!newest) newest = configureCompactShell(shell, options); };
    const interrupted = configureCompactShell(shell, options);
    interrupted.dispose();
    summary.click();
    assert.equal(layers.stack().length, 1);
    newest!.dispose();
    assert.equal(layers.stack().length, 0);
  } finally { fake.restore(); }
});

test('replacement during layer acquisition finds rows and late old close cannot reclaim them', async () => {
  const { LayerManager } = await import('./layers');
  const { fake, doc, button, shell } = bar();
  try {
    const layers = new LayerManager(doc);
    const options = { layers, signal: new AbortController().signal, closeLabel: 'Close', cancelInput() {} };
    const sound = button('sound');
    shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: sound });
    configureCompactShell(shell, options);
    const summary = doc.querySelector<HTMLElement>('summary')!;
    const actual = layers.open.bind(layers);
    let replaced = false;
    layers.open = spec => {
      const acquired = actual(spec);
      if (!replaced) {
        replaced = true;
        configureCompactShell(shell, options);
        summary.click();
      }
      return acquired;
    };
    summary.click();
    assert.equal(layers.stack().length, 1);
    assert.equal(layers.stack()[0].element.contains(sound), true);
    assert.equal(summary.getAttribute('aria-expanded'), 'true');
    layers.stack()[0].element.querySelector<HTMLElement>('button.shell-compact-close')?.click();
  } finally { fake.restore(); }
});

test('pending compact registration snapshots caller configuration and original lifetime', async () => {
  const { LayerManager } = await import('./layers');
  const { fake, doc, button, shell } = bar();
  try {
    const original = new AbortController();
    const replacement = new AbortController();
    const layers = new LayerManager(doc);
    const otherLayers = new LayerManager(doc);
    let originalCalls = 0;
    let changedCalls = 0;
    const options = { layers, signal: original.signal, closeLabel: 'Original close', cancelInput() { originalCalls++; } };
    configureCompactShell(shell, options);
    options.layers = otherLayers;
    options.signal = replacement.signal;
    options.closeLabel = 'Changed close';
    options.cancelInput = () => { changedCalls++; };
    shell.add({ id: 'shell.sound', zone: 'menu', order: 10, element: button('sound') });
    doc.querySelector<HTMLElement>('summary')!.click();
    assert.equal(layers.stack().length, 1);
    assert.equal(otherLayers.stack().length, 0);
    assert.equal(doc.querySelector('.shell-compact-close')?.textContent, 'Original close');
    assert.deepEqual([originalCalls, changedCalls], [1, 0]);
    replacement.abort();
    assert.equal(layers.stack().length, 1);
    original.abort();
    assert.equal(layers.stack().length, 0);
    assert.equal(doc.querySelector('.shell-compact-panel'), null);
  } finally { fake.restore(); }
});
