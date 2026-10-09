/**
 * The MP-01 shared-session wire contract (text JSON, `v: 1`). Shared by `createSessionHost` and `createSession`.
 *
 * Client to host: `join {rules, version, token, player}`, `action {seq, action}`, `ack {session, sequence}`, `ping`.
 * Optional host `refreshOnPing` dirties the existing view on ping; only host pump publishes it.
 * No extra frame or negotiated capability is added; client deadlines require paired setup.
 * Host to client: `welcome {player, session}`, then complete scoped views (`view` / `view-unavailable`, NW-02) whose
 * reserved entity `@you` carries `{player, processed}`: the last action sequence of this connection the host applied
 * (or consumed as a rejection) in that same projection, the coherent prediction baseline.
 */
import {DEFAULT_TERMINAL_CLOSE_CODES, DEFAULT_TERMINAL_CLOSE_REASONS} from './close-policy';
import {INTEGRITY_CLOSE_REASON} from './integrity';
import type {SessionLimits} from './session-rules';
import type {ViewLimits} from './view-types';

export const SESSION_PROTOCOL_VERSION = 1;
/** Reserved view entity carrying this connection's player id and processed action sequence. */
export const SESSION_SELF_ENTITY = '@you';
/** Close reasons a fresh attempt would repeat: clients stop reconnecting on these (with the defaults). */
export const SESSION_TERMINAL_REASONS: readonly string[] = Object.freeze([
  ...DEFAULT_TERMINAL_CLOSE_REASONS,
  INTEGRITY_CLOSE_REASON,
  'rules-mismatch',
  'replaced',
]);
export const SESSION_TERMINAL_CODES: readonly number[] = DEFAULT_TERMINAL_CLOSE_CODES;
/** Close codes the reference host uses: policy refusal, capacity, going away. */
export const SESSION_CLOSE_CODES = Object.freeze({policy: 1008, capacity: 1013, away: 1001});
/** A client-chosen per-page key that lets a reconnect keep its player slot. Not an account or a secret worth keeping. */
export const SESSION_PLAYER_KEY = /^[A-Za-z0-9_-]{16,64}$/;

export const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
export const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

/** Random URL-safe characters from the platform CSPRNG (browser and Node 22 both provide `crypto.getRandomValues`). */
export function randomKey(bytes = 24): string {
  const data = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(data);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (const byte of data) out += alphabet[byte & 63];
  return out;
}

/** Compares two strings without an early exit on the first differing character. */
export function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

/** Complete-view bounds for a session: the world bounds plus the view envelope and the reserved `@you` entity. */
export function sessionViewLimits(limits: SessionLimits): ViewLimits {
  return Object.freeze({
    maxBytes: limits.world.maxBytes + 2048,
    maxNodes: limits.world.maxNodes + 4 * (limits.maxEntities + 1) + 16,
    maxDepth: limits.world.maxDepth + 3,
    maxEntities: limits.maxEntities + 1,
    maxIdentityLength: 64,
  });
}
