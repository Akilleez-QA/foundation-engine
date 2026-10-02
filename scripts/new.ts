// scripts/new.ts (`npm run new -- <kind> <id> [options]`): generators. Each writes new files only (never overwrites)
// into the game being built (GAME_DIR, else ./game, else templates/blank/game), takes its defaults from the build
// brief, and prints what it made and what to do next. Kinds:
//
//   scene <id> [--type level] [--lazy-body]      a scene file, its test, a budgets.json row (the brief's per-scene ceiling until
//                                  measured) and a GAME.md changelog row
//   entity <id>                    a prefab (Name, Transform, Shape)
//   component <id>                 a component type in a helper file
//   system <id> [--frame]          a system in a helper file, with a testScene test
//   input <id> [--axis]            a button (key + pad, and tap when the brief lists touch) or an axis
//   save-section <id>              a save section '<game>.<id>' with the migration pattern
//   kit <id>                       an engine kit folder src/kits/<id> (index, README, test): only when asked to extend
//                                  the engine
//   interactable <id> [--door <scene>]   (explore kit) a thing to use, or a door to another scene
//   area <id>                      (explore kit) a scene to move around in: walls, player, camera, prompt
//   lesson <id>                    (learn kit) an outline-first lesson: data, scene, test, words
import './lib/node-version.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { gameDir, ROOT } from './lib/game-dir.mjs';
import { loadGame } from '../src/app/game-files';

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const pascal = (id: string) => id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');
export const camel = (id: string) => { const p = pascal(id); return p[0].toLowerCase() + p.slice(1); };
const today = () => new Date().toISOString().slice(0, 10);

export interface Generated { files: string[]; next: string[] }
type Brief = Awaited<ReturnType<typeof loadGame>>['brief'];

function write(file: string, text: string, made: string[]) {
  if (existsSync(file)) throw Error(`${relative(ROOT, file)} already exists; choose another id (generators never overwrite)`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text); made.push(relative(ROOT, file).split('\\').join('/'));
}

function changelog(dir: string, line: string, made: string[]) {
  const md = join(dir, '..', 'GAME.md');
  if (!existsSync(md)) return;
  appendFileSync(md, `| ${today()} | ${line} | |\n`);
  made.push(relative(ROOT, md).split('\\').join('/') + ' (changelog row)');
}

