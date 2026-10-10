#!/usr/bin/env node
// scripts/capabilities.mjs (`npm run capabilities`): writes docs/capabilities.json and docs/capabilities.md, the
// generated record of what this checkout ships. Docs and skills drift when many PRs land at once (a page says a
// feature is missing minutes after it merged); this record is read from the code, so it cannot.
//
// Everything is derived from the tree:
//   engine     the value and type exports of `@engine` (src/author/index.ts), read with the TypeScript checker
//   kits       each `src/kits/<name>/index.ts` and its value exports
//   knobs      the quality knobs registered in src/platform/render/quality.ts, and whether anything outside the
//              registry, its types and the Graphics screen reads each one
//   scripts    the npm scripts in package.json
//   templates  the folders under templates/ with a game.ts
//   features   the feature IDs below. Each names its evidence in code; `shipped` is true only when every piece of
//              evidence is present in this checkout. The PR number is metadata for messages, not evidence.
//
// `npm run lint:docs-claims` regenerates both files in memory and fails when the committed ones differ, then uses the
// manifest to reject "not here yet" claims about features that have shipped (scripts/lint/docs-claims.mjs).
//
//   node scripts/capabilities.mjs          write docs/capabilities.json and docs/capabilities.md
//   node scripts/capabilities.mjs --check  exit 1 when either file is stale
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as prettier from 'prettier';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const JSON_PATH = 'docs/capabilities.json';
export const MD_PATH = 'docs/capabilities.md';
const REPO = 'https://github.com/Akilleez-QA/foundation-engine';

/**
 * Feature IDs and their evidence. Evidence kinds:
 *   {engine: 'Name'}             `@engine` exports the value Name
 *   {kit: 'name', export?: 'X'}  `@kits/name` exists (and exports the value X)
 *   {script: 'name'}             package.json has the npm script
 *   {template: 'name'}           templates/<name>/game/game.ts exists
 *   {path: 'rel/path'}           the file or folder exists
 *   {knobRead: 'id'}             engine code outside the knob registry reads the quality knob
 * Add a row when a feature with an ID (or a capability docs commonly call missing) lands or is planned. A planned row
 * (its evidence absent) is what lets a correct "not yet" claim pass the lint.
 * @type {readonly {id: string, title: string, pr?: number, docs?: string, evidence: readonly Record<string, string>[]}[]}
 */
