/**
 * core/settings/module.ts: `core.settings`, the settings service as a kernel module (STD-SET-1, STD-SET-2).
 *
 * The values live in the device section `settings.values`, registered here so export, import and reset know it. The
 * rows are the engine's (`coreSettings`) plus the game's, passed as `game` (the composition root's list). The service
 * is `appSettings()`, provided as `settings`; its `settings` probe says how often the platform was queried.
 */
import { defineModule, type EngineModule } from '../module';
import type {} from '../save/module';
import { settingsValuesSection, type SettingDef, type Settings } from './settings';
import { appSettings, registerGameSettings, settingsProbe } from './app-settings';

declare module '../services' { interface Services { readonly settings: Settings } }

export function settingsModule(o: { game?: readonly SettingDef[] } = {}): EngineModule {
  return defineModule({
    id: 'core.settings', version: '1.0.0', requires: ['core.save'], serviceKeys: ['settings'], eventAreas: ['settings'],
    register(r) { r.saveSections.add(settingsValuesSection, 'core.settings'); },
    install(s) {
      if (o.game?.length) registerGameSettings(o.game);
      s.provide('settings', appSettings());
      s.probes.register('settings', () => settingsProbe()!, s.signal);
    },
  });
}
