/** Conservative shared admission. Counts declared ownership, not cache-deduplicated residency. */
export interface DependencyReservation {
  release(): void;
}
export interface DependencyBudget {
  reserve(bytes: number): DependencyReservation;
  readonly stats: {readonly maxBytes: number; readonly reservedBytes: number; readonly owners: number};
}
/** Saturation rejects synchronously; callers decide when to retry after an owner leaves. */
export function createDependencyBudget(maxBytes: number): DependencyBudget {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Error('dependency budget: invalid limit');
  let reservedBytes = 0,
    owners = 0;
  return Object.freeze({
    reserve(bytes: number): DependencyReservation {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error('dependency budget: invalid reservation');
      if (bytes > maxBytes - reservedBytes || owners === Number.MAX_SAFE_INTEGER)
        throw Error('dependency budget: admission exceeded');
      reservedBytes += bytes;
      owners++;
      let released = false;
      return Object.freeze({
        release() {
          if (released) return;
          released = true;
          reservedBytes -= bytes;
          owners--;
        },
      });
    },
    get stats() {
      return Object.freeze({maxBytes, reservedBytes, owners});
    },
  });
}
