import {defineKit, type KitDefinition} from '../../author';

export interface ObjectiveRequirement {
  id: string;
  event: string;
  target: number;
}
export interface ObjectiveEvent {
  runId: string;
  eventId: string;
  event: string;
  amount: number;
}
export interface ObjectiveOptions {
  runId: string;
  requirements: readonly ObjectiveRequirement[];
  maxEvents?: number;
}
export interface ObjectiveSnapshot {
  version: 1;
  runId: string;
  requirements: ObjectiveRequirement[];
  events: ObjectiveEvent[];
  cancelled: boolean;
  reward: {attemptId: string; acknowledged: boolean} | null;
}
export type ObjectiveResult =
  'accepted' | 'duplicate' | 'conflict' | 'stale' | 'cancelled' | 'complete' | 'unmatched' | 'saturated';
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function arrayLength(raw: unknown, max: number): number {
  if (!Array.isArray(raw)) throw Error('Invalid objective array');
  const length = raw.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > max) throw Error('Invalid objective array bound');
  return length;
}
function requirements(raw: unknown): ObjectiveRequirement[] {
  // Preserve the existing uncapped definition API; only real array lengths are valid.
  const length = arrayLength(raw, 0xffffffff);
  if (!length) throw new Error('Objectives require at least one requirement');
  const source = raw as ObjectiveRequirement[],
    result: ObjectiveRequirement[] = [],
    ids = new Set<string>();
  for (let i = 0; i < length; i++) {
    const r = source[i];
    if (!r) throw Error('Invalid objective requirement');
    const {id: key, event: name, target} = r;
    if (!id(key) || !id(name) || !positive(target) || ids.has(key)) throw Error('Invalid objective requirement');
    ids.add(key);
    result.push({id: key, event: name, target});
  }
  return result;
}
function event(raw: unknown): ObjectiveEvent {
  if (!raw) throw Error('Invalid objective event');
  const {runId, eventId, event: name, amount} = raw as ObjectiveEvent;
  if (!id(runId) || !id(eventId) || !id(name) || !positive(amount)) throw Error('Invalid objective event');
  return {runId, eventId, event: name, amount};
}

/** Pure run state. Persist snapshots through a game's existing defineSaveSection. */
export function createObjectiveRun(options: ObjectiveOptions, saved?: unknown) {
  const {runId, requirements: supplied, maxEvents = 10000} = options;
  if (!id(runId)) throw new Error('Invalid run ID');
  if (!positive(maxEvents)) throw new Error('Invalid objective event limit');
  const reqs = requirements(supplied);
  let cancelled = false;
  let reward: ObjectiveSnapshot['reward'] = null;
  const events = new Map<string, ObjectiveEvent>();
  const counts = new Map(reqs.map(r => [r.id, 0]));
  const complete = () => reqs.every(r => counts.get(r.id)! >= r.target);
  const add = (e: ObjectiveEvent) => {
    events.set(e.eventId, e);
    for (const r of reqs)
      if (r.event === e.event) {
        const current = counts.get(r.id)!;
        counts.set(r.id, current + Math.min(e.amount, r.target - current));
      }
  };
  if (saved !== undefined) {
    const s = saved as ObjectiveSnapshot;
    if (!s) throw Error('Invalid objective snapshot');
    const {
      version,
      runId: savedRun,
      cancelled: savedCancelled,
      requirements: savedRequirements,
      events: savedEvents,
      reward: savedReward,
    } = s;
    if (
      version !== 1 ||
      savedRun !== runId ||
      typeof savedCancelled !== 'boolean' ||
      JSON.stringify(requirements(savedRequirements)) !== JSON.stringify(reqs)
    )
      throw new Error('Invalid objective snapshot');
    const length = arrayLength(savedEvents, maxEvents);
    for (let i = 0; i < length; i++) {
      const e = event(savedEvents[i]);
      if (e.runId !== runId || events.has(e.eventId) || complete() || !reqs.some(r => r.event === e.event))
        throw new Error('Invalid objective history');
      add(e);
    }
    cancelled = savedCancelled;
    if (cancelled && complete()) throw new Error('Completed run cannot be cancelled');
    if (savedReward !== null) {
      if (!savedReward) throw Error('Invalid reward state');
      const {attemptId, acknowledged} = savedReward;
      if (!id(attemptId) || typeof acknowledged !== 'boolean' || !complete() || cancelled)
        throw new Error('Invalid reward state');
      reward = {attemptId, acknowledged};
    }
  }
  let busy = false;
  const guarded = <T>(operation: () => T): T => {
    if (busy) throw Error('objectives: reentrant mutation');
    busy = true;
    try {
      return operation();
    } finally {
      busy = false;
    }
  };
  const claimId = JSON.stringify(['objective-reward', runId]);
  return {
    record(raw: ObjectiveEvent): ObjectiveResult {
      return guarded(() => {
        const e = event(raw);
        if (e.runId !== runId) return 'stale';
        const previous = events.get(e.eventId);
        if (previous) return JSON.stringify(previous) === JSON.stringify(e) ? 'duplicate' : 'conflict';
        if (cancelled) return 'cancelled';
        if (complete()) return 'complete';
        if (!reqs.some(r => r.event === e.event)) return 'unmatched';
        if (events.size >= maxEvents) return 'saturated';
        add(e);
        return 'accepted';
      });
    },
    progress: () => reqs.map(r => ({...r, count: counts.get(r.id)!})),
    isComplete: complete,
    cancel(): boolean {
      return guarded(() => {
        if (complete() || cancelled) return false;
        cancelled = true;
        return true;
      });
    },
    /** Retry uses the SAME claimId at the reward sink; attemptId identifies this delivery attempt. */
    claimReward(attemptId: string): {claimId: string; attemptId: string} | null {
      return guarded(() => {
        if (!id(attemptId)) throw new Error('Invalid attempt ID');
        if (!complete() || cancelled || reward?.acknowledged) return null;
        reward = {attemptId, acknowledged: false};
        return {claimId, attemptId};
      });
    },
    acknowledgeReward(attemptId: string): boolean {
      return guarded(() => {
        if (!reward || reward.attemptId !== attemptId) return false;
        reward.acknowledged = true;
        return true;
      });
    },
    snapshot(): ObjectiveSnapshot {
      return {
        version: 1,
        runId: runId,
        requirements: reqs.map(r => ({...r})),
        events: [...events.values()].map(e => ({...e})),
        cancelled,
        reward: reward ? {...reward} : null,
      };
    },
  };
}
export function objectives(): KitDefinition {
  return defineKit({id: 'objectives'});
}
