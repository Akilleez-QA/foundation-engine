/** Observed state of the existing scene model owner; querying never requests or retries assets. */
export interface ModelState {
  readonly status: 'absent' | 'loading' | 'ready' | 'failed';
  readonly requestedAsset: string | null;
  readonly adoptedAsset: string | null;
}
