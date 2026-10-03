/**
 * Narration families (ADR 0021; STD-STR-5). A narration key composed at runtime, such as
 * `tour-${stop}-${step}`, is declared as a family: a pattern with `{holes}` and the finite domain of each hole.
 * Validation expands every family and proves each key has text and audio in every voice, so a mistyped composed key
 * fails a test instead of falling back silently.
 *
 * Keys here are narration keys (`tour-gate-0`); the string catalogue stores them as `narration.<key>`.
 *
 * Every composed key in a game is built by `narrationKey()` from a family row declared next to the data its domain
 * comes from; a content test validates every family.
 */
export type NarrationDomainValue = string | number;

declare const narrationKeyBrand: unique symbol;
/** A narration key that came from a family (or a literal key): what the narrator publishes. */
export type NarrationKey = string & {readonly [narrationKeyBrand]: true};

/** One family. `H` is its hole names, so `narrationKey(def, vars)` needs exactly those variables. */
export interface NarrationFamilyDef<H extends string = string> {
  /** `narration-family.<name>`. */
  id: string;
  /** Legacy key with `{hole}` placeholders, for example `tour-{stop}-{step}`. */
  pattern: string;
  /** Every value each hole can take. Every hole must have a domain, and every domain a hole. */
  domain: Readonly<Record<H, readonly NarrationDomainValue[]>>;
  /** Keys in the grid that the code never builds. */
  except?: readonly string[];
}

const HOLE = /\{([A-Za-z_]\w*)\}/g;
/** The variables a family's key needs: one value per hole. */
export type NarrationVars<H extends string> = Readonly<Record<H, NarrationDomainValue>>;
export const narrationCatalogKey = (legacyKey: string) => 'narration.' + legacyKey;

/** The hole names of a pattern, in order of first appearance. */
export function narrationFamilyHoles(pattern: string): string[] {
  return [...new Set([...pattern.matchAll(HOLE)].map(m => m[1]!))]; // HOLE's group 1 is not optional
}

/** Structural problems with one family: holes without a domain, unused domains, empty domains, stray exceptions. */
export function narrationFamilyProblems(def: NarrationFamilyDef): string[] {
  const domain: Readonly<Record<string, readonly NarrationDomainValue[]>> = def.domain;
  const problems: string[] = [];
  const holes = narrationFamilyHoles(def.pattern);
  if (!def.id.startsWith('narration-family.')) problems.push(`${def.id}: id must start with "narration-family."`);
  if (!holes.length) problems.push(`${def.id}: pattern "${def.pattern}" has no {holes}; a fixed key is not a family`);
  for (const h of holes) {
    // Past the first branch, h is an own key of domain.
    if (!Object.hasOwn(domain, h)) problems.push(`${def.id}: hole {${h}} has no domain`);
    else if (!domain[h]!.length) problems.push(`${def.id}: hole {${h}} has an empty domain`);
    else if (new Set(domain[h]!.map(String)).size !== domain[h]!.length)
      problems.push(`${def.id}: hole {${h}} repeats a value`);
  }
  for (const d of Object.keys(domain))
    if (!holes.includes(d)) problems.push(`${def.id}: domain "${d}" is not a hole in "${def.pattern}"`);
  if (problems.length) return problems;
  const grid = new Set(expandGrid(def));
  for (const e of def.except ?? [])
    if (!grid.has(e)) problems.push(`${def.id}: exception "${e}" is not in the family's grid`);
  return problems;
}

/** Fill a pattern without checking the domain: exactly what a composing call site used to build (`'landing-'+phase`). */
export function fillNarrationPattern<H extends string>(
  def: NarrationFamilyDef<H>,
  vars: Partial<NarrationVars<H>>,
): string {
  const values: Partial<Record<string, NarrationDomainValue>> = vars;
  return def.pattern.replace(HOLE, (_, h: string) => String(values[h]));
}

