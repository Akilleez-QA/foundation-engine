import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene } from '../../author';
import { testScene } from '../../author/testing';
import { installFakeDom } from '../../testing/fake-dom';
import type { LessonInput } from './lesson';
import { directorSystem, disposeLesson } from './runtime';
import { CONTROLS_RESERVE, createControls } from './ui';

// Fake DOM geometry is set by hand: these tests pin the layout contract (what moves, by how much, and what stays),
// not real browser layout. scripts/play/stock-touch-check.mjs measures the same separation in Chromium.

type Rect = { left: number; top: number; width: number; height: number };
type El = { rect: Rect; style: Record<string, string>; tagName: string; children: El[]; append(...n: El[]): void; prepend?: unknown; querySelector(s: string): El | null; lastElementChild?: El | null };

function setup() {
  const fake = installFakeDom();
  Object.assign(fake.document, { createElementNS: (_ns: string, tag: string) => fake.document.createElement(tag) });
  const observers: { trigger(): void }[] = [];
  const g = globalThis as unknown as { ResizeObserver: new (fn: () => void) => { trigger(): void } };
  const Base = g.ResizeObserver;
  g.ResizeObserver = class extends Base { constructor(fn: () => void) { super(fn); observers.push(this); } };
  const overlay = fake.document.createElement('div') as unknown as El;
  fake.document.body.append(overlay as never);
  Object.assign(overlay, { prepend: (node: El) => overlay.append(node) });
  const relayout = () => { for (const o of observers) o.trigger(); };
  return { fake, overlay, relayout };
}

/** Resolve the inset expressions the kit writes (`max(Npx, var(--p, 0px))`) against the overlay's published properties. */
function px(expr: string, overlay: El): number {
  const resolved = expr.replace(/var\((--[\w-]+),\s*([^)]+)\)/g, (_m, name: string, fallback: string) => overlay.style[name] || fallback);
  const m = resolved.match(/^max\((.*)\)$/);
  return Math.max(...(m ? m[1].split(',') : [resolved]).map(v => parseFloat(v)));
}

const lesson: LessonInput = {
  id: 'layout', version: 1, title: 'Layout',
  objectives: [{ id: 'see', text: 'See' }],
  cast: [{ id: 'teacher', name: 'Teacher', role: 'teacher', color: '#fff' }],
  outline: [{ id: 'board', type: 'board', objective: 'see' }],
  scenes: { board: { type: 'board', title: 'Board', board: { items: [] }, timeline: [{ do: 'say', who: 'teacher', text: 'Look at the board' }, { do: 'wait-for', event: 'next' }] } },
};

async function boardLesson(width: number, height: number, barHeight: number) {
  const s = setup();
  const h = await testScene(defineScene({ id: 'layout', title: 'Layout', systems: [directorSystem(lesson)], exit: disposeLesson }));
  s.overlay.rect = { left: 0, top: 0, width, height };
  Object.assign(h.ctx.view, { overlay: s.overlay });
  h.run(1 / 60);
  const nav = s.overlay.querySelector('nav')!, board = s.overlay.querySelector('.chalkboard')!;
  nav.rect = { left: 8, top: height - 12 - barHeight, width: width - 16, height: barHeight };
  const progress = s.overlay.children.find(el => el.tagName === 'P' && el.style.cssText?.includes('left:16px'))!;
  progress.rect = { left: 16, top: 56, width: 90, height: 30 };
  s.relayout();
  return { ...s, h, nav, board };
}

test('compact portrait: a wrapped control bar never covers the board or its caption', async () => {
  // 320×568 with the 47 px shell header: the bar wraps to three 48 px rows (160 px with gaps).
  const { fake, h, overlay, nav, board } = await boardLesson(320, 521, 160);
  try {
    const boardBottomEdge = overlay.rect.height - px(board.style.bottom, overlay);
    assert.ok(boardBottomEdge <= nav.rect.top - 8, `board ends at ${boardBottomEdge}, bar starts at ${nav.rect.top}`);
    assert.equal(overlay.style[CONTROLS_RESERVE], '180px');
  } finally { h.dispose(); fake.restore(); }
});

test('desktop: a single-row bar keeps the authored board inset and top line geometry', async () => {
  const { fake, h, overlay, board } = await boardLesson(1280, 753, 48);
  try {
    assert.equal(px(board.style.bottom, overlay), 76);   // chalkboard's own inset, unchanged
    assert.equal(overlay.style['--learn-top-clear'], '0px');
    assert.equal(overlay.style['--learn-top-side'], '160px');
  } finally { h.dispose(); fake.restore(); }
});

test('a centred panel moves below the top line and scrolls above a wrapped bar only when it would collide', () => {
  const { fake, overlay, relayout } = setup();
  try {
    overlay.rect = { left: 0, top: 0, width: 320, height: 521 };
    const controls = createControls(overlay as never);
    const nav = overlay.querySelector('nav')!, progress = overlay.children[0];
    nav.rect = { left: 8, top: 349, width: 304, height: 160 };
    progress.rect = { left: 16, top: 56, width: 90, height: 30 };
    const doc = (overlay as unknown as { ownerDocument: { createElement(t: string): El } }).ownerDocument;
    const line = doc.createElement('p'), panel = doc.createElement('section');
    overlay.append(line, panel);
    Object.assign(panel.style, { top: '50%', transform: 'translate(-50%,-55%)' });
    line.rect = { left: 16, top: 94, width: 288, height: 48 };
    panel.rect = { left: 0, top: 118, width: 320, height: 260 };   // centred: covers the line's lower half
    controls.arrange({ line: line as never, panel: panel as never });
    relayout();
    assert.equal(overlay.style['--learn-top-clear'], '94px');   // the line drops below the progress pill
    assert.equal(panel.style.top, '150px');                      // below the line (142) plus the gap
    assert.equal(panel.style.transform, 'translateX(-50%)');
    assert.equal(panel.style.maxHeight, '191px');                // scrolls within what the bar leaves (341)
    assert.equal(panel.style.overflowY, 'auto');
    // Rotated or resized to desktop: room again, so the authored position returns.
    overlay.rect = { left: 0, top: 0, width: 1280, height: 753 };
    nav.rect = { left: 8, top: 693, width: 1264, height: 48 };
    line.rect = { left: 305, top: 56, width: 670, height: 30 };
    panel.rect = { left: 346, top: 248, width: 588, height: 234 };
    relayout();
    assert.deepEqual([panel.style.top, panel.style.transform, panel.style.maxHeight], ['50%', 'translate(-50%,-55%)', '']);
    assert.equal(overlay.style['--learn-top-clear'], '0px');
    controls.destroy();
    assert.equal(overlay.style[CONTROLS_RESERVE], '');
    assert.equal(overlay.style['--learn-top-clear'], '');
  } finally { fake.restore(); }
});