export const FEATURES = [
  {
    id: 'NAV-FIELD-01',
    title: 'Optional incremental shared navigation distance fields',
    docs: 'src/kits/navigation/README.md',
    evidence: [{kit: 'navigation', export: 'createDistanceField'}, {path: 'src/kits/navigation/field.test.ts'}],
  },
  {
    id: 'WORK-01',
    title: 'Optional bounded fair work roster',
    docs: 'src/kits/work-roster/README.md',
    evidence: [{kit: 'work-roster', export: 'createWorkRoster'}, {path: 'src/kits/work-roster/consumers.test.ts'}],
  },
  {
    id: 'ASG-01',
    title: 'Optional bounded service and worksite assignment ownership',
    docs: 'docs/guides/assignments.md',
    evidence: [{kit: 'assignments', export: 'createAssignments'}],
  },
  {
    id: 'ITINERARY-01',
    title: 'Bounded editable destination itineraries with owned completion attempts',
    docs: 'src/kits/itinerary/README.md',
    evidence: [{kit: 'itinerary', export: 'createItinerary'}],
  },
  {
    id: 'ALN-01',
    title: 'Planar interaction preparation with bounded proposals and exact-ticket acknowledgment',
    docs: 'src/kits/alignment/README.md',
    evidence: [{kit: 'alignment', export: 'createAlignment'}, {path: 'src/kits/alignment/alignment.test.ts'}],
  },
  {
    id: 'REWIND-01',
    title: 'Bounded rewind history for judging remote commands against past state',
    docs: 'src/kits/rewind/README.md',
    evidence: [{kit: 'rewind', export: 'createRewindHistory'}, {path: 'src/kits/rewind/history.test.ts'}],
  },
  {
    id: 'NW-DELTA',
    title: 'Acknowledged-baseline deltas for complete network views',
    docs: 'src/kits/network/README.md',
    evidence: [{kit: 'network', export: 'createViewDeltaEncoder'}, {path: 'src/kits/network/view-delta.test.ts'}],
  },
  {
    id: 'VISIBILITY-01',
    title: 'Bounded source-owned visibility and explored history',
    docs: 'src/kits/visibility/README.md',
    evidence: [{kit: 'visibility', export: 'createVisibility'}],
  },
  {
    id: 'GEN-WEIGHTED',
    title: 'Bounded eligible weighted choice with separately committed recent history',
    docs: 'docs/guides/weighted-choice.md',
    evidence: [
      {kit: 'procgen', export: 'chooseWeighted'},
      {kit: 'procgen', export: 'createChoiceHistory'},
    ],
  },
  {
    id: 'CAP-EFFECT-CHECKPOINT',
    title: 'Portable timed contribution checkpoints',
    docs: 'docs/guides/timed-effects.md',
    evidence: [
      {kit: 'capabilities', export: 'createTimedEffects'},
      {path: 'src/kits/capabilities/timed-effects-checkpoint.test.ts'},
    ],
  },
  {
    id: 'VIS-01',
    title: 'Tone mapping and exposure per scene (view.output)',
    pr: 124,
    docs: 'docs/guides/scene-look.md',
    evidence: [{engine: 'validateSceneOutput'}, {engine: 'TONE_MAPPINGS'}],
  },
  {
    id: 'VIS-02',
    title: 'Point and spot lights in fixed per-scene slots',
    pr: 138,
    docs: 'docs/guides/scene-look.md',
    evidence: [{engine: 'PointLight'}, {engine: 'SpotLight'}, {engine: 'sceneLights'}],
  },
  {
    id: 'VIS-03',
    title: 'Shadows from the sun, local lights and shapes',
    pr: 148,
    docs: 'docs/guides/scene-look.md',
    evidence: [{engine: 'Shadow'}, {engine: 'sceneShadows'}],
  },
  {
    id: 'VIS-04',
    title: 'Material options (shading, double side, alpha cut-out, vertex colours) and Material on Mesh and Model',
    pr: 127,
    docs: 'docs/recipes/give-a-shape-a-material.md',
    evidence: [{engine: 'MATERIAL_SHADINGS'}, {engine: 'defineMaterial'}],
  },
  {
    id: 'VIS-05',
    title: 'Gradient sky, discs, stars and exponential haze',
    pr: 150,
    docs: 'docs/guides/scene-look.md',
    evidence: [{engine: 'validateSky'}, {engine: 'defineEnvironment'}],
  },
  {
    id: 'VIS-06',
    title: 'Instanced scatter of a Shape or Mesh (one draw per scatter)',
    pr: 144,
    docs: 'docs/guides/scatter.md',
    evidence: [{engine: 'Scatter'}, {engine: 'defineScatter'}, {engine: 'sceneScatter'}],
  },
  {
    id: 'VIS-10',
    title: 'Blob (contact) shadows: one instanced draw of soft ground ellipses where no real shadow reaches',
    docs: 'docs/guides/blob-shadows.md',
    evidence: [{engine: 'BlobShadow'}, {engine: 'sceneBlobShadows'}, {script: 'test:blob-shadows-browser'}],
  },
  {
    id: 'VIS-09',
    title: 'Opt-in full three.js kit (@kits/three)',
    pr: 136,
    evidence: [{kit: 'three'}],
  },
  {
    id: 'VIS-11',
    title: 'Procedural interior reflection environment (reflection kind interior)',
    pr: 183,
    docs: 'docs/guides/scene-look.md',
    evidence: [{engine: 'validateInteriorReflection'}, {engine: 'INTERIOR_REFLECTION_LIMITS'}],
  },
  {
    id: 'POST-01',
    title: 'Post-processing (bloom, vignette, grade): a consumer of the post.mode quality knob',
    pr: 161,
    docs: 'docs/guides/post-processing.md',
    evidence: [{knobRead: 'post.mode'}],
  },
  {
    id: 'POST-02',
    title: 'Post grade lookup tables (.cube, view.post.grade.lut) and an HDR ceiling before bloom (view.post.ceiling)',
    pr: 179,
    docs: 'docs/guides/post-processing.md',
    evidence: [{engine: 'cubeLutText'}, {engine: 'parseCubeLut'}, {path: 'src/platform/render/post/lut.ts'}],
  },
  {
    id: 'FX-01',
    title: 'Particle emitters',
    pr: 63,
    docs: 'docs/guides/particles.md',
    evidence: [{engine: 'Emitter'}, {engine: 'defineEmitter'}, {engine: 'sceneParticles'}],
  },
  {
    id: 'FX-01a',
    title: 'Flipbook (sprite-sheet) particles and npm run fx:pack',
    pr: 141,
    docs: 'docs/guides/particles.md',
    evidence: [{script: 'fx:pack'}],
  },
  {
    id: 'GEN-01',
    title: 'Seeded hierarchical generation (deriveSeed)',
    docs: 'docs/kits/README.md',
    evidence: [{kit: 'procgen', export: 'deriveSeed'}],
  },
  {
    id: 'GRID-01',
    title: 'Atomic sparse cell batches and bounded immutable occupancy queries',
    docs: 'docs/guides/cell-occupancy.md',
    evidence: [
      {kit: 'spatial', export: 'createOccupancy'},
      {kit: 'procgen', export: 'CELL_BATCH_CEILING'},
    ],
  },
  {
    id: 'GEN-02',
    title: 'Bounded binary record store for large edited worlds',
    pr: 56,
    docs: 'docs/recipes/store-large-world-records.md',
    evidence: [{kit: 'procgen', export: 'listChunkDatabases'}],
  },
  {
    id: 'MP-01',
    title: 'Newcomer shared session (LAN/loopback) and npm run host',
    pr: 61,
    docs: 'docs/guides/multiplayer-session.md',
    evidence: [
      {kit: 'network', export: 'createSession'},
      {kit: 'network', export: 'createSessionHost'},
      {script: 'host'},
    ],
  },
  {
    id: 'KTX2',
    title: 'KTX2 (Basis Universal) model textures',
    pr: 146,
    docs: 'docs/guides/compressed-textures.md',
    evidence: [{path: 'src/platform/assets/model-ktx2.ts'}],
  },
  {
    id: 'DX-03',
    title: 'Asset provenance records and npm run disclosure',
    pr: 137,
    docs: 'docs/guides/asset-provenance.md',
    evidence: [{script: 'disclosure'}, {script: 'lint:provenance'}],
  },
  {
    id: 'ASSET-VERIFY',
    title: 'Model contracts (npm run asset:verify)',
    pr: 126,
    docs: 'docs/guides/model-contracts.md',
    evidence: [{script: 'asset:verify'}],
  },
  {
    id: 'ASSET-OPTIMIZE',
    title: 'Model optimisation (npm run asset:optimize)',
    pr: 135,
    evidence: [{script: 'asset:optimize'}],
  },
  {
    id: 'SHOWCASE',
    title: 'The showcase template',
    pr: 128,
    docs: 'templates/showcase/README.md',
    evidence: [{template: 'showcase'}],
  },
  {
    id: 'POSE-TO-POSE',
    title: 'Pose-to-pose rigging and animation pipeline',
    pr: 142,
    docs: 'docs/recipes/animate-pose-to-pose.md',
    evidence: [{path: 'tools/pose-to-pose/pipeline.mjs'}],
  },
  {
    id: 'WEBGPU',
    title: 'WebGPU render backend',
    docs: 'docs/guides/render-backend.md',
    evidence: [{path: 'src/platform/render/backends/webgpu'}],
  },
  {
    id: 'PHYSICS',
    title: 'Rigid-body physics',
    evidence: [{kit: 'physics'}],
  },
];

