/** Optional single-value arithmetic. The caller owns acceptance, lifetime, clocks and persistence. */
export interface ResourceValue {
  readonly version: 1;
  readonly mode: 'continuous' | 'safe-integer';
  readonly min: number;
  readonly max: number;
  readonly current: number;
}
export interface ResourcePolicy {
  readonly overflow: 'reject' | 'clamp';
  /** nearest ties toward positive infinity. Continuous mode requires reject (no quantization). */
  readonly rounding: 'reject' | 'floor' | 'ceil' | 'nearest';
}
export type ResourceChange =
  | { readonly kind: 'set'; readonly value: number }
  | { readonly kind: 'add'; readonly delta: number }
  | { readonly kind: 'bounds'; readonly min: number; readonly max: number; readonly adjust: 'retain' | 'ratio' | 'refill' };
export type ResourceFailure = 'invalid' | 'range' | 'precision' | 'overflow' | 'zero-width';
export interface ResourceCalculation {
  readonly requested: ResourceChange;
  readonly policy: ResourcePolicy;
  /** Diagnostic only: Number arithmetic, or an approximation of an exact integer-ratio target. */
  readonly calculatedTarget: number;
  readonly targetPrecision: 'approximate-number' | 'approximate-ratio';
  readonly roundedTarget: number;
  /** Present only for safe-integer add: rounded before the checked addition. */
  readonly roundedAddend: number | null;
  readonly acceptedTarget: number;
  readonly actualDelta: number;
  readonly clamped: boolean;
}
export type ResourceCandidate =
  | { readonly ok: true; readonly state: ResourceValue; readonly calculation: ResourceCalculation }
  | { readonly ok: false; readonly reason: ResourceFailure };
class Invalid extends Error {
  constructor(readonly reason: ResourceFailure) { super(`resource value: ${reason}`); }
}
const fail = (reason: ResourceFailure): never => { throw new Invalid(reason); };
const zero = (value: number) => value === 0 ? 0 : value;
function record(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid');
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return fail('invalid');
  return raw as Record<string, unknown>;
}
function finite(raw: unknown, reason: ResourceFailure = 'invalid'): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail(reason);
  return zero(raw);
}
function integer(value: number): number {
  if (!Number.isInteger(value)) return fail('precision');
  if (!Number.isSafeInteger(value)) return fail('overflow');
  return zero(value);
}
function interval(min: number, max: number, mode: ResourceValue['mode']): void {
  if (mode === 'safe-integer') { integer(min); integer(max); }
  if (min > max) fail('range');
}
/** Strict, detached restore. Never clamps, rounds, migrates or changes precision mode. */
export function parseResourceValue(raw: unknown): ResourceValue {
  const data = record(raw, ['version', 'mode', 'min', 'max', 'current']);
  const { version, mode, min: inputMin, max: inputMax, current: inputCurrent } = data;
  if (version !== 1 || (mode !== 'continuous' && mode !== 'safe-integer')) return fail('invalid');
  const min = finite(inputMin), max = finite(inputMax), current = finite(inputCurrent);
  interval(min, max, mode);
  if (mode === 'safe-integer') integer(current);
  if (current < min || current > max) return fail('range');
  return Object.freeze({ version, mode, min, max, current });
}
function captureChange(raw: ResourceChange): ResourceChange {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid');
  // Read the discriminator once; a getter cannot change the selected branch on a second read.
  const kind = raw.kind;
  if (kind === 'set') { const data = record(raw, ['kind', 'value']); return Object.freeze({ kind, value: finite(data.value) }); }
  if (kind === 'add') { const data = record(raw, ['kind', 'delta']); return Object.freeze({ kind, delta: finite(data.delta) }); }
  if (kind === 'bounds') {
    const data = record(raw, ['kind', 'min', 'max', 'adjust']);
    const min = finite(data.min), max = finite(data.max), adjust = data.adjust;
    if (adjust !== 'retain' && adjust !== 'ratio' && adjust !== 'refill') return fail('invalid');
    return Object.freeze({ kind, min, max, adjust });
  }
  return fail('invalid');
}
function capturePolicy(raw: ResourcePolicy, mode: ResourceValue['mode']): ResourcePolicy {
  const { overflow, rounding } = record(raw, ['overflow', 'rounding']);
  if ((overflow !== 'reject' && overflow !== 'clamp') || !['reject', 'floor', 'ceil', 'nearest'].includes(rounding as string)) return fail('invalid');
  if (mode === 'continuous' && rounding !== 'reject') return fail('invalid');
  return Object.freeze({ overflow, rounding: rounding as ResourcePolicy['rounding'] });
}
function round(value: number, policy: ResourcePolicy['rounding']): number {
  if (policy === 'reject') { if (!Number.isInteger(value)) return fail('precision'); return integer(value); }
  return integer(policy === 'floor' ? Math.floor(value) : policy === 'ceil' ? Math.ceil(value) : Math.round(value));
}
const safe = BigInt(Number.MAX_SAFE_INTEGER);
function checked(value: bigint): number {
  if (value < -safe || value > safe) return fail('overflow');
  return Number(value);
}
/** Exact rational rounding. Denominator is positive; nearest ties go toward positive infinity. */
function roundRatio(numerator: bigint, denominator: bigint, policy: ResourcePolicy['rounding']): number {
  let floor = numerator / denominator, remainder = numerator % denominator;
  if (remainder < 0n) { floor--; remainder += denominator; }
  if (policy === 'reject' && remainder !== 0n) return fail('precision');
  if (policy === 'ceil' && remainder !== 0n) floor++;
  if (policy === 'nearest' && remainder * 2n >= denominator) floor++;
  return checked(floor);
}
/**
 * Prepare only. Repeating add is not idempotent; caller-owned tickets/receipts govern publication.
 * Domain clamp never repairs nonfinite or unsafe arithmetic. No mutations, reads with consequences or timers.
 */
