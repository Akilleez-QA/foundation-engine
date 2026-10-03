/**
 * core/save/section.ts: the SaveSection contract and the SaveStore interface (ADR 0007, STANDARD chapter 8).
 * Everything beyond the core fields is optional, so a minimal section compiles.
 */
export type SaveScope = 'player' | 'profile' | 'device';
export type PlayerId = string;

/** How a section reaches data written before the save store existed. */
export interface LegacyBinding {
  /** Keys for one owner: the player id for player scope, '' otherwise. Order matters to `decode`. */
  keys(player: PlayerId): string[];
  /** Raw strings (null when absent) to data in the shape of `fromVersion`. Throw when unreadable. */
  decode(raws: (string | null)[]): unknown;
  /** The section version the decoded data corresponds to. Migrations run from here. */
  fromVersion: number;
  /**
   * 'import' (default): read once when the section has no envelope yet; legacy keys are never modified.
   * 'live': the legacy key IS the storage (before a section moves to an envelope).
   */
  mode?: 'import' | 'live';
  /**
   * Needed for 'live' and for mirroring: the value back to raw strings (null removes the key). In 'import' mode,
   * undefined leaves that key exactly as it is: a key the section reads but never writes .
   */
  encode?(value: unknown): (string | null | undefined)[];
  /** Dual-write the legacy keys for one or two releases, so unmigrated readers and a rollback keep working. */
  mirror?: boolean | undefined;
  /** The legacy value lives in sessionStorage. */
  session?: boolean | undefined;
  /**
   * Hash each key separately (import mode, with a union `merge`, never mirrored): when one legacy key changes, `decode`
   * sees only that key's raw (the others as null) and the result is merged in. A reader of many independent records
   * then re-imports only the record that changed.
   */
  perKey?: boolean;
}

/**
 * One migration step: version-n data to n+1. Method syntax makes the parameter bivariant, so an author's typed step
 * (`(old: { n: number }) => …`) is accepted while the store calls it with the untyped previous step's output.
 */
export type Migration = { step(old: unknown): unknown }['step'];

export interface SaveSection<T> {
  // ---- core fields
  id: string;
  scope: SaveScope;
  version: number;
  initial(): T;
  parse(raw: unknown): T;
  /** Typed per step by the author (`(old: V1) => V2`); the store calls each with the previous step's output. */
  migrations?: Record<number, Migration>;
  /** Shorthand for `legacy: {keys: () => legacyKeys, fromVersion: 1, decode: raws => JSON.parse(first non-null raw)}`. */
  legacyKeys?: string[];
  /** Default true for player and profile scope, false for device scope. Only player sections are exported today. */
  export?: boolean;
  // ---- extensions
  legacy?: LegacyBinding;
  /** Union for progress (never loses earned things). Used for multi-tab conflicts and for import. */
  merge?(stored: T, incoming: T): T;
  /** Import semantics; default 'merge' when `merge` exists, otherwise 'replace'. */
  importMode?: 'merge' | 'replace';
  /** Old section ids that still load into this section (ids are never renamed; aliases carry renames). */
  aliases?: string[];
  /** 'session' keeps it in sessionStorage (per-tab state). Default 'local'. */
  storage?: 'local' | 'session';
  /** Refuse writes above this many UTF-16 chars. Default 256 k. */
  maxChars?: number;
  /** Regenerable cache (thumbnails): excluded from export and from the size warning. */
  cache?: boolean;
  /** 'eager' (default) debounced autosave; 'lazy' only on flush points (pagehide, leave, player switch). */
  flush?: 'eager' | 'lazy';
}

export type SectionStatus =
  | 'saved'        // storage matches memory
  | 'dirty'        // a write is scheduled
  | 'session'      // the last write failed: kept in this tab, retried at every flush
  | 'unavailable'  // storage could not be read: never written over until a read succeeds
  | 'quarantined'  // stored data was unreadable: a copy is in the quarantine and play continues from `initial()`
  | 'newer';       // written by a newer build: read-only here, never overwritten