const posix = p => p.split('\\').join('/');

/** Value and type exports of each module, resolved through `export *` and re-exports by the TypeScript checker. */
export function moduleExports(files, root = ROOT) {
  const program = ts.createProgram(
    files.map(f => join(root, f)),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
  );
  const checker = program.getTypeChecker();
  const out = {};
  for (const f of files) {
    const source = program.getSourceFile(join(root, f));
    const symbol = source && checker.getSymbolAtLocation(source);
    const values = [];
    const types = [];
    for (const s of symbol ? checker.getExportsOfModule(symbol) : []) {
      const target = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
      (target.flags & ts.SymbolFlags.Value ? values : types).push(s.name);
    }
    out[f] = {values: values.sort(), types: types.sort()};
  }
  return out;
}

const REGISTRY = new Set([
  'src/platform/render/quality.ts',
  'src/platform/render/quality-knobs.ts',
  'src/platform/ui/graphics-screen.ts',
]);

function sourceFiles(root, dir) {
  const out = [];
  const walk = d => {
    for (const e of readdirSync(join(root, d), {withFileTypes: true})) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'generated' && e.name !== 'node_modules') walk(rel);
      } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

/** The registered quality knobs, each with whether engine code outside the registry reads it. */
export function knobs(root = ROOT) {
  const quality = readFileSync(join(root, 'src/platform/render/quality.ts'), 'utf8');
  const ids = [...quality.matchAll(/^\s+id: '([a-z-]+\.[a-z-]+)',$/gm)].map(m => m[1]);
  const sources = sourceFiles(root, 'src')
    .filter(f => !REGISTRY.has(f))
    .map(f => [f, readFileSync(join(root, f), 'utf8')]);
  return ids.map(id => ({
    id,
    readBy: sources.filter(([, text]) => text.includes(`'${id}'`) || text.includes(`"${id}"`)).map(([f]) => f),
  }));
}

