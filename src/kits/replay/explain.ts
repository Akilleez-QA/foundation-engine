/**
 * kits/replay/explain.ts: name the first difference between two detail texts of a diverged tick.
 *
 * Detail texts are canonical JSON (sorted keys). The search is depth first in canonical order and stops at the first
 * difference; for the selection shape (`{entities: [[id, {componentId: fields}]...], resources?, count?}`, see
 * state.ts) the path is translated to an entity, component and field, or a resource. Bounded by the parse limits.
 */
import { captureJson, type JsonLimits } from '../network/captured-json';

export interface DivergenceExplainOptions {
  /** Parse limits for each detail text (default 8 MiB, 2^20 nodes, depth 32). Over the limit: `detail-unreadable`. */
  readonly limits?: JsonLimits;
  /** Longest value preview, in UTF-16 code units (default 160). Longer previews end in '…'. */
  readonly maxValueChars?: number;
}
/** `a` is the recorded side, `b` the replay. `removed`: only in `a`; `added`: only in `b`. */
export type DivergenceKind = 'value' | 'type' | 'added' | 'removed' | 'entity-set';
export type DivergenceExplanation =
  | Readonly<{ status: 'found'; tick: number; kind: DivergenceKind; path: string; entity: number | null; component: string | null;
      field: string | null; resource: string | null; a: string | null; b: string | null }>
  /** `no-detail`: a side kept no detail for that tick (outside its window, or truncated). `no-difference`: the detail
   *  texts are equal although the digests differ (the digest covers state its detail does not). */
  | Readonly<{ status: 'unavailable'; tick: number; reason: 'no-detail' | 'detail-unreadable' | 'no-difference' }>;

const LIMITS: JsonLimits = Object.freeze({ maxBytes: 8 << 20, maxNodes: 1 << 20, maxDepth: 32 });
type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };
type Step = string | number;
interface Diff { path: Step[]; kind: Exclude<DivergenceKind, 'entity-set'>; a: Json | undefined; b: Json | undefined }

const kindOf = (v: Json) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

function firstDiff(a: Json, b: Json, path: Step[]): Diff | null {
  if (kindOf(a) !== kindOf(b)) return { path, kind: 'type', a, b };
  if (a === null || typeof a !== 'object') return a === b ? null : { path, kind: 'value', a, b };
  if (Array.isArray(a)) {
    const y = b as readonly Json[];
    for (let i = 0; i < Math.min(a.length, y.length); i++) { const d = firstDiff(a[i], y[i], [...path, i]); if (d) return d; }
    if (a.length === y.length) return null;
    const i = Math.min(a.length, y.length);
    return a.length > y.length ? { path: [...path, i], kind: 'removed', a: a[i], b: undefined } : { path: [...path, i], kind: 'added', a: undefined, b: y[i] };
  }
  const x = a as { readonly [k: string]: Json }, y = b as { readonly [k: string]: Json };
  for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
    if (!Object.hasOwn(y, k)) return { path: [...path, k], kind: 'removed', a: x[k], b: undefined };
    if (!Object.hasOwn(x, k)) return { path: [...path, k], kind: 'added', a: undefined, b: y[k] };
    const d = firstDiff(x[k], y[k], [...path, k]);
    if (d) return d;
  }
  return null;
}

const pathText = (path: readonly Step[]) => path.map((s, i) => typeof s === 'number' ? `[${s}]` : /^[A-Za-z_$][\w$-]*$/.test(s) ? `${i ? '.' : ''}${s}` : `[${JSON.stringify(s)}]`).join('') || '(root)';
const fieldText = (path: readonly Step[]) => path.length ? pathText(path).replace(/^\./, '') : null;

const rowsOf = (v: Json): readonly Json[] | null => v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as Record<string, Json>).entities)
  ? (v as Record<string, readonly Json[]>).entities : null;
const rowId = (rows: readonly Json[] | null, i: number) => {
  const r = rows?.[i];
  return Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' ? r[0] : null;
};

/**
 * Explain the first difference between a diverged tick's recorded (`a`) and replayed (`b`) detail texts. O(text size).
 */
export function explainDivergence(tick: number, a: string | null, b: string | null, options: DivergenceExplainOptions = {}): DivergenceExplanation {
  // Never throws: an explanation is diagnostic, and the replay's result must survive any detail text.
  try { return explain(tick, a, b, options); } catch { return Object.freeze({ status: 'unavailable', tick, reason: 'detail-unreadable' }); }
}
function explain(tick: number, a: string | null, b: string | null, options: DivergenceExplainOptions): DivergenceExplanation {
  if (a === null || b === null) return Object.freeze({ status: 'unavailable', tick, reason: 'no-detail' });
  let x: Json, y: Json;
  try { x = captureJson(a, options.limits ?? LIMITS).value as Json; y = captureJson(b, options.limits ?? LIMITS).value as Json; }
  catch { return Object.freeze({ status: 'unavailable', tick, reason: 'detail-unreadable' }); }
  const d = firstDiff(x, y, []);
  if (!d) return Object.freeze({ status: 'unavailable', tick, reason: 'no-difference' });
  const max = options.maxValueChars ?? 160;
  const preview = (v: Json | undefined) => {
    if (v === undefined) return null;
    const s: string | undefined = JSON.stringify(v);
    if (typeof s !== 'string') return null;
    return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
  };
  let kind: DivergenceKind = d.kind, entity: number | null = null, component: string | null = null, field: string | null = null, resource: string | null = null;
  const ra = rowsOf(x), rb = rowsOf(y), p = d.path;
  if (ra && rb && p[0] === 'entities' && typeof p[1] === 'number') {
    const ia = rowId(ra, p[1]), ib = rowId(rb, p[1]);
    if (ia !== ib || p.length < 3 || p[2] === 0) {
      // The entity lists differ at this row: the first entity present on one side only.
      kind = 'entity-set';
      entity = ia === null ? ib : ib === null ? ia : Math.min(ia, ib);
    } else {
      entity = ia;
      if (typeof p[3] === 'string') { component = p[3]; field = fieldText(p.slice(4)); }
    }
  } else if (p[0] === 'resources' && typeof p[1] === 'string' && x && typeof x === 'object' && !Array.isArray(x)) {
    resource = p[1]; field = fieldText(p.slice(2));
  }
  const at = (v: Json, path: readonly Step[]): Json | undefined => {
    let cur: Json | undefined = v;
    for (const s of path) cur = cur && typeof cur === 'object' && Object.hasOwn(cur, s) ? (cur as Record<string | number, Json>)[s as never] : undefined;
    return cur;
  };
  const rowPath = kind === 'entity-set' ? p.slice(0, 2) : p;
  return Object.freeze({ status: 'found', tick, kind, path: pathText(rowPath), entity, component, field, resource,
    a: preview(kind === 'entity-set' ? at(x, rowPath) : d.a), b: preview(kind === 'entity-set' ? at(y, rowPath) : d.b) });
}
