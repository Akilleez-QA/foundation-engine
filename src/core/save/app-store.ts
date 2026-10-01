/**
 * core/save/app-store.ts: the running game's one save store, for code that reads section handles outside a module's
 * `install` (a module reads `s.save`).
 *
 * The game's boot creates its store (`createGameSaveStore`) and installs it here. A page that runs owner code without
 * the game's boot (a harness page, a tool) gets a plain store over the same browser storage the first time it asks,
 * so owners never write around the store; outside a browser (tests) that store is in memory. There is only ever one
 * store per tab: a later install flushes and replaces a stand-in, so no two caches of one key live side by side.
 *
 * Owners call `appSaveStore()` when they read or write, never at import, and never keep a handle across a player
 * switch (a handle without `of(player)` follows the active player anyway).
 */
import type { SaveStore } from './section';
import { browserPort, MemoryBackend, type StoragePort } from './storage-port';
import { createSaveStore, DEFAULT_SAVE_NAMESPACE } from './store';

let installed: SaveStore | undefined, standIn = false;
let standInOptions: { namespace: string; build: string } = { namespace: DEFAULT_SAVE_NAMESPACE, build: 'game@0.0.0' };
/** The composition root names its namespace and build before anything asks for the store. */
export function configureAppSaveStore(o: { namespace?: string; build?: string }): void {
  standInOptions = { namespace: o.namespace ?? standInOptions.namespace, build: o.build ?? standInOptions.build };
}
const replaced = new Set<() => void>();

/** The game's boot installs its store. A stand-in made earlier is flushed and disposed first. */
export function installAppSaveStore<S extends SaveStore>(store: S): S {
  const previous = installed;
  if (installed && installed !== store && standIn) installed.dispose();
  installed = store; standIn = false;
  if (previous && previous !== store) for (const fn of [...replaced]) fn();
  return store;
}

/**
 * Runs `fn` whenever a new store replaces the one owners were using (the game's boot replacing a stand-in). A service
 * that keeps a subscription across reads (for example the settings service) moves it to the new store here.
 */
export function onAppSaveStoreRescened(fn: () => void): () => void {
  replaced.add(fn);
  return () => { replaced.delete(fn); };
}

/** The store owners read and write through. */
export function appSaveStore(): SaveStore {
  if (!installed) { installed = createStandIn(); standIn = true; }
  return installed;
}

/** `localStorage` exists (a browser that blocks it throws on access: that still counts, see createStandIn). */
function hasWebStorage(): boolean {
  try { return (globalThis as { localStorage?: unknown }).localStorage !== undefined; } catch { return true; }
}

function createStandIn(): SaveStore {
  let local: StoragePort, session: StoragePort;
  // Only a runtime without a window and Web Storage (tests, tools) gets memory. Blocked storage in a browser stays the
  // browser port, whose reads throw, so the store treats it as unavailable and never as empty (STD-SAV-3). A test that
  // stubs `window` but no storage gets memory too: a browser port there would fail every write and retry it forever.
  if (typeof window !== 'undefined' && hasWebStorage()) { local = browserPort('local'); session = browserPort('session'); }
  else { local = new MemoryBackend().port(0, 'local'); session = new MemoryBackend().port(0, 'session'); }
  return createSaveStore({ local, session, build: standInOptions.build, namespace: standInOptions.namespace });
}

/** Tests: forget the installed store, so the next `appSaveStore()` makes a fresh one (or a test installs its own). */
export function resetAppSaveStoreForTests(): void { installed?.dispose(); installed = undefined; standIn = false; }
