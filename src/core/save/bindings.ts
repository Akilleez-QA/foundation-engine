/**
 * core/save/bindings.ts: legacy bindings over one old key, in `import` mode (ADR 0007).
 *
 * The old key is read once, when the section has no envelope yet, and is never reformatted: with `mirror` the store
 * writes it back only when the value it holds has really changed, and never over bytes that do not decode (they are
 * their own quarantine). Mirroring keeps a rollback, and code that still reads the old key, up to date.
 */
import type {LegacyBinding, PlayerId} from './section';

export interface ImportOptions {
  /** Dual-write the old key while anything still reads it (turn it off once nothing reads the old key). */
  mirror?: boolean;
  /** The old key lives in sessionStorage. */
  session?: boolean;
}

/** A JSON value in one old key. A missing key is null; text that is not JSON throws (the store quarantines it). */
export function importJson(key: (player: PlayerId) => string, o: ImportOptions = {}): LegacyBinding {
  return {
    mode: 'import',
    keys: p => [key(p)],
    fromVersion: 1,
    mirror: o.mirror,
    session: o.session,
    decode: ([raw]) => (raw === null ? null : JSON.parse(raw!)), // one raw per key, and keys() has one
    encode: v => [v === null || v === undefined ? null : JSON.stringify(v)],
  };
}

/** Text kept exactly as stored (a flag such as 'ready' or '1', a number string). A missing key is null. */
export function importRaw(key: (player: PlayerId) => string, o: ImportOptions = {}): LegacyBinding {
  return {
    mode: 'import',
    keys: p => [key(p)],
    fromVersion: 1,
    mirror: o.mirror,
    session: o.session,
    decode: ([raw]) => raw,
    encode: v => [typeof v === 'string' ? v : null],
  };
}
