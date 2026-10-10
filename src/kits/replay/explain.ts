/**
 * kits/replay/explain.ts: name the first difference between two detail texts of a diverged tick.
 *
 * Detail texts are canonical JSON (sorted keys). The search is depth first in canonical order and stops at the first
 * difference; for the selection shape (`{entities: [[id, {componentId: fields}]...], resources?, count?}`, see
 * state.ts) the path is translated to an entity, component and field, or a resource. Bounded by the parse limits.
 */
import {captureJson, type JsonLimits} from '../network/captured-json';

export interface DivergenceExplainOptions {
  /** Parse limits for each detail text (default 8 MiB, 2^20 nodes, depth 32). Over the limit: `detail-unreadable`. */
  readonly limits?: JsonLimits;
  /** Longest value preview, in UTF-16 code units (default 160). Longer previews end in '…'. */
  readonly maxValueChars?: number;
}
/** `a` is the recorded side, `b` the replay. `removed`: only in `a`; `added`: only in `b`. */
export type DivergenceKind = 'value' | 'type' | 'added' | 'removed' | 'entity-set';
export type DivergenceExplanation =
  | Readonly<{
      status: 'found';
      tick: number;
      kind: DivergenceKind;
      path: string;
      entity: number | null;
      component: string | null;
      field: string | null;
      resource: string | null;
      a: string | null;
      b: string | null;
    }>
  /** `no-detail`: a side kept no detail for that tick (outside its window, or truncated). `no-difference`: the detail
   *  texts are equal although the digests differ (the digest covers state its detail does not). */
  | Readonly<{status: 'unavailable'; tick: number; reason: 'no-detail' | 'detail-unreadable' | 'no-difference'}>;

const LIMITS: JsonLimits = Object.freeze({maxBytes: 8 << 20, maxNodes: 1 << 20, maxDepth: 32});
type Json = null | boolean | number | string | readonly Json[] | {readonly [k: string]: Json};
type Step = string | number;
interface Diff {
  path: Step[];
  kind: Exclude<DivergenceKind, 'entity-set'>;
  a: Json | undefined;
  b: Json | undefined;
}

const kindOf = (v: Json) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Depth-first walk in canonical order (array elements, then a length difference; sorted union of keys). Appends each
 * difference to `out` and stops once `out` holds `max`. A container whose kinds differ is one difference (not walked).
 */
function collectDiffs(a: Json, b: Json, path: Step[], out: Diff[], max: number): void {
  if (out.length >= max) return;
  if (kindOf(a) !== kindOf(b)) {
    out.push({path, kind: 'type', a, b});
    return;
  }
  if (a === null || typeof a !== 'object') {
    if (a !== b) out.push({path, kind: 'value', a, b});
    return;
  }
  if (Array.isArray(a)) {
    const y = b as readonly Json[];
    const shared = Math.min(a.length, y.length);
    for (let i = 0; i < shared && out.length < max; i++) collectDiffs(a[i]!, y[i]!, [...path, i], out, max); // i < both lengths
    for (let i = shared; i < a.length && out.length < max; i++)
      out.push({path: [...path, i], kind: 'removed', a: a[i], b: undefined});
    for (let i = shared; i < y.length && out.length < max; i++)
      out.push({path: [...path, i], kind: 'added', a: undefined, b: y[i]});
    return;
  }
  const x = a as {readonly [k: string]: Json},
    y = b as {readonly [k: string]: Json};
  for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
    if (out.length >= max) return;
    if (!Object.hasOwn(y, k)) out.push({path: [...path, k], kind: 'removed', a: x[k], b: undefined});
    else if (!Object.hasOwn(x, k)) out.push({path: [...path, k], kind: 'added', a: undefined, b: y[k]});
    else collectDiffs(x[k]!, y[k]!, [...path, k], out, max); // own key of both (checked above)
  }
}
function firstDiff(a: Json, b: Json, path: Step[]): Diff | null {
  const out: Diff[] = [];
  collectDiffs(a, b, path, out, 1);
  return out[0] ?? null;
}

const previewer = (max: number) => (v: Json | undefined) => {
  if (v === undefined) return null;
  const s: string | undefined = JSON.stringify(v);
  if (typeof s !== 'string') return null;
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
};

const pathText = (path: readonly Step[]) =>
  path
    .map((s, i) =>
      typeof s === 'number'
        ? `[${s}]`
        : /^[A-Za-z_$][\w$-]*$/.test(s)
          ? `${i ? '.' : ''}${s}`
          : `[${JSON.stringify(s)}]`,
    )
    .join('') || '(root)';
const fieldText = (path: readonly Step[]) => (path.length ? pathText(path).replace(/^\./, '') : null);

const rowsOf = (v: Json): readonly Json[] | null =>
  v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as Record<string, Json>).entities)
    ? (v as {readonly entities: readonly Json[]}).entities
    : null;
const rowId = (rows: readonly Json[] | null, i: number) => {
  const r = rows?.[i];
  return Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' ? r[0] : null;
};

/**
 * Explain the first difference between a diverged tick's recorded (`a`) and replayed (`b`) detail texts. O(text size).
 */
