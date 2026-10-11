/** Update-local interval index. Internal captured bodies only; no owner, callbacks or public kit API. */
interface Interval {
  readonly id: number;
  readonly minX: number;
  readonly maxX: number;
}

/** Match the sweep's minX/id ordering, including extents rounded to zero at large coordinates. */
export function contactIntervalsOverlap(a: Interval, b: Interval): boolean {
  return a.minX < b.minX || (a.minX === b.minX && a.id < b.id) ? b.minX < a.maxX : a.minX < b.maxX;
}

export function createContactIndex<T extends Interval>(bodies: readonly T[]) {
  const sorted = [...bodies].sort((a, b) => a.minX - b.minX || a.id - b.id);
  let base = 1;
  while (base < sorted.length) base *= 2;
  const maxima = new Float64Array(base * 2).fill(-Infinity);
  for (let i = 0; i < sorted.length; i++) maxima[base + i] = sorted[i]!.maxX;
  for (let i = base - 1; i > 0; i--) maxima[i] = Math.max(maxima[i * 2]!, maxima[i * 2 + 1]!);
  return {
    /** Logical index slots, independent of overlap density; not a JS heap-byte estimate. */
    slots: maxima.length,
    /** Replace one caller-owned row; return traversal visits for internal algorithm checks. */
    row(body: T, out: T[]): number {
      out.length = 0;
      let visits = 0;
      function visit(node: number, lo: number, hi: number): void {
        visits++;
        if (lo >= sorted.length || sorted[lo]!.minX >= body.maxX || maxima[node]! < body.minX) return;
        if (hi - lo === 1) {
          const other = sorted[lo]!;
          if (other.id > body.id && contactIntervalsOverlap(body, other)) out.push(other);
          return;
        }
        const mid = (lo + hi) / 2;
        visit(node * 2, lo, mid);
        visit(node * 2 + 1, mid, hi);
      }
      visit(1, 0, base);
      out.sort((a, b) => a.id - b.id);
      return visits;
    },
  };
}
