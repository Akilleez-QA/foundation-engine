/**
 * platform/audio/module.ts: `platform.audio`, the one audio output as a kernel module (STD-SYS-16, STD-TST-8).
 *
 * It owns the `cues` registry (the core interface cues, plus a game's rows added in `register`) and provides `audio`.
 * Volumes and mute follow the settings service; `core.mute` toggles `sound.muted`. The output is silent (no
 * AudioContext is ever created) whenever the `dev.silent` flag is on or the page is driven by automation
 * (`navigator.webdriver`), so a test or bench browser can never reach the speakers; the harness also passes
 * `--mute-audio`. The first pointer gesture (or the mute key) unlocks the context, as browsers require.
 *
 * Spatial quality is the creator's choice (`defineGame({ audio })`, docs/guides/spatial-audio.md): the HRTF voice limit
 * per quality preset, position smoothing, and whether players see the `sound.headphone-3d` setting. The effective HRTF
 * limit is the preset's value, or 0 while that setting is off; it follows preset and setting changes live.
 *
 * Sound files (the composition root's second argument): `sound` resolves a game's sound ids to file URLs, so
 * `play`/`playVoice` take a sound id as well as a cue id; the output fetches, keeps and decodes files within `files`
 * bounds (sound-files.ts).
 */
import { defineModule, type EngineModule } from '../../core/module';
import type { Registry } from '../../core/registry';
import type { Services } from '../../core/services';
import type { SettingDef } from '../../core/settings/settings';
import { isQualityPreset, QUALITY_PRESETS, type Ported, type QualityPreset } from '../../core/tiers';
import { budgetFor } from '../../core/budget';
import type {} from '../../core/settings/module';
import type {} from '../render/quality-module';
import type {} from '../../core/settings/features-module';
import type {} from '../input/module';
import { publicUrl } from '../assets/public-base';
import { CORE_CUES, createAudioOutput, type AudioOutput, type AudioStats, type CueDef } from './audio-output';
import type { SoundFileOptions, SoundFileStats } from './sound-files';

declare module '../../core/registry' { interface Registries { cues: Registry<CueDef> } }
declare module '../../core/services' { interface Services { readonly audio: AudioOutput } }
declare module '../../core/probe' { interface EngineProbes { audio: { silent: boolean; headphone3d: boolean | null; sounds: SoundFileStats } & AudioStats } }
declare module '../../core/settings/settings' { interface SettingValues { 'sound.headphone-3d': boolean } }

export const AUDIO_MODULE_ID = 'platform.audio';

/** The player-facing "Headphone 3D audio" switch. Registered only when the creator asks (`headphoneSetting: true`). */
export const HEADPHONE_3D_SETTING: SettingDef<'sound.headphone-3d'> = {
  id: 'sound.headphone-3d', section: 'sound', type: 'bool', label: 'settings.sound.headphone-3d', help: 'settings.sound.headphone-3d.help', scope: 'device', default: true,
};

/** The creator's spatial audio choices; every field is optional and the defaults keep the previous behaviour. */
export interface SpatialAudioOptions {
  /** HRTF voices allowed at once, per quality preset (flat value = reference; `ports` override lighter presets, falling back low → medium → high → reference). Default 8. */
  hrtf?: Ported<{ maxVoices: number }>;
  /** Listener and position smoothing time constant in seconds, [0, 1]. Default 0 (instant). */
  smoothing?: number;
  /** Register the `sound.headphone-3d` setting so the settings panel shows it. Default false. */
  headphoneSetting?: boolean;
}

/** Validated HRTF limit for `preset`. */
export function hrtfLimitFor(options: SpatialAudioOptions | undefined, preset: QualityPreset, maxVoices = 64): number {
  // The engine's preset fallback (core/budget.ts): low → medium → high → reference.
  const value = options?.hrtf ? budgetFor(options.hrtf, preset).maxVoices ?? options.hrtf.maxVoices : Math.min(8, maxVoices);
  if (!Number.isSafeInteger(value) || value < 0 || value > maxVoices) throw Error(`audio: HRTF voice limit for ${preset} must be an integer in [0, ${maxVoices}]`);
  return value;
}
/** Throws on any invalid creator value before a module installs. */
export function validateSpatialAudioOptions(options: SpatialAudioOptions | undefined): void {
  if (!options) return;
  for (const preset of QUALITY_PRESETS) hrtfLimitFor(options, preset);
  for (const key of Object.keys(options.hrtf?.ports ?? {})) if (!isQualityPreset(key) || key === 'reference') throw Error(`audio: unknown quality preset '${key}'`);
  const smoothing = options.smoothing ?? 0;
  if (typeof smoothing !== 'number' || !(smoothing >= 0 && smoothing <= 1)) throw Error('audio: smoothing must be in [0, 1] s');
}
/** The settings rows the creator's choice adds (none by default). */
export const spatialAudioSettings = (options: SpatialAudioOptions | undefined): SettingDef[] => options?.headphoneSetting ? [HEADPHONE_3D_SETTING as SettingDef] : [];

