/** Optional scene-owned action timing. The caller owns rules, effects and durable publication. */
export interface ActionRunInput {
  /** Unique for this owner's bounded session; terminal identities remain reserved. */
  id: string;
  owner: string;
  readyAt: number;
  expiresAt: number;
}
export type ActionRunState = 'pending' | 'ready' | 'completed' | 'cancelled' | 'expired';
export interface ActionRun extends Readonly<ActionRunInput> {
  readonly revision: number;
  readonly state: ActionRunState;
}
export type ActionAdmission =
  | { readonly kind: 'admitted' | 'duplicate'; readonly action: ActionRun }
  | { readonly kind: 'conflict' | 'capacity' | 'expired' };
export type ActionTransition =
  | { readonly kind: 'applied'; readonly action: ActionRun }
  | { readonly kind: 'missing' | 'stale' | 'not-ready' | 'terminal' };

const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const live = (action: ActionRun) => action.state === 'pending' || action.state === 'ready';

/**
 * Advance from the existing scene clock before attempting a consequence. No timers or callbacks.
 * Each scan is at most maxActions records; terminal records are retained until this session ends.
 */
export function createActionRuns(options: { now: number; maxActions?: number }) {
  let now = options.now;
  const maxActions = options.maxActions ?? 256;
  if (!finite(now) || !Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 65536) throw Error('actions: invalid configuration');
  const records = new Map<string, ActionRun>();
  let busy = false;
  const mutate = <T>(fn: () => T): T => {
    if (busy) throw Error('actions: reentrant mutation');
    busy = true;
    try { return fn(); } finally { busy = false; }
  };
  const change = (action: ActionRun, state: ActionRunState) => {
    const next = Object.freeze({ ...action, revision: action.revision + 1, state });
    records.set(action.id, next);
    return next;
  };
  const transition = (id: string, revision: number, state: 'completed' | 'cancelled'): ActionTransition => {
    if (!identity(id) || !Number.isSafeInteger(revision) || revision < 0) throw Error('actions: invalid transition');
    const action = records.get(id);
    if (!action) return Object.freeze({ kind: 'missing' });
    if (action.revision !== revision) return Object.freeze({ kind: 'stale' });
    if (!live(action)) return Object.freeze({ kind: 'terminal' });
    if (state === 'completed' && action.state !== 'ready') return Object.freeze({ kind: 'not-ready' });
    return Object.freeze({ kind: 'applied', action: change(action, state) });
  };
  return {
    get now() { return now; },
    get size() { return records.size; },
    admit(input: ActionRunInput): ActionAdmission {
      return mutate(() => {
        // Capture once under the guard, before validation: getters cannot alter this owner.
        const { id, owner, readyAt, expiresAt } = input;
        if (!identity(id) || !identity(owner) || !finite(readyAt) || !finite(expiresAt) || expiresAt <= readyAt) throw Error('actions: invalid admission');
        const old = records.get(id);
        if (old) return old.owner === owner && old.readyAt === readyAt && old.expiresAt === expiresAt
          ? Object.freeze({ kind: 'duplicate', action: old }) : Object.freeze({ kind: 'conflict' });
        if (expiresAt <= now) return Object.freeze({ kind: 'expired' });
        if (records.size >= maxActions) return Object.freeze({ kind: 'capacity' });
        const action: ActionRun = Object.freeze({ id, owner, readyAt, expiresAt, revision: 0, state: readyAt <= now ? 'ready' : 'pending' });
        records.set(id, action);
        return Object.freeze({ kind: 'admitted', action });
      });
    },
    /** Expiry takes precedence at the exact deadline. Backward/nonfinite time rejects before change. */
    advance(time: number): readonly ActionRun[] {
      return mutate(() => {
        if (!finite(time) || time < now) throw Error('actions: invalid time');
        now = time;
        const changed: ActionRun[] = [];
        for (const action of records.values()) {
          if (!live(action)) continue;
          if (time >= action.expiresAt) changed.push(change(action, 'expired'));
          else if (action.state === 'pending' && time >= action.readyAt) changed.push(change(action, 'ready'));
        }
        return Object.freeze(changed);
      });
    },
    get(id: string): ActionRun | null { return records.get(id) ?? null; },
    /** Acknowledges caller acceptance only; it does not apply an effect or persist anything. */
    acknowledge(id: string, revision: number): ActionTransition { return mutate(() => transition(id, revision, 'completed')); },
    cancel(id: string, revision: number): ActionTransition { return mutate(() => transition(id, revision, 'cancelled')); },
    /** Cancels currently live runs. Does not ban future admission for this owner. */
    cancelOwner(owner: string): readonly ActionRun[] {
      return mutate(() => {
        if (!identity(owner)) throw Error('actions: invalid owner');
        const changed: ActionRun[] = [];
        for (const action of records.values()) if (action.owner === owner && live(action)) changed.push(change(action, 'cancelled'));
        return Object.freeze(changed);
      });
    },
  };
}
