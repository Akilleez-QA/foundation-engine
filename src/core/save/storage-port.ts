/**
 * core/save/storage-port.ts: the only code in the engine that touches Web Storage.
 * Every read and write may throw (private windows, blocked site data, quota). Callers never assume otherwise.
 * `MemoryBackend` is the test double: several ports over one backend are several tabs.
 */
export type StorageKind = 'local' | 'session';

export interface StoragePort {
  readonly kind: StorageKind;
  get(key: string): string | null; // throws when storage is unavailable
  set(key: string, value: string): void; // throws on quota or blocked storage
  remove(key: string): void;
  keys(): string[];
  /** Cross-tab change feed (the window 'storage' event). Fires for writes made by OTHER tabs only. */
  subscribe?(fn: (key: string | null) => void): () => void;
}

/** Browser adapter. `storage` events only fire for localStorage in other tabs, which is what we want. */
export function browserPort(kind: StorageKind): StoragePort {
  const s = (): Storage => (kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage);
  return {
    kind,
    get: k => s().getItem(k),
    set: (k, v) => s().setItem(k, v),
    remove: k => s().removeItem(k),
    keys: () => {
      const st = s(),
        out: string[] = [];
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    },
    subscribe:
      kind === 'local' && typeof globalThis.addEventListener === 'function'
        ? fn => {
            const h = (e: Event) => fn((e as StorageEvent).key);
            globalThis.addEventListener('storage', h);
            return () => globalThis.removeEventListener('storage', h);
          }
        : undefined,
  };
}

/** One shared "disk" for tests. Several ports (tabs) over one backend reproduce multi-tab behaviour. */
export class MemoryBackend {
  readonly data = new Map<string, string>();
  /** Failure injection: return true to make the operation throw. */
  failGet: (key: string) => boolean = () => false;
  failSet: (key: string, value: string) => boolean = () => false;
  quotaChars = Infinity;
  writes = 0;
  private listeners = new Map<number, Set<(key: string | null) => void>>();
  used(): number {
    let n = 0;
    for (const [k, v] of this.data) n += k.length + v.length;
    return n;
  }
  port(tab = 0, kind: StorageKind = 'local'): StoragePort {
    return {
      kind,
      get: k => {
        if (this.failGet(k)) throw new Error('SecurityError: storage blocked');
        return this.data.get(k) ?? null;
      },
      set: (k, v) => {
        if (this.failSet(k, v)) throw new Error('QuotaExceededError');
        const next = this.used() - (this.data.has(k) ? k.length + this.data.get(k)!.length : 0) + k.length + v.length;
        if (next > this.quotaChars) throw new Error('QuotaExceededError');
        this.data.set(k, v);
        this.writes++;
        this.emit(tab, k);
      },
      remove: k => {
        this.data.delete(k);
        this.emit(tab, k);
      },
      keys: () => [...this.data.keys()],
      subscribe: fn => {
        let set = this.listeners.get(tab);
        if (!set) this.listeners.set(tab, (set = new Set()));
        set.add(fn);
        return () => set!.delete(fn);
      },
    };
  }
  private emit(fromTab: number, key: string) {
    for (const [tab, set] of this.listeners) if (tab !== fromTab) for (const fn of set) fn(key);
  }
}