const automated = () => typeof navigator !== 'undefined' && (navigator as { webdriver?: boolean }).webdriver === true;

/** A game's sound files, wired by the composition root. Both fields optional; omit for cues only. */
export interface SoundFileModuleOptions {
  /** Maps a sound id to its file URL (undefined: not a sound). */
  sound?(services: Services, id: string): string | undefined;
  /** Sound-file bounds (`soundBudgets(minimum device)` in the app). */
  files?: Omit<SoundFileOptions, 'report'>;
}

export function audioModule(spatial?: SpatialAudioOptions, soundFiles: SoundFileModuleOptions = {}): EngineModule {
  const { sound, files } = soundFiles;
  validateSpatialAudioOptions(spatial);
  return defineModule({
    id: AUDIO_MODULE_ID, version: '1.0.0', requires: ['core.settings', 'core.features'], optional: ['platform.input', 'platform.quality'], serviceKeys: ['audio'],
    defines: { cues: {
      idForm: /^[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/,
      validate: c => [...(c.duration > 0 && c.duration <= 10 ? [] : ['duration must be in (0, 10] s']), ...(c.steps.length ? [] : ['has no steps'])],
    } },
    register(r) { for (const c of CORE_CUES) r.cues.add(c, AUDIO_MODULE_ID); },
    install(s) {
      const silent = () => s.features.enabled('dev.silent') || automated();
      const audio = createAudioOutput({
        // A site path (`/music/theme.m4a`) is a file under public/, served under the build's base; full URLs pass.
        resolveUrl: url => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) ? url : publicUrl(url),
        silent, muted: () => s.settings.get('sound.muted'), effects: () => s.settings.get('sound.effects'), music: () => s.settings.get('sound.music'),
        onChange: fn => {
          const offs = (['sound.muted', 'sound.effects', 'sound.music'] as const).map(id => s.settings.subscribe(id, fn, s.signal));
          return () => { for (const off of offs) off(); };
        },
        cues: s.registries.cues.all(), report: m => s.log.warn(m),
        maxHrtfVoices: hrtfLimitFor(spatial, 'reference'), smoothing: spatial?.smoothing ?? 0,
        ...(sound ? { sound: (id: string) => sound(s, id) } : {}), ...(files ? { files } : {}),
      });
      s.provide('audio', audio);
      const quality = s.app.has('platform.quality') ? s.quality : null;
      const headphones = s.settings.defs('sound').some(d => d.id === HEADPHONE_3D_SETTING.id);
      const headphone3d = () => headphones ? s.settings.get('sound.headphone-3d') : null;
      const limit = () => { audio.setHrtfLimit(headphone3d() === false ? 0 : hrtfLimitFor(spatial, quality?.preset ?? 'reference')); };
      limit();
      quality?.subscribe(limit, s.signal);
      if (headphones) s.settings.subscribe('sound.headphone-3d', limit, s.signal);
      const unlock = () => audio.unlock();
      if (s.app.has('platform.input')) {
        s.input.onAction('core.mute', e => { unlock(); if (e.phase === 'press') s.settings.set('sound.muted', !s.settings.get('sound.muted')); }, { signal: s.signal });
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('pointerdown', unlock, { signal: s.signal, capture: true });
        document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden), { signal: s.signal });
      }
      s.probes.register('audio', () => ({ silent: silent(), headphone3d: headphone3d(), contexts: audio.stats.contexts, played: audio.stats.played, skipped: audio.stats.skipped,
        active: audio.stats.active, hrtfActive: audio.stats.hrtfActive, hrtfLimit: audio.stats.hrtfLimit, downgraded: audio.stats.downgraded, culled: audio.stats.culled, sounds: { ...audio.sounds } }), s.signal);
      return { dispose: () => audio.dispose() };
    },
  });
}
