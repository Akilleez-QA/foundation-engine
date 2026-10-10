/**
 * Squad knowledge, cover selection and utility scoring: small, bounded helpers that turn perception into decisions a
 * behaviour tree or state machine can read. They own no agents, clock or navigation.
 */
import {fail, finite, frozenVec, vec, type Vec3} from './senses';
import type {Awareness, Stimulus} from './awareness';

export interface SquadReport {
  readonly target: string;
  readonly position: Vec3;
  /** When the reporter perceived it (seconds). */
  readonly time: number;
  /** Confidence in [0, 1]. */
  readonly confidence: number;
  readonly reporter: string;
}

/**
 * Shared squad knowledge: the newest report per target (ties: higher confidence, then reporter id). `share` copies an
 * agent's suspicious-or-alerted targets in; `inform` turns fresh reports into `report` stimuli for a member, scaled by
 * confidence and by age (fading to 0 at `maxAge`), skipping what the member reported itself.
 */
export function createSquadKnowledge(options: {readonly maxTargets?: number; readonly maxAge?: number} = {}) {
  const maxTargets = options.maxTargets ?? 64,
    maxAge = options.maxAge ?? 10;
  if (!Number.isSafeInteger(maxTargets) || maxTargets < 1 || maxTargets > 1024) fail('maxTargets must be in [1, 1024]');
  if (!finite(maxAge) || maxAge <= 0 || maxAge > 1e6) fail('maxAge must be within (0, 1e6]');
  const reports = new Map<string, SquadReport>();
  const better = (a: SquadReport, b: SquadReport) =>
    a.time !== b.time
      ? a.time > b.time
      : a.confidence !== b.confidence
        ? a.confidence > b.confidence
        : a.reporter < b.reporter;
  const api = {
    report(r: SquadReport): 'stored' | 'older' | 'full' {
      if (!r || typeof r !== 'object') fail('a report must be an object');
      const target: unknown = r.target,
        reporter: unknown = r.reporter,
        time: unknown = r.time,
        confidence: unknown = r.confidence;
      if (typeof target !== 'string' || !target || typeof reporter !== 'string' || !reporter)
        fail('report target and reporter must be names');
      if (!finite(time) || time < 0) fail('report time must be a nonnegative finite time');
      if (!finite(confidence) || confidence < 0 || confidence > 1) fail('report confidence must be within [0, 1]');
      const copy: SquadReport = Object.freeze({
        target,
        reporter,
        time,
        confidence,
        position: frozenVec(vec(r.position, 'report position')),
      });
      const old = reports.get(target);
      if (old && !better(copy, old)) return 'older';
      if (!old && reports.size >= maxTargets) return 'full';
      reports.set(target, copy);
      return 'stored';
    },
    /** Share an agent's suspicious or alerted targets (confidence = awareness). */
    share(reporter: string, awareness: Awareness): number {
      let n = 0;
      for (const t of awareness.targets())
        if (
          t.level !== 'unaware' &&
          api.report({
            target: t.target,
            position: t.lastKnown,
            time: t.lastStimulus,
            confidence: t.awareness,
            reporter,
          }) === 'stored'
        )
          n++;
      return n;
    },
    /** Report stimuli for `member` at `now` from reports younger than maxAge that others made. */
    inform(member: string, now: number): readonly Stimulus[] {
      if (!finite(now)) fail('now must be finite');
      const out: Stimulus[] = [];
      for (const r of reports.values()) {
        const age = now - r.time;
        if (r.reporter === member || age < 0 || age >= maxAge) continue;
        out.push(
          Object.freeze({
            target: r.target,
            kind: 'report',
            strength: r.confidence * (1 - age / maxAge),
            position: r.position,
          }),
        );
      }
      return Object.freeze(out.sort((a, b) => (a.target < b.target ? -1 : 1)));
    },
    recall(target: string): SquadReport | null {
      return reports.get(target) ?? null;
    },
    /** Drop reports older than maxAge. */
    expire(now: number): number {
      let n = 0;
      for (const [k, r] of reports)
        if (now - r.time >= maxAge) {
          reports.delete(k);
          n++;
        }
      return n;
    },
  };
  return api;
}
export type SquadKnowledge = ReturnType<typeof createSquadKnowledge>;

export interface CoverPoint {
  readonly id: string;
  readonly position: Vec3;
}
/**
 * Pick cover: candidates within [minDistance, maxDistance] of the agent that are not reserved by someone else and that
 * `protects(point, threat)` confirms are hidden from the threat (a creator line-of-sight query). Candidates are
 * tried nearest first (or farthest from the threat with `prefer: 'away'`), ties by id, and at most `maxChecks` protect
 * queries are made. Returns the first protected point, or null.
 */
