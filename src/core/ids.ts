/** Identity, never gameplay randomness. Preserve the browser UUID format used by existing saves. */
export const newId = (): string => crypto.randomUUID();
