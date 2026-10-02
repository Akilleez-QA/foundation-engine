/**
 * Test double: the small subset of the IndexedDB API that `chunk-port.ts` uses, with its asynchronous shape.
 *
 * Transactions on one database run one at a time in creation order (stricter than IndexedDB, which lets read-only
 * transactions overlap, but equivalent for overlapping readwrite scopes). A transaction sees the committed state at
 * the moment it starts, its requests settle in later macrotasks, it commits only after its last request settled with
 * nothing new queued, and an abort or failed request discards every staged change. Values are structured-cloned.
 * It is not a conformance implementation: no indexes, key ranges, durability, or upgrades beyond creation.
 */
type Store = Map<IDBValidKey, unknown> & { auto?: number; autoIncrement?: boolean };
const later = (fn: () => void) => setTimeout(fn, 0);
const domError = (name: string, message = name) => Object.assign(new Error(message), { name });

export interface FakeIdbControls {
  /** Make a put/add fail with QuotaExceededError (aborting its transaction). */
  quotaOnPut: (store: string, key: IDBValidKey | undefined) => boolean;
  /** Make the next `open` fail (e.g. a private mode refusing IndexedDB). */
  failOpen: boolean;
  /** Make the next `open` fail with VersionError (a newer build created the database). */
  newerVersionOnOpen: boolean;
  /** Committed contents, for assertions and corruption injection. */
  readonly databases: Map<string, Map<string, Store>>;
  /** Fire `versionchange` at every open connection (another tab upgrading). */
  versionChange(): void;
  commits: number;
  /** Highest number of transactions that were started and not finished at the same time (must stay 1). */
  maxConcurrent: number;
}

class FakeRequest<T> {
  result!: T; error: Error | null = null;
  onsuccess: (() => void) | null = null; onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null; onblocked: (() => void) | null = null;
}

export function createFakeIdb(): { factory: IDBFactory; controls: FakeIdbControls } {
  const databases = new Map<string, Map<string, Store>>();
  const queues = new Map<string, { run(): void; done: boolean }[]>();
  const connections = new Set<{ onversionchange: (() => void) | null; name: string }>();
  let running = 0;
  const controls: FakeIdbControls = {
    quotaOnPut: () => false, failOpen: false, newerVersionOnOpen: false, databases, commits: 0, maxConcurrent: 0,
    versionChange() { for (const c of [...connections]) c.onversionchange?.(); },
  };
  const pump = (name: string) => {
    const q = queues.get(name)!;
    while (q.length && q[0]!.done) q.shift();
    const head = q[0] as ({ run(): void; done: boolean; started?: boolean }) | undefined;
    if (head && !head.started) { head.started = true; head.run(); }
  };

  function connect(name: string) {
    const stores = databases.get(name)!;
    let closed = false;
    const db = {
      name,
      onversionchange: null as (() => void) | null,
      objectStoreNames: { contains: (s: string) => stores.has(s) },
      createObjectStore(s: string, options?: { autoIncrement?: boolean }) { const m: Store = new Map(); m.autoIncrement = !!options?.autoIncrement; m.auto = 0; stores.set(s, m); return {}; },
      close() { closed = true; connections.delete(db); },
      transaction(names: string[], mode: IDBTransactionMode) {
        if (closed) throw domError('InvalidStateError', 'connection is closing');
        for (const n of names) if (!stores.has(n)) throw domError('NotFoundError');
        const staged = new Map<string, Store>();
        const buffered: (() => void)[] = [];
        let open = 0, started = false, finished = false;
        const entry = { done: false, run: () => {
          started = true; running++; controls.maxConcurrent = Math.max(controls.maxConcurrent, running);
          // snapshot at start, after every earlier transaction committed
          for (const n of names) { const src = stores.get(n)!, copy: Store = new Map(src); copy.auto = src.auto; copy.autoIncrement = src.autoIncrement; staged.set(n, copy); }
          for (const op of buffered.splice(0)) op();
          if (open === 0) settleSoon();
        } };
        const finish = () => { entry.done = true; if (started) running--; later(() => pump(name)); };
        const settleSoon = () => later(() => {
          if (finished || open > 0) return;
          finished = true;
          if (mode === 'readwrite') { for (const [k, v] of staged) stores.set(k, v); controls.commits++; }
          finish(); t.oncomplete?.();
        });
        const fail = (e: Error) => { finished = true; t.error = e; finish(); later(() => { t.onerror?.(); t.onabort?.(); }); };
        const t = {
          error: null as Error | null,
          oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null,
          abort() { if (finished) return; finished = true; finish(); later(() => t.onabort?.()); },
          objectStore(n: string) {
            if (!names.includes(n)) throw domError('NotFoundError');
            const request = <T>(op: (store: Store) => T, write = false): FakeRequest<T> => {
              if (finished) throw domError('TransactionInactiveError');
              if (write && mode !== 'readwrite') throw domError('ReadOnlyError');
              const r = new FakeRequest<T>(); open++;
              const exec = () => later(() => {
                if (finished) return;
                open--;
                try { r.result = op(staged.get(n)!); r.onsuccess?.(); }
                catch (e) { r.error = e as Error; r.onerror?.(); fail(e as Error); return; }
                if (open === 0) settleSoon();
              });
              if (started) exec(); else buffered.push(exec);
              return r;
            };
            const put = (store: Store, value: unknown, key?: IDBValidKey) => {
              const k = key ?? (store.autoIncrement ? ++store.auto! : undefined);
              if (k === undefined) throw domError('DataError');
              if (controls.quotaOnPut(n, k)) throw domError('QuotaExceededError');
              store.set(k, structuredClone(value)); return k;
            };
            return {
              get: (k: IDBValidKey) => request(s => structuredClone(s.get(k))),
              put: (v: unknown, k?: IDBValidKey) => request(s => put(s, v, k), true),
              add: (v: unknown, k?: IDBValidKey) => request(s => put(s, v, k), true),
              delete: (k: IDBValidKey) => request(s => { s.delete(k); return undefined; }, true),
              clear: () => request(s => { s.clear(); return undefined; }, true),
              count: () => request(s => s.size),
              openCursor() {
                let entries: [IDBValidKey, unknown][] = [], i = 0;
                const r = request(s => { entries = [...s].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); return at(0); });
                function at(position: number): unknown {
                  i = position;
                  if (i >= entries.length) return null;
                  return { key: entries[i]![0], value: structuredClone(entries[i]![1]), continue() {
                    open++;
                    later(() => { if (finished) return; open--; r.result = at(i + 1); r.onsuccess?.(); if (open === 0) settleSoon(); });
                  } };
                }
                return r;
              },
            };
          },
        };
        queues.get(name)!.push(entry);
        later(() => pump(name));
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
        if (controls.newerVersionOnOpen) { controls.newerVersionOnOpen = false; r.error = domError('VersionError', 'requested version is less than the existing version'); r.onerror?.(); return; }
        const fresh = !databases.has(name);
        if (fresh) { databases.set(name, new Map()); queues.set(name, []); }
        r.result = connect(name);
        if (fresh && version >= 1) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
    deleteDatabase(name: string) {
      const r = new FakeRequest<unknown>();
      later(() => {
        if ([...connections].some(c => c.name === name)) { r.onblocked?.(); return; }
        databases.delete(name); queues.delete(name); r.onsuccess?.();
      });
      return r;
    },
    async databases() { return [...databases.keys()].map(name => ({ name, version: 1 })); },
  };
  return { factory: factory as unknown as IDBFactory, controls };
}
