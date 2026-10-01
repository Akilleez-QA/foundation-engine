/**
 * core/router/scenes.ts: the router's `scenes` and `redirects` registries (ADR 0022; STD-RUN-10: scenes are rows in
 * the router's registries; STD-REG-1: created with `defineRegistry`).
 *
 * A scene is any state of the game the router can enter: a level, a menu, a world, a cutscene, a lesson. `SceneRow`
 * is data only; its loader and its enter are its dispatch row (`SceneEntry`, core/router/handover.ts), registered by
 * the scene's module.
 */
import { adminOf, defineRegistry, type AdminRegistry, type EntryProblem, type Registry, type RegistryOptions } from '../registry';
import type { LocalizedLabel } from '../i18n/label';
import type { SceneBudget } from '../budget';
import { redirectProblems, routesOf, type SceneId, type SceneRoute, type RedirectDef } from './resolve';

/** Open, game-defined kinds ('level', 'menu', 'world', 'cutscene', …): the router never switches on them. */
export type SceneKind = string;

export interface SceneRow {
  id: SceneId;
  kind: SceneKind;
  /** The first route is canonical (`#scene/<id>`); extra routes may carry fixed params. */
  routes: readonly [SceneRoute, ...SceneRoute[]];
  /** The display name: a string key with its fallback caption (or plain text in tests and tools). */
  title: string | LocalizedLabel;
  /** A scene this one belongs to (a level of a world): shells may use it for a way back. */
  parent?: SceneId;
  /** The scene budget (STD-PRF-1), when the game keeps budgets on the rows rather than in its budgets file. */
  budget?: SceneBudget;
}

declare module '../registry' {
  interface Registries { scenes: Registry<SceneRow>; redirects: Registry<RedirectDef> }
}

const SCENE_ID = /^scene\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The scene registry's row and cross-row checks (the kernel builds the registry from these in `defines`). */
export const sceneRegistryOptions: RegistryOptions<SceneRow> = {
  validate: p => [
      ...(SCENE_ID.test(p.id) ? [] : [`id '${p.id}' is not scene.<kebab-case>`]),
      ...(p.routes.length ? [] : ['has no route']),
      ...p.routes.filter(r => !r.hash.startsWith('#')).map(r => `route '${r.hash}' is not a hash route`),
      ...(typeof p.kind === 'string' && p.kind ? [] : ['has no kind']),
    ],
    problems: all => {
      const out: EntryProblem[] = [];
      const claimed = new Map<string, string>();
      for (const p of all) for (const r of p.routes) {
        const other = claimed.get(r.hash);
        if (other) out.push({ id: p.id, problem: `route ${r.hash} is already claimed by ${other}` });
        else claimed.set(r.hash, p.id);
      }
      for (const p of all) if (p.parent && !all.some(o => o.id === p.parent)) out.push({ id: p.id, problem: `parent '${p.parent}' does not exist` });
      return out;
    },
};

export function defineSceneRegistry(owner = 'core'): AdminRegistry<SceneRow> {
  return defineRegistry<SceneRow>('scenes', sceneRegistryOptions, owner);
}

/** The redirect registry's row checks. */
export const redirectRegistryOptions: RegistryOptions<RedirectDef> = {
    validate: r => [
      ...(r.id.startsWith('redirect.') ? [] : [`id '${r.id}' is not redirect.<kebab-case>`]),
      ...(r.note ? [] : ['has no note (why the old route exists)']),
      ...(r.from instanceof RegExp && r.from.global ? ['a global (/g) pattern is stateful; drop the g flag'] : []),
    ],
};

export function defineRedirectRegistry(owner = 'core'): AdminRegistry<RedirectDef> {
  return defineRegistry<RedirectDef>('redirects', redirectRegistryOptions, owner);
}

/** The router's two registries, filled from rows and frozen. A row's `source` is the module that owns it. */
export interface RouteTables { scenes: Registry<SceneRow>; redirects: Registry<RedirectDef> }

export function buildRouteTables(scenes: readonly SceneRow[], redirects: readonly RedirectDef[], source: string, owner = 'core'): RouteTables {
  const p = defineSceneRegistry(owner), r = defineRedirectRegistry(owner);
  for (const row of scenes) p.add(row, source);
  for (const row of redirects) r.add(row, source);
  adminOf(p).freeze(); adminOf(r).freeze();
  return { scenes: p, redirects: r };
}

/** Every problem in both tables: per-row validation, cross-row problems and the redirect audit. */
export function routeTableProblems(t: RouteTables): string[] {
  return [
    ...adminOf(t.scenes).check('report').map(x => `${x.registry}${x.id ? ' ' + x.id : ''}: ${x.problem}`),
    ...adminOf(t.redirects).check('report').map(x => `${x.registry}${x.id ? ' ' + x.id : ''}: ${x.problem}`),
    ...redirectProblems(routesOf(t.scenes.all()), t.redirects.all()),
  ];
}
