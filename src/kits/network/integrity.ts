/**
 * Optional, caller-owned command integrity for an authoritative host (SEC-01).
 *
 * Validity and policy are separate:
 * - `assess` is pure and deterministic: creator rules judge (command, authoritative state, tick). It mutates nothing,
 *   so it can run inside an authority reducer, where an invalid command is consumed as a domain rejection (the
 *   client's prediction then reconciles back to authoritative state) instead of leaving a sequence gap.
 * - `admit` (before dispatch) and `record` (after the outcome) are local policy: a bounded, decaying score per key,
 *   an optional tick-rate budget, throttle and close thresholds, observe-only mode and a bounded local audit log.
 * - `check` composes all three for unsequenced commands, where refusing a command leaves no gap.
 *
 * It constructs no timer, clock, socket, transport or telemetry; nothing leaves the host unless the creator sends it.
 * Nothing calls it unless the creator does. See docs/guides/integrity.md.
 */
import type { DocumentValue } from '../authoring/document';
import { CLOSE_REASON_TOKEN, MAX_CLOSE_REASON_LENGTH } from '../../platform/network/browser-transport';
import { captureJson } from './captured-json';
import { createRateAdmission, type RateAdmission, type RateKey } from './rate-admission';

/** Default terminal close reason. Add it to `createClosePolicy({terminalReasons})` so clients stop reconnecting. */
export const INTEGRITY_CLOSE_REASON = 'integrity-violation';
export const MAX_INTEGRITY_RULES = 32;
/** Largest weight one finding can add, and the per-key score ceiling. */
export const MAX_INTEGRITY_WEIGHT = 1e6;
const MAX_SCORE = 1e9, MAX_WINDOW = 64, MAX_SUBJECT = 128, MAX_STREAM = 256;
export const INTEGRITY_AUDIT_FORMAT = 'foundation.integrity-audit';

export type IntegrityMode = 'enforce' | 'observe';
export type IntegrityVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'reject' | 'flag'; readonly reason: string; readonly weight: number; readonly evidence?: unknown };

/** What a rule sees. Deterministic inputs only: no score, connection or host clock. */
export interface IntegrityInput<C, S> {
  readonly command: C;
  /** The creator's authoritative state or a view of it. Never captured or copied; treat as read-only. */
  readonly state: S;
  /** The authoritative tick the command applies to, or null when the creator has no tick address. */
  readonly tick: number | null;
}

export interface IntegrityRule<C, S> {
  /** Token: 1-64 of `A-Z a-z 0-9 . _ : -`, starting with a letter or digit; unique within one owner. */
  readonly id: string;
  /** `observe` audits this rule's verdicts without acting or scoring (shadow mode). Default `enforce`. */
  readonly mode?: IntegrityMode;
  /** Ceiling on this rule's decaying score contribution per key, so one noisy rule cannot close a key alone. */
  readonly maxScore?: number;
  /** Synchronous, pure and deterministic. A throw or malformed verdict is a rule error (fail closed). */
  check(input: IntegrityInput<C, S>): IntegrityVerdict;
}

export interface IntegrityFinding {
  readonly rule: string;
  readonly kind: 'reject' | 'flag' | 'rule-error';
  readonly reason: string;
  readonly weight: number;
  /** True when the rule is in observe mode: audited, never acts, never scores. */
  readonly observed: boolean;
  readonly evidence: DocumentValue | null;
}

export interface IntegrityAssessment {
  /** The acting verdict. Always `ok` when the owner is in observe mode. */
  readonly verdict: 'ok' | 'invalid';
  /** What the verdict would be if everything were enforced. */
  readonly wouldBe: 'ok' | 'invalid';
  /** The rule and reason that made it invalid (or would have, in observe mode). */
  readonly rule: string | null;
  readonly reason: string | null;
  readonly findings: readonly IntegrityFinding[];
}

/** Optional review reference stored with audit entries. */
export interface IntegrityRef { readonly stream?: string; readonly sequence?: number; readonly tick?: number }

export interface IntegrityLimits {
  /** Tracked keys. A new key at the bound evicts the least-recently-seen key (never refuses a key). */
  readonly maxKeys: number;
  /** Retained audit entries per key (oldest dropped first). */
  readonly maxHistoryPerKey: number;
  /** Retained audit entries across all keys (oldest dropped first and counted in `dropped`). */
  readonly maxAudit: number;
  /** Byte bound for one finding's evidence JSON (default 512). Larger evidence is dropped and counted. */
  readonly maxEvidenceBytes?: number;
  /**
   * Unscored refusal rows (throttle, close repeats, unscored tick-budget) one key may add per second, with a burst of
   * `maxHistoryPerKey` (default 1). Scored entries are always audited.
   */
  readonly auditRowsPerKeyPerSecond?: number;
}

