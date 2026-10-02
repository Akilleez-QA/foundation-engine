/// <reference types="vite/client" />
/**
 * app/modules.ts: every module the app boots (ADR 0036, STD-MOD-11). Nothing here is a hand-kept list of game code:
 *  - the game's definitions in `@game` (every `*.ts` default export except tests, the brief and game.ts) are
 *    compiled by the author layer into `feature.game` and one `feature.<scene>` module per scene;
 *  - engine-level features and packs are discovered by folder (`features/*\/index.ts`, `packs/*\/index.ts`).
 * The kernel orders modules by `requires`, never by list position.
 */
import type { EngineModule } from '../core/module';
import { TEST_API } from '../core/env';
import { compileGame } from '../author/compile';
import type { AuthorDef } from '../author/defs';
import { layerModules } from './layer-modules';
import { brief, game } from './game';

// Whole modules, not `import: 'default'`: a helper file (shared components, constants) has no default export.
const definitions = Object.values(import.meta.glob<{ default?: AuthorDef }>(
  ['@game/**/*.ts', '!@game/**/*.test.ts', '!@game/build.brief.ts', '!@game/game.ts', '!@game/public/**'], { eager: true })).map(m => m.default);
export const compiled = compileGame({ brief, game, defs: definitions });
const layers = layerModules(game, brief);

const manifests = Object.entries(
  import.meta.glob<EngineModule>(['../features/*/index.ts', '../packs/*/index.ts'], { eager: true, import: 'default' }),
);

/** In a DEV or test build, `?engine-throw-test` adds a module whose install throws: the app still boots, and the test
 *  API's `engine.modules()` shows it `failed` (STD-MOD-6: one module's failure never takes the app down). */
const throwTest: EngineModule = {
  id: 'feature.boot-throw-test', version: '0.0.0',
  install() { throw new Error('a deliberately throwing test module (?engine-throw-test)'); },
};
const flag = (name: string) => TEST_API && typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);
const testModules: readonly EngineModule[] = flag('engine-throw-test') ? [throwTest] : [];

export const modules: readonly EngineModule[] = [...layers, ...compiled.modules, ...manifests.map(([, m]) => m), ...testModules];

/** The file that put each entry of `modules` in the list (same order): the kernel names both when two share an id. */
export const moduleSources: readonly string[] = [
  ...layers.map(() => 'src/app/layer-modules.ts'),
  ...compiled.modules.map(() => '@game (compiled by src/author/compile.ts)'),
  ...manifests.map(([path]) => `src/${path.slice(3)}`),
  ...testModules.map(() => 'src/app/modules.ts'),
];
