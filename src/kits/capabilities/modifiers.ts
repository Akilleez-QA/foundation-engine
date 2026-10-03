export interface Modifier {
  stat: string;
  add: number;
  multiply: number;
}
export interface ModifierExplanationRow extends Readonly<Modifier> {
  readonly source: string;
  readonly row: number;
}
export interface ModifierExplanation {
  readonly stat: string;
  readonly base: number;
  readonly additive: number;
  readonly multiplier: number;
  readonly value: number;
  readonly contributions: readonly ModifierExplanationRow[];
}
/** Rebuild from source-owned contributions; removal never tries to invert floating point changes. */
export function createModifiers(base: Readonly<Record<string, number>>, maxSources = 256) {
  const initial = {...base},
    sources = new Map<string, Modifier[]>();
  if (!Number.isSafeInteger(maxSources) || maxSources < 1 || !Object.values(initial).every(Number.isFinite))
    throw Error('modifiers: invalid configuration');
  // One arithmetic path, with optional trace collection only when explicitly requested.
  const evaluateStat = (stat: string, candidate: Map<string, Modifier[]>, rows?: ModifierExplanationRow[]) => {
    let add = 0,
      multiply = 1;
    for (const source of [...candidate.keys()].sort()) {
      const values = candidate.get(source)!;
      for (let row = 0; row < values.length; row++) {
        const m = values[row]!;
        if (m.stat !== stat) continue;
        add += m.add;
        multiply *= m.multiply;
        if (rows) rows.push(Object.freeze({source, row, stat: m.stat, add: m.add, multiply: m.multiply}));
      }
    }
    const value = (initial[stat]! + add) * multiply; // callers pass only own keys of initial
    if (!Number.isFinite(value)) throw Error('modifiers: overflow');
    return {add, multiply, value};
  };
  const evaluate = (candidate: Map<string, Modifier[]>) => {
    const result = {...initial};
    for (const stat of Object.keys(initial)) result[stat] = evaluateStat(stat, candidate).value;
    return result;
  };
  let busy = false;
  const guarded = <T>(operation: () => T): T => {
    if (busy) throw Error('modifiers: reentrant mutation');
    busy = true;
    try {
      return operation();
    } finally {
      busy = false;
    }
  };
  return {
    set(source: string, modifiers: readonly Modifier[]) {
      return guarded(() => {
        if (
          typeof source !== 'string' ||
          !source ||
          (!sources.has(source) && sources.size >= maxSources) ||
          !Array.isArray(modifiers)
        )
          throw Error('modifiers: invalid contribution');
        const length = modifiers.length;
        if (!Number.isSafeInteger(length) || length < 0 || length > 64) throw Error('modifiers: invalid contribution');
        const captured: Modifier[] = [];
        for (let i = 0; i < length; i++) {
          const {stat, add, multiply} = modifiers[i]!;
          if (
            typeof stat !== 'string' ||
            !Object.hasOwn(initial, stat) ||
            !Number.isFinite(add) ||
            !Number.isFinite(multiply) ||
            multiply < 0
          )
            throw Error('modifiers: invalid contribution');
          captured.push({stat, add, multiply});
        }
        const next = new Map(sources);
        next.set(source, captured);
        evaluate(next);
        sources.set(source, captured);
      });
    },
    remove(source: string) {
      return guarded(() => {
        if (!sources.has(source)) return false;
        const next = new Map(sources);
        next.delete(source);
        evaluate(next);
        return sources.delete(source);
      });
    },
    values: () => evaluate(sources),
    /** Accepted facts for one stat; count-bounded rows, not a byte/label-size guarantee. */
    explain(stat: string): ModifierExplanation | null {
      if (typeof stat !== 'string') throw Error('modifiers: stat must be a string');
      if (!Object.hasOwn(initial, stat)) return null;
      const contributions: ModifierExplanationRow[] = [],
        result = evaluateStat(stat, sources, contributions);
      return Object.freeze({
        stat,
        base: initial[stat]! /* own key: checked above */,
        additive: result.add,
        multiplier: result.multiply,
        value: result.value,
        contributions: Object.freeze(contributions),
      });
    },
  };
}