/** Build the manifest from the tree. */
export function buildManifest(root = ROOT) {
  const kitNames = readdirSync(join(root, 'src/kits'), {withFileTypes: true})
    .filter(e => e.isDirectory() && existsSync(join(root, 'src/kits', e.name, 'index.ts')))
    .map(e => e.name)
    .sort();
  const files = ['src/author/index.ts', ...kitNames.map(k => `src/kits/${k}/index.ts`)];
  const exportsOf = moduleExports(files, root);
  const engine = exportsOf['src/author/index.ts'];
  const kits = kitNames.map(name => {
    const file = `src/kits/${name}/index.ts`;
    return {name, exports: exportsOf[file].values};
  });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts = Object.keys(pkg.scripts ?? {}).sort();
  const templates = readdirSync(join(root, 'templates'), {withFileTypes: true})
    .filter(e => e.isDirectory() && existsSync(join(root, 'templates', e.name, 'game', 'game.ts')))
    .map(e => e.name)
    .sort();
  const knobList = knobs(root);
  const kitByName = new Map(kits.map(k => [k.name, k]));
  const has = ev => {
    if (ev.engine) return engine.values.includes(ev.engine);
    if (ev.kit) return kitByName.has(ev.kit) && (!ev.export || kitByName.get(ev.kit).exports.includes(ev.export));
    if (ev.script) return scripts.includes(ev.script);
    if (ev.template) return templates.includes(ev.template);
    if (ev.path) return existsSync(join(root, ev.path));
    if (ev.knobRead) return (knobList.find(k => k.id === ev.knobRead)?.readBy.length ?? 0) > 0;
    throw Error(`capabilities: unknown evidence ${JSON.stringify(ev)}`);
  };
  const features = FEATURES.map(f => ({
    id: f.id,
    title: f.title,
    shipped: f.evidence.every(has),
    ...(f.pr ? {pr: f.pr} : {}),
    ...(f.docs ? {docs: f.docs} : {}),
    evidence: f.evidence.map(describe),
  }));
  return {
    $comment: 'Generated by npm run capabilities from the code. Do not edit; npm run lint:docs-claims checks it.',
    features,
    engine: {module: '@engine', values: engine.values, types: engine.types},
    kits,
    knobs: knobList,
    templates,
    scripts,
  };
}

/** One piece of evidence, in words. */
export function describe(ev) {
  if (ev.engine) return `@engine exports ${ev.engine}`;
  if (ev.kit) return ev.export ? `@kits/${ev.kit} exports ${ev.export}` : `@kits/${ev.kit} exists`;
  if (ev.script) return `npm run ${ev.script}`;
  if (ev.template) return `templates/${ev.template}`;
  if (ev.path) return `${ev.path} exists`;
  if (ev.knobRead) return `engine code reads the ${ev.knobRead} knob`;
  return JSON.stringify(ev);
}

