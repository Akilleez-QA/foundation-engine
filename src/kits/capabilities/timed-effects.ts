import {createModifiers, type Modifier, type ModifierExplanation, type ModifierExplanationRow} from './modifiers.js';

/** A live in-memory handle. Only the exact object returned by this owner can cancel it. */
export interface EffectHandle {
  readonly serial: number;
}
export interface TimedEffectInput {
  key: string;
  expiresAt: number;
  modifiers: readonly Modifier[];
}
export interface TimedEffect extends Readonly<TimedEffectInput> {
  readonly handle: EffectHandle;
  readonly modifiers: readonly Readonly<Modifier>[];
}
/** Portable accepted state; array order preserves same-key contribution ordering. */
export interface TimedEffectsCheckpoint {
  readonly version: 1;
  readonly now: number;
  readonly maxEffects: number;
  readonly maxModifiers: number;
  readonly base: Readonly<Record<string, number>>;
  readonly effects: readonly Readonly<TimedEffectInput>[];
}

// Portable input is plain data. Do not execute accessors or caller array iterators.
function dataRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw Error('effects: invalid checkpoint record');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key)))
    throw Error('effects: invalid checkpoint fields');
  const captured: Record<string, unknown> = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw Error('effects: checkpoint accessor');
    captured[key] = descriptor.value;
  }
  return captured;
}
function dataArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw Error('effects: invalid checkpoint array');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(value).length !== length + 1)
    throw Error('effects: checkpoint array limit');
  const captured: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) throw Error('effects: checkpoint array hole or accessor');
    captured.push(descriptor.value);
  }
  return captured;
}

export type EffectPolicy = 'replace' | 'stack' | 'reject';
export type EffectAdmission =
  {readonly kind: 'applied'; readonly effect: TimedEffect} | {readonly kind: 'conflict' | 'capacity' | 'expired'};

