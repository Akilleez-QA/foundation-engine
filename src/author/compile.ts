/**
 * author/compile.ts: turns a game's definitions into engine modules. This is the whole bridge between the author
 * surface and the engine's registries:
 *
 *   feature.game        save sections, input actions (buttons and axes), modes and assets; the `play` service; probes
 *   <kit modules>       whatever each kit in `defineGame({ kits })` contributes (registries, services)
 *   feature.<scene>     the scene row (`scene.<id>`, route `#scene/<id>`) and a dispatch row whose body (runtime.ts:
 *                       the renderer, world and systems) loads lazily on first entry
 *
 * English text in the definitions becomes the base catalogue under derived keys (`game.scene.<id>.title`,
 * `game.input.<id>`), so the shell, prompts and loading card are keyed like every other string.
 */
import { defineModule, type EngineModule } from '../core/module';
import type { Registry } from '../core/registry';
import { appI18n } from '../core/i18n/app-i18n';
import { label, type LocalizedLabel } from '../core/i18n/label';
import type { SceneId } from '../core/router/resolve';
import type { SceneRow } from '../core/router/scenes';
import type { InputActionDef } from '../platform/input/actions';
import type {} from '../platform/ui/shell-module';
import type {} from '../platform/input/module';
import type {} from '../platform/audio/module';
import type { BuildBrief } from './build';
import { createPlayService } from './play';
import { actionOf, sceneId } from './ids';
import type { AssetDefinition, AuthorDef, GameDefinition, InputDefinition, ModeDefinition, SaveSectionDef, SceneDefinition } from './defs';

/** The kits a game uses, as registry rows: open, validated (every kit a kit requires is present) and frozen at boot. */
export interface KitRow { readonly id: string; readonly requires: readonly string[]; readonly modules: readonly string[] }
declare module '../core/registry' { interface Registries { modes: Registry<ModeDefinition>; assets: Registry<AssetDefinition>; kits: Registry<KitRow> } }

export const GAME_MODULE_ID = 'feature.game';
export { sceneId, actionOf };

/** Every definition the game uses: its own files' default exports (a helper file without one is skipped), then each
 *  kit's. */
export function allDefinitions(game: GameDefinition, defs: readonly (AuthorDef | undefined)[]): AuthorDef[] {
  return [...defs.filter((d): d is AuthorDef => !!d && typeof d === 'object' && 'kind' in d), ...(game.kits ?? []).flatMap(k => k.defs)];
}

/** The derived string keys, and the English catalogue built from the definitions. */
export function gameCatalog(defs: readonly AuthorDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of defs) {
    if (d.kind === 'scene') out[`game.scene.${d.id}.title`] = d.title;
    else if (d.kind === 'input') out[`game.input.${d.id}`] = d.label;
    else if (d.kind === 'mode') out[`game.mode.${d.id}`] = d.title;
  }
  return out;
}

/** The input action rows of a definition: one press row for a button, two hold rows for an axis. */
export function actionRows(i: InputDefinition): InputActionDef[] {
  const labelKey = `game.input.${i.id}`;
  if (!i.axis) return [{ id: actionOf(i.id), label: labelKey, scope: 'global', kind: 'press', defaults: { keys: i.keys, pad: i.pad } } as unknown as InputActionDef];
  return (['negative', 'positive'] as const).map(side => ({ id: actionOf(i.id, side), label: labelKey, scope: 'global', kind: 'hold', defaults: { keys: i.axis![side].keys, pad: i.axis![side].pad } } as unknown as InputActionDef));
}