/** Fill a pattern. Throws when a hole has no value or the value is outside the hole's domain. */
export function narrationKey<H extends string>(def: NarrationFamilyDef<H>, vars: NarrationVars<H>): NarrationKey {
  const domain: Readonly<Record<string, readonly NarrationDomainValue[]>> = def.domain;
  const values: Readonly<Record<string, NarrationDomainValue>> = vars;
  const key = def.pattern.replace(HOLE, (_, h: string) => {
    if (!Object.hasOwn(values, h)) throw new Error(`${def.id}: no value for {${h}}`);
    const v = values[h];
    if (!domain[h]?.some(d => String(d) === String(v)))
      throw new Error(`${def.id}: ${JSON.stringify(v)} is not in the domain of {${h}}`);
    return String(v);
  });
  if (def.except?.includes(key)) throw new Error(`${def.id}: "${key}" is an exception the code never builds`);
  return key as NarrationKey;
}

/**
 * A two-hole family over a ragged grid: each row value of the first hole has its own number of steps (0…n-1) in the
 * second. The cells no row reaches become exceptions, so the family expands to exactly the keys the code builds.
 */
export function raggedNarrationFamily<A extends string, B extends string>(
  id: string,
  pattern: string,
  a: A,
  b: B,
  rows: readonly (readonly [NarrationDomainValue, number])[],
): NarrationFamilyDef<A | B> {
  const steps = Array.from({length: Math.max(0, ...rows.map(r => r[1]))}, (_, i) => i);
  const cell = (row: NarrationDomainValue, step: number) =>
    pattern.split(`{${a}}`).join(String(row)).split(`{${b}}`).join(String(step));
  const except = rows.flatMap(([row, n]) => steps.filter(s => s >= n).map(s => cell(row, s)));
  const domain = {[a]: rows.map(r => r[0]), [b]: steps} as Record<string, readonly NarrationDomainValue[]> as Record<
    A | B,
    readonly NarrationDomainValue[]
  >;
  return {id, pattern, domain, ...(except.length ? {except} : {})};
}

function expandGrid(def: NarrationFamilyDef): string[] {
  const domain: Readonly<Record<string, readonly NarrationDomainValue[]>> = def.domain;
  let keys = [def.pattern];
  for (const h of narrationFamilyHoles(def.pattern)) {
    const next: string[] = [];
    // Callers validate first (narrationFamilyProblems): every hole has a domain.
    for (const k of keys) for (const v of domain[h]!) next.push(k.split(`{${h}}`).join(String(v)));
    keys = next;
  }
  return keys;
}

/** Every key a family declares: the full grid of its domains, minus exceptions, in domain order. */
export function expandNarrationFamily(def: NarrationFamilyDef): string[] {
  const problems = narrationFamilyProblems(def);
  if (problems.length) throw new Error(problems.join('\n'));
  const except = new Set(def.except ?? []);
  return expandGrid(def).filter(k => !except.has(k));
}

/** The pattern with every hole replaced by `*`: the shape a builder site produces (`tour-deep-*-*`). */
export const narrationFamilyShape = (pattern: string) => pattern.replace(HOLE, '*');

/**
 * Validate expanded families against the narration text and audio. `hasText(key)` and `hasAudio(voice, key)` are
 * injected so the check runs in tests and in the build alike. Returns one line per missing piece.
 */
export function narrationFamilyGaps(
  defs: readonly NarrationFamilyDef[],
  voices: readonly string[],
  hasText: (key: string) => boolean,
  hasAudio: (voice: string, key: string) => boolean,
): string[] {
  const gaps: string[] = [];
  const ids = new Set<string>();
  for (const def of defs) {
    if (ids.has(def.id)) gaps.push(`${def.id}: declared twice`);
    ids.add(def.id);
    const problems = narrationFamilyProblems(def);
    if (problems.length) {
      gaps.push(...problems);
      continue;
    }
    for (const key of expandNarrationFamily(def)) {
      if (!hasText(key)) gaps.push(`${def.id}: "${key}" has no narration text`);
      for (const v of voices) if (!hasAudio(v, key)) gaps.push(`${def.id}: "${key}" has no audio for voice "${v}"`);
    }
  }
  return gaps;
}