export interface TimedExplanationRow extends ModifierExplanationRow {
  readonly key: string;
  readonly handle: EffectHandle;
  readonly expiresAt: number;
  readonly effectRow: number;
}
export interface TimedEffectExplanation extends Omit<ModifierExplanation, 'contributions'> {
  readonly now: number;
  readonly contributions: readonly TimedExplanationRow[];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const identity = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 256;

/** Optional timed contributions. Time and conflict semantics are supplied by the creator. */
export function createTimedEffects(options: {
  base: Readonly<Record<string, number>>;
  now: number;
  maxEffects?: number;
  maxModifiers?: number;
}) {
  const {base, now: initialTime, maxEffects = 256, maxModifiers = 64} = options;
  if (
    !finite(initialTime) ||
    !Number.isSafeInteger(maxEffects) ||
    maxEffects < 1 ||
    maxEffects > 4096 ||
    !Number.isSafeInteger(maxModifiers) ||
    maxModifiers < 1 ||
    maxModifiers > 64
  )
    throw Error('effects: invalid configuration');
  const keys = Object.keys(base);
  if (keys.length > 256) throw Error('effects: too many base values');
  const initial: Record<string, number> = Object.create(null);
  for (const key of keys) {
    const value = base[key];
    if (!identity(key) || !finite(value)) throw Error('effects: invalid base');
    Object.defineProperty(initial, key, {value, enumerable: true});
  }
  const modifiers = createModifiers(initial, 1);
  let records = new Map<EffectHandle, TimedEffect>(),
    now = initialTime,
    serial = 0,
    busy = false;
  const mutate = <T>(operation: () => T): T => {
    if (busy) throw Error('effects: reentrant mutation');
    busy = true;
    try {
      return operation();
    } finally {
      busy = false;
    }
  };
  const ordered = (candidate: Map<EffectHandle, TimedEffect>) =>
    [...candidate.values()].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : a.handle.serial - b.handle.serial,
    );
  // One existing modifier-owner transaction: even batch expiry either commits completely or throws.
  const publish = (candidate: Map<EffectHandle, TimedEffect>) => {
    const contributions: Modifier[] = [];
    for (const effect of ordered(candidate)) for (const value of effect.modifiers) contributions.push({...value});
    modifiers.set('timed-effects', contributions);
    records = candidate;
  };
  return {
    get now() {
      return now;
    },
    get size() {
      return records.size;
    },
    apply(input: TimedEffectInput, policy: EffectPolicy): EffectAdmission {
      return mutate(() => {
        if (policy !== 'replace' && policy !== 'stack' && policy !== 'reject') throw Error('effects: invalid policy');
        const {key, expiresAt, modifiers: supplied} = input;
        if (!identity(key) || !finite(expiresAt) || !Array.isArray(supplied)) throw Error('effects: invalid effect');
        const length = supplied.length;
        if (!Number.isSafeInteger(length) || length < 0 || length > maxModifiers)
          throw Error('effects: contribution limit');
        const captured: Readonly<Modifier>[] = [];
        // Never invoke caller array methods; capture each field once while reentry is guarded.
        for (let i = 0; i < length; i++) {
          const {stat, add, multiply} = supplied[i];
          if (!identity(stat) || !Object.hasOwn(initial, stat) || !finite(add) || !finite(multiply) || multiply < 0)
            throw Error('effects: invalid contribution');
          captured.push(Object.freeze({stat, add, multiply}));
        }
        if (expiresAt <= now) return Object.freeze({kind: 'expired'});
        const candidate = new Map(records);
        for (const [handle, effect] of records)
          if (effect.key === key) {
            if (policy === 'reject') return Object.freeze({kind: 'conflict'});
            if (policy === 'replace') candidate.delete(handle);
          }
        let count = length;
        for (const effect of candidate.values()) count += effect.modifiers.length;
        if (candidate.size >= maxEffects || count > maxModifiers) return Object.freeze({kind: 'capacity'});
        if (serial === Number.MAX_SAFE_INTEGER) throw Error('effects: exhausted handles');
        const handle = Object.freeze({serial: serial + 1});
        const effect = Object.freeze({key, expiresAt, modifiers: Object.freeze(captured), handle});
        candidate.set(handle, effect);
        publish(candidate);
        serial++;
        return Object.freeze({kind: 'applied', effect});
      });
    },
    /** At the exact deadline, expiry wins. Failed arithmetic leaves time and all effects unchanged. */
    advance(time: number): readonly TimedEffect[] {
      return mutate(() => {
        if (!finite(time) || time < now) throw Error('effects: invalid time');
        const candidate = new Map(records),
          expired: TimedEffect[] = [];
        for (const effect of ordered(records))
          if (effect.expiresAt <= time) {
            candidate.delete(effect.handle);
            expired.push(effect);
          }
        if (expired.length) publish(candidate);
        now = time;
        return Object.freeze(expired);
      });
    },
    cancel(handle: EffectHandle): boolean {
      return mutate(() => {
        if (!records.has(handle)) return false;
        const candidate = new Map(records);
        candidate.delete(handle);
        publish(candidate);
        return true;
      });
    },
    /** Clears all contributions together; suitable for scene exit or arithmetic recovery. */
    cancelAll(): readonly TimedEffect[] {
      return mutate(() => {
        const removed = Object.freeze(ordered(records));
        if (removed.length) publish(new Map());
        return removed;
      });
    },
    values: (): Readonly<Record<string, number>> => Object.freeze(modifiers.values()),
    snapshot: (): readonly TimedEffect[] => Object.freeze(ordered(records)),
    /** Detached portable data. Persist with creator-owned state in one save section. */
    checkpoint(): TimedEffectsCheckpoint {
      return Object.freeze({
        version: 1 as const,
        now,
        maxEffects,
        maxModifiers,
        base: Object.freeze({...initial}),
        effects: Object.freeze(
          ordered(records).map(effect =>
            Object.freeze({
              key: effect.key,
              expiresAt: effect.expiresAt,
              modifiers: Object.freeze(effect.modifiers.map(row => Object.freeze({...row}))),
            }),
          ),
        ),
      });
    },
    /** Replaces accepted state in one transaction, including time; all old handles retire. */
    restore(saved: unknown): readonly TimedEffect[] {
      return mutate(() => {
        const data = dataRecord(saved, ['version', 'now', 'maxEffects', 'maxModifiers', 'base', 'effects']);
        if (
          data.version !== 1 ||
          !finite(data.now) ||
          data.maxEffects !== maxEffects ||
          data.maxModifiers !== maxModifiers
        )
          throw Error('effects: incompatible checkpoint');
        const savedBase = dataRecord(data.base, keys);
        for (const key of keys) if (savedBase[key] !== initial[key]) throw Error('effects: incompatible base');
        const supplied = dataArray(data.effects, maxEffects);
        if (serial > Number.MAX_SAFE_INTEGER - supplied.length) throw Error('effects: exhausted handles');
        const candidate = new Map<EffectHandle, TimedEffect>();
        let count = 0;
        for (const row of supplied) {
          const effect = dataRecord(row, ['key', 'expiresAt', 'modifiers']);
          if (!identity(effect.key) || !finite(effect.expiresAt) || effect.expiresAt <= data.now)
            throw Error('effects: invalid saved effect');
          const captured: Readonly<Modifier>[] = [];
          for (const value of dataArray(effect.modifiers, maxModifiers - count)) {
            const modifier = dataRecord(value, ['stat', 'add', 'multiply']);
            if (
              !identity(modifier.stat) ||
              !Object.hasOwn(initial, modifier.stat) ||
              !finite(modifier.add) ||
              !finite(modifier.multiply) ||
              modifier.multiply < 0
            )
              throw Error('effects: invalid saved contribution');
            captured.push(Object.freeze({stat: modifier.stat, add: modifier.add, multiply: modifier.multiply}));
          }
          count += captured.length;
          const handle = Object.freeze({serial: serial + candidate.size + 1});
          candidate.set(
            handle,
            Object.freeze({
              key: effect.key,
              expiresAt: effect.expiresAt,
              modifiers: Object.freeze(captured),
              handle,
            }),
          );
        }
        // Do not apply records one by one: safe final aggregates can have unsafe prefixes.
        publish(candidate);
        serial += candidate.size;
        now = data.now;
        return Object.freeze(ordered(records));
      });
    },
    /** Exact immutable handles intentionally retain cancellation identity within this owner. */
    explain(stat: string): TimedEffectExplanation | null {
      const trace = modifiers.explain(stat);
      if (!trace) return null;
      const provenance: {effect: TimedEffect; effectRow: number}[] = [];
      for (const effect of ordered(records))
        for (let effectRow = 0; effectRow < effect.modifiers.length; effectRow++) provenance.push({effect, effectRow});
      const contributions = trace.contributions.map(row => {
        const {effect, effectRow} = provenance[row.row]!;
        return Object.freeze({...row, key: effect.key, handle: effect.handle, expiresAt: effect.expiresAt, effectRow});
      });
      return Object.freeze({...trace, now, contributions: Object.freeze(contributions)});
    },
  };
}
