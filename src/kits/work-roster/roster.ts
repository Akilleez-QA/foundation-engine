/** Logical storage ceilings, not native heap or CPU bounds. */
export const WORK_ROSTER_MAX_ENTRIES = 65536;
export const WORK_ROSTER_MAX_ID_LENGTH = 256;

/** Only the exact returned object has authority; this shape cannot manufacture membership. */
export interface WorkTicket {
  readonly id: string;
}
export type WorkAdmission =
  {readonly status: 'accepted'; readonly ticket: WorkTicket} | {readonly status: 'duplicate' | 'full' | 'closed'};
export type WorkVisits =
  {readonly status: 'ready'; readonly tickets: readonly WorkTicket[]} | {readonly status: 'closed'};
export interface WorkRoster {
  readonly size: number;
  add(id: string): WorkAdmission;
  check(ticket: unknown): ticket is WorkTicket;
  remove(ticket: unknown): boolean;
  take(maxVisits: number): WorkVisits;
  dispose(): void;
}

/** No callbacks, payloads, clock, persistence or entity ownership. */
export function createWorkRoster(options: {maxEntries: number; maxIdLength: number}): WorkRoster {
  const maxEntries = options.maxEntries,
    maxIdLength = options.maxIdLength;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > WORK_ROSTER_MAX_ENTRIES ||
    !Number.isSafeInteger(maxIdLength) ||
    maxIdLength < 1 ||
    maxIdLength > WORK_ROSTER_MAX_ID_LENGTH
  )
    throw new RangeError('work-roster: invalid limits');
  const rows = new Map<string, WorkTicket>();
  // Strong keys are live tickets only. Lookup never reads a supplied handle, including revoked proxies.
  const members = new Map<unknown, string>();
  let closed = false;
  return Object.freeze({
    get size() {
      return rows.size;
    },
    add(id: string): WorkAdmission {
      if (typeof id !== 'string' || !id.length || id.length > maxIdLength)
        throw new TypeError('work-roster: invalid id');
      if (closed) return {status: 'closed'};
      if (rows.has(id)) return {status: 'duplicate'};
      if (rows.size >= maxEntries) return {status: 'full'};
      const ticket = Object.freeze({id});
      rows.set(id, ticket);
      members.set(ticket, id);
      return {status: 'accepted', ticket};
    },
    check(ticket: unknown): ticket is WorkTicket {
      return members.has(ticket);
    },
    remove(ticket: unknown): boolean {
      const id = members.get(ticket);
      if (id === undefined) return false;
      members.delete(ticket);
      rows.delete(id);
      return true;
    },
    take(maxVisits: number): WorkVisits {
      if (!Number.isSafeInteger(maxVisits) || maxVisits < 0) throw new RangeError('work-roster: invalid visit count');
      if (closed) return {status: 'closed'};
      const count = Math.min(maxVisits, rows.size);
      const tickets: WorkTicket[] = [];
      for (let i = 0; i < count; i++) {
        const ticket = rows.values().next().value!;
        tickets.push(ticket);
        rows.delete(ticket.id);
        rows.set(ticket.id, ticket);
      }
      return {status: 'ready', tickets: Object.freeze(tickets)};
    },
    dispose(): void {
      closed = true;
      rows.clear();
      members.clear();
    },
  });
}
