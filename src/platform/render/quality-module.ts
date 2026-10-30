/** Owns the device quality choice before any dependent scene can allocate a renderer. */
import {defineModule, type EngineModule} from '../../core/module';
import type {} from '../../core/save/module';
import {graphicsSettingsSection, type Quality, type QualityPreset, type PresetSource} from './quality';
import {bindAppQuality, createAppQuality, type AppQualityOptions} from './quality-runtime';

declare module '../../core/services' {
  interface Services {
    readonly quality: Quality;
  }
}
declare module '../../core/probe' {
  interface EngineProbes {
    quality: {preset: QualityPreset; source: PresetSource; governing: boolean};
  }
}

export interface QualityModuleOptions extends Omit<AppQualityOptions, 'store'> {}

export function qualityModule(options: QualityModuleOptions = {}): EngineModule {
  return defineModule({
    id: 'platform.quality',
    version: '1.0.0',
    requires: ['core.save'],
    serviceKeys: ['quality'],
    register(r) {
      r.saveSections.add(graphicsSettingsSection, 'platform.quality');
    },
    install(s) {
      // The handle is lazy: a pinned run never reads or writes this section.
      const choice = s.save.section(graphicsSettingsSection);
      const quality = createAppQuality({
        ...options,
        search: options.search ?? (typeof location === 'undefined' ? '' : location.search),
        store: {
          read: () => choice.get() ?? undefined,
          write: value => {
            choice.replace(value);
          },
        },
      });
      s.provide('quality', quality);
      const unbind = bindAppQuality(quality);
      s.signal.addEventListener('abort', unbind, {once: true});
      s.probes.register(
        'quality',
        () => ({preset: quality.preset, source: quality.source, governing: quality.governing}),
        s.signal,
      );
      return {dispose: unbind};
    },
  });
}
