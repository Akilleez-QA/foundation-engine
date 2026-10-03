// src/testing/must.ts: test-only narrowing for values a test expects to exist (noUncheckedIndexedAccess).
/** The value, or a thrown Error naming what was missing. */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}
