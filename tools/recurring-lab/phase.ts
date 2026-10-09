/** Experimental portable phase data. No clock, callback queue or outcome owner. */
export interface RecurringDefinition {
  readonly id: string;
  readonly revision: number;
  readonly firstAt: number;
  readonly period: number;
  readonly maxBatch: number;
}
export interface RecurringPhase {
  readonly version: 1;
  readonly definition: RecurringDefinition;
  readonly next: number;
  readonly lastCommitted: number | null;
}
export type DuePolicy = 'skip' | 'coalesce' | 'replay';
export interface Firing {
  readonly id: string;
  readonly ordinal: number;
  readonly at: number;
  /** Coalescing summarizes this many due occurrences; replay rows always count one. */
  readonly count: number;
}
const whole = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
export function record(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)
  )
    throw Error('recurrence: expected plain record');
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== fields.length || keys.some(k => typeof k !== 'string' || !fields.includes(k)))
    throw Error('recurrence: invalid fields');
  const out: Record<string, unknown> = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !('value' in descriptor)) throw Error('recurrence: accessor');
    out[key] = descriptor.value;
  }
  return out;
}
export function definition(raw: unknown): RecurringDefinition {
  const d = record(raw, ['id', 'revision', 'firstAt', 'period', 'maxBatch']);
  if (
    typeof d.id !== 'string' ||
    d.id.length < 1 ||
    d.id.length > 64 ||
    !whole(d.revision) ||
    !whole(d.firstAt) ||
    !whole(d.period) ||
    d.period < 1 ||
    !whole(d.maxBatch) ||
    d.maxBatch < 1 ||
    d.maxBatch > 256
  )
    throw Error('recurrence: invalid definition');
  return Object.freeze({id: d.id, revision: d.revision, firstAt: d.firstAt, period: d.period, maxBatch: d.maxBatch});
}
const number = (value: bigint): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('recurrence: phase overflow');
  return Number(value);
};
export function deadline(state: RecurringPhase): number {
  return number(BigInt(state.definition.firstAt) + BigInt(state.next) * BigInt(state.definition.period));
}
export function restorePhase(expected: RecurringDefinition, raw: unknown): RecurringPhase {
  const d = definition(expected),
    s = record(raw, ['version', 'definition', 'next', 'lastCommitted']);
  const supplied = definition(s.definition);
  if (
    Object.keys(d).some(k => d[k as keyof RecurringDefinition] !== supplied[k as keyof RecurringDefinition]) ||
    s.version !== 1 ||
    !whole(s.next) ||
    (s.lastCommitted !== null && (!whole(s.lastCommitted) || s.lastCommitted >= s.next))
  )
    throw Error('recurrence: incompatible phase');
  const state = Object.freeze({version: 1 as const, definition: d, next: s.next, lastCommitted: s.lastCommitted});
  deadline(state);
  return state;
}
export function initialPhase(raw: RecurringDefinition): RecurringPhase {
  return Object.freeze({version: 1 as const, definition: definition(raw), next: 0, lastCommitted: null});
}
/** Pure bounded proposal. Caller commits it with coupled outcomes and persists the envelope. */
export function planDue(raw: RecurringPhase, now: number, policy: DuePolicy) {
  const state = restorePhase(raw.definition, raw);
  if (
    !Number.isFinite(now) ||
    now < 0 ||
    now > Number.MAX_SAFE_INTEGER ||
    (policy !== 'skip' && policy !== 'coalesce' && policy !== 'replay')
  )
    throw Error('recurrence: invalid due request');
  const at = deadline(state),
    firings: Firing[] = [];
  if (now < at) return Object.freeze({phase: state, firings: Object.freeze(firings), due: 0});
  const due = number((BigInt(Math.floor(now)) - BigInt(at)) / BigInt(state.definition.period) + 1n);
  const taken = policy === 'replay' ? Math.min(due, state.definition.maxBatch) : due;
  const next = number(BigInt(state.next) + BigInt(taken));
  const add = (ordinal: number, count: number) =>
    firings.push(
      Object.freeze({
        id: JSON.stringify([state.definition.id, state.definition.revision, ordinal]),
        ordinal,
        at: deadline({...state, next: ordinal}),
        count,
      }),
    );
  if (policy === 'coalesce') add(next - 1, due);
  if (policy === 'replay') for (let i = 0; i < taken; i++) add(state.next + i, 1);
  const phase = Object.freeze({...state, next, lastCommitted: firings.at(-1)?.ordinal ?? state.lastCommitted});
  deadline(phase); // Reject exhaustion before returning any candidate.
  return Object.freeze({phase, firings: Object.freeze(firings), due});
}
