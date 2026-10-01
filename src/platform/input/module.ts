/**
 * platform/input/module.ts: `platform.input`, the app's one action dispatcher as a kernel module (ADR 0044, ADR 0047,
 * STANDARD chapter 10).
 *
 * It owns the `inputActions` registry: the core rows (Back, interact, move, zoom, camera, mute, quick slots) are added
 * here, and a feature adds its own rows in `register` (an id '<area>.<name>', a label key, a scope, a kind and key/pad
 * defaults). The registry's checks run at validate: an action keyboard or pad cannot reach, or a default binding two
 * rows share, is a boot problem. At install the dispatcher is built over the frozen rows and provided as `input`.
 */
import { defineModule, type EngineModule } from '../../core/module';
import { CORE_INPUT_ACTIONS, inputActionRegistryOptions, checkReach, type InputActions } from './actions';
import { installAppInput, appLoop, appLayers } from '../ui/runtime';
import { installLazyActionGamepad } from './lazy-action-gamepad';

declare module '../../core/services' { interface Services { readonly input: InputActions } }
declare module '../../core/probe' { interface EngineProbes { input: { actions: string[]; epoch: number } } }

export const INPUT_MODULE_ID = 'platform.input';

export function inputModule(o: { doc?: () => Document } = {}): EngineModule {
  return defineModule({
    id: INPUT_MODULE_ID, version: '1.0.0', serviceKeys: ['input'],
    defines: { inputActions: inputActionRegistryOptions },
    register(r) { for (const row of CORE_INPUT_ACTIONS) r.inputActions.add(row, INPUT_MODULE_ID); },
    install(s) {
      const doc = o.doc?.() ?? (typeof document === 'undefined' ? undefined : document);
      if (!doc) throw Error('platform.input needs a document');
      const reach = checkReach(s.registries.inputActions);
      for (const p of reach.problems) s.log.warn(p);
      const input = installAppInput(doc, s.registries.inputActions, s.signal);
      s.provide('input', input);
      if (doc.defaultView) installLazyActionGamepad({ input, doc, win: doc.defaultView, layers: appLayers(doc), loop: appLoop(), signal: s.signal, report: error => s.log.warn(String(error)) });
      s.probes.register('input', () => ({ actions: s.registries.inputActions.all().map(a => a.id), epoch: input.epoch }), s.signal);
    },
  });
}
