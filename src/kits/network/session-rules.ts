/**
 * Optional creator-owned shared-session rules (MP-01). One pure definition that a game scene and a reference host
 * both import: the host applies it authoritatively, the client predicts with it. Owns no socket, clock, timer,
 * random source or ECS state. See docs/guides/multiplayer-session.md.
 */
import type {DocumentValue} from '../authoring/document';
import {captureJson, captureJsonLimits, type JsonLimits} from './captured-json';
import type {IntegrityRule} from './integrity';

/** A shared world: entity id to creator JSON fields. Ids starting with `@` are reserved for the session protocol. */
export type SessionWorld = Readonly<Record<string, DocumentValue>>;
/** What an integrity rule sees on the host: the authoritative world, the acting player and that player's last applied tick. */
export interface SessionIntegrityState {
  readonly world: SessionWorld;
  readonly player: string;
  /** Host tick of this player's previous applied action, or null. */
  readonly lastActionTick: number | null;
}
export interface SessionLimits {
  /** Bounds of the whole world JSON (and of each disclosed projection). */
  readonly world: JsonLimits;
  /** Bounds of one action JSON. */
  readonly action: JsonLimits;
  /** Entities in one world (the protocol adds one reserved entity per view). */
  readonly maxEntities: number;
}
export interface SessionRulesInput<A extends DocumentValue = DocumentValue> {
  /** Token shared by host and client; a mismatch is refused before joining. */
  readonly id: string;
  /** Bump when the rules change; host and client must agree. Positive safe integer. */
  readonly version: number;
  /** Players in one session, 1-16. */
  readonly maxPlayers: number;
  readonly initial: () => SessionWorld;
  /** A player arrives (ids are host-assigned: `p1`, `p2`, ...). Pure. */
  readonly join: (world: SessionWorld, player: string) => SessionWorld;
  /** A player left and did not return within the host's grace period. Pure. */
  readonly leave: (world: SessionWorld, player: string) => SessionWorld;
  /** Schema check for one action. Runs on host and client before `apply`. */
  readonly action: (value: DocumentValue) => value is A;
  /** The rule: pure, deterministic, no clock or random. Return the world unchanged to ignore an action. */
  readonly apply: (world: SessionWorld, player: string, action: A) => SessionWorld;
  /** What one player may see. Default: everything. Prediction runs on this projection. */
  readonly disclose?: (world: SessionWorld, player: string) => SessionWorld;
  /** Optional host-side plausibility rules (SEC-01); observe-only unless the host enforces them. */
  readonly integrity?: readonly IntegrityRule<A, SessionIntegrityState>[];
  readonly limits?: Partial<SessionLimits>;
}
export interface SessionRules<A extends DocumentValue = DocumentValue> extends Required<
  Omit<SessionRulesInput<A>, 'limits' | 'disclose' | 'integrity'>
> {
  readonly kind: 'session-rules';
  readonly disclose: ((world: SessionWorld, player: string) => SessionWorld) | null;
  readonly integrity: readonly IntegrityRule<A, SessionIntegrityState>[];
  readonly limits: SessionLimits;
}

export const DEFAULT_SESSION_LIMITS: SessionLimits = Object.freeze({
  world: Object.freeze({maxBytes: 16384, maxNodes: 1024, maxDepth: 6}),
  action: Object.freeze({maxBytes: 512, maxNodes: 32, maxDepth: 4}),
  maxEntities: 48,
});
export const MAX_SESSION_PLAYERS = 16;
/** Wire-safe token: 1-64 of `A-Z a-z 0-9 . _ : -`, starting with a letter or digit. */
export const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ENTITY_ID = /^[A-Za-z0-9_][A-Za-z0-9._:-]{0,63}$/;

const fn = (value: unknown) => typeof value === 'function';
/** Define the shared rules once; import them from the scene and from the session file the host loads. */
export function defineSessionRules<A extends DocumentValue>(input: SessionRulesInput<A>): SessionRules<A> {
  if (!input || typeof input !== 'object') throw Error('session rules: invalid definition');
  const {id, version, maxPlayers} = input;
  if (typeof id !== 'string' || !SESSION_TOKEN.test(id)) throw Error('session rules: id must be a short token');
  if (!Number.isSafeInteger(version) || version < 1) throw Error('session rules: version must be a positive integer');
  if (!Number.isSafeInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > MAX_SESSION_PLAYERS)
    throw Error(`session rules: maxPlayers must be 1-${MAX_SESSION_PLAYERS}`);
  if (
    ![input.initial, input.join, input.leave, input.action, input.apply].every(fn) ||
    (input.disclose !== undefined && !fn(input.disclose))
  )
    throw Error('session rules: missing function');
  const integrity = input.integrity ?? [];
  if (!Array.isArray(integrity)) throw Error('session rules: integrity must be a list of rules');
  const supplied = input.limits ?? {};
  const maxEntities = supplied.maxEntities ?? DEFAULT_SESSION_LIMITS.maxEntities;
  if (!Number.isSafeInteger(maxEntities) || maxEntities < 1 || maxEntities > 1024)
    throw Error('session rules: invalid maxEntities');
  const limits: SessionLimits = Object.freeze({
    world: captureJsonLimits(supplied.world ?? DEFAULT_SESSION_LIMITS.world),
    action: captureJsonLimits(supplied.action ?? DEFAULT_SESSION_LIMITS.action),
    maxEntities,
  });
  const rules: SessionRules<A> = Object.freeze({
    kind: 'session-rules' as const,
    id,
    version,
    maxPlayers,
    initial: input.initial,
    join: input.join,
    leave: input.leave,
    action: input.action,
    apply: input.apply,
    disclose: input.disclose ?? null,
    integrity: Object.freeze([...integrity]),
    limits,
  });
  // Fail at definition time, not on the first join: the initial world must already be valid.
  checkWorld(rules, rules.initial());
  return rules;
}

/** A world value as the protocol accepts it: a plain object of valid entity ids, within count and JSON bounds. Returns canonical JSON. */
export function checkWorld(
  rules: {readonly limits: SessionLimits},
  world: unknown,
): Readonly<{world: SessionWorld; json: string}> {
  if (world === null || typeof world !== 'object' || Array.isArray(world)) throw Error('session world: not an object');
  const ids = Object.keys(world);
  if (ids.length > rules.limits.maxEntities) throw Error('session world: too many entities');
  for (const id of ids) if (!ENTITY_ID.test(id)) throw Error('session world: invalid entity id');
  const captured = captureJson(JSON.stringify(world), rules.limits.world);
  // Captured values are detached and recursively frozen: creator code cannot mutate the accepted world later.
  return Object.freeze({world: captured.value as SessionWorld, json: captured.json});
}

/** Runs a creator callback that must return a valid world; null when it throws or returns something invalid. */
export function safeWorld(
  rules: {readonly limits: SessionLimits},
  produce: () => SessionWorld,
): Readonly<{world: SessionWorld; json: string}> | null {
  try {
    return checkWorld(rules, produce());
  } catch {
    return null;
  }
}
