import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {
  defineBuild,
  defineGame,
  defineScene,
  defineSystem,
  defineAsset,
  defineSaveSection,
  Name,
  Transform,
  Model,
} from '../../../src/author/index.ts';
import {browserPort} from '../../../src/core/save/storage-port.ts';
import {createTestApi} from '../../../src/dev/test-api.ts';
import {createAppearanceDocument} from '../../../src/kits/character/appearance.ts';
import {createAuthoringSession} from '../../../src/kits/authoring/session.ts';
import {BufferGeometry, Material, Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// Test-only accounting for decode-cancellation cycles: every dispose is remembered by identity, and while a cycle is
// armed each parse result's geometry, materials, textures and decoded bitmaps are recorded for that cycle.
const disposedResources = new WeakSet(),
  decodeTrack = {cycle: null, parsed: {}};
for (const proto of [BufferGeometry.prototype, Material.prototype, Texture.prototype]) {
  const dispose = proto.dispose;
  proto.dispose = function () {
    disposedResources.add(this);
    return dispose.call(this);
  };
}
{
  const parseAsync = GLTFLoader.prototype.parseAsync;
  GLTFLoader.prototype.parseAsync = async function (...args) {
    const cycle = decodeTrack.cycle,
      result = await parseAsync.apply(this, args);
    if (cycle === null) return result;
    const found = {geometry: new Set(), material: new Set(), texture: new Set(), bitmap: new Set()};
    result.scene.traverse(node => {
      if (node.geometry) found.geometry.add(node.geometry);
      for (const material of [node.material ?? []].flat()) {
        found.material.add(material);
        for (const value of Object.values(material))
          if (value?.isTexture) {
            found.texture.add(value);
            if (typeof value.image?.close === 'function') found.bitmap.add(value.image);
          }
      }
    });
    (decodeTrack.parsed[cycle] ??= []).push(found);
    return result;
  };
}
const initial = {version: 1, parts: {form: 'first'}, parameters: {}};
const names = ['first', 'second', 'slow', 'failed', 'missing', 'decoded'];
const intake = value =>
  createAppearanceDocument({
    id: 'preview-model',
    json: JSON.stringify(value),
    version: 1,
    limits: {maxBytes: 1024, maxNodes: 16, maxDepth: 4, maxParts: 1, maxParameters: 0},
    validate: v => Object.keys(v.parts).length === 1 && names.includes(v.parts.form),
  });
const section = defineSaveSection({
  id: 'model.profile',
  scope: 'device',
  initial,
  parse(value) {
    const d = intake(value);
    const out = d.read().value;
    d.dispose();
    return out;
  },
});
const brief = defineBuild({
  goal: 'Preview asynchronous model candidates without losing the accepted selection.',
  genre: 'diagnostic',
  pitch: 'Owned model candidates.',
  coreLoop: ['Preview', 'Accept', 'Save'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Failed and cancelled loads preserve accepted models and saved appearance.',
      how: 'playtest',
      by: 'scripts/play/model-preview-check.mjs',
    },
  ],
});
const game = defineGame({id: 'model-preview', version: '0.1.0', title: 'Model preview', firstScene: 'sample'});
const assets = names.map(id =>
  defineAsset({
    id,
    type: 'model',
    url: `/__model-preview/${id}.glb`,
    licence: 'CC0-1.0',
    author: 'Foundation Engine contributors',
    source: 'templates/mechanics/game/tools/generate-fixture.mjs',
  }),
);
let ctx,
  accepted = null,
  candidate = null,
  documentOwner,
  session,
  save,
  life,
  retired = true,
  message = '',
  lastStatus = '';
const el = id => document.getElementById(id);
const storageKey = 'model-preview|device|model.profile',
  local = browserPort('local');
let presenceKnown = false,
  observedPersistenceStatus,
  storedEnvelopeExists = false;