export interface IntegrityOptions<C, S> {
  readonly rules: readonly IntegrityRule<C, S>[];
  readonly limits: IntegrityLimits;
  /** Score removed per second of host time (linear, never below zero). Positive finite. */
  readonly decayPerSecond: number;
  /** `observe` computes and audits everything but never rejects, throttles or closes. Default `enforce`. */
  readonly enforcement?: IntegrityMode;
  /** Rule-set identity stored in audit entries and exports (token, default `default`). */
  readonly config?: string;
  /** Exportable label for a key in audit entries (at most 128 chars). Default: string keys as is, else `anonymous`. */
  readonly subject?: (key: RateKey) => string;
  /** At or above `score`, a key's commands pass a token bucket first; limited ones are throttled. */
  readonly throttle?: { readonly score: number; readonly capacity: number; readonly refillPerSecond: number };
  /** At or above `score` (and, when set, at least `requires.violations` violations within `requires.withinMs`), close. */
  readonly close?: {
    readonly score: number; readonly reason?: string;
    readonly requires?: { readonly violations: number; readonly withinMs: number };
  };
  /**
   * Tick-rate budget (anti speed-up): a bucket of `maxCatchUpTicks`, refilled at `ticksPerSecond * (1 + slack)` of
   * host time. `admit(key, now, {tick})` spends the claimed tick advance since the key's last admitted tick, clamped
   * to [1, maxCatchUpTicks]; `{ticks}` spends an explicit count. Over budget is throttled; only a retry before
   * `retryAfterMs` scores `weight`. A claim that can never fit (malformed, or `ticks` above `maxCatchUpTicks`) is
   * rejected `tick-claim`. Rules must clamp a command's elapsed ticks to at most `maxCatchUpTicks`.
   * Set `maxCatchUpTicks` at least to the client's prediction `maxPending`.
   */
  readonly tickBudget?: {
    readonly ticksPerSecond: number; readonly maxCatchUpTicks: number; readonly slack?: number;
    readonly weight?: number; readonly maxScore?: number; readonly mode?: IntegrityMode;
  };
  /** Score added for a rule error (default 0: a broken rule never closes a player). */
  readonly ruleErrorWeight?: number;
  /** Local, synchronous diagnostic sink. Exceptions are swallowed and counted. Nothing is sent anywhere. */
  readonly onAudit?: (entry: IntegrityAuditEntry) => void;
}

export type IntegrityRefusalReason = 'invalid-time' | 'invalid-key' | 'invalid-assessment' | 'busy' | 'retired' | 'disposed';

export type IntegrityDecision =
  /** Proceed. `observed` names the action observe mode suppressed, if any. */
  | { readonly action: 'allow'; readonly score: number; readonly observed: 'reject' | 'throttle' | 'close' | null }
  /**
   * Do not apply; retrying the same command cannot succeed. From `check`: the command is invalid (unsequenced
   * commands only). From `admit`: an impossible tick claim (`tick-claim`); consume a sequenced command as a no-op.
   */
  | { readonly action: 'reject'; readonly reason: string; readonly rule: string; readonly score: number }
  /** Do not dispatch now; the same command may be retried after `retryAfterMs` (like a busy refusal). */
  | { readonly action: 'throttle'; readonly reason: 'throttled' | 'tick-budget'; readonly retryAfterMs: number; readonly score: number }
  /** Do not dispatch; close the connection with `reason`, a terminal close token. */
  | { readonly action: 'close'; readonly reason: string; readonly score: number }
  /** Owner refusal: do not dispatch; nothing was scored. */
  | { readonly action: 'refused'; readonly reason: IntegrityRefusalReason };

export interface IntegrityAuditEntry {
  /** Monotonic per owner. */
  readonly seq: number;
  readonly at: number;
  readonly subject: string;
  readonly config: string;
  readonly kind: 'reject' | 'flag' | 'rule-error' | 'tick-budget' | 'throttle' | 'close';
  readonly rule: string | null;
  readonly reason: string;
  /** Score actually applied (after ceilings; 0 when observed). */
  readonly weight: number;
  readonly score: number;
  readonly observed: boolean;
  readonly ref: IntegrityRef | null;
  readonly evidence: DocumentValue | null;
}

export interface IntegrityKeyState {
  readonly score: number;
  readonly violations: number;
  readonly lastViolationAt: number | null;
  readonly history: readonly IntegrityAuditEntry[];
}

export interface IntegrityStats {
  readonly keys: number; readonly admitted: number; readonly recorded: number; readonly rejected: number;
  readonly throttled: number; readonly closed: number; readonly flags: number; readonly ruleErrors: number;
  readonly tickBudgetExceeded: number; readonly wouldReject: number; readonly wouldThrottle: number;
  readonly wouldClose: number; readonly evicted: number; readonly evictedScored: number; readonly dropped: number;
  readonly evidenceDropped: number; readonly clockRegressions: number; readonly auditErrors: number;
  /** Unscored refusal rows beyond a key's audit allowance (`limits.auditRowsPerKeyPerSecond`), counted instead of audited. */
  readonly auditSuppressed: number;
  readonly disposed: boolean;
}

/** What a command claims in simulation time, for the tick budget. Use one of `tick` or `ticks`. */
export interface IntegrityTickClaim {
  /** The tick address the command claims. The owner charges `clamp(tick - last admitted tick, 1, maxCatchUpTicks)`. */
  readonly tick?: number;
  /** An explicit positive count of ticks this command advances. */
  readonly ticks?: number;
}

export interface Integrity<C, S> {
  /** Pure validity verdict. Safe inside an authority reducer. The result may be passed to `record` once. */
  assess(input: IntegrityInput<C, S>): IntegrityAssessment;
  /** Policy before dispatch or submit: close state, throttle and the tick budget. Never throws. */
  admit(key: RateKey, now: number, options?: IntegrityTickClaim & { readonly ref?: IntegrityRef }): IntegrityDecision;
  /** Scores an assessment after its outcome is known (once per assessment), audits it, may return `close`. */
  record(key: RateKey, assessment: IntegrityAssessment, now: number, ref?: IntegrityRef): IntegrityDecision;
  /** Unsequenced convenience: admit, assess, record. Returns `reject` for an invalid command. */
  check(key: RateKey, input: IntegrityInput<C, S>, now: number,
    options?: IntegrityTickClaim & { readonly ref?: IntegrityRef }): IntegrityDecision;
  read(key: RateKey, now?: number): IntegrityKeyState | null;
  /** Retained audit entries, oldest first. */
  audit(): readonly IntegrityAuditEntry[];
  /** Retained entries as deterministic JSON text for local review. Nothing is sent. */
  exportAudit(): string;
  /** Drops a key's score, history and buckets. Forgetting resets the key: do not call it on every disconnect. */
  forget(key: RateKey): boolean;
  stats(): IntegrityStats;
  /** Idempotent. Clears all state; later calls are refused `disposed`. */
  dispose(): void;
}