export function prepareResourceChange(raw: unknown, inputChange: ResourceChange, inputPolicy: ResourcePolicy): ResourceCandidate {
  try {
    const before = parseResourceValue(raw), requested = captureChange(inputChange), policy = capturePolicy(inputPolicy, before.mode);
    const discrete = before.mode === 'safe-integer';
    let min = before.min, max = before.max, calculatedTarget: number, roundedTarget: number;
    let roundedAddend: number | null = null, targetPrecision: ResourceCalculation['targetPrecision'] = 'approximate-number';
    if (requested.kind === 'set') {
      calculatedTarget = requested.value;
      roundedTarget = discrete ? round(calculatedTarget, policy.rounding) : calculatedTarget;
    } else if (requested.kind === 'add') {
      calculatedTarget = finite(before.current + requested.delta, 'overflow');
      if (discrete) {
        roundedAddend = round(requested.delta, policy.rounding);
        roundedTarget = checked(BigInt(before.current) + BigInt(roundedAddend));
      } else roundedTarget = calculatedTarget;
    } else {
      ({ min, max } = requested); interval(min, max, before.mode);
      if (requested.adjust === 'retain') calculatedTarget = roundedTarget = before.current;
      else if (requested.adjust === 'refill') calculatedTarget = roundedTarget = max;
      else {
        if (before.min === before.max) return fail('zero-width');
        if (discrete) {
          // Endpoints have at most 53 magnitude bits; intermediates remain below 2^109.
          const denominator = BigInt(before.max) - BigInt(before.min);
          const numerator = BigInt(min) * denominator + (BigInt(before.current) - BigInt(before.min)) * (BigInt(max) - BigInt(min));
          calculatedTarget = finite(Number(numerator) / Number(denominator), 'overflow');
          targetPrecision = 'approximate-ratio'; roundedTarget = roundRatio(numerator, denominator, policy.rounding);
        } else {
          const oldWidth = finite(before.max - before.min, 'overflow'), newWidth = finite(max - min, 'overflow');
          const fraction = finite(finite(before.current - before.min, 'overflow') / oldWidth, 'overflow');
          calculatedTarget = finite(min + finite(fraction * newWidth, 'overflow'), 'overflow'); roundedTarget = calculatedTarget;
        }
      }
    }
    roundedTarget = finite(roundedTarget, 'overflow');
    if (discrete) integer(roundedTarget);
    const clamped = roundedTarget < min || roundedTarget > max;
    if (clamped && policy.overflow === 'reject') return fail('range');
    const acceptedTarget = zero(Math.max(min, Math.min(max, roundedTarget)));
    const actualDelta = discrete ? checked(BigInt(acceptedTarget) - BigInt(before.current)) : finite(acceptedTarget - before.current, 'overflow');
    const state = Object.freeze({ version: 1 as const, mode: before.mode, min, max, current: acceptedTarget });
    const calculation = Object.freeze({ requested, policy, calculatedTarget, targetPrecision, roundedTarget, roundedAddend, acceptedTarget, actualDelta, clamped });
    return Object.freeze({ ok: true, state, calculation });
  } catch (error) {
    // Accessor/proxy failures are invalid input too; no external mutable owner exists to roll back.
    return Object.freeze({ ok: false, reason: error instanceof Invalid ? error.reason : 'invalid' });
  }
}
