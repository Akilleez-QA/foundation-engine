/**
 * platform/audio/module.ts: `platform.audio`, the one audio output as a kernel module (STD-SYS-16, STD-TST-8).
 *
 * It owns the `cues` registry (the core interface cues, plus a game's rows added in `register`) and provides `audio`.
 * Volumes and mute follow the settings service; `core.mute` toggles `sound.muted`. The output is silent (no
 * AudioContext is ever created) whenever the `dev.silent` flag is on or the page is driven by automation
 * (`navigator.webdriver`), so a test or bench browser can never reach the speakers; the harness also passes
 * `--mute-audio`. The first pointer gesture (or the mute key) unlocks the context, as browsers require.
 */
import { defineModule, type EngineModule } from '../../core/module';
import type { Registry } from '../../core/registry';
import type {} from '../../core/settings/module';
import type {} from '../../core/settings/features-module';
import type {} from '../input/module';
import { CORE_CUES, createAudioOutput, type AudioOutput, type CueDef } from './audio-output';

declare module '../../core/registry' { interface Registries { cues: Registry<CueDef> } }
declare module '../../core/services' { interface Services { readonly audio: AudioOutput } }
declare module '../../core/probe' { interface EngineProbes { audio: { silent: boolean; contexts: number; played: number; skipped: number } } }

export const AUDIO_MODULE_ID = 'platform.audio';

const automated = () => typeof navigator !== 'undefined' && (navigator as { webdriver?: boolean }).webdriver === true;

export function audioModule(): EngineModule {
  return defineModule({
    id: AUDIO_MODULE_ID, version: '1.0.0', requires: ['core.settings', 'core.features'], optional: ['platform.input'], serviceKeys: ['audio'],
    defines: { cues: {
      idForm: /^[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/,
      validate: c => [...(c.duration > 0 && c.duration <= 10 ? [] : ['duration must be in (0, 10] s']), ...(c.steps.length ? [] : ['has no steps'])],
    } },
    register(r) { for (const c of CORE_CUES) r.cues.add(c, AUDIO_MODULE_ID); },
    install(s) {
      const silent = () => s.features.enabled('dev.silent') || automated();
      const audio = createAudioOutput({
        silent, muted: () => s.settings.get('sound.muted'), effects: () => s.settings.get('sound.effects'), music: () => s.settings.get('sound.music'),
        onChange: fn => {
          const offs = (['sound.muted', 'sound.effects', 'sound.music'] as const).map(id => s.settings.subscribe(id, fn, s.signal));
          return () => { for (const off of offs) off(); };
        },
        cues: s.registries.cues.all(), report: m => s.log.warn(m),
      });
      s.provide('audio', audio);
      const unlock = () => audio.unlock();
      if (s.app.has('platform.input')) {
        s.input.onAction('core.mute', e => { unlock(); if (e.phase === 'press') s.settings.set('sound.muted', !s.settings.get('sound.muted')); }, { signal: s.signal });
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('pointerdown', unlock, { signal: s.signal, capture: true });
        document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden), { signal: s.signal });
      }
      s.probes.register('audio', () => ({ silent: silent(), ...audio.stats }), s.signal);
      return { dispose: () => audio.dispose() };
    },
  });
}