const OK: IntegrityVerdict = Object.freeze({ kind: 'ok' });
const token = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_CLOSE_REASON_LENGTH && CLOSE_REASON_TOKEN.test(value);
const weightOk = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_INTEGRITY_WEIGHT;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const scoreOk = (value: unknown): value is number => finite(value) && value > 0 && value <= MAX_SCORE;
const modeOk = (value: unknown): value is IntegrityMode | undefined =>
  value === undefined || value === 'enforce' || value === 'observe';

/** The verdict that lets a command through this rule. */
export const integrityOk = (): IntegrityVerdict => OK;
/** Marks the command invalid; `weight` (default 0) is scored when recorded. Optional JSON `evidence` for review. */
export const integrityReject = (reason: string, weight = 0, evidence?: unknown): IntegrityVerdict =>
  Object.freeze(evidence === undefined ? { kind: 'reject', reason, weight } : { kind: 'reject', reason, weight, evidence });
/** Lets the command through but scores `weight` (default 1) when recorded. */
export const integrityFlag = (reason: string, weight = 1, evidence?: unknown): IntegrityVerdict =>
  Object.freeze(evidence === undefined ? { kind: 'flag', reason, weight } : { kind: 'flag', reason, weight, evidence });

type Entry = {
  score: number; at: number; violations: number; lastViolationAt: number | null;
  history: IntegrityAuditEntry[]; window: number[]; caps: number[] | null;
  /** Last admitted claimed tick (tick budget), and the host time before which a retry is early. */
  lastTick: number | null; retryAt: number | null;
  /** Unscored refusal audit allowance: tokens and the host time they were last refilled. */
  auditTokens: number; auditAt: number;
};

