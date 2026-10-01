// core/tiers.ts: the quality presets (ADR 0017, 0029, 0030). Types plus the ordered preset list.
// The single home of `QualityPreset`: the kernel's module budgets, core/activity, the quality service
// (platform/render) and the asset manifest (platform/assets) all read it from here. Budget shapes live in
// core/budget.ts when that lands; the checker is platform/perf/budget-check.ts.

/** 'reference' is the reference machine (the design bar, the only gated tier); the others are later ports. */
export type QualityPreset = 'reference' | 'high' | 'medium' | 'low';
/** The lighter presets: the keys of a `Ported<T>`'s `ports`. */
export type PortPreset = Exclude<QualityPreset, 'reference'>;
/** Flat fields are the reference values; `ports` override them for lighter presets (ADR 0030). */
export type Ported<T> = T & { ports?: Partial<Record<PortPreset, Partial<T>>> };

/** Presets, best first (display order on the Graphics screen, and the asset tier order). */
export const QUALITY_PRESETS = ['reference', 'high', 'medium', 'low'] as const satisfies readonly QualityPreset[];
export const isQualityPreset = (v: unknown): v is QualityPreset => (QUALITY_PRESETS as readonly unknown[]).includes(v);
