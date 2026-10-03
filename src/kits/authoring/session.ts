import type {
  AuthoredDocument,
  DocumentValue,
  EditResult,
  EditTicket,
  PreparedDocument,
  PrepareResult,
} from './document.js';

export type SessionResult<T extends DocumentValue> = EditResult<T> | {readonly status: 'empty' | 'saturated'};
/** Optional single-writer draft/history controller. Publication covers document data only. */
export function createAuthoringSession<T extends DocumentValue>(
  document: AuthoredDocument<T>,
  options: {maxEntries: number; maxHistoryBytes: number},
) {
  const {maxEntries, maxHistoryBytes} = options;
  if (![maxEntries, maxHistoryBytes].every(n => Number.isSafeInteger(n) && n > 0))
    throw Error('authoring: invalid history limits');
  type Entry = {before: string; after: string; bytes: number};
  let head = document.read(),
    draft: PreparedDocument<T> | null = null;
  let entries: Entry[] = [],
    cursor = 0,
    bytes = 0,
    retired = false,
    busy = false;
  const clearDraft = () => {
    if (draft) document.discard(draft);
    draft = null;
  };
  const guard = (allowStale = false): {status: 'retired' | 'busy' | 'stale'} | null => {
    if (retired) return {status: 'retired'};
    if (busy) return {status: 'busy'};
    if (!allowStale && document.read().ticket !== head.ticket) return {status: 'stale'};
    return null;
  };
  const travel = (direction: -1 | 1): SessionResult<T> => {
    const blocked = guard();
    if (blocked) return blocked;
    const entry = entries[direction < 0 ? cursor - 1 : cursor];
    if (!entry) return {status: 'empty'};
    busy = true;
    try {
      const prepared = document.prepare(head.ticket, () => (direction < 0 ? entry.before : entry.after));
      if (retired) {
        if (prepared.status === 'prepared') document.discard(prepared.candidate);
        return {status: 'retired'};
      }
      if (prepared.status !== 'prepared') return prepared;
      const result = document.publish(prepared.candidate);
      if (result.status === 'accepted') {
        head = result.snapshot;
        cursor += direction;
        clearDraft();
      }
      return result;
    } finally {
      busy = false;
    }
  };
  return Object.freeze({
    preview(ticket: EditTicket, propose: (value: T) => string | null): PrepareResult<T> {
      const blocked = guard();
      if (blocked) return blocked;
      if (ticket !== head.ticket) return {status: 'stale'};
      busy = true;
      try {
        const prepared = document.prepare(ticket, propose);
        if (retired) {
          if (prepared.status === 'prepared') document.discard(prepared.candidate);
          return {status: 'retired'};
        }
        if (prepared.status === 'prepared') {
          clearDraft();
          draft = prepared.candidate;
        }
        return prepared;
      } finally {
        busy = false;
      }
    },
    readPreview(): PreparedDocument<T> | null {
      return retired || document.read().ticket !== head.ticket ? null : draft;
    },
    cancel(): {status: 'cancelled' | 'retired' | 'busy'} {
      const blocked = guard(true);
      if (blocked) return blocked as {status: 'retired' | 'busy'};
      clearDraft();
      return {status: 'cancelled'};
    },
    commit(): SessionResult<T> {
      const blocked = guard();
      if (blocked) return blocked;
      if (!draft) return {status: 'empty'};
      busy = true;
      try {
        // Plan retention before publication, including both serialized endpoints.
        if (draft.bytes > maxHistoryBytes - head.bytes) return {status: 'saturated'};
        const entry: Entry = {before: head.json, after: draft.json, bytes: head.bytes + draft.bytes};
        const next = entries.slice(0, cursor);
        let nextBytes = next.reduce((sum, e) => sum + e.bytes, 0);
        while (next.length && (next.length >= maxEntries || nextBytes > maxHistoryBytes - entry.bytes))
          nextBytes -= next.shift()!.bytes;
        next.push(entry);
        nextBytes += entry.bytes;
        const result = document.publish(draft);
        if (result.status === 'accepted') {
          head = result.snapshot;
          entries = next;
          cursor = next.length;
          bytes = nextBytes;
          draft = null;
        }
        return result;
      } finally {
        busy = false;
      }
    },
    undo: () => travel(-1),
    redo: () => travel(1),
    resetHistory(): {status: 'reset' | 'retired' | 'busy'} {
      const blocked = guard(true);
      if (blocked) return blocked as {status: 'retired' | 'busy'};
      head = document.read();
      clearDraft();
      entries = [];
      cursor = 0;
      bytes = 0;
      return {status: 'reset'};
    },
    dispose() {
      retired = true;
      clearDraft();
      entries = [];
      cursor = 0;
      bytes = 0;
    },
    stats() {
      return {
        entries: entries.length,
        cursor,
        bytes,
        pending: draft !== null,
        retired,
        stale: document.read().ticket !== head.ticket,
      };
    },
  });
}