export function chooseCover(
  points: readonly CoverPoint[],
  query: {
    readonly agent: Vec3;
    readonly threat: Vec3;
    readonly protects: (point: Vec3, threat: Vec3) => boolean;
    readonly minDistance?: number;
    readonly maxDistance?: number;
    readonly prefer?: 'near' | 'away';
    readonly reserved?: (id: string) => boolean;
    readonly maxChecks?: number;
  },
): {readonly id: string; readonly position: Vec3; readonly checks: number} | null {
  if (!Array.isArray(points) || points.length > 4096) fail('at most 4,096 cover points');
  const agent = vec(query.agent, 'agent'),
    threat = vec(query.threat, 'threat'),
    min = query.minDistance ?? 0,
    max = query.maxDistance ?? 1e6,
    prefer = query.prefer ?? 'near',
    maxChecks = query.maxChecks ?? 16;
  if (!finite(min) || !finite(max) || min < 0 || max < min) fail('distance band must satisfy 0 ≤ min ≤ max');
  if (prefer !== 'near' && prefer !== 'away') fail('prefer is near or away');
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 4096) fail('maxChecks must be in [1, 4096]');
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const candidates: {id: string; position: Vec3; key: number}[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || typeof p !== 'object') fail('a cover point must be an object');
    const id: unknown = p.id;
    if (typeof id !== 'string' || !id || ids.has(id)) fail('cover ids must be unique names');
    ids.add(id);
    const position = vec(p.position, `cover ${id}`);
    const d = dist(agent, position);
    if (d < min || d > max || query.reserved?.(id)) continue;
    candidates.push({id, position, key: prefer === 'near' ? d : -dist(threat, position)});
  }
  candidates.sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1));
  let checks = 0;
  for (const c of candidates) {
    if (checks >= maxChecks) break;
    checks++;
    if (query.protects(c.position, threat)) return Object.freeze({id: c.id, position: frozenVec(c.position), checks});
  }
  return null;
}

/** Exclusive cover claims per agent; a stale release (another agent's) is refused. */
export function createCoverReservations() {
  const byPoint = new Map<string, string>(),
    byAgent = new Map<string, string>();
  return {
    claim(agent: string, point: string): 'claimed' | 'taken' {
      const holder = byPoint.get(point);
      if (holder !== undefined && holder !== agent) return 'taken';
      const previous = byAgent.get(agent);
      if (previous !== undefined) byPoint.delete(previous);
      byPoint.set(point, agent);
      byAgent.set(agent, point);
      return 'claimed';
    },
    release(agent: string): boolean {
      const point = byAgent.get(agent);
      if (point === undefined) return false;
      byAgent.delete(agent);
      byPoint.delete(point);
      return true;
    },
    /** For `chooseCover`'s `reserved`: true when someone other than `agent` holds `point`. */
    takenFor(agent: string): (point: string) => boolean {
      return point => {
        const holder = byPoint.get(point);
        return holder !== undefined && holder !== agent;
      };
    },
    holder(point: string): string | null {
      return byPoint.get(point) ?? null;
    },
  };
}

export interface UtilityOption<I> {
  readonly id: string;
  /** Multiplier on the final score, [0, 10]. Default 1. */
  readonly weight?: number;
  /** Each returns a value in [0, 1]; the option's score is their compensated product. */
  readonly considerations: readonly ((input: I) => number)[];
}
/**
 * Utility choice: each option scores the product of its considerations, compensated for their count so options with
 * more considerations are not penalised (score + (1 − score) × (1 − 1/n) × score), times its weight. The current choice
 * gets `momentum` (a [0, 1] bonus fraction) to avoid dithering. Highest score wins, ties by declaration order; below
 * `minScore` nothing is chosen. Considerations outside [0, 1] throw. A behaviour tree action can write the choice to
 * its blackboard.
 */
export function chooseUtility<I>(
  options: readonly UtilityOption<I>[],
  input: I,
  settings: {readonly current?: string | null; readonly momentum?: number; readonly minScore?: number} = {},
): {readonly choice: string | null; readonly scores: Readonly<Record<string, number>>} {
  if (!Array.isArray(options) || options.length < 1 || options.length > 256) fail('1-256 utility options');
  const momentum = settings.momentum ?? 0.25,
    minScore = settings.minScore ?? 0;
  if (!finite(momentum) || momentum < 0 || momentum > 1) fail('momentum must be within [0, 1]');
  if (!finite(minScore) || minScore < 0) fail('minScore must be ≥ 0');
  const scores: Record<string, number> = Object.create(null);
  let best: string | null = null,
    bestScore = -Infinity;
  for (const o of options) {
    if (!o || typeof o.id !== 'string' || !o.id || o.id in scores) fail('utility option ids must be unique names');
    const weight = o.weight ?? 1;
    if (!finite(weight) || weight < 0 || weight > 10) fail(`${o.id}: weight must be within [0, 10]`);
    const list = o.considerations;
    if (!Array.isArray(list) || list.length < 1 || list.length > 32) fail(`${o.id}: 1-32 considerations`);
    let product = 1;
    for (const c of list) {
      const v = c(input);
      if (!finite(v) || v < 0 || v > 1) fail(`${o.id}: considerations must return a number within [0, 1]`);
      product *= v;
    }
    const mod = 1 - 1 / list.length;
    let score = (product + (1 - product) * mod * product) * weight;
    if (settings.current === o.id) score *= 1 + momentum;
    scores[o.id] = score;
    if (score > bestScore) {
      bestScore = score;
      best = o.id;
    }
  }
  return Object.freeze({choice: bestScore >= minScore && bestScore > 0 ? best : null, scores: Object.freeze(scores)});
}
