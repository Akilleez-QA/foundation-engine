/** Test setup uses the storage port and codecs, never writes behind a live store's cache.
 * Reset permanently retires the old store; callers reload immediately after seeding. */
import type { SaveStore, SaveSection } from './section';
import { createSaveTestAdapter } from './test-adapter';
export function createTestReset(old: SaveStore, fresh: () => SaveStore, sections: readonly SaveSection<unknown>[], retire: () => void) {
 return (seed: readonly { section: string; value: unknown; player?: string }[]) => {
  retire();
  const result = old.resetAll();
  if (result.failed.length) throw new Error(`engine.reset failed: ${result.failed.join(', ')}`);
  const store = fresh();
  try {
   const api = createSaveTestAdapter(store, sections);
   for (const row of seed) {
    const status = api.seed(row.section, row.value, row.player);
    if (status !== 'saved') throw new Error(`engine.reset: ${row.section} left ${status}`);
   }
  } finally { store.dispose(); }
 };
}