export function createIntegrity<C, S>(options: IntegrityOptions<C, S>): Integrity<C, S> {
  if (options === null || typeof options !== 'object') throw Error('integrity: invalid options');
  const { limits, decayPerSecond, throttle, close, tickBudget, onAudit } = options;
  if (!Array.isArray(options.rules) || options.rules.length > MAX_INTEGRITY_RULES) throw Error('integrity: invalid rules');
  const rules: readonly IntegrityRule<C, S>[] = Object.freeze([...options.rules]);
  const ids = new Set<string>();
  const ruleCaps: (number | null)[] = [];
  for (const rule of rules) {
    if (!rule || !token(rule.id) || ids.has(rule.id) || typeof rule.check !== 'function' || !modeOk(rule.mode)
      || (rule.maxScore !== undefined && !scoreOk(rule.maxScore))) throw Error('integrity: invalid rule');
    ids.add(rule.id);
    ruleCaps.push(rule.maxScore ?? null);
  }
  if (!limits || !positive(limits.maxKeys) || !positive(limits.maxHistoryPerKey) || !positive(limits.maxAudit)
    || (limits.maxEvidenceBytes !== undefined && !positive(limits.maxEvidenceBytes))) throw Error('integrity: invalid limits');
  const bounds = Object.freeze({ maxKeys: limits.maxKeys, maxHistoryPerKey: limits.maxHistoryPerKey,
    maxAudit: limits.maxAudit, maxEvidenceBytes: limits.maxEvidenceBytes ?? 512 });
  const auditRate = limits.auditRowsPerKeyPerSecond ?? 1;
  if (!finite(auditRate) || auditRate < 0 || auditRate > 1e6) throw Error('integrity: invalid audit rate');
  const evidenceLimits = Object.freeze({ maxBytes: bounds.maxEvidenceBytes, maxNodes: 64, maxDepth: 4 });
  if (!finite(decayPerSecond) || decayPerSecond <= 0 || decayPerSecond > MAX_SCORE) throw Error('integrity: invalid decay');
  const enforcement = options.enforcement ?? 'enforce';
  if (!modeOk(enforcement)) throw Error('integrity: invalid enforcement');
  const observing = enforcement === 'observe';
  const config = options.config ?? 'default';
  if (!token(config)) throw Error('integrity: invalid config');
  const subjectOf = options.subject;
  if (subjectOf !== undefined && typeof subjectOf !== 'function') throw Error('integrity: invalid subject');
  const ruleErrorWeight = options.ruleErrorWeight ?? 0;
  if (!weightOk(ruleErrorWeight)) throw Error('integrity: invalid rule error weight');
  if (onAudit !== undefined && typeof onAudit !== 'function') throw Error('integrity: invalid audit sink');
  const closeAt = close === undefined ? null : close.score;
  const closeReason = close?.reason ?? INTEGRITY_CLOSE_REASON;
  const requires = close?.requires ?? null;
  if (close !== undefined && (!scoreOk(closeAt) || !token(closeReason))) throw Error('integrity: invalid close');
  if (requires !== null && (!positive(requires.violations) || requires.violations > MAX_WINDOW
    || !finite(requires.withinMs) || requires.withinMs <= 0)) throw Error('integrity: invalid close window');
  const throttleAt = throttle === undefined ? null : throttle.score;
  if (throttle !== undefined && !scoreOk(throttleAt)) throw Error('integrity: invalid throttle');
  const tick = tickBudget === undefined ? null : Object.freeze({
    weight: tickBudget.weight ?? 1, maxScore: tickBudget.maxScore ?? null, observe: tickBudget.mode === 'observe',
    slack: tickBudget.slack ?? 0.05, capacity: tickBudget.maxCatchUpTicks });
  if (tickBudget !== undefined && (!weightOk(tick!.weight) || !modeOk(tickBudget.mode)
    || (tick!.maxScore !== null && !scoreOk(tick!.maxScore)) || !finite(tick!.slack) || tick!.slack < 0 || tick!.slack > 1
    || !finite(tickBudget.ticksPerSecond))) throw Error('integrity: invalid tick budget');
  // Both buckets reuse rate admission (NW-05). Their keys are a subset of tracked keys, so they never refuse capacity.
  const throttleBucket: RateAdmission | null = throttle === undefined ? null
    : createRateAdmission({ maxKeys: bounds.maxKeys, capacity: throttle.capacity, refillPerSecond: throttle.refillPerSecond });
  const tickBucket: RateAdmission | null = tickBudget === undefined ? null
    : createRateAdmission({ maxKeys: bounds.maxKeys, capacity: tickBudget.maxCatchUpTicks,
      refillPerSecond: tickBudget.ticksPerSecond * (1 + tick!.slack) });
  // Contribution slots: one per rule with a ceiling, plus one for the tick budget.
  const TICK_SLOT = rules.length;
  const capped = ruleCaps.some(c => c !== null) || (tick !== null && tick.maxScore !== null);

  // Insertion order is least-recently-seen order: every touch re-inserts its key.
  const entries = new Map<RateKey, Entry>();
  const auditLog: IntegrityAuditEntry[] = [];
  const issued = new WeakSet<object>();
  let latest = 0, busy = false, disposed = false, seq = 0;
  let admitted = 0, recorded = 0, rejected = 0, throttled = 0, closed = 0, flags = 0, ruleErrors = 0;
  let tickBudgetExceeded = 0, wouldReject = 0, wouldThrottle = 0, wouldClose = 0, evicted = 0, evictedScored = 0;
  let dropped = 0, evidenceDropped = 0, clockRegressions = 0, auditErrors = 0, auditSuppressed = 0;

  const validKey = (key: unknown): key is RateKey =>
    (typeof key === 'object' && key !== null) || typeof key === 'function'
    || (typeof key === 'string' && key.length > 0 && key.length <= 256);
  const validTime = (now: unknown): now is number =>
    typeof now === 'number' && Number.isFinite(now) && now >= 0 && now <= Number.MAX_SAFE_INTEGER;
  const decay = (value: number, elapsed: number): number => Math.max(0, value - (decayPerSecond * elapsed) / 1000);
  const refused = (reason: IntegrityRefusalReason): IntegrityDecision => Object.freeze({ action: 'refused', reason });
  const allow = (score: number, observed: 'reject' | 'throttle' | 'close' | null = null): IntegrityDecision =>
    Object.freeze({ action: 'allow', score, observed });

  function subject(key: RateKey): string {
    if (!subjectOf) return typeof key === 'string' ? key.slice(0, MAX_SUBJECT) : 'anonymous';
    try {
      const label = subjectOf(key);
      return typeof label === 'string' && label.length <= MAX_SUBJECT ? label : 'invalid-subject';
    } catch { return 'invalid-subject'; }
  }
  function captureRef(ref: unknown): IntegrityRef | null {
    if (ref === undefined || ref === null || typeof ref !== 'object') return null;
    const { stream, sequence, tick: t } = ref as Record<string, unknown>;
    const out: { stream?: string; sequence?: number; tick?: number } = {};
    if (typeof stream === 'string' && stream.length > 0 && stream.length <= MAX_STREAM) out.stream = stream;
    if (Number.isSafeInteger(sequence) && (sequence as number) >= 0) out.sequence = sequence as number;
    if (Number.isSafeInteger(t) && (t as number) >= 0) out.tick = t as number;
    return Object.keys(out).length ? Object.freeze(out) : null;
  }
  function captureEvidence(value: unknown): DocumentValue | null {
    if (value === undefined) return null;
    try {
      const json = JSON.stringify(value);
      if (typeof json !== 'string') throw Error('evidence');
      return captureJson(json, evidenceLimits).value;
    } catch { evidenceDropped++; return null; }
  }

  /** Clock high-water mark: a backwards reading is counted and grants no decay or refill. */
  function clock(now: number): number {
    if (now < latest) clockRegressions++;
    else latest = now;
    return latest;
  }
  /** Finds or creates the key's entry (evicting the least-recently-seen key at the bound) and decays it to `t`. */
  function touch(key: RateKey, t: number): Entry {
    let entry = entries.get(key);
    if (entry === undefined) {
      if (entries.size >= bounds.maxKeys) {
        const [oldKey, oldEntry] = entries.entries().next().value as [RateKey, Entry];
        entries.delete(oldKey);
        throttleBucket?.forget(oldKey);
        tickBucket?.forget(oldKey);
        evicted++;
        if (decay(oldEntry.score, t - oldEntry.at) > 0) evictedScored++;
      }
      entry = { score: 0, at: t, violations: 0, lastViolationAt: null, history: [], window: [],
        caps: capped ? new Array<number>(rules.length + 1).fill(0) : null, lastTick: null, retryAt: null,
        auditTokens: bounds.maxHistoryPerKey, auditAt: t };
    } else entries.delete(key);
    entries.set(key, entry);
    const elapsed = Math.max(0, t - entry.at);
    entry.score = decay(entry.score, elapsed);
    if (entry.caps) for (let i = 0; i < entry.caps.length; i++) entry.caps[i] = decay(entry.caps[i]!, elapsed);
    entry.at = t;
    return entry;
  }
  /** Adds `weight`, limited by the slot's ceiling; returns the weight actually applied. */
  function add(entry: Entry, weight: number, slot: number, cap: number | null): number {
    let applied = weight;
    if (entry.caps && cap !== null) {
      applied = Math.max(0, Math.min(weight, cap - entry.caps[slot]!));
      entry.caps[slot] = entry.caps[slot]! + applied;
    }
    entry.score = Math.min(MAX_SCORE, entry.score + applied);
    return applied;
  }
  function violation(entry: Entry, t: number): void {
    entry.violations++;
    entry.lastViolationAt = t;
    if (requires) {
      entry.window.push(t);
      if (entry.window.length > requires.violations) entry.window.shift();
    }
  }
  function closing(entry: Entry, t: number): boolean {
    if (closeAt === null || entry.score < closeAt) return false;
    if (!requires) return true;
    return entry.window.length >= requires.violations && t - entry.window[0]! <= requires.withinMs;
  }
  function audit(key: RateKey, entry: Entry, t: number, item: {
    kind: IntegrityAuditEntry['kind']; rule: string | null; reason: string; weight: number;
    observed: boolean; ref: IntegrityRef | null; evidence: DocumentValue | null;
  }): void {
    const row: IntegrityAuditEntry = Object.freeze({ seq: ++seq, at: t, subject: subject(key), config, kind: item.kind,
      rule: item.rule, reason: item.reason, weight: item.weight, score: entry.score, observed: item.observed,
      ref: item.ref, evidence: item.evidence });
    entry.history.push(row);
    if (entry.history.length > bounds.maxHistoryPerKey) {
      // Evict the oldest unscored row first, so a key's own no-ops cannot push its scored evidence out.
      const i = entry.history.findIndex(e => e.weight <= 0);
      entry.history.splice(i >= 0 ? i : 0, 1);
    }
    auditLog.push(row);
    if (auditLog.length > bounds.maxAudit) { auditLog.shift(); dropped++; }
    if (onAudit) try { onAudit(row); } catch { auditErrors++; }
  }
  /**
   * Audits a refusal or finding. Scored rows are always audited; unscored ones (weight 0: no-ops, throttles, repeated
   * closes) spend a per-key allowance (burst `maxHistoryPerKey`, refilled at `auditRowsPerKeyPerSecond`), so one
   * key's unscored traffic cannot flush others' evidence.
   */
  function auditOnce(key: RateKey, entry: Entry, t: number, item: Parameters<typeof audit>[3]): void {
    if (item.weight <= 0) {
      entry.auditTokens = Math.min(bounds.maxHistoryPerKey,
        entry.auditTokens + (Math.max(0, t - entry.auditAt) * auditRate) / 1000);
      entry.auditAt = t;
      if (entry.auditTokens < 1) { auditSuppressed++; return; }
      entry.auditTokens -= 1;
    }
    audit(key, entry, t, item);
  }
  /** Close decision at the current score; in observe mode it is audited and suppressed. */
  function closeDecision(key: RateKey, entry: Entry, t: number, ref: IntegrityRef | null): IntegrityDecision | null {
    if (!closing(entry, t)) return null;
    auditOnce(key, entry, t, { kind: 'close', rule: null, reason: closeReason, weight: 0, observed: observing, ref, evidence: null });
    if (observing) { wouldClose++; return allow(entry.score, 'close'); }
    closed++;
    return Object.freeze({ action: 'close', reason: closeReason, score: entry.score });
  }

  function assess(input: IntegrityInput<C, S>): IntegrityAssessment {
    const frozen: IntegrityInput<C, S> = Object.freeze({ command: input?.command, state: input?.state,
      tick: Number.isSafeInteger(input?.tick) ? input.tick : null });
    const findings: IntegrityFinding[] = [];
    let rule: string | null = null, reason: string | null = null;
    for (const r of rules) {
      const observed = r.mode === 'observe';
      // Fields are read inside the guard, so a throwing getter is a rule error, not an owner exception.
      let kind: unknown, why: unknown, weight: unknown, evidence: unknown;
      try {
        const v = r.check(frozen) as unknown;
        if (v !== null && typeof v === 'object') {
          ({ kind } = v as { kind: unknown });
          if (kind === 'reject' || kind === 'flag') ({ reason: why, weight, evidence } = v as Record<string, unknown>);
        }
      } catch { kind = undefined; }
      if (kind === 'ok') continue;
      let finding: IntegrityFinding;
      if ((kind === 'reject' || kind === 'flag') && token(why) && weightOk(weight))
        finding = Object.freeze({ rule: r.id, kind, reason: why, weight, observed, evidence: captureEvidence(evidence) });
      else finding = Object.freeze({ rule: r.id, kind: 'rule-error', reason: 'rule-error', weight: ruleErrorWeight,
        observed, evidence: null });
      findings.push(finding);
      // A reject or rule error from an enforced rule decides the command; observed rules never do.
      if (finding.kind !== 'flag' && !observed) { rule = r.id; reason = finding.reason; break; }
    }
    const wouldBe = rule === null ? 'ok' : 'invalid';
    const assessment: IntegrityAssessment = Object.freeze({ verdict: observing ? 'ok' : wouldBe, wouldBe, rule, reason,
      findings: Object.freeze(findings) });
    issued.add(assessment);
    return assessment;
  }

  /** The tick-budget cost of a claim, or null when it can never be admitted. Does not mutate. */
  function tickCost(entry: Entry, claim: IntegrityTickClaim): { cost: number | null; claimed: number | null } {
    if (claim.tick !== undefined) {
      const claimed = Number.isSafeInteger(claim.tick) && (claim.tick as number) >= 0 ? claim.tick as number : null;
      // A gap larger than the bucket (a resynchronised or idle client) is charged a full bucket: rules must clamp
      // the movement one command may cover (maxElapsedTicks) to at most maxCatchUpTicks so it never exceeds its cost.
      const cost = claimed === null ? null
        : Math.min(tick!.capacity, entry.lastTick === null ? 1 : Math.max(1, claimed - entry.lastTick));
      return { cost, claimed };
    }
    const n = claim.ticks;
    return { cost: positive(n) && n <= tick!.capacity ? n : null, claimed: null };
  }

  function admitAt(key: RateKey, t: number, claim: IntegrityTickClaim | undefined, ref: IntegrityRef | null): IntegrityDecision {
    admitted++;
    const entry = touch(key, t);
    const closeNow = closeDecision(key, entry, t, ref);
    if (closeNow && closeNow.action === 'close') return closeNow;
    let observed: 'reject' | 'throttle' | 'close' | null = closeNow ? 'close' : null;
    if (throttleBucket && throttleAt !== null && entry.score >= throttleAt) {
      const r = throttleBucket.admit(key, t);
      if (r.status !== 'admitted') {
        auditOnce(key, entry, t, { kind: 'throttle', rule: null, reason: 'throttled', weight: 0, observed: observing, ref, evidence: null });
        if (!observing) {
          throttled++;
          return Object.freeze({ action: 'throttle', reason: 'throttled',
            retryAfterMs: r.status === 'limited' && r.retryAfterMs !== null ? r.retryAfterMs : 1, score: entry.score });
        }
        wouldThrottle++;
        observed ??= 'throttle';
      }
    }
    if (tickBucket && tick && claim && (claim.tick !== undefined || claim.ticks !== undefined)) {
      const { cost, claimed } = tickCost(entry, claim);
      const shadow = tick.observe;
      if (cost === null) {
        // Malformed or larger than the whole bucket: retrying cannot help, so it is not a throttle.
        tickBudgetExceeded++;
        const applied = shadow ? 0 : add(entry, tick.weight, TICK_SLOT, tick.maxScore);
        if (!shadow) violation(entry, t);
        auditOnce(key, entry, t, { kind: 'tick-budget', rule: null, reason: 'tick-claim', weight: applied,
          observed: shadow || observing, ref, evidence: captureEvidence({ tick: claim.tick ?? null, ticks: claim.ticks ?? null,
            lastTick: entry.lastTick }) });
        if (!shadow) {
          const after = closeDecision(key, entry, t, ref);
          if (after && after.action === 'close') return after;
          if (after) observed = 'close';
          if (!observing) {
            rejected++;
            return Object.freeze({ action: 'reject', reason: 'tick-claim', rule: 'tick-budget', score: entry.score });
          }
          wouldReject++;
          observed ??= 'reject';
        }
      } else {
        const r = tickBucket.admit(key, t, cost);
        if (r.status !== 'admitted') {
          tickBudgetExceeded++;
          // Only a retry before the previous retryAfterMs scores: a client that waits gains nothing and is not punished.
          const early = entry.retryAt !== null && t < entry.retryAt;
          const retryAfterMs = r.status === 'limited' && r.retryAfterMs !== null ? r.retryAfterMs : 1;
          entry.retryAt = t + retryAfterMs;
          const applied = early && !shadow ? add(entry, tick.weight, TICK_SLOT, tick.maxScore) : 0;
          if (early && !shadow) violation(entry, t);
          auditOnce(key, entry, t, { kind: 'tick-budget', rule: null, reason: early ? 'tick-budget-early' : 'tick-budget',
            weight: applied, observed: shadow || observing, ref, evidence: captureEvidence({ cost, retryAfterMs }) });
          if (!shadow) {
            const after = closeDecision(key, entry, t, ref);
            if (after && after.action === 'close') return after;
            if (after) observed = 'close';
            if (!observing) {
              throttled++;
              return Object.freeze({ action: 'throttle', reason: 'tick-budget', retryAfterMs, score: entry.score });
            }
            wouldThrottle++;
            observed ??= 'throttle';
          }
        }
        if (r.status === 'admitted' || observing || shadow) {
          // The last admitted claim, not the maximum: one absurd claim must not make every later claim cost 1.
          if (claimed !== null) entry.lastTick = claimed;
          if (r.status === 'admitted') entry.retryAt = null;
        }
      }
    }
    return allow(entry.score, observed);
  }

  function recordAt(key: RateKey, assessment: IntegrityAssessment, t: number, ref: IntegrityRef | null): IntegrityDecision {
    if (!issued.has(assessment)) return refused('invalid-assessment');
    issued.delete(assessment);
    recorded++;
    const entry = touch(key, t);
    let counted = false;
    for (const finding of assessment.findings) {
      const index = rules.findIndex(r => r.id === finding.rule);
      const applied = finding.observed ? 0 : add(entry, finding.weight, index, ruleCaps[index] ?? null);
      // One recorded command is at most one violation, however many rules it tripped.
      // Only scored findings are violations: an unscored rejection (weight 0) is a no-op, not evidence.
      if (!finding.observed && applied > 0 && !counted) { violation(entry, t); counted = true; }
      if (finding.kind === 'flag') flags++;
      if (finding.kind === 'rule-error') ruleErrors++;
      auditOnce(key, entry, t, { kind: finding.kind, rule: finding.rule, reason: finding.reason, weight: applied,
        observed: finding.observed || observing, ref, evidence: finding.evidence });
    }
    const suppressed = assessment.wouldBe === 'invalid' && assessment.verdict === 'ok';
    if (suppressed) wouldReject++;
    const decision = closeDecision(key, entry, t, ref);
    if (decision) return decision;
    return allow(entry.score, suppressed ? 'reject' : null);
  }

  /** Shared guard: disposal, reentry, time and key. */
  function guarded(key: RateKey, now: number, run: (t: number) => IntegrityDecision): IntegrityDecision {
    if (disposed) return refused('disposed');
    if (busy) return refused('busy');
    if (!validTime(now)) return refused('invalid-time');
    if (!validKey(key)) return refused('invalid-key');
    busy = true;
    try { return run(clock(now)); } finally { busy = false; }
  }

  return Object.freeze({
    assess,
    admit: (key: RateKey, now: number, opts?: IntegrityTickClaim & { readonly ref?: IntegrityRef }) =>
      guarded(key, now, t => admitAt(key, t, opts, captureRef(opts?.ref))),
    record: (key: RateKey, assessment: IntegrityAssessment, now: number, ref?: IntegrityRef) =>
      guarded(key, now, t => recordAt(key, assessment, t, captureRef(ref))),
    check(key: RateKey, input: IntegrityInput<C, S>, now: number,
      opts?: IntegrityTickClaim & { readonly ref?: IntegrityRef }): IntegrityDecision {
      return guarded(key, now, t => {
        const ref = captureRef(opts?.ref);
        const gate = admitAt(key, t, opts, ref);
        if (gate.action !== 'allow') return gate;
        const entry = entries.get(key);
        const assessment = assess(input);
        if (disposed) return refused('disposed');
        if (entries.get(key) !== entry) return refused('retired');
        const decision = recordAt(key, assessment, t, ref);
        if (decision.action !== 'allow') return decision;
        if (assessment.verdict === 'invalid') {
          rejected++;
          return Object.freeze({ action: 'reject', reason: assessment.reason!, rule: assessment.rule!, score: decision.score });
        }
        return gate.action === 'allow' && gate.observed && !decision.observed ? allow(decision.score, gate.observed) : decision;
      });
    },
    read(key: RateKey, now?: number): IntegrityKeyState | null {
      if (now !== undefined && !validTime(now)) return null;
      const entry = entries.get(key);
      if (entry === undefined) return null;
      return Object.freeze({ score: decay(entry.score, Math.max(now ?? latest, latest) - entry.at),
        violations: entry.violations, lastViolationAt: entry.lastViolationAt, history: Object.freeze([...entry.history]) });
    },
    audit: () => Object.freeze([...auditLog]),
    exportAudit: () => JSON.stringify({ format: INTEGRITY_AUDIT_FORMAT, version: 1, config, enforcement, dropped,
      entries: auditLog.map(e => ({ seq: e.seq, at: e.at, subject: e.subject, config: e.config, kind: e.kind,
        rule: e.rule, reason: e.reason, weight: e.weight, score: e.score, observed: e.observed, ref: e.ref,
        evidence: e.evidence })) }),
    forget(key: RateKey): boolean {
      throttleBucket?.forget(key);
      tickBucket?.forget(key);
      return entries.delete(key);
    },
    stats: (): IntegrityStats => Object.freeze({ keys: entries.size, admitted, recorded, rejected, throttled, closed,
      flags, ruleErrors, tickBudgetExceeded, wouldReject, wouldThrottle, wouldClose, evicted, evictedScored, dropped,
      evidenceDropped, clockRegressions, auditErrors, auditSuppressed, disposed }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      entries.clear();
      auditLog.length = 0;
      throttleBucket?.dispose();
      tickBucket?.dispose();
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Generic, pure rule helpers. Each reads values through creator selectors, so it knows no game nouns. A selector
// that throws is a rule error; a selector that returns a malformed value is a violation.

/** Shared helper options: how a violation is reported. */
export interface IntegrityRuleBase {
  readonly id: string;
  /** `reject` (default) makes the command invalid; `flag` lets it through and scores it. */
  readonly violation?: 'reject' | 'flag';
  /** Score per violation (default 1). */
  readonly weight?: number;
  /** `observe` audits without acting or scoring. */
  readonly mode?: IntegrityMode;
  /** Ceiling on this rule's decaying contribution per key. */
  readonly maxScore?: number;
}
type Select<C, S, T> = (input: IntegrityInput<C, S>) => T;

function base<C, S>(spec: IntegrityRuleBase, check: (input: IntegrityInput<C, S>,
  fail: (evidence?: unknown) => IntegrityVerdict) => IntegrityVerdict): IntegrityRule<C, S> {
  if (!spec || !token(spec.id)) throw Error('integrity rule: invalid id');
  const mode = spec.violation ?? 'reject', weight = spec.weight ?? 1;
  if ((mode !== 'reject' && mode !== 'flag') || !weightOk(weight) || !modeOk(spec.mode)
    || (spec.maxScore !== undefined && !scoreOk(spec.maxScore))) throw Error('integrity rule: invalid violation');
  const fail = (evidence?: unknown) =>
    mode === 'reject' ? integrityReject(spec.id, weight, evidence) : integrityFlag(spec.id, weight, evidence);
  return Object.freeze({ id: spec.id, ...(spec.mode ? { mode: spec.mode } : {}),
    ...(spec.maxScore !== undefined ? { maxScore: spec.maxScore } : {}),
    check: (input: IntegrityInput<C, S>) => check(input, fail) });
}
const MAX_DIMENSIONS = 16;
function vector(value: unknown): number[] | null {
  if (finite(value)) return [value];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DIMENSIONS || !value.every(finite)) return null;
  return value as number[];
}
const fn = (...values: unknown[]) => values.every(v => typeof v === 'function');
const nonNegative = (...values: unknown[]) => values.every(v => finite(v) && v >= 0);

/**
 * Bounds how far a value may move per elapsed tick between the last authoritative value and the value the command
 * would produce: distance <= `allowance + perTick * clamp(elapsedTicks, 1, maxElapsedTicks)`. Values are numbers or
 * equal-length vectors (Euclidean, at most 16 dimensions). `current` or `elapsedTicks` null: no authoritative value
 * yet, passes. Pair with the owner's `tickBudget` so a client cannot claim more ticks than host time allows.
 * Host time in place of ticks works but is jitter-sensitive (see the guide).
 */
export function maxRateOfChange<C, S>(spec: IntegrityRuleBase & {
  readonly current: Select<C, S, number | readonly number[] | null>;
  readonly proposed: Select<C, S, number | readonly number[]>;
  readonly elapsedTicks: Select<C, S, number | null>;
  readonly perTick: number;
  readonly allowance?: number;
  readonly maxElapsedTicks?: number;
}): IntegrityRule<C, S> {
  const allowance = spec?.allowance ?? 0, maxElapsed = spec?.maxElapsedTicks ?? Number.MAX_SAFE_INTEGER;
  if (!spec || !nonNegative(spec.perTick, allowance) || !(finite(maxElapsed) && maxElapsed >= 1)
    || !fn(spec.current, spec.proposed, spec.elapsedTicks)) throw Error('integrity rule: invalid rate');
  return base(spec, (input, fail) => {
    const was = spec.current(input), elapsed = spec.elapsedTicks(input);
    if (was === null || elapsed === null) return OK;
    const from = vector(was), to = vector(spec.proposed(input));
    if (!finite(elapsed) || !from || !to || from.length !== to.length) return fail();
    let sum = 0;
    for (let i = 0; i < from.length; i++) sum += (to[i]! - from[i]!) ** 2;
    const distance = Math.sqrt(sum), allowed = allowance + spec.perTick * Math.min(maxElapsed, Math.max(1, elapsed));
    return distance <= allowed ? OK : fail({ distance, allowed });
  });
}

/** Requires a finite number within [min, max]; optionally an integer. */
export function valueInRange<C, S>(spec: IntegrityRuleBase & {
  readonly value: Select<C, S, unknown>; readonly min: number; readonly max: number; readonly integer?: boolean;
}): IntegrityRule<C, S> {
  if (!spec || !finite(spec.min) || !finite(spec.max) || spec.min > spec.max || !fn(spec.value))
    throw Error('integrity rule: invalid range');
  return base(spec, (input, fail) => {
    const v = spec.value(input);
    return finite(v) && v >= spec.min && v <= spec.max && (!spec.integer || Number.isInteger(v)) ? OK : fail();
  });
}

/** Requires the value to be one of at most 256 allowed strings, numbers or booleans (strict equality). */
export function valueInSet<C, S>(spec: IntegrityRuleBase & {
  readonly value: Select<C, S, unknown>; readonly allowed: readonly (string | number | boolean)[];
}): IntegrityRule<C, S> {
  if (!spec || !Array.isArray(spec.allowed) || spec.allowed.length === 0 || spec.allowed.length > 256
    || !spec.allowed.every(v => typeof v === 'string' || typeof v === 'boolean' || finite(v)) || !fn(spec.value))
    throw Error('integrity rule: invalid set');
  const allowed = new Set<unknown>(spec.allowed);
  return base(spec, (input, fail) => allowed.has(spec.value(input)) ? OK : fail());
}

/**
 * Requires a number to advance past the authoritative previous value: greater (strict, default) or equal, and by
 * at most `maxStep` when set. `previous` null: none yet, any finite value passes.
 */
export function monotonic<C, S>(spec: IntegrityRuleBase & {
  readonly value: Select<C, S, unknown>; readonly previous: Select<C, S, number | null>;
  readonly strict?: boolean; readonly maxStep?: number;
}): IntegrityRule<C, S> {
  if (!spec || (spec.maxStep !== undefined && !nonNegative(spec.maxStep)) || !fn(spec.value, spec.previous))
    throw Error('integrity rule: invalid monotonic');
  const strict = spec.strict ?? true;
  return base(spec, (input, fail) => {
    const v = spec.value(input), previous = spec.previous(input);
    if (!finite(v)) return fail();
    if (previous === null) return OK;
    if (!finite(previous) || (strict ? v <= previous : v < previous)) return fail();
    return spec.maxStep === undefined || v - previous <= spec.maxStep ? OK : fail();
  });
}

/**
 * Requires at least `cooldownTicks` between the authoritative last use (`lastTick`, null when never used) and the
 * command's tick (`tick`, default the input tick). A missing current tick is a violation.
 */
export function cooldown<C, S>(spec: IntegrityRuleBase & {
  readonly lastTick: Select<C, S, number | null>; readonly cooldownTicks: number;
  readonly tick?: Select<C, S, number | null>;
}): IntegrityRule<C, S> {
  if (!spec || !nonNegative(spec.cooldownTicks) || !fn(spec.lastTick) || (spec.tick !== undefined && !fn(spec.tick)))
    throw Error('integrity rule: invalid cooldown');
  return base(spec, (input, fail) => {
    const last = spec.lastTick(input);
    if (last === null) return OK;
    const now = spec.tick ? spec.tick(input) : input.tick;
    return finite(last) && finite(now) && now - last >= spec.cooldownTicks ? OK : fail();
  });
}

/**
 * Accepts a client-claimed tick only within a band around the host's tick: `host - maxBehindTicks <= claimed <=
 * host + maxAheadTicks` (`hostTick` defaults to the input tick). A claim **ahead** of the band is a violation scored
 * with `weight`. A claim **behind** it is still invalid (consume it as a no-op) but scores `behindWeight` (default 0):
 * stale input after a stall, reconnect or jitter is normal for honest clients and must not close them. This bounds
 * latency compensation; the rewind itself is creator code.
 */
export function claimedTickInBand<C, S>(spec: IntegrityRuleBase & {
  readonly claimed: Select<C, S, unknown>; readonly hostTick?: Select<C, S, number | null>;
  readonly maxBehindTicks: number; readonly maxAheadTicks: number; readonly behindWeight?: number;
}): IntegrityRule<C, S> {
  const behindWeight = spec?.behindWeight ?? 0;
  if (!spec || !nonNegative(spec.maxBehindTicks, spec.maxAheadTicks) || !fn(spec.claimed) || !weightOk(behindWeight)
    || (spec.hostTick !== undefined && !fn(spec.hostTick))) throw Error('integrity rule: invalid band');
  return base(spec, (input, fail) => {
    const claimed = spec.claimed(input), host = spec.hostTick ? spec.hostTick(input) : input.tick;
    if (!finite(claimed) || !finite(host)) return fail();
    if (claimed > host + spec.maxAheadTicks) return fail({ claimed, host });
    if (claimed < host - spec.maxBehindTicks) {
      const evidence = { claimed, host, behind: true };
      return spec.violation === 'flag' ? integrityFlag(spec.id, behindWeight, evidence) : integrityReject(spec.id, behindWeight, evidence);
    }
    return OK;
  });
}

/** Generic rule helpers, grouped so their short names do not crowd the kit namespace. */
export const integrityRules = Object.freeze({ maxRateOfChange, valueInRange, valueInSet, monotonic, cooldown, claimedTickInBand });
