// core/save/prefixes.ts: every Web Storage key the save store writes starts with one of these prefixes, and "reset
// everything" clears exactly these (STD-SAV-10). A contract test fails when a storage key falls outside them.
export const DEFAULT_SAVE_NAMESPACE = 'game';
const NAMESPACE = /^[a-z][a-z0-9-]{0,31}$/;

export interface SavePrefixes {
  /** Section envelopes: `<ns>|p:<player>|<section>`, `<ns>|profile|…`, `<ns>|device|…`. */
  envelope: string;
  /** Unreadable raw bytes, never overwritten. */
  quarantine: string;
  /** One copy of a record before a migration rewrote it. */
  backup: string;
  /** Everything `resetAll` removes. */
  reset: readonly string[];
}

/** The prefixes of one store namespace, plus any legacy prefixes the game still reads. */
export function savePrefixes(namespace: string = DEFAULT_SAVE_NAMESPACE, legacy: readonly string[] = []): SavePrefixes {
  if (!NAMESPACE.test(namespace)) throw Error(`save namespace '${namespace}' must be lower kebab-case, at most 32 characters`);
  return Object.freeze({
    envelope: namespace + '|', quarantine: namespace + '-q|', backup: namespace + '-bak|',
    reset: Object.freeze([namespace + '|', namespace + '-', ...legacy]),
  });
}

export const isSaveKey = (key: string, prefixes: SavePrefixes = savePrefixes()) => prefixes.reset.some(prefix => key.startsWith(prefix));
