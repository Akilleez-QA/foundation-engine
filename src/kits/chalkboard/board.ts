/**
 * kits/chalkboard/board: board items as data, in board units (a 160 × 90 board, y down), and their chalk paths.
 * Items: text and label (i18n keys), line, arrow, circle, rect, axes, number line, and a free path. Each item's
 * `path()` is the stroke a draw-on animation reveals; `length` sizes the dash for it. Pure: no DOM.
 */
export type Pt = [x: number, y: number];
export type BoardItem =
  | { id: string; kind: 'text'; at: Pt; text: string; size?: number; color?: string }
  | { id: string; kind: 'label'; at: Pt; text: string; color?: string }
  | { id: string; kind: 'line'; from: Pt; to: Pt; color?: string }
  | { id: string; kind: 'arrow'; from: Pt; to: Pt; color?: string }
  | { id: string; kind: 'circle'; at: Pt; r: number; color?: string; fill?: string }
  | { id: string; kind: 'rect'; at: Pt; w: number; h: number; color?: string }
  | { id: string; kind: 'axes'; at: Pt; w: number; h: number; color?: string }
  | { id: string; kind: 'number-line'; from: Pt; to: Pt; min: number; max: number; step: number; color?: string }
  | { id: string; kind: 'path'; points: Pt[]; closed?: boolean; color?: string };

export const BOARD = { width: 160, height: 90 } as const;
const d = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The SVG path data of an item's stroke (text items have none: they are written, not drawn). */
export function pathOf(i: BoardItem): string {
  const M = (p: Pt) => `M${p[0]} ${p[1]}`, L = (p: Pt) => `L${p[0]} ${p[1]}`;
  switch (i.kind) {
    case 'line': return `${M(i.from)}${L(i.to)}`;
    case 'arrow': {
      const [x1, y1] = i.from, [x2, y2] = i.to, a = Math.atan2(y2 - y1, x2 - x1), h = 3;
      const l: Pt = [x2 - h * Math.cos(a - 0.5), y2 - h * Math.sin(a - 0.5)], r: Pt = [x2 - h * Math.cos(a + 0.5), y2 - h * Math.sin(a + 0.5)];
      return `${M(i.from)}${L(i.to)}${M(l)}${L(i.to)}${L(r)}`;
    }
    case 'circle': return `M${i.at[0] + i.r} ${i.at[1]}A${i.r} ${i.r} 0 1 1 ${i.at[0] - i.r} ${i.at[1]}A${i.r} ${i.r} 0 1 1 ${i.at[0] + i.r} ${i.at[1]}`;
    case 'rect': return `${M(i.at)}h${i.w}v${i.h}h${-i.w}Z`;
    case 'axes': return `${M([i.at[0], i.at[1] - i.h])}${L(i.at)}${L([i.at[0] + i.w, i.at[1]])}`;
    case 'number-line': {
      const n = Math.round((i.max - i.min) / i.step), ticks: string[] = [];
      for (let k = 0; k <= n; k++) { const x = i.from[0] + ((i.to[0] - i.from[0]) * k) / n, y = i.from[1] + ((i.to[1] - i.from[1]) * k) / n; ticks.push(`M${x} ${y - 1.5}L${x} ${y + 1.5}`); }
      return `${M(i.from)}${L(i.to)}${ticks.join('')}`;
    }
    case 'path': return i.points.map((p, k) => (k ? L(p) : M(p))).join('') + (i.closed ? 'Z' : '');
    default: return '';
  }
}

/** The stroke length of an item, in board units (for the draw-on dash). */
export function lengthOf(i: BoardItem): number {
  switch (i.kind) {
    case 'line': return d(i.from, i.to);
    case 'arrow': return d(i.from, i.to) + 6;
    case 'circle': return 2 * Math.PI * i.r;
    case 'rect': return 2 * (i.w + i.h);
    case 'axes': return i.w + i.h;
    case 'number-line': return d(i.from, i.to) + 3 * (Math.round((i.max - i.min) / i.step) + 1);
    case 'path': return i.points.slice(1).reduce((s, p, k) => s + d(i.points[k], p), 0) + (i.closed && i.points.length > 2 ? d(i.points[i.points.length - 1], i.points[0]) : 0);
    default: return 0;
  }
}

/** Number-line tick labels (min … max). */
export function tickLabels(i: Extract<BoardItem, { kind: 'number-line' }>): { at: Pt; text: string }[] {
  const n = Math.round((i.max - i.min) / i.step);
  return Array.from({ length: n + 1 }, (_, k) => ({ at: [i.from[0] + ((i.to[0] - i.from[0]) * k) / n, i.from[1] + 6] as Pt, text: String(+(i.min + k * i.step).toFixed(6)) }));
}