const persistence = () => {
  if (retired || !save) return null;
  const status = save.status(),
    matches = JSON.stringify(save.get()) === documentOwner.read().json;
  if (!presenceKnown || status !== observedPersistenceStatus) {
    storedEnvelopeExists = false;
    try {
      storedEnvelopeExists = local.get(storageKey) !== null;
    } catch {}
    presenceKnown = true;
    observedPersistenceStatus = status;
  }
  return status === 'saved'
    ? matches
      ? storedEnvelopeExists
        ? 'saved'
        : 'not-saved'
      : 'unsaved'
    : `unsaved:${status}`;
};
const readEntity = e =>
  e === null
    ? null
    : {
        entity: e,
        ...ctx.modelState(e),
        visible: ctx.modelState(e).status === 'ready' && (ctx.world.get(e, Model)?.visible ?? false),
        x: ctx.world.get(e, Transform)?.x ?? null,
      };
const read = () => ({
  retired,
  message,
  value: documentOwner?.read().value,
  draft: session?.readPreview()?.value ?? null,
  accepted: ctx ? readEntity(accepted) : null,
  candidate: ctx ? readEntity(candidate) : null,
  count: ctx?.world.count ?? 0,
  save: persistence(),
  saveStatus: retired ? null : (save?.status() ?? null),
});
const show = () => {
  const s = read();
  el('state').textContent = JSON.stringify(s, null, 2);
  el('commit').disabled = retired || !s.candidate || s.candidate.status !== 'ready' || !s.candidate.visible;
  el('save').disabled = retired || !s.accepted?.visible;
  el('retry').disabled = retired || (s.accepted?.status === 'ready' && !s.accepted.visible);
};
const spawn = (asset, x, visible) =>
  ctx.world.spawn(
    Name({name: x < 0 ? 'accepted' : 'candidate'}),
    Transform({x}),
    Model({asset, playing: false, visible}),
  );
