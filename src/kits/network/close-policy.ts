/**
 * Optional classification of a validated remote close as a terminal refusal or a transient loss. Pure and
 * stateless after construction: it owns no socket, timer or retry state. The creator chooses which close reasons
 * and codes are terminal; a consumer stops automatic reconnects on `terminal` and may pace a retry on `transient`.
 * See docs/guides/network-retry.md.
 */
import {
  CLOSE_REASON_TOKEN,
  MAX_CLOSE_REASON_LENGTH,
  type BrowserRemoteClose,
} from '../../platform/network/browser-transport';

/** Credential refusals by the stock network intake: retrying the same credential cannot succeed. */
export const DEFAULT_TERMINAL_CLOSE_REASONS: readonly string[] = Object.freeze(['auth-rejected', 'revoked']);
/** RFC 6455 protocol error, unsupported data and invalid payload: a fresh connection would repeat the violation. */
export const DEFAULT_TERMINAL_CLOSE_CODES: readonly number[] = Object.freeze([1002, 1003, 1007]);
export const MAX_CLOSE_POLICY_ENTRIES = 32;

export interface ClosePolicyOptions {
  /** Close reason tokens treated as terminal. Omitted: `DEFAULT_TERMINAL_CLOSE_REASONS`; `[]`: none. */
  readonly terminalReasons?: readonly string[];
  /** Close codes (1000-4999) treated as terminal whatever the reason. Omitted: `DEFAULT_TERMINAL_CLOSE_CODES`; `[]`: none. */
  readonly terminalCodes?: readonly number[];
}
export type CloseClass = 'terminal' | 'transient';
export interface ClosePolicy {
  /** `terminal` when the code or reason is configured terminal; anything else, including no close record, is `transient`. */
  classify(remote: BrowserRemoteClose | null | undefined): CloseClass;
  read(): Readonly<{terminalReasons: readonly string[]; terminalCodes: readonly number[]}>;
}

function capture<T>(value: unknown, fallback: readonly T[], valid: (entry: unknown) => entry is T): readonly T[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length > MAX_CLOSE_POLICY_ENTRIES) throw Error('close policy: invalid list');
  const rows: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry: unknown = value[i];
    if (!valid(entry) || rows.includes(entry)) throw Error('close policy: invalid entry');
    rows.push(entry);
  }
  return Object.freeze(rows);
}
const reasonToken = (entry: unknown): entry is string =>
  typeof entry === 'string' && entry.length <= MAX_CLOSE_REASON_LENGTH && CLOSE_REASON_TOKEN.test(entry);
const closeCode = (entry: unknown): entry is number =>
  typeof entry === 'number' && Number.isInteger(entry) && entry >= 1000 && entry <= 4999;

export function createClosePolicy(options: ClosePolicyOptions = {}): ClosePolicy {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(key => key !== 'terminalReasons' && key !== 'terminalCodes')
  )
    throw Error('close policy: invalid options');
  const terminalReasons = capture(options.terminalReasons, DEFAULT_TERMINAL_CLOSE_REASONS, reasonToken);
  const terminalCodes = capture(options.terminalCodes, DEFAULT_TERMINAL_CLOSE_CODES, closeCode);
  const snapshot = Object.freeze({terminalReasons, terminalCodes});
  return Object.freeze({
    classify(remote: BrowserRemoteClose | null | undefined): CloseClass {
      if (!remote) return 'transient';
      const {code, reason} = remote;
      if (closeCode(code) && terminalCodes.includes(code)) return 'terminal';
      if (reasonToken(reason) && terminalReasons.includes(reason)) return 'terminal';
      return 'transient';
    },
    read: () => snapshot,
  });
}
