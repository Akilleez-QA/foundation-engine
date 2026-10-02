/**
 * Test double: the small subset of the IndexedDB API that `chunk-port.ts` uses, with its asynchronous shape.
 * Requests settle in later macrotasks; a transaction commits only after its last request settled and nothing new was
 * queued, and an abort discards every staged change. Values are structured-cloned on the way in and out.
 * It is not a conformance implementation: no indexes, key ranges, version upgrades beyond 0→1, or durability.
 */
type Store = Map<IDBValidKey, unknown> & { auto?: number; autoIncrement?: boolean };
const later = (fn: () => void) => setTimeout(fn, 0);
const domError = (name: string, message = name) => Object.assign(new Error(message), { name });

export interface FakeIdbControls {
  /** Make a put/add fail with QuotaExceededError (aborting its transaction). */
  quotaOnPut: (store: string, key: IDBValidKey | undefined) => boolean;
  /** Make the next `open` fail (e.g. a private mode refusing IndexedDB). */
  failOpen: boolean;
  /** Committed contents, for assertions and corruption injection. */
  readonly databases: Map<string, Map<string, Store>>;
  /** Fire `versionchange` at every open connection (another tab upgrading). */
  versionChange(): void;
  commits: number;
}

class FakeRequest<T> {
  result!: T; error: Error | null = null; readyState: 'pending' | 'done' = 'pending';
  onsuccess: (() => void) | null = null; onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null; onblocked: (() => void) | null = null;
}

export function createFakeIdb(): { factory: IDBFactory; controls: FakeIdbControls } {
  const databases = new Map<string, Map<string, Store>>();
  const connections = new Set<{ onversionchange: (() => void) | null }>();
  const controls: FakeIdbControls = {
    quotaOnPut: () => false, failOpen: false, databases, commits: 0,
    versionChange() { for (const c of [...connections]) c.onversionchange?.(); },
  };

  function connect(name: string) {
    const stores = databases.get(name)!;
    let closed = false;
    const db = {
      onversionchange: null as (() => void) | null,
      objectStoreNames: { contains: (s: string) => stores.has(s) },
      createObjectStore(s: string, options?: { autoIncrement?: boolean }) { const m: Store = new Map(); m.autoIncrement = !!options?.autoIncrement; m.auto = 0; stores.set(s, m); return {}; },
      close() { closed = true; connections.delete(db); },
      transaction(names: string[], mode: IDBTransactionMode) {
        if (closed) throw domError('InvalidStateError', 'connection is closing');
        for (const n of names) if (!stores.has(n)) throw domError('NotFoundError');
        // staged copies: committed only on success
        const staged = new Map<string, Store>();
        for (const n of names) { const src = stores.get(n)!, copy: Store = new Map(src); copy.auto = src.auto; copy.autoIncrement = src.autoIncrement; staged.set(n, copy); }
        let open = 0, finished = false;
        const t = {
          error: null as Error | null,
          oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null,
          abort() { if (finished) return; finished = true; later(() => t.onabort?.()); },
          objectStore(n: string) {
            const store = staged.get(n);
            if (!store) throw domError('NotFoundError');
            const request = <T>(op: () => T, write = false): FakeRequest<T> => {
              if (finished) throw domError('TransactionInactiveError');
              if (write && mode !== 'readwrite') throw domError('ReadOnlyError');
              const r = new FakeRequest<T>(); open++;
              later(() => {
                if (finished) return;
                try { r.result = op(); r.readyState = 'done'; r.onsuccess?.(); }
                catch (e) { r.error = e as Error; r.readyState = 'done'; t.error = e as Error; r.onerror?.(); finished = true; later(() => { t.onerror?.(); t.onabort?.(); }); return; }
                finally { open--; }
                if (open === 0) later(() => {
                  if (finished || open > 0) return;
                  finished = true;
                  if (mode === 'readwrite') { for (const [k, v] of staged) stores.set(k, v); controls.commits++; }
                  t.oncomplete?.();
                });
              });
              return r;
            };
            const put = (value: unknown, key?: IDBValidKey) => {
              const k = key ?? (store.autoIncrement ? ++store.auto! : undefined);
              if (k === undefined) throw domError('DataError');
              if (controls.quotaOnPut(n, k)) throw domError('QuotaExceededError');
              store.set(k, structuredClone(value)); return k;
            };
            return {
              get: (k: IDBValidKey) => request(() => structuredClone(store.get(k))),
              put: (v: unknown, k?: IDBValidKey) => request(() => put(v, k), true),
              add: (v: unknown, k?: IDBValidKey) => request(() => put(v, k), true),
              delete: (k: IDBValidKey) => request(() => { store.delete(k); return undefined; }, true),
              clear: () => request(() => { store.clear(); return undefined; }, true),
              count: () => request(() => store.size),
              openCursor() {
                const entries = [...store].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
                let i = 0;
                const r = request(() => cursorAt(0));
                function cursorAt(at: number) {
                  i = at;
                  if (i >= entries.length) return null;
                  return { key: entries[i]![0], value: structuredClone(entries[i]![1]), continue() { open++; later(() => { if (finished) return; try { r.result = cursorAt(i + 1) as never; r.onsuccess?.(); } finally { open--; } if (open === 0) later(() => { if (finished || open > 0) return; finished = true; t.oncomplete?.(); }); }); } };
                }
                return r;
              },
            };
          },
        };
        return t;
      },
    };
    connections.add(db);
    return db;
  }

  const factory = {
    open(name: string, version: number) {
      const r = new FakeRequest<unknown>();
      later(() => {
        if (controls.failOpen) { controls.failOpen = false; r.error = domError('InvalidStateError', 'blocked in this mode'); r.onerror?.(); return; }
        const fresh = !databases.has(name);
        if (fresh) databases.set(name, new Map());
        r.result = connect(name);
        if (fresh && version >= 1) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  return { factory: factory as unknown as IDBFactory, controls };
}