/** Every catalogue the game runs with: derived keys, then each kit's strings, then the game's own (which win). */
export function mergedStrings(game: GameDefinition, defs: readonly AuthorDef[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = { en: gameCatalog(defs) };
  for (const source of [...(game.kits ?? []).map(k => k.strings), game.strings ?? {}]) for (const [locale, c] of Object.entries(source)) out[locale] = { ...out[locale], ...c };
  return out;
}

const localized = (key: string, fallback: string) => ({ key, fallback }) as unknown as LocalizedLabel;

export interface CompiledGame { modules: EngineModule[]; scenes: SceneDefinition[]; first: SceneId; namespace: string }

export function compileGame(o: { brief: BuildBrief; game: GameDefinition; defs: readonly (AuthorDef | undefined)[] }): CompiledGame {
  const { brief, game } = o;
  const defs = allDefinitions(game, o.defs);
  const scenes = defs.filter((d): d is SceneDefinition => d.kind === 'scene');
  const sections = defs.filter((d): d is SaveSectionDef<unknown> => d.kind === 'save-section');
  const inputs = defs.filter((d): d is InputDefinition => d.kind === 'input');
  const modes = defs.filter((d): d is ModeDefinition => d.kind === 'mode');
  const assets = defs.filter((d): d is AssetDefinition => d.kind === 'asset');
  if (!scenes.some(s => s.id === game.firstScene)) throw Error(`game: the first scene '${game.firstScene}' has no defineScene`);
  const ids = scenes.map(s => s.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) throw Error(`game: two scenes are called '${twice}'`);
  for (const [locale, catalog] of Object.entries(mergedStrings(game, defs))) appI18n.addCatalog(locale, catalog);

  const gameModule = defineModule({
    id: GAME_MODULE_ID, version: game.version,
    requires: ['core.save', 'core.router', 'platform.input', 'platform.shell', 'platform.quality'], optional: ['platform.audio'],
    serviceKeys: ['play'],
    defines: {
      modes: { validate: m => (ids.includes(m.scene) ? [] : [`mode ${m.id} starts in unknown scene '${m.scene}'`]) },
      assets: { validate: a => (/^https?:\/\//.test(a.url) ? ['assets are served with the game, never from another site'] : []) },
      kits: { problems: rows => rows.flatMap(k => k.requires.filter(r => !rows.some(o => o.id === r)).map(r => `kit ${k.id} needs kit ${r}`)) },
    },
    register(r) {
      for (const d of sections) r.saveSections.add(d.section, GAME_MODULE_ID);
      for (const i of inputs) for (const row of actionRows(i)) r.inputActions.add(row, GAME_MODULE_ID);
      for (const m of modes) r.modes.add(m, GAME_MODULE_ID);
      for (const a of assets) r.assets.add(a, GAME_MODULE_ID);
      for (const k of game.kits ?? []) r.kits.add({ id: k.id, requires: k.requires, modules: k.modules.map(m => m.id) }, GAME_MODULE_ID);
    },
    install(s) {
      const play = createPlayService(brief, game);
      s.provide('play', play);
      s.probes.register('game', () => ({ id: game.id, genre: brief.genre, policy: brief.policy, modes: brief.modes, minimum: brief.devices.minimum }), s.signal);
      s.probes.register('world', () => play.current()?.state() ?? null, s.signal);
    },
  });

  const sceneModules = scenes.map(scene => {
    const id = `feature.${scene.id}`, title = localized(`game.scene.${scene.id}.title`, scene.title);
    const row: SceneRow = { id: sceneId(scene.id), kind: scene.type, routes: [{ hash: `#scene/${scene.id}` }], title };
    return defineModule({
      id, version: game.version, requires: [GAME_MODULE_ID, 'core.router', 'platform.shell', ...(game.kits ?? []).flatMap(k => k.modules.map(m => m.id))],
      register(r) { r.scenes.add(row, id); },
      install(s) {
        s.router.scene({
          id: row.id, get label() { return label(title); }, preload: scene.id === game.firstScene ? 'never' : 'idle',
          load: () => import('./runtime'),
          prepare: (m,visit) => (m as typeof import('./runtime')).prepareScene(s,scene,visit),
          enter: (m, visit) => (m as typeof import('./runtime')).enterScene({ s, brief, scene, visit, inputs }),
        });
      },
    });
  });
  const kitModules = (game.kits ?? []).flatMap(k => k.modules);
  return { modules: [gameModule, ...kitModules, ...sceneModules], scenes, first: sceneId(game.firstScene), namespace: game.id };
}
