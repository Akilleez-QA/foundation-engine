/** Detached plain-JSON resource observation; failures must never look like empty or null state. */
export function captureResourceState(value: unknown): Record<string, unknown> {
  try {
    const json = JSON.stringify(value ?? {}, (_key, entry: unknown) => {
      if (typeof entry === 'number' && !Number.isFinite(entry)) throw Error('nonfinite number');
      return entry;
    });
    return JSON.parse(json) as Record<string, unknown>;
  } catch (cause) {
    throw new Error('RESOURCE_CAPTURE_FAILED: resource observation is not valid JSON', {cause});
  }
}