export function explainDivergence(
  tick: number,
  a: string | null,
  b: string | null,
  options: DivergenceExplainOptions = {},
): DivergenceExplanation {
  // Never throws: an explanation is diagnostic, and the replay's result must survive any detail text.
  try {
    return explain(tick, a, b, options);
  } catch {
    return Object.freeze({status: 'unavailable', tick, reason: 'detail-unreadable'});
  }
}
function explain(
  tick: number,
  a: string | null,
  b: string | null,
  options: DivergenceExplainOptions,
): DivergenceExplanation {
  if (a === null || b === null) return Object.freeze({status: 'unavailable', tick, reason: 'no-detail'});
  let x: Json, y: Json;
  try {
    x = captureJson(a, options.limits ?? LIMITS).value as Json;
    y = captureJson(b, options.limits ?? LIMITS).value as Json;
  } catch {
    return Object.freeze({status: 'unavailable', tick, reason: 'detail-unreadable'});
  }
  const d = firstDiff(x, y, []);
  if (!d) return Object.freeze({status: 'unavailable', tick, reason: 'no-difference'});
  const preview = previewer(options.maxValueChars ?? 160);
  let kind: DivergenceKind = d.kind,
    entity: number | null = null,
    component: string | null = null,
    field: string | null = null,
    resource: string | null = null;
  const ra = rowsOf(x),
    rb = rowsOf(y),
    p = d.path;
  if (ra && rb && p[0] === 'entities' && typeof p[1] === 'number') {
    const ia = rowId(ra, p[1]),
      ib = rowId(rb, p[1]);
    if (ia !== ib || p.length < 3 || p[2] === 0) {
      // The entity lists differ at this row: the first entity present on one side only.
      kind = 'entity-set';
      entity = ia === null ? ib : ib === null ? ia : Math.min(ia, ib);
    } else {
      entity = ia;
      if (typeof p[3] === 'string') {
        component = p[3];
        field = fieldText(p.slice(4));
      }
    }
  } else if (p[0] === 'resources' && typeof p[1] === 'string' && x && typeof x === 'object' && !Array.isArray(x)) {
    resource = p[1];
    field = fieldText(p.slice(2));
  }
  const at = (v: Json, path: readonly Step[]): Json | undefined => {
    let cur: Json | undefined = v;
    for (const s of path)
      cur =
        cur && typeof cur === 'object' && Object.hasOwn(cur, s)
          ? (cur as Record<string | number, Json>)[s as never]
          : undefined;
    return cur;
  };
  const rowPath = kind === 'entity-set' ? p.slice(0, 2) : p;
  return Object.freeze({
    status: 'found',
    tick,
    kind,
    path: pathText(rowPath),
    entity,
    component,
    field,
    resource,
    a: preview(kind === 'entity-set' ? at(x, rowPath) : d.a),
    b: preview(kind === 'entity-set' ? at(y, rowPath) : d.b),
  });
}

export interface DifferenceListOptions {
  /** Most differences listed: an integer in [1, 1024] (default 16). Later differences set `truncated`. */
  readonly maxPaths?: number;
  /** Parse limits for each text (default as `explainDivergence`). */
  readonly limits?: JsonLimits;
  /** Longest value preview, in UTF-16 code units (default 160). */
  readonly maxValueChars?: number;
}
/** One differing path. `a` and `b` are bounded JSON previews; null when the value is absent on that side. */
export type StateDifference = Readonly<{
  path: string;
  kind: Exclude<DivergenceKind, 'entity-set'>;
  a: string | null;
  b: string | null;
}>;
export type DifferenceList =
  | Readonly<{status: 'listed'; differences: readonly StateDifference[]; truncated: boolean}>
  | Readonly<{status: 'unavailable'; reason: 'detail-unreadable' | 'no-difference'}>;

/**
 * List up to `maxPaths` differing paths between two JSON texts, in the same depth-first canonical order as
 * `explainDivergence` (so the first entry is its first difference). Generic: no entity or resource translation. Never
 * throws for text it cannot read. O(text size) plus at most `maxPaths` previews.
 */
export function listDifferences(a: string, b: string, options: DifferenceListOptions = {}): DifferenceList {
  const maxPaths = options.maxPaths ?? 16,
    maxValueChars = options.maxValueChars ?? 160;
  if (!Number.isSafeInteger(maxPaths) || maxPaths < 1 || maxPaths > 1024)
    throw RangeError('replay explain: maxPaths must be an integer in [1, 1024]');
  if (!Number.isSafeInteger(maxValueChars) || maxValueChars < 1)
    throw RangeError('replay explain: maxValueChars must be a positive integer');
  let x: Json, y: Json;
  try {
    x = captureJson(a, options.limits ?? LIMITS).value as Json;
    y = captureJson(b, options.limits ?? LIMITS).value as Json;
  } catch {
    return Object.freeze({status: 'unavailable', reason: 'detail-unreadable'});
  }
  // One extra difference tells a full list from a truncated one.
  const out: Diff[] = [];
  collectDiffs(x, y, [], out, maxPaths + 1);
  if (out.length === 0) return Object.freeze({status: 'unavailable', reason: 'no-difference'});
  const preview = previewer(maxValueChars);
  const differences = out
    .slice(0, maxPaths)
    .map(d => Object.freeze({path: pathText(d.path), kind: d.kind, a: preview(d.a), b: preview(d.b)}));
  return Object.freeze({status: 'listed', differences: Object.freeze(differences), truncated: out.length > maxPaths});
}
