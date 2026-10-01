/** kits/chalkboard/view: the DOM (SVG) of a board. `update(state)` touches only the elements whose state changed. */
import { BOARD, lengthOf, pathOf, tickLabels, type BoardItem } from './board';

export interface BoardItemState { visible: boolean; progress: number; spotlight: boolean }
export interface BoardState { items: Record<string, BoardItemState>; caption: { who: string; text: string; color?: string } | null; pointer: string | null }
export interface BoardView { readonly root: HTMLElement; update(s: BoardState): void; destroy(): void }

const SVG = 'http://www.w3.org/2000/svg';
const CHALK = '#f4f1ea';

export function createBoardView(host: HTMLElement, items: readonly BoardItem[], o: { title: string; text: (key: string) => string; reducedMotion?: boolean }): BoardView {
  const doc = host.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'chalkboard';
  root.dataset.learnKit = 'chalkboard';
  root.style.cssText = 'position:absolute;inset:100px 16px 76px 16px;display:grid;grid-template-rows:1fr auto;gap:8px;pointer-events:none;';
  const svg = doc.createElementNS(SVG, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${BOARD.width} ${BOARD.height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.cssText = 'width:100%;height:100%;background:#233a2e;border:3px solid #6b4f33;border-radius:12px;box-shadow:inset 0 0 40px rgb(0 0 0 / 35%);';
  const title = doc.createElementNS(SVG, 'title'); title.textContent = o.title; svg.append(title);
  const desc = doc.createElementNS(SVG, 'desc'); svg.append(desc);
  const caption = doc.createElement('p');
  caption.setAttribute('aria-live', 'polite');
  caption.style.cssText = 'margin:0;min-height:1.6em;padding:6px 12px;border-radius:10px;background:rgb(10 16 22 / 78%);color:var(--engine-text);font:600 var(--engine-text-xl) var(--engine-font);text-align:center;';
  root.append(svg, caption);
  host.prepend(root);   // under the lesson's cards and controls

  const nodes = new Map<string, { g: SVGGElement; stroke?: SVGPathElement; len: number; last: string }>();
  for (const i of items) {
    const g = doc.createElementNS(SVG, 'g') as SVGGElement;
    g.dataset.item = i.id;
    const color = i.color ?? CHALK;
    let stroke: SVGPathElement | undefined;
    if (i.kind === 'text' || i.kind === 'label') {
      const t = doc.createElementNS(SVG, 'text');
      t.setAttribute('x', String(i.at[0])); t.setAttribute('y', String(i.at[1]));
      t.setAttribute('fill', color); t.setAttribute('font-size', String(i.kind === 'text' ? (i.size ?? 7) : 5));
      t.setAttribute('font-family', 'system-ui, sans-serif');
      if (i.kind === 'label') t.setAttribute('text-anchor', 'middle');
      t.textContent = o.text(i.text);
      g.append(t);
    } else {
      stroke = doc.createElementNS(SVG, 'path') as SVGPathElement;
      stroke.setAttribute('d', pathOf(i)); stroke.setAttribute('fill', i.kind === 'circle' && i.fill ? i.fill : 'none');
      stroke.setAttribute('stroke', color); stroke.setAttribute('stroke-width', '0.9'); stroke.setAttribute('stroke-linecap', 'round'); stroke.setAttribute('stroke-linejoin', 'round');
      g.append(stroke);
      if (i.kind === 'number-line') for (const tl of tickLabels(i)) {
        const t = doc.createElementNS(SVG, 'text'); t.setAttribute('x', String(tl.at[0])); t.setAttribute('y', String(tl.at[1])); t.setAttribute('fill', color); t.setAttribute('font-size', '3.5'); t.setAttribute('text-anchor', 'middle'); t.textContent = tl.text; g.append(t);
      }
    }
    g.style.display = 'none';
    svg.append(g);
    nodes.set(i.id, { g, stroke, len: Math.max(1, lengthOf(i)), last: '' });
  }
  let lastCaption = '', lastDesc = '';
  return {
    root,
    update(s) {
      const said: string[] = [];
      for (const [id, n] of nodes) {
        const st = s.items[id] ?? { visible: false, progress: 0, spotlight: false };
        const p = o.reducedMotion ? (st.progress > 0 ? 1 : 0) : st.progress;
        const key = `${st.visible}|${p.toFixed(3)}|${st.spotlight}|${s.pointer === id}`;
        if (st.visible) said.push(id);
        if (key === n.last) continue;
        n.last = key;
        n.g.style.display = st.visible ? '' : 'none';
        if (n.stroke) { n.stroke.setAttribute('stroke-dasharray', String(n.len)); n.stroke.setAttribute('stroke-dashoffset', String(n.len * (1 - p))); }
        else n.g.style.opacity = String(p);
        n.g.style.filter = st.spotlight ? 'drop-shadow(0 0 1.5px #ffe27a)' : '';
        n.g.dataset.pointer = s.pointer === id ? 'true' : 'false';
      }
      const d = items.filter(i => said.includes(i.id) && (i.kind === 'text' || i.kind === 'label')).map(i => o.text((i as { text: string }).text)).join('. ');
      if (d !== lastDesc) { desc.textContent = d; lastDesc = d; }
      const c = s.caption ? `${s.caption.who}: ${s.caption.text}` : '';
      if (c !== lastCaption) { caption.textContent = c; caption.style.borderLeft = s.caption?.color ? `6px solid ${s.caption.color}` : ''; lastCaption = c; }
    },
    destroy() { root.remove(); },
  };
}
