import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, defineSystem, testScene } from '../../author';
import { hud } from './index';
import { createViewSize } from '../../author/view-size';

test('ui kit: the HUD keeps lines, a banner and a prompt per scene visit, readable without a DOM', async () => {
  const show = defineSystem({ id: 'show', phase: 'frame', run(ctx) { hud(ctx).line('score', `Score ${ctx.time.frame}`); hud(ctx).banner(ctx.time.frame > 2 ? 'Over' : null); } });
  const t = await testScene(defineScene({ id: 'hud-test', title: 'HUD', systems: [show] }));
  t.run(2 / 60);
  assert.deepEqual(hud(t.ctx).read(), { lines: { score: 'Score 2' }, banner: null, prompt: null });
  t.run(1 / 60);
  assert.equal(hud(t.ctx).read().banner, 'Over');
  hud(t.ctx).line('score', null);
  assert.deepEqual(hud(t.ctx).read().lines, {});
});

// Minimal DOM boundary double: layout and input reach are verified by the browser consumer.
class HudElement extends EventTarget {
  children: HudElement[] = [];
  parentElement: HudElement | null = null;
  style = { cssText: '' }; dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  className = ''; textContent = ''; hidden = false; type = ''; tabIndex = -1;
  constructor(readonly ownerDocument: HudDocument) { super(); }
  get isConnected(): boolean { return this === this.ownerDocument.root || !!this.parentElement?.isConnected; }
  append(...nodes: HudElement[]) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes: HudElement[]) { for (const n of [...this.children]) n.remove(); this.append(...nodes); }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter(n => n !== this); this.parentElement = null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  focus() { this.ownerDocument.focus = this; }
}
class HudDocument {
  root = new HudElement(this); focus: HudElement | null = null;
  createElement(_tag: string) { return new HudElement(this); }
}
function domHud() {
  const doc = new HudDocument(), overlay = doc.createElement('div'); doc.root.append(overlay);
  type Options = Parameters<NonNullable<import('../../author').SceneContext['view']['openReadingSheet']>>[0];
  const requests: { options: Options; abort: AbortController; close(): void; reject(error: Error): void }[] = [];
  let size = { width: 390, height: 844 };
  const lifetime = new AbortController();
  const errors: unknown[] = [];
  const sizes = createViewSize(lifetime.signal, () => size, error => errors.push(error));
  const ctx = { view: { overlay, observeSize: sizes.observe, openReadingSheet(options: Options) {
    const abort = new AbortController();
    const ready = new Promise<void>((_resolve, reject) => {
      const close = () => { if (abort.signal.aborted) return; abort.abort(); (options.element as unknown as HudElement).remove(); (options.returnFocus() as unknown as HudElement | null)?.focus(); };
      requests.push({ options, abort, close, reject });
    });
    overlay.append(options.element as unknown as HudElement);
    (options.initialFocus() as unknown as HudElement | null)?.focus();
    return { signal: abort.signal, ready, close: requests.at(-1)!.close };
  } } } as unknown as import('../../author').SceneContext;
  const h = hud(ctx);
  const all = (el: HudElement): HudElement[] => el.children.flatMap(child => [child, ...all(child)]);
  const find = (name: string) => all(overlay).find(el => el.className === name)!;
  return { doc, overlay, h, requests, find, errors, lifetime, resize(width: number, height = 844) { size = { width, height }; sizes.refresh(); } };
}

test('HUD disclosure keeps essential state visible and preserves inline defaults without a layer', () => {
  const { h, find, requests } = domHud();
  h.line('essential', 'Keep visible'); h.line('detail', '<img onerror=bad>', { importance: 'detail' });
  assert.deepEqual(find('hud-lines').children.map(x => x.textContent), ['Keep visible', '<img onerror=bad>']);
  assert.equal(find('hud-details-trigger').hidden, true); assert.equal(requests.length, 0);
  h.present({ mode: 'disclose', label: 'Details', closeLabel: 'Close' });
  assert.deepEqual(find('hud-lines').children.map(x => x.textContent), ['Keep visible']);
  const trigger = find('hud-details-trigger'); assert.equal(trigger.hidden, false);
  assert.match(trigger.style.cssText, /min-width:48px;min-height:48px/);
  trigger.dispatchEvent(new Event('click')); h.details(true);
  assert.equal(requests.length, 1, 'repeated open does not allocate another sheet');
  const sheet = requests[0].options.element as unknown as HudElement;
  assert.equal(sheet.children[0].children[1].children[0].textContent, '<img onerror=bad>', 'content remains literal text');
  assert.deepEqual(h.read(), { lines: { essential: 'Keep visible', detail: '<img onerror=bad>' }, banner: null, prompt: null });
});

