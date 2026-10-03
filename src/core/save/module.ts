/**
 * core/save/module.ts: the save store as a kernel module (ADR 0007, STD-SYS-7, STD-MOD-18).
 *
 * `core.save` owns the `saveSections` registry. Every module registers its sections as rows in `register`; the rows
 * are frozen and validated before any module installs, and `core.save` (which every module that persists requires)
 * builds the one store from the frozen set in its install, so export, import and reset know every section before
 * anything opens one. The store is the `save` service and the app store (`appSaveStore()`) for code outside modules.
 *
 * Flush points (STD-SAV-12): a hidden page, `pagehide`, a player switch, export and a scene being left. No storage
 * work runs inside a frame (the debounce uses idle callbacks).
 */
import { defineModule, type EngineModule } from '../module';
import type { Registry } from '../registry';
import type { SaveSection, SaveStore } from './section';
import { browserPort, MemoryBackend, type StoragePort } from './storage-port';
import { createSaveStore, playersSection, type SavePending, type Timers } from './store';
import { sectionProblems } from './validate';
import { savePrefixes } from './prefixes';
import { installAppSaveStore, configureAppSaveStore } from './app-store';

declare module '../registry' {
  interface Registries { saveSections: Registry<SaveSection<unknown> & { id: string }> }
}
declare module '../services' {
  interface Services { readonly save: SaveStore & { pending(): SavePending } }
}
declare module '../probe' {
  interface EngineProbes { save: { sections: string[]; activePlayer: string; players: string[]; pending: SavePending } }
}

export interface SaveModuleOptions {
  /** The game's key namespace (lower kebab-case): every stored key starts with it. */
  namespace: string;
  /** '<game>@<version>', written into every envelope. */
  build: string;
  /** Storage ports; default: the browser's Web Storage when present, memory otherwise (tests, tools). */
  storage?: () => { local: StoragePort; session: StoragePort };
  timers?: Timers;
  /** Extra prefixes reset also clears (keys the game wrote before adopting the store). */
  legacyPrefixes?: readonly string[];
}

const hasWebStorage = () => { try { return typeof window !== 'undefined' && (globalThis as { localStorage?: unknown }).localStorage !== undefined; } catch { return true; } };
const defaultStorage = () => hasWebStorage()
  ? { local: browserPort('local'), session: browserPort('session') }
  : { local: new MemoryBackend().port(0, 'local'), session: new MemoryBackend().port(0, 'session') };

export function saveModule(o: SaveModuleOptions): EngineModule {
  configureAppSaveStore({ namespace: o.namespace, build: o.build });
  const prefixes = savePrefixes(o.namespace, o.legacyPrefixes);
  return defineModule({
    id: 'core.save', version: '1.0.0', serviceKeys: ['save'], eventAreas: ['player'],
    defines: { saveSections: {
      // Section ids are namespaced lowercase ('owner.name'); the registry's own id rule would refuse the dot-free form.
      idForm: /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/,
      problems: all => sectionProblems([playersSection, ...all], '7', prefixes),
    } },
    install(s) {
      const { local, session } = (o.storage ?? defaultStorage)();
      const store = createSaveStore({ local, session, build: o.build, namespace: o.namespace, legacyPrefixes: o.legacyPrefixes, timers: o.timers, sections: s.registries.saveSections.all() });
      installAppSaveStore(store);
      s.provide('save', store);
      const offPlayer = store.onPlayerChanged((id, previous) => s.events.emit('player.changed', { id, previous }));
      s.probes.register('save', () => ({ sections: s.registries.saveSections.all().map(d => d.id), activePlayer: store.activePlayer(), players: store.players(), pending: store.pending() }), s.signal);
      const flush = (reason: string) => () => { try { store.flush(reason); } catch (error) { s.log.warn('flush failed', error); } };
      if (typeof document !== 'undefined') {
        const hidden = () => { if (document.visibilityState === 'hidden') flush('hidden')(); };
        document.addEventListener('visibilitychange', hidden, { signal: s.signal });
        globalThis.addEventListener?.('pagehide', flush('pagehide'), { signal: s.signal });
      }
      return { dispose: () => { offPlayer(); store.dispose(); } };
    },
  });
}