const cancel = () => {
  if (candidate !== null) ctx.world.despawn(candidate);
  candidate = null;
  session.cancel();
  ctx.world.touch();
};
const commands = {
  preview() {
    cancel();
    const form = el('form').value;
    const prepared = session.preview(documentOwner.read().ticket, () =>
      JSON.stringify({version: 1, parts: {form}, parameters: {}}),
    );
    if (prepared.status !== 'prepared') throw Error(`Preview ${prepared.status}`);
    candidate = spawn(form, 0.8, false);
    message = 'Loading hidden candidate; accepted model retained.';
  },
  cancel() {
    cancel();
    message = 'Candidate cancelled.';
  },
  commit() {
    if (candidate === null || ctx.modelState(candidate).status !== 'ready' || !ctx.world.get(candidate, Model).visible)
      throw Error('Candidate is not ready.');
    const result = session.commit();
    if (result.status !== 'accepted') throw Error(`Commit ${result.status}`);
    ctx.world.despawn(accepted);
    accepted = candidate;
    candidate = null;
    ctx.world.get(accepted, Transform).x = -0.8;
    ctx.world.touch();
    message = 'Accepted candidate.';
  },
  save() {
    if (ctx.modelState(accepted).status !== 'ready' || !ctx.world.get(accepted, Model).visible)
      throw Error('Accepted model needs compatibility recovery before saving.');
    save.update(draft => Object.assign(draft, structuredClone(documentOwner.read().value)), {now: true});
    presenceKnown = false;
    message = `Save ${persistence()}.`;
  },
  retry() {
    cancel();
    ctx.world.despawn(accepted);
    accepted = spawn(documentOwner.read().value.parts.form, -0.8, false);
    ctx.world.touch();
    message = 'Retrying accepted model without changing saved selection.';
  },
  reload() {
    location.reload();
  },
};
const frame = defineSystem({
  id: 'model-preview-state',
  phase: 'frame',
  run() {
    if (retired) return;
    if (candidate !== null) {
      const state = ctx.modelState(candidate),
        model = ctx.world.get(candidate, Model);
      if (state.status === 'ready' && !model.visible) {
        if (ctx.modelSocket(candidate, 'hand')) {
          model.visible = true;
          ctx.world.touch();
          message = 'Candidate ready. Compare, Commit or Cancel.';
        } else {
          message = 'Required socket missing. Accepted model retained.';
        }
      }
      if (state.status === 'failed') message = 'Candidate load failed. Cancel or preview another selection.';
    }
    if (ctx.modelState(accepted).status === 'ready' && !ctx.world.get(accepted, Model).visible) {
      if (ctx.modelSocket(accepted, 'hand')) {
        ctx.world.get(accepted, Model).visible = true;
        ctx.world.touch();
        message = 'Accepted model ready.';
      } else
        message =
          'Accepted model is incompatible: required socket missing. Saved selection retained; Reload after fixing the asset, or preview another selection. Retry cannot refresh cached asset bytes.';
    }
    if (ctx.modelState(accepted).status === 'failed')
      message = 'Accepted selection could not load. Retry preserves the saved selection.';
    const signature = JSON.stringify(read());
    if (signature !== lastStatus) {
      lastStatus = signature;
      show();
    }
  },
});
const scene = defineScene({
  id: 'sample',
  title: 'Asynchronous candidates',
  systems: [frame],
  view: {camera: {position: [0, 1.8, 4], target: [0, 0.6, 0], fov: 42}, background: 0x243347},
  enter(context) {
    ctx = context;
    retired = false;
    presenceKnown = false;
    life = new AbortController();
    save = ctx.save(section);
    documentOwner = intake(save.get());
    session = createAuthoringSession(documentOwner, {maxEntries: 8, maxHistoryBytes: 16384});
    accepted = spawn(documentOwner.read().value.parts.form, -0.8, false);
    candidate = null;
    el('form').value = documentOwner.read().value.parts.form;
    message = 'Accepted appearance loading.';
    for (const [id, fn] of Object.entries(commands))
      el(id).addEventListener(
        'click',
        () => {
          try {
            fn();
          } catch (error) {
            message = String(error);
          }
          show();
        },
        {signal: life.signal},
      );
    el('form').addEventListener(
      'change',
      () => {
        cancel();
        message = 'Selection changed; preview again.';
        show();
      },
      {signal: life.signal},
    );
    show();
  },
  exit() {
    retired = true;
    life.abort();
    session.dispose();
    documentOwner.dispose();
    if (candidate !== null) ctx.world.despawn(candidate);
    if (accepted !== null) ctx.world.despawn(accepted);
    candidate = null;
    accepted = null;
  },
});
const compiled = compileGame({brief, game, defs: [scene, frame, section, ...assets]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  flag: id => appFeatures().enabled(id),
  probes: true,
});
let models;
const booted = app.boot();
window.engine = createTestApi(app, booted);
window.modelPreview = {
  read,
  resources: () => models?.stats(),
  queryRepeated() {
    for (let i = 0; i < 100; i++) {
      if (accepted !== null) ctx.modelState(accepted);
      if (candidate !== null) ctx.modelState(candidate);
    }
  },
  dispose() {
    app.dispose();
  },
  decodeTrack: {
    arm(cycle) {
      decodeTrack.cycle = cycle;
    },
    disarm() {
      decodeTrack.cycle = null;
    },
    read(cycle) {
      const parsed = decodeTrack.parsed[cycle] ?? [],
        held = new Set(window.__decodeHold.held.filter(h => h.cycle === cycle).map(h => h.bitmap)),
        count = kind => {
          const all = parsed.flatMap(p => [...p[kind]]);
          return {
            total: all.length,
            released: all.filter(r => (kind === 'bitmap' ? r.width === 0 && r.height === 0 : disposedResources.has(r)))
              .length,
          };
        };
      return {
        parses: parsed.length,
        geometry: count('geometry'),
        material: count('material'),
        texture: count('texture'),
        bitmap: count('bitmap'),
        heldBitmapsInParse: parsed.flatMap(p => [...p.bitmap]).filter(b => held.has(b)).length,
      };
    },
  },
};
await booted;
models = app.services.models;