function addBudgetRow(dir: string, id: string, brief: Brief, made: string[]) {
  const file = join(dir, 'budgets.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.scenes[id]) return;
  const c = brief.performance.perScene;
  data.scenes[id] = {
    scene: `scene.${id}`, route: `#scene/${id}`, active: true,
    budget: { draws: c.draws, triangles: c.triangles, textureMiB: c.textureMiB, heapMiB: c.heapMiB, contexts: 1, loadMiB: 1 },
    provenance: { measured: `unmeasured: the brief's ceiling for a ${brief.devices.minimum}`, run: 'measure with npm run bench -- --only <first>,' + id + ', then npm run perf:derive, and lower these numbers' },
  };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  made.push(relative(ROOT, file).split('\\').join('/') + ` (row ${id})`);
}

const phone = (b: Brief) => b.devices.targets.includes('phone') || b.devices.targets.includes('tablet');

export async function generate(kind: string, id: string, opts: Record<string, string | boolean> = {}, dir = gameDir()): Promise<Generated> {
  if (!KEBAB.test(id ?? '')) throw Error(`the id '${id}' must be lowercase kebab-case`);
  const { brief, game } = await loadGame(dir);
  const files: string[] = [], next: string[] = [];
  const P = pascal(id), c = camel(id);
  switch (kind) {
    case 'scene': {
      const lazyBody = opts['lazy-body'] === true;
      if (lazyBody) for (const name of [`${id}.ts`, `${id}.body.mts`, `${id}.test.ts`]) {
        if (existsSync(join(dir, name))) throw Error(`${name} already exists; choose another id (generators never overwrite)`);
      }
      write(join(dir, `${id}.ts`), `// ${P}: ${String(opts.title ?? P)}. Add entities and systems; see docs/recipes/add-a-scene.md.
import { ${lazyBody ? 'defineScene' : 'defineScene, Name, Shape, Transform'} } from '@engine';

export default defineScene({
  id: '${id}', title: '${String(opts.title ?? P)}', type: '${String(opts.type ?? 'scene')}',
  view: { camera: { position: [0, 8, 10], target: [0, 0, 0]${phone(brief) ? ', minWidthFov: 50' : ''} }, background: 0x141a24 },
${lazyBody ? `  body: () => import('./${id}.body.mts'),` : `  entities: [
    [Name({ name: 'floor' }), Transform(), Shape({ kind: 'plane', size: [10, 0, 10], color: 0x2a3342 })],
  ],
  systems: [],`}
});
`, files);
      if (lazyBody) write(join(dir, `${id}.body.mts`), `// Loaded through the scene's body callback; keep body-only dependencies here.
import { Name, Shape, Transform, type SceneBody } from '@engine';

export default {
  entities: [[Name({ name: 'floor' }), Transform(), Shape({ kind: 'plane', size: [10, 0, 10], color: 0x2a3342 })]],
  systems: [],
} satisfies SceneBody;
`, files);
      write(join(dir, `${id}.test.ts`), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene } from '@engine';
import game from './game';
import ${c} from './${id}';

test('${id}: the scene starts and runs a second without errors', async () => {
  const t = await testScene(${c}, { game });
  t.run(1);
  assert.ok(t.world.count > 0);
});
`, files);
      addBudgetRow(dir, id, brief, files);
      changelog(dir, `Added scene \`${id}\``, files);
      next.push(`Go there: ctx.scene.goto('${id}') or #scene/${id}`, `See it: npm run play:snap -- --scene ${id}${phone(brief) ? ' --mobile' : ''}`, `Measure and lower its budget: docs/recipes/add-a-budget.md`);
      break;
    }
    case 'entity':
      write(join(dir, `${id}.ts`), `// The ${id} prefab. Spawn it with ctx.spawn(${c}) or list it in a scene's entities.
import { defineEntity, Name, Shape, Transform } from '@engine';

export default defineEntity({ id: '${id}', components: [Name({ name: '${id}' }), Transform({ y: 0.5 }), Shape({ kind: 'box', size: [1, 1, 1], color: 0xcccccc })] });
`, files);
      next.push(`Use it: import ${c} from './${id}'; add it to a scene's entities`);
      break;
    case 'component':
      write(join(dir, `${id}.ts`), `// The ${P} component: data only; systems give it behaviour (docs/recipes/add-an-entity-and-component.md).
import { defineComponent } from '@engine';

export const ${P} = defineComponent('${id}', { value: 0 });
`, files);
      next.push(`Use it: ${P}({ value: 1 }) in an entity; ctx.world.query(${P}) in a system`);
      break;
    case 'system': {
      const phase = opts.frame ? 'frame' : 'fixed';
      write(join(dir, `${id}.ts`), `// The ${id} system (${phase === 'fixed' ? 'fixed 60 Hz step: deterministic' : 'once per frame: presentation'}). Add it to a scene's systems.
import { defineSystem } from '@engine';

export const ${c} = defineSystem({
  id: '${id}',${phase === 'frame' ? "\n  phase: 'frame'," : ''}
  run(ctx, dt) {
    // Read input as actions (ctx.input), change components, emit world events; never touch the DOM here.
    void ctx; void dt;
  },
});
`, files);
      write(join(dir, `${id}.test.ts`), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, testScene } from '@engine';
import game from './game';
import { ${c} } from './${id}';

test('${id}: runs on an empty world', async () => {
  const t = await testScene(defineScene({ id: '${id}-test', title: 'Test', systems: [${c}] }), { game });
  t.run(1);
  assert.equal(t.world.count, 0);
});
`, files);
      next.push(`Add it: systems: [..., ${c}] in the scene that needs it`);
      break;
    }
    case 'input': {
      const touch = brief.devices.input.includes('touch') || brief.devices.input.includes('pointer');
      const body = opts.axis
        ? `axis: {\n    negative: { keys: ['code:KeyQ'], pad: ['lb'] },\n    positive: { keys: ['code:KeyE'], pad: ['rb'] },\n  },`
        : `keys: ['f'], pad: ['x']${touch ? ', tap: true' : ''},`;
      write(join(dir, `${id}.ts`), `// The ${id} ${opts.axis ? 'axis (-1…1)' : 'action'}. Change the bindings; every action needs a key and a pad input.
import { defineInput } from '@engine';

export default defineInput({
  id: '${id}', label: '${P.replace(/([a-z])([A-Z])/g, '$1 $2')}',
  ${body}
});
`, files);
      next.push(opts.axis ? `Read it: ctx.input.axis('${id}')` : `Read it: ctx.input.pressed('${id}') or ctx.input.held('${id}')`, 'npm run check reports a clash with another binding');
      break;
    }
    case 'save-section':
      write(join(dir, `${id}.ts`), `// Saved state '${game.id}.${id}'. The id is save data: never rename it. Add migrate[n] when the shape changes.
import { defineSaveSection } from '@engine';

export default defineSaveSection({
  id: '${game.id}.${id}',
  initial: { count: 0 },
  merge: (a, b) => ({ count: Math.max(a.count, b.count) }),
});
`, files);
      next.push(`Use it: ctx.save(${c}).update(d => { d.count++; })`);
      break;
    case 'kit': {
      const kdir = join(ROOT, 'src', 'kits', id);
      write(join(kdir, 'index.ts'), `/**
 * kits/${id}: <what it is for>. Cost: <draws, per-frame work>.
 */
import { defineKit, defineSystem, type KitDefinition, type SystemDefinition } from '../../author';

export function ${c}System(): SystemDefinition {
  return defineSystem({ id: '${id}-update', run(ctx) { void ctx; } });
}

export function ${c}(): KitDefinition { return defineKit({ id: '${id}' }); }
`, files);
      write(join(kdir, 'README.md'), `# kits/${id}

<Authorized creator requirement and reusable extension seam.>

Follow [the creator contract](../../../docs/CREATOR-CONTRACT.md). Complete this
record before claiming the kit is ready; placeholders are not passing evidence.

| Contract | Definition |
|---|---|
| Creator-owned semantics | <Rules and choices supplied by the application> |
| Inputs and outputs | <Schemas, units, identities and publication boundary> |
| Owner | <Lifetime and borrowed engine services> |
| Bounds | <Work, queues, memory, retention and retry limits> |
| Overload | <Reject, defer or degrade within the declared quality floor> |
| Cancellation and replacement | <How stale work is retired> |
| Failure and recovery | <Partial work, cleanup failures and recoverable state> |
| Evidence | <Consumer, tests, measured budgets and manual acceptance> |
| Limits | <Unsupported behavior and unverified claims> |
`, files);
      write(join(kdir, `${id}.test.ts`), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, testScene } from '../../author';
import { ${c}System } from './index';

test('${id} kit: its system runs', async () => {
  const t = await testScene(defineScene({ id: '${id}-kit-test', title: 'Test', systems: [${c}System()] }));
  t.run(0.1);
  assert.equal(t.world.count, 0);
});
`, files);
      next.push(`Use it from a game: import { ${c} } from '@kits/${id}'; kits: [${c}()]`, 'Follow docs/recipes/add-a-kit.md');
      break;
    }
    case 'interactable': {
      const door = typeof opts.door === 'string' ? opts.door : '';
      write(join(dir, `${id}.ts`), `// ${door ? `A door to '${door}'` : `A thing to use: '${id}'`} (explore kit). Put ${c}At(x, z) in a scene's entities; react to
// ctx.world.read('interact') with id '${id}'${door ? '' : ' in a system'}. Its label is the string key game.use.${id}.
import { Shape, Transform } from '@engine';
import { Solid } from '@kits/character';
import { Interactable } from '@kits/explore';

export const ${c}At = (x: number, z: number) => [
  Transform({ x, y: 0.5, z }), Shape({ kind: 'box', size: [1, 1, 1], color: ${door ? '0x4a2f1c' : '0xc9a46a'} }),${door ? '' : ' Solid({ halfX: 0.5, halfZ: 0.5 }),'}
  Interactable({ id: '${id}', label: 'game.use.${id}'${door ? `, to: '${door}', toX: 0, toZ: 0` : ''} }),
];
`, files);
      next.push(`Add the text: strings.en['game.use.${id}'] in game.ts`, `Place it: ${c}At(2, 0) in a scene's entities`);
      break;
    }
    case 'area': {
      write(join(dir, `${id}.ts`), `// ${P}: a scene to move around in (explore kit): walls, the player, a camera and the use prompt.
import { defineScene, Name, Shape, Transform } from '@engine';
import { cameraSystem } from '@kits/camera';
import { Character, characterSystem, Walls } from '@kits/character';
import { exploreSystem } from '@kits/explore';

export default defineScene({
  id: '${id}', title: '${P}', type: 'area',
  view: { camera: { position: [0, 9, 7], target: [0, 0, 0]${phone(brief) ? ', minWidthFov: 55' : ''} }, background: 0x9cc7e4 },
  entities: [
    [Transform(), Shape({ kind: 'plane', size: [30, 0, 30], color: 0x6fa05a })],
    [Walls({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 })],
    [Name({ name: 'player' }), Transform({ y: 0.7 }), Shape({ kind: 'capsule', size: [0.6, 1.4, 0.6], color: 0xf2c14e }), Character()],
  ],
  systems: [characterSystem(), exploreSystem(), cameraSystem('orbit', { distance: 11, pitch: 0.95 })],
});
`, files);
      addBudgetRow(dir, id, brief, files);
      changelog(dir, `Added area \`${id}\``, files);
      next.push(`Needs the kits ui, camera, character and explore in game.ts`, `Add things: npm run new -- interactable <id>`, `See it: npm run play:snap -- --scene ${id}`);
      break;
    }
    case 'lesson': {
      const { generateLesson } = await import('../src/kits/learn/generate');
      const made = generateLesson(dir, id, brief, ROOT);
      for (const f of made.files) write(join(ROOT, f), made.text[f], files);
      files.push(...made.strings);
      addBudgetRow(dir, id, brief, files);
      changelog(dir, `Added lesson \`${id}\``, files);
      next.push(...made.next);
      break;
    }
    default: throw Error(`unknown kind '${kind}': scene, entity, component, system, input, save-section, kit, interactable, area, lesson`);
  }
  return { files, next };
}

if (process.argv[1]?.endsWith('new.ts')) {
  const [kind, id, ...rest] = process.argv.slice(2);
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { const v = rest[i + 1]; if (v && !v.startsWith('--')) { opts[rest[i].slice(2)] = v; i++; } else opts[rest[i].slice(2)] = true; }
  if (!kind || !id) { console.log('usage: npm run new -- <scene|entity|component|system|input|save-section|kit|interactable|area|lesson> <id> [options]'); process.exit(kind ? 1 : 0); }
  try {
    const r = await generate(kind, id, opts);
    console.log(`new ${kind} ${id}:\n${r.files.map(f => '  + ' + f).join('\n')}\nNext:\n${r.next.map(n => '  - ' + n).join('\n')}`);
  } catch (e) { console.error('new: ' + (e as Error).message); process.exitCode = 1; }
}