/** The human-readable page. */
export function renderMarkdown(m) {
  const pr = f => (f.pr ? `[#${f.pr}](${REPO}/pull/${f.pr})` : '');
  const link = f => (f.docs ? `[${f.docs.split('/').pop()}](${posix(relativeFromDocs(f.docs))})` : '');
  const row = f => `| ${f.id} | ${f.title} | ${pr(f)} | ${link(f)} |`;
  const shipped = m.features.filter(f => f.shipped);
  const planned = m.features.filter(f => !f.shipped);
  const lines = [
    '# Capabilities',
    '',
    '<!-- Generated by `npm run capabilities` from the code. Do not edit; `npm run lint:docs-claims` checks it. -->',
    '',
    'What this checkout ships, read from the code: the source of truth when a page and the code disagree. The',
    'machine-readable form is [capabilities.json](capabilities.json). A feature counts as shipped only when all of its',
    'evidence (exports, kits, scripts, files) is present; that says it exists on this revision, not that it has device',
    'acceptance (see the [acceptance ledger](guides/upgrade-acceptance-ledger.md)).',
    '',
    // Lists are one item per line so pull requests that each add an export, script or kit merge without conflict.
    '## Shipped features',
    '',
    '| ID | Feature | PR | Docs |',
    '|---|---|---|---|',
    ...shipped.map(row),
    '',
    '## Not shipped yet',
    '',
    'Tracked so that a correct "not yet" in the docs is recognised. A row moves up when its evidence lands.',
    '',
    '| ID | Feature | PR | Docs |',
    '|---|---|---|---|',
    ...planned.map(row),
    '',
    '## Kits',
    '',
    "Each kit's value exports are listed in [capabilities.json](capabilities.json).",
    '',
    ...m.kits.map(k => `- \`@kits/${k.name}\``),
    '',
    '## Templates',
    '',
    ...m.templates.map(t => `- \`${t}\``),
    '',
    '## Quality knobs',
    '',
    '| Knob | Read by engine code |',
    '|---|---|',
    ...m.knobs.map(
      k => `| \`${k.id}\` | ${k.readBy.length ? k.readBy.map(f => `\`${f}\``).join(', ') : 'registry only'} |`,
    ),
    '',
    '## `@engine` value exports',
    '',
    ...m.engine.values.map(v => `- \`${v}\``),
    '',
    '## npm scripts',
    '',
    ...m.scripts.map(s => `- \`${s}\``),
    '',
  ];
  return lines.join('\n');
}

const relativeFromDocs = p => (p.startsWith('docs/') ? p.slice(5) : `../${p}`);

/** Both files as they would be written (JSON formatted by the repository's Prettier settings). */
export async function render(root = ROOT) {
  const m = buildManifest(root);
  const options = (await prettier.resolveConfig(join(root, JSON_PATH))) ?? {};
  const json = await prettier.format(JSON.stringify(m), {...options, parser: 'json'});
  return {manifest: m, json, md: renderMarkdown(m)};
}

/** The committed files that differ from the generated ones. */
export async function staleFiles(root = ROOT) {
  const {json, md} = await render(root);
  const read = p => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
  return [
    [JSON_PATH, json],
    [MD_PATH, md],
  ]
    .filter(([p, text]) => read(p) !== text)
    .map(([p]) => p);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const stale = await staleFiles();
    if (stale.length) {
      console.error(`capabilities: ${stale.join(' and ')} out of date; run npm run capabilities`);
      process.exit(1);
    }
    console.log('capabilities: up to date');
  } else {
    const {json, md, manifest} = await render();
    writeFileSync(join(ROOT, JSON_PATH), json);
    writeFileSync(join(ROOT, MD_PATH), md);
    const shipped = manifest.features.filter(f => f.shipped).map(f => f.id);
    console.log(
      `capabilities: wrote ${JSON_PATH} and ${MD_PATH} (${shipped.length}/${manifest.features.length} features shipped: ${shipped.join(', ')})`,
    );
  }
}
