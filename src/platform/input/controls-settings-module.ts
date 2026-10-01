import { defineModule, type EngineModule } from '../../core/module';
import type {} from '../../core/save/module';
import type {} from './module';
import { bindControlsSettings, controlsSettingsSection, type ControlsSettings, type ControlsSettingsOptions } from './controls-settings';

declare module '../../core/services' { interface Services { readonly controlsSettings: ControlsSettings } }

/** Opt in at composition time; ordinary inputModule() remains storage-independent. */
export function controlsSettingsModule(options: ControlsSettingsOptions): EngineModule {
  const section = controlsSettingsSection(options);
  return defineModule({
    id: 'platform.controls-settings', version: '1.0.0',
    requires: ['core.save', 'platform.input'], serviceKeys: ['controlsSettings'],
    register(registries) { registries.saveSections.add(section, 'platform.controls-settings'); },
    install(services) {
      const controls = bindControlsSettings(services.save.section(section), services.input, section, services.signal);
      services.provide('controlsSettings', controls);
      return controls;
    },
  });
}
