/** A rectangle in one caller-selected coordinate space, normally CSS pixels. */
export interface OcclusionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OcclusionMeasure {
  /** Area inside the supplied viewport. Zero for an empty or outside region. */
  readonly area: number;
  /** Union of supplied footprints intersecting this region. */
  readonly occupiedArea: number;
  /** occupiedArea / area, or zero when area is zero. */
  readonly occupiedRatio: number;
}

export interface UiOcclusionReport extends OcclusionMeasure {
  /** Same order as the supplied critical regions; regions are assessed independently. */
  readonly criticalRegions: readonly OcclusionMeasure[];
}

/** Diagnostic work limits; exceeding these throws before geometry is processed. */
export const UI_OCCLUSION_LIMITS = Object.freeze({ footprints: 256, criticalRegions: 64 });

type Bounds = { left: number; top: number; right: number; bottom: number };

function bounds(rect: OcclusionRect, label: string): Bounds {
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0
    || !Number.isFinite(x + width) || !Number.isFinite(y + height)
    || !Number.isFinite(width * height)) {
    throw new RangeError(`${label}: expected finite coordinates, nonnegative dimensions and finite edges/area`);
  }
  return { left: x, top: y, right: x + width, bottom: y + height };
}

function intersect(a: Bounds, b: Bounds): Bounds | undefined {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : undefined;
}

// Sweep x slabs and merge their occupied y intervals. Overlapping footprints are
// counted once, independent of input order. This runs on demand, never per frame.
function unionArea(rects: readonly Bounds[]): number {
  const xs = [...new Set(rects.flatMap(r => [r.left, r.right]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1]!, right = xs[i]!; // 1 <= i < xs.length
    const spans = rects.filter(r => r.left < right && r.right > left).sort((a, b) => a.top - b.top);
    let length = 0, end = -Infinity;
    for (const span of spans) {
      if (span.bottom > end) {
        length += span.bottom - Math.max(span.top, end);
        end = span.bottom;
      }
    }
    area += (right - left) * length;
  }
  return area;
}

function measure(region: Bounds | undefined, footprints: readonly Bounds[]): OcclusionMeasure {
  if (!region) return Object.freeze({ area: 0, occupiedArea: 0, occupiedRatio: 0 });
  const area = (region.right - region.left) * (region.bottom - region.top);
  if (area === 0) return Object.freeze({ area: 0, occupiedArea: 0, occupiedRatio: 0 });
  const clipped = footprints.flatMap(rect => {
    const overlap = intersect(region, rect);
    return overlap ? [overlap] : [];
  });
  // Roundoff can slightly exceed the containing area after many additions.
  const occupiedArea = Math.min(area, unionArea(clipped));
  return Object.freeze({ area, occupiedArea, occupiedRatio: occupiedArea / area });
}

/**
 * Pure, optional, bounded geometry diagnostic. No DOM sampling, device inference,
 * visibility thresholds or pass/fail policy. All rectangles use the same coordinate
 * space. Include translucent content and transparent input blockers explicitly;
 * this function neither infers opacity nor discounts any supplied footprint.
 *
 * Results measure the union clipped to the viewport, and separately to each
 * viewport-clipped critical region. A zero-area region reports zero, not a
 * visibility pass. The caller must check that required regions actually exist.
 * Inputs are neither retained nor mutated. All results are frozen snapshots.
 */
export function measureUiOcclusion(
  viewport: OcclusionRect,
  footprints: readonly OcclusionRect[],
  criticalRegions: readonly OcclusionRect[] = [],
): UiOcclusionReport {
  if (footprints.length > UI_OCCLUSION_LIMITS.footprints
    || criticalRegions.length > UI_OCCLUSION_LIMITS.criticalRegions) {
    throw new RangeError('UI occlusion diagnostic input limit exceeded');
  }
  const view = bounds(viewport, 'viewport');
  const occupied = footprints.map((rect, i) => bounds(rect, `footprints[${i}]`));
  const regions = criticalRegions.map((rect, i) => bounds(rect, `criticalRegions[${i}]`));
  return Object.freeze({
    ...measure(view, occupied),
    criticalRegions: Object.freeze(regions.map(region => measure(intersect(view, region), occupied))),
  });
}
