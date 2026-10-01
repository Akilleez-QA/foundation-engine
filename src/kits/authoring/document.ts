/** Optional authoring data. Runtime entities, renderer objects and callbacks are never document values. */
export type DocumentValue = null | boolean | number | string | readonly DocumentValue[] | { readonly [key: string]: DocumentValue };
export interface DocumentLimits { maxBytes: number; maxNodes: number; maxDepth: number }
export interface EditTicket { readonly lifetime: symbol; readonly revision: number }
export interface DocumentSnapshot<T extends DocumentValue> {
  readonly id: string; readonly ticket: EditTicket; readonly value: T; readonly json: string; readonly bytes: number;
}
export type EditResult<T extends DocumentValue> =
  | { readonly status: 'accepted'; readonly snapshot: DocumentSnapshot<T> }
  | { readonly status: 'stale' | 'retired' | 'busy' | 'rejected' | 'exhausted' };

/** Validated data staged against an exact owner ticket; not a published revision. */
export interface PreparedDocument<T extends DocumentValue> {
  readonly ticket: EditTicket; readonly value: T; readonly json: string; readonly bytes: number;
}
export type PrepareResult<T extends DocumentValue> =
  | { readonly status: 'prepared'; readonly candidate: PreparedDocument<T> }
  | Exclude<EditResult<T>, { status: 'accepted' }>;
export interface AuthoredDocument<T extends DocumentValue> {
  read(): DocumentSnapshot<T>;
  prepare(ticket: EditTicket, propose: (value: T) => string | null): PrepareResult<T>;
  publish(candidate: PreparedDocument<T>): EditResult<T>;
  discard(candidate: PreparedDocument<T>): void;
  edit(ticket: EditTicket, propose: (value: T) => string | null): EditResult<T>;
  dispose(): void;
}

function decode(json: string, limits: DocumentLimits): { value: DocumentValue; bytes: number } {
  // Check UTF-16 length before allocating UTF-8 storage. Every UTF-16 code unit consumes at least one UTF-8 byte.
  if (typeof json !== 'string' || json.length > limits.maxBytes) throw Error('authoring: document byte limit');
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > limits.maxBytes) throw Error('authoring: document byte limit');
  const value: DocumentValue = JSON.parse(json);
  const pending: { value: DocumentValue; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++nodes > limits.maxNodes || entry.depth > limits.maxDepth) throw Error('authoring: document structure limit');
    if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) throw Error('authoring: nonfinite document number');
    if (entry.value && typeof entry.value === 'object') {
      const children = Object.values(entry.value);
      if (children.length > limits.maxNodes - nodes - pending.length) throw Error('authoring: document structure limit');
      for (const child of children) pending.push({ value: child, depth: entry.depth + 1 });
      Object.freeze(entry.value);
    }
  }
  return { value, bytes };
}

/** Synchronous, bounded retained data; creator callbacks are not sandboxed or CPU-budgeted. */
export function createAuthoredDocument<T extends DocumentValue>(options: {
  id: string; json: string; limits: DocumentLimits; validate(value: DocumentValue): value is T;
}): AuthoredDocument<T> {
  if (typeof options.id !== 'string' || !options.id || options.id.length > 256) throw Error('authoring: invalid document id');
  const id = options.id, limits = { ...options.limits }, validate = options.validate, initialJson = options.json;
  if (![limits.maxBytes, limits.maxNodes, limits.maxDepth].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('authoring: invalid document limits');
  const initial = decode(initialJson, limits);
  if (validate(initial.value) !== true) throw Error('authoring: rejected initial document');
  const lifetime = Symbol('authored-document');
  let retired = false, busy = false;
  const snapshot = (value: T, json: string, bytes: number, revision: number): DocumentSnapshot<T> =>
    Object.freeze({ id, value, json, bytes, ticket: Object.freeze({ lifetime, revision }) });
  let current = snapshot(initial.value, initialJson, initial.bytes, 0);
  const candidates = new WeakSet<PreparedDocument<T>>();
  const prepare = (ticket: EditTicket, propose: (value: T) => string | null): PrepareResult<T> => {
    if (retired) return { status: 'retired' };
    if (ticket !== current.ticket) return { status: 'stale' };
    if (busy) return { status: 'busy' };
    if (current.ticket.revision === Number.MAX_SAFE_INTEGER) return { status: 'exhausted' };
    busy = true;
    try {
      const json = propose(current.value);
      if (retired) return { status: 'retired' };
      if (json === null) return { status: 'rejected' };
      const decoded = decode(json, limits);
      const valid = validate(decoded.value);
      if (retired) return { status: 'retired' };
      if (valid !== true) return { status: 'rejected' };
      const candidate = Object.freeze({ ticket, value: decoded.value as T, json, bytes: decoded.bytes });
      candidates.add(candidate);
      return { status: 'prepared', candidate };
    } finally { busy = false; }
  };
  const publish = (candidate: PreparedDocument<T>): EditResult<T> => {
    if (retired) return { status: 'retired' };
    if (busy) return { status: 'busy' };
    // Membership precedes caller property access, including proxies and fabricated values.
    if (!candidates.has(candidate) || candidate.ticket !== current.ticket) return { status: 'stale' };
    if (current.ticket.revision === Number.MAX_SAFE_INTEGER) return { status: 'exhausted' };
    current = snapshot(candidate.value, candidate.json, candidate.bytes, current.ticket.revision + 1);
    candidates.delete(candidate);
    return { status: 'accepted', snapshot: current };
  };
  return Object.freeze({
    read: (): DocumentSnapshot<T> => current,
    prepare, publish,
    discard(candidate: PreparedDocument<T>): void { candidates.delete(candidate); },
    edit(ticket: EditTicket, propose: (value: T) => string | null): EditResult<T> {
      const prepared = prepare(ticket, propose);
      return prepared.status === 'prepared' ? publish(prepared.candidate) : prepared;
    },
    dispose(): void { retired = true; },
  });
}

/** Optional creator reference convention. Creators own uniqueness, incarnation allocation and persistence. */
export function authoredReference(document: string, id: string, incarnation: number) {
  if (![document, id].every(s => typeof s === 'string' && s.length > 0 && s.length <= 256)
    || !Number.isSafeInteger(incarnation) || incarnation < 0) throw Error('authoring: invalid authored reference');
  return Object.freeze({ document, id, incarnation });
}
