/** What `recoverableImport` needs from the page; the tests pass fakes. */
export interface ChunkRetry {
  /** `import()` a URL the bundler did not see (the re-request). */
  importUrl(url: string): Promise<unknown>;
  /** The file answers again: the network is back. */
  reachable(url: string): Promise<boolean>;
  /** Reload the page for the file `url` (null: unnamed), keeping the address and so the current scene. At most once per
   * file for one history entry, so a file that stays broken shows the card instead of reloading forever. */
  reload(url: string | null): void;
}
const CHUNK_FAILURE = /dynamically imported module|importing a module script failed/i;
/** The module file a failed `import()` names (Chromium and Firefox name it; Safari does not). */
export function failedChunkUrl(error: unknown): string | null {
  const message = String((error as {message?: unknown})?.message ?? error);
  return /(https?:\/\/[^\s'"]+?\.(?:m?js|tsx?))(?:[?#][^\s'"]*)?(?=$|[\s'"])/.exec(message)?.[1] ?? null;
}
export const isChunkFailure = (error: unknown) =>
  CHUNK_FAILURE.test(String((error as {message?: unknown})?.message ?? error));
const RELOADED = 'engineChunkReload';
export const pageChunkRetry: ChunkRetry = {
  importUrl: url => import(/* @vite-ignore */ url),
  reachable: url =>
    fetch(url, {cache: 'no-store'}).then(
      r => r.ok,
      () => false,
    ),
  reload(url) {
    // Offline, a reload would show the browser's error page: keep the card and its Try again.
    if (typeof navigator === 'object' && navigator.onLine === false) return;
    const state = (history.state ?? {}) as Record<string, unknown>,
      key = url ?? '?';
    if (state[RELOADED] === key) return;
    history.replaceState({...state, [RELOADED]: key}, '');
    location.reload();
  },
};
/**
 * A dynamic import that Try again can recover (STD-PRI-11: a child is never stuck; ADR 0045 retry). Chromium keeps a
 * failed `import()` failed until the page reloads (its module map remembers the failure), so asking again for the same
 * URL fails at once. This remembers the file the failure names and asks for it again with a cache-busting query; the
 * module that arrives is kept, so later requests reuse it (`recovered`). If that fails too while the file answers again, the file
 * Chromium remembers is one of its imports, which only a reload clears: the page reloads, keeping the address and so
 * the current scene (as it does when the file turns out to hold several modules). Still offline, it fails again and the
 * failure card offers Try again. `load` must be the bare `import()`; anything built from the module goes after it.
 */
export function recoverableImport<M>(load: () => Promise<M>, retry: ChunkRetry = pageChunkRetry): () => Promise<M> {
  let failed: string | null | undefined,
    recovered: string | undefined,
    attempt = 0;
  return async () => {
    if (recovered) return (await retry.importUrl(recovered)) as M;
    if (failed === undefined) {
      try {
        return await load();
      } catch (error) {
        if (isChunkFailure(error)) failed = failedChunkUrl(error);
        throw error;
      }
    }
    const url = failed;
    if (url === null) {
      retry.reload(null);
      throw Error('This part of the game could not load; the page reloads to fetch it again.');
    }
    const again = url + (url.includes('?') ? '&' : '?') + 'retry=' + ++attempt;
    let chunk: unknown;
    try {
      chunk = await retry.importUrl(again);
    } catch (error) {
      if (await retry.reachable(url).catch(() => false)) retry.reload(url);
      throw error;
    }
    const module = moduleIn(chunk);
    if (module === null) {
      retry.reload(url);
      throw Error('This part of the game arrived in a shared file; the page reloads to open it.');
    }
    recovered = again;
    failed = undefined;
    return module as M;
  };
}
/**
 * The module a re-requested file holds. A module that is its own chunk arrives as that chunk's exports. A module the
 * bundler placed inside a shared chunk is exported from it as one namespace object (Rollup's `import(chunk).then(n=>n.f)`),
 * which the re-request cannot name: with exactly one namespace in the chunk it is that one; with several, null (reload).
 */
function moduleIn(chunk: unknown): unknown {
  if (!chunk || typeof chunk !== 'object') return chunk;
  const namespaces = Object.values(chunk).filter(
    v => !!v && typeof v === 'object' && (v as {[Symbol.toStringTag]?: unknown})[Symbol.toStringTag] === 'Module',
  );
  return namespaces.length === 0 ? chunk : namespaces.length === 1 ? namespaces[0] : null;
}