test('HUD last-detail removal and inline transition close before leaving focus on a hidden trigger', () => {
  const { h, requests, doc, find } = domHud();
  h.line('secondary', 'More', { importance: 'detail' }); h.present({ mode: 'disclose', label: 'Details', closeLabel: 'Close' });
  h.details(true); h.line('secondary', null);
  assert.equal(requests[0].abort.signal.aborted, true); assert.equal(find('hud-details-trigger').hidden, true);
  assert.equal(doc.focus, doc.root, 'removed trigger restores scene focus');
  h.line('secondary', 'More', { importance: 'detail' }); h.details(true); h.present({ mode: 'inline' });
  assert.equal(requests[1].abort.signal.aborted, true); assert.equal(doc.focus, doc.root);
  assert.deepEqual(find('hud-lines').children.map(x => x.textContent), ['More']);
});

test('HUD importance-only changes update disclosure and identical presentations preserve focused sheet', () => {
  const { h, requests, doc, find } = domHud();
  h.line('row', 'Same'); h.present({ mode: 'disclose', label: 'Details', closeLabel: 'Close' });
  assert.equal(find('hud-details-trigger').hidden, true);
  h.line('row', 'Same', { importance: 'detail' }); h.details(true);
  const focus = doc.focus; h.present({ mode: 'disclose', label: 'Details', closeLabel: 'Close' });
  h.present({ mode: 'disclose', label: 'Information', closeLabel: 'Return' });
  assert.equal(requests.length, 1); assert.equal(doc.focus, focus);
  assert.equal((requests[0].options.element as unknown as HudElement).attributes.get('aria-label'), 'Information');
  assert.equal(focus?.attributes.get('aria-label'), 'Information');
  assert.equal(find('hud-details-close').textContent, 'Return');
  h.line('row', 'Same');
  assert.equal(requests[0].abort.signal.aborted, true, 'two-argument line restores essential default');
  assert.deepEqual(find('hud-lines').children.map(x => x.textContent), ['Same']);
});

test('HUD close, aborted entry and stale ready rejection leave later sheets intact', async () => {
  const { h, requests, find } = domHud();
  h.line('row', 'Detail', { importance: 'detail' }); h.present({ mode: 'disclose', label: 'Details', closeLabel: 'Close' });
  h.details(true); h.details(false); h.details(true);
  requests[0].reject(new Error('late failure')); await Promise.resolve();
  assert.equal(find('hud-details-trigger').attributes.get('aria-expanded'), 'true');
  assert.equal(requests[1].abort.signal.aborted, false);
  const sheet = requests[1].options.element as unknown as HudElement;
  sheet.children[1].dispatchEvent(new Event('click'));
  assert.equal(requests[1].abort.signal.aborted, true);
  assert.equal(find('hud-details-trigger').attributes.get('aria-expanded'), 'false');
  h.details(true); requests[2].abort.abort();
  assert.equal(find('hud-details-trigger').attributes.get('aria-expanded'), 'false');
  assert.equal(find('hud-details-sheet'), undefined);
});

test('HUD repeated open/close retains one trigger and no detached sheet in the active overlay', () => {
  const { h, overlay, requests, find } = domHud();
  h.line('row', 'Detail', { importance: 'detail' }); h.present({ mode: 'disclose', label: 'Details', closeLabel: 'Close' });
  const baseline = overlay.children.length;
  for (let i = 0; i < 100; i++) { h.details(true); h.details(false); }
  assert.equal(overlay.children.length, baseline); assert.equal(requests.filter(r => !r.abort.signal.aborted).length, 0);
  assert.equal(overlay.children.filter(e => e.className === 'hud-header').length, 1);
  assert.equal(find('hud-details-trigger').attributes.get('aria-expanded'), 'false');
});