/** Handles share their store lifetime; operations throw after the store is disposed. */
export interface SectionHandle<T> {
  get(): Readonly<T>;
  /** Mutate a draft (a structured clone) or return a replacement. Marks dirty; autosave is debounced.
   * Both update and replace retain the target player selected before callbacks run. Reset/disposal during
   * those callbacks rejects the write rather than reviving the retired cell. */
  update(fn: (draft: T) => T | void, opts?: { now?: boolean }): SectionStatus;
  replace(value: T, opts?: { now?: boolean }): SectionStatus;
  subscribe(fn: (value: Readonly<T>) => void): () => void;
  status(): SectionStatus;
  /** The same section for another player (player scope only). */
  of(player: PlayerId): SectionHandle<T>;
}

export interface QuarantineEntry { key: string; from: string; reason: string }
export interface FlushReport { written: string[]; failed: string[]; skipped: string[] }
export interface ImportReport {
  format: 'engine-profile@2' | 'legacy';
  /** Known sections: `saved` (written), `session` (held in memory; storage refused), `skipped-newer` (a later version).
   * Orphans (ids this build does not own): `orphan-kept` only after a successful write or exact stored-byte match;
   * `orphan-conflict` preserves different existing bytes; `orphan-failed` means storage access threw;
   * `orphan-superseded` is an alias id of a section the same file supplies (a pre-rename copy), not written. */
  sections: Record<string, 'saved' | 'session' | 'skipped-newer' | 'orphan-kept' | 'orphan-conflict' | 'orphan-failed' | 'orphan-superseded'>;
}
export interface ProfileFileV2 {
  format: 'engine-profile';
  version: 2;
  exportedBy: string;
  player: { id: PlayerId; name?: string | undefined };
  sections: Record<string, { v: number; data: unknown }>;
  /** Sections this build does not know, or cannot read yet (newer): carried verbatim so nothing is lost. */
  orphans?: Record<string, unknown>;
  /** Unreadable data found on this device, for support. Never imported automatically. */
  quarantine?: Record<string, string>;
}

export interface SaveStore {
  // contract
  section<T>(def: SaveSection<T>): SectionHandle<T>;
  players(): PlayerId[];
  // extensions
  activePlayer(): PlayerId;
  setActivePlayer(id: PlayerId): void;
  addPlayer(name?: string): PlayerId;
  playerName(id: PlayerId): string | undefined;
  /** Writes every dirty section now (a flush point). Each section is its own physical envelope, written separately. */
  flush(reason?: string): FlushReport;
  /**
   * Runs `fn` and defers autosave scheduling until it returns, so the updates it makes land in the same flush.
   * This groups scheduling only. It is NOT cross-key atomicity: a crash, quota error or another tab can still leave
   * some of the touched keys new and others old, readers are not isolated, and nothing rolls back if `fn` throws
   * (ADR 0052, STD-SAV-16). State that must stay coherent belongs in one physical envelope.
   */
  batch(fn: () => void): void;
  exportPlayer(id?: PlayerId): ProfileFileV2;
  importPlayer(text: string, into?: PlayerId): ImportReport;
  resetAll(): { removed: number; failed: string[] };
  quarantine(): QuarantineEntry[];
  onPlayerChanged(fn: (id: PlayerId, previous: PlayerId) => void): () => void;
  /** Terminal and idempotent. Attempts one final flush without retrying failures, detaches subscriptions,
   * and suppresses notifications during that flush. Other operations/retained handles throw afterward;
   * the store implementation's pure pending() diagnostic remains available. */
  dispose(): void;
}

export interface StoreUsage { chars: number; sections: Record<string, number> }

// The `player` event area belongs to the save store: `player.changed {id, previous}`.
declare module '../events' {
  interface EngineEvents {
    /** The active player changed. Emitted by the store's owner after the roster changed, never per frame. */
    'player.changed': { id: PlayerId; previous: PlayerId };
  }
}
