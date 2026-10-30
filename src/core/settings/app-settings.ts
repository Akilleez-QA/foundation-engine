/**
 * core/settings/app-settings.ts: the running game's one settings service (STD-SET-1/2), like
 * core/save/app-store.ts is its one save store, until the kernel boot hands `s.settings` to every module.
 *
 * - Values live in the device section 'settings.values' of the app's save store. The service reaches the store through `appSaveStore()` on every read and write, and moves its
 *   subscription when the game's boot replaces a stand-in store, so it never holds a stale handle.
 * - It is the one writer of `body.still-mode` and `body.large-type` (the stylesheets read them).
 * - The platform defaults are read here and only here (STD-SET-4): `prefers-reduced-motion` and `pointer: coarse` are
 *   each queried with `matchMedia` ONCE, when the service is created, and followed through their `change` events. A
 *   frame never queries the platform; `calmScenes()` is `get('comfort.calm')`, an O(1) read.
 *   The number of `matchMedia` calls is on the test API (probe 'settings'), so a verifier can prove it stays at two.
 */
import {appEvents} from '../app-events';
import {appSaveStore, onAppSaveStoreRescened} from '../save/app-store';
import {
  coreSettings,
  createSettings,
  settingsValuesSection,
  type Settings,
  type SettingDef,
  type SettingEnv,
  type SettingsStore,
  type StoredSettings,
} from './settings';
import type {EngineProbes} from '../probe';

declare module '../probe' {
  interface EngineProbes {
    /** The settings service: how often the platform was queried, the effective Calm value, and what is stored. */
    settings: {matchMediaCalls: number; calm: boolean; stored: Readonly<StoredSettings>};
  }
}

let matchMediaCalls = 0;
/** The platform side of the settings environment: each media query made once and followed through `change`. */
function browserEnv(): {env: SettingEnv; watch(recheck: () => void): void} {
  const env: SettingEnv = {prefersReducedMotion: false, coarsePointer: false};
  const queries: [keyof SettingEnv, string][] = [
    ['prefersReducedMotion', '(prefers-reduced-motion: reduce)'],
    ['coarsePointer', '(pointer: coarse)'],
  ];
  const lists: [keyof SettingEnv, MediaQueryList][] = [];
  if (typeof matchMedia === 'function') {
    for (const [field, query] of queries) {
      try {
        matchMediaCalls++;
        const list = matchMedia(query);
        env[field] = list.matches;
        lists.push([field, list]);
      } catch {
        /* no media queries: the default stays */
      }
    }
  }
  return {
    env,
    watch(recheck) {
      for (const [field, list] of lists)
        list.addEventListener?.('change', e => {
          env[field] = e.matches;
          recheck();
        });
    },
  };
}

/** 'settings.values' in whichever store the app is using now. */
function appSettingsStore(): SettingsStore {
  const handle = () => appSaveStore().section(settingsValuesSection);
  return {
    get: () => handle().get(),
    update: (fn, o) => handle().update(fn, o),
    subscribe(fn) {
      let off = handle().subscribe(fn);
      const moved = onAppSaveStoreRescened(() => {
        off();
        off = handle().subscribe(fn);
        fn(handle().get());
      });
      return () => {
        off();
        moved();
      };
    },
  };
}

let instance: Settings | undefined;
let gameSettings: readonly SettingDef[] = [];
/** The composition root adds the game's settings rows before anything reads settings. */
export function registerGameSettings(defs: readonly SettingDef[]): void {
  if (instance) throw Error('[settings] game settings must be registered before the settings service is created');
  gameSettings = defs;
}
/** The app's settings (created on first use). */
export function appSettings(): Settings {
  if (instance) return instance;
  const platform = browserEnv();
  const body = () => (typeof document === 'undefined' ? undefined : document.body);
  instance = createSettings([...coreSettings, ...gameSettings], appSettingsStore(), platform.env, {
    dom: {
      toggleClass: (c, on) => {
        body()?.classList?.toggle?.(c, on);
      },
    },
    events: appEvents,
    watchEnv: platform.watch,
  });
  return instance;
}

/** The `settings` probe (the composition root registers it on `s.probes`): undefined until the settings exist. */
export function settingsProbe(): EngineProbes['settings'] | undefined {
  const s = instance;
  return (
    s && {matchMediaCalls, calm: s.get('comfort.calm'), stored: appSaveStore().section(settingsValuesSection).get()}
  );
}

/** Calm scenes, the one central value every motion system reads (STD-SET-2). */
export const calmScenes = (): boolean => appSettings().get('comfort.calm');

/** Tests: forget the service, so the next `appSettings()` builds a fresh one over the current store and platform. */
export function resetAppSettingsForTests(): void {
  instance = undefined;
  matchMediaCalls = 0;
  gameSettings = [];
}
/** Tests: how many times the platform was queried. */
export const settingsMatchMediaCalls = (): number => matchMediaCalls;