test('HUD reading starts at the named paging region and retains Close and focus return', () => {
  const { h, requests, doc, find } = domHud();
  h.line('row', 'Long reading content', { importance: 'detail' });
  h.present({ mode: 'disclose', label: 'Details', closeLabel: 'Close' }); h.details(true);
  const sheet = requests[0].options.element as unknown as HudElement;
  const scroll = sheet.children[0], close = sheet.children[1];
  assert.equal(doc.focus, scroll, 'opening starts on the explicit paging surface');
  assert.equal(scroll.tabIndex, 0, 'reading region remains part of the tab sequence');
  assert.equal(sheet.attributes.get('aria-modal'), undefined, 'scope sheet does not claim whole-page modality');
  assert.equal(close.type, 'button', 'Close remains a native keyboard/controller action');
  assert.deepEqual(sheet.children, [scroll, close], 'Close follows the initial reading focus in DOM order');
  assert.equal(scroll.attributes.has('data-ui-scroll'), true, 'only the intentional reading region opts into layer page actions');
  assert.equal(scroll.attributes.get('role'), 'region');
  assert.equal(scroll.attributes.get('aria-label'), 'Details');
  assert.match(scroll.style.cssText, /overflow-y:auto/);
  assert.notEqual(scroll, close);
  h.present({ mode: 'disclose', label: 'Translated details', closeLabel: 'Return' });
  assert.equal(scroll.attributes.get('aria-label'), 'Translated details');
  assert.equal(requests.length, 1, 'translation updates the existing keyboard surface');
  assert.equal(doc.focus, scroll, 'translation does not steal reading focus');
  close.dispatchEvent(new Event('click'));
  assert.equal(requests[0].abort.signal.aborted, true);
  assert.equal(doc.focus, find('hud-details-trigger'), 'closing returns focus to the invoking action');
});


test('creator layout selection preserves sheets, closes through the existing owner and detaches manually', () => {
  const { h, requests, find, resize, lifetime } = domHud();
  h.line('detail', 'More', { importance: 'detail' });
  let selections = 0;
  h.layout({ select: ({ width }) => {
    selections++;
    return width < 700 ? { mode: 'disclose', label: 'Details', closeLabel: 'Close' } : { mode: 'inline' };
  } });
  assert.equal(find('hud-details-trigger').hidden, false);
  h.details(true);
  resize(400);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].abort.signal.aborted, false);
  resize(900);
  assert.equal(requests[0].abort.signal.aborted, true);
  assert.equal(find('hud-details-trigger').hidden, true);
  h.present({ mode: 'inline' });
  resize(390);
  assert.equal(selections, 3);
  h.layout({ select: () => { selections++; return { mode: 'inline' }; } });
  lifetime.abort();
  resize(1000);
  assert.equal(selections, 4);
});

test('layout selector failures preserve usable HUD and replacement during selection wins', () => {
  const { h, errors, find, resize } = domHud();
  h.line('detail', 'More', { importance: 'detail' });
  h.layout({ select: () => { throw new Error('bad author selector'); } });
  assert.equal(errors.length, 1);
  assert.equal(find('hud-details-trigger').hidden, true);
  h.layout({ select: () => ({ mode: 'bad' } as never) });
  assert.equal(errors.length, 2);
  h.layout({ select: () => {
    h.present({ mode: 'inline' });
    return { mode: 'disclose', label: 'Ignored', closeLabel: 'Close' };
  } });
  resize(500);
  assert.equal(find('hud-details-trigger').hidden, true);
  assert.equal(errors.length, 2);
});

test('replacing and stopping layout removes previous viewport selection', () => {
  const { h, resize, find } = domHud();
  h.line('detail', 'More', { importance: 'detail' });
  let oldCalls = 0;
  let newCalls = 0;
  h.layout({ select: () => { oldCalls++; return { mode: 'inline' }; } });
  h.layout({ select: () => { newCalls++; return { mode: 'disclose', label: 'Details', closeLabel: 'Close' }; } });
  resize(500);
  assert.equal(oldCalls, 1);
  assert.equal(newCalls, 2);
  h.layout(null);
  resize(900);
  assert.equal(newCalls, 2);
  assert.equal(find('hud-details-trigger').hidden, false, 'stopping retains current presentation');
});
