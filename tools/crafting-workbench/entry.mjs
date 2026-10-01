import '../../src/app/styles.ts';
import './style.css';
import { createApp } from '../../src/core/app.ts';
import { appFeatures } from '../../src/core/settings/app-features.ts';
import { layerModules } from '../../src/app/layer-modules.ts';
import { compileGame } from '../../src/author/compile.ts';
import {
  defineBuild,
  defineGame,
  defineScene,
  defineSaveSection,
  Name,
  Transform,
  Shape,
} from '../../src/author/index.ts';
import { createTestApi } from '../../src/dev/test-api.ts';
import { saveModule } from '../../src/core/save/module.ts';
import { browserPort } from '../../src/core/save/storage-port.ts';
import { createEditorController } from './editor-controller.mjs';
import {
  recipeSectionDefinition,
  recipeStorageKey,
  createRecipeStoragePort,
} from './recipe.mjs';
import {
  createRuntimeController,
  createRuntimeStoragePort,
  runtimeSectionDefinition,
  runtimeStorageKey,
} from './runtime-controller.mjs';
import { createSurveyAdapter } from './survey.mjs';
const definition = (d) => {
  const section = defineSaveSection({ ...d, initial: d.initial() });
  section.section = d;
  return section;
};
const recipeSection = definition(recipeSectionDefinition),
  runtimeSection = definition(runtimeSectionDefinition),
  saveBuild = 'crafting@0.1.0';
const brief = defineBuild({
  goal: 'Inspect creator recipes and coherently reserve, experiment and produce finite material.',
  genre: 'diagnostic',
  pitch: 'Optional recipe and production workbench.',
  coreLoop: ['Edit', 'Preview', 'Reserve', 'Experiment', 'Produce'],
  devices: {
    targets: ['desktop'],
    minimum: 'desktop',
    input: ['keyboard', 'pointer'],
  },
  success: [
    {
      id: 'S1',
      check:
        'Definition edits remain isolated from accepted material custody, production and historical facts.',
      how: 'playtest',
      by: 'scripts/play/crafting-workbench-check.mjs',
    },
  ],
});
const game = defineGame({
  id: 'crafting-workbench',
  version: '0.1.0',
  title: 'Crafting workbench',
  firstScene: 'sample',
});
const guarded = createRecipeStoragePort(
    createRuntimeStoragePort(browserPort('local')),
  ),
  failureKey = 'crafting-refuse-runtime';
const storage = {
  ...guarded,
  set(key, value) {
    if (
      key === runtimeStorageKey &&
      sessionStorage.getItem(failureKey) === 'yes'
    )
      throw Error('Intentional runtime storage refusal');
    guarded.set(key, value);
  },
};
let editor,
  runtime,
  survey,
  context,
  life,
  sheet,
  runtimeResume = null,
  draft = null,
  prepared = null,
  retainedSurvey = null,
  message = '',
  lastResult = null,
  pane = 'editor',
  signature = '',
  projection = '',
  entities = [];
const el = (id) => document.getElementById(id),
  clone = structuredClone,
  number = (id) => Number(el(id).value),
  id = () => crypto.randomUUID();
const options = (select, values) => {
  const old = select.value;
  select.replaceChildren(
    ...values.map((value) => {
      const row = document.createElement('option');
      row.value = value;
      row.textContent = value;
      return row;
    }),
  );
  if (values.includes(old)) select.value = old;
};
const recipe = () => draft ?? editor.read().recipe;
function fields() {
  if (!el('details')) return;
  const r = recipe();
  options(
    el('slot'),
    r.slots.map((s) => s.id),
  );
  options(
    el('attribute'),
    r.attributes.map((a) => a.id),
  );
  options(el('output-property'), [
    'massMg',
    'volumeUl',
    ...Object.keys(r.output.properties),
  ]);
  const slot = r.slots.find((s) => s.id === el('slot').value),
    attribute = r.attributes.find((a) => a.id === el('attribute').value),
    model =
      r.output[el('output-property').value] ??
      r.output.properties[el('output-property').value];
  for (const name of ['slot-materials', 'slot-unit', 'slot-quantity'])
    el(name).disabled = !slot;
  el('slot-materials').value = slot?.materials.join(',') ?? '';
  el('slot-unit').value = slot?.unit ?? '';
  el('slot-quantity').value = slot?.quantity ?? '';
  for (const name of [
    'attribute-weights',
    'attribute-initial',
    'attribute-gain',
    'attribute-effect',
  ])
    el(name).disabled = !attribute;
  el('attribute-weights').value =
    attribute?.weights
      .map((w) => `${w.slot} / ${w.property} / ${w.weight}`)
      .join('\n') ?? '';
  for (const [field, key] of [
    ['attribute-initial', 'initialPermille'],
    ['attribute-gain', 'gainPermille'],
    ['attribute-effect', 'effectPermille'],
  ])
    el(field).value = attribute?.[key] ?? '';
  el('point-limit').value = r.pointLimit;
  el('output-base').value = model.base;
  el('output-terms').value = model.terms
    .map((t) => `${t.attribute} / ${t.coefficient}`)
    .join('\n');
  el('recipe-json').value = JSON.stringify(r, null, 2);
}
function applyFields() {
  const r = clone(recipe()),
    slot = r.slots.find((s) => s.id === el('slot').value),
    attribute = r.attributes.find((a) => a.id === el('attribute').value),
    model =
      r.output[el('output-property').value] ??
      r.output.properties[el('output-property').value];
  if (slot) {
    slot.materials = el('slot-materials')
      .value.split(',')
      .map((s) => s.trim());
    slot.unit = el('slot-unit').value;
    slot.quantity = number('slot-quantity');
  }
  if (attribute) {
    attribute.weights = el('attribute-weights')
      .value.split('\n')
      .filter(Boolean)
      .map((line) => {
        const [slot, property, weight] = line.split('/').map((s) => s.trim());
        return { slot, property, weight: Number(weight) };
      });
    attribute.initialPermille = number('attribute-initial');
    attribute.gainPermille = number('attribute-gain');
    attribute.effectPermille = number('attribute-effect');
  }
  r.pointLimit = number('point-limit');
  model.base = number('output-base');
  model.terms = el('output-terms')
    .value.split('\n')
    .filter(Boolean)
    .map((line) => {
      const [attribute, coefficient] = line.split('/').map((s) => s.trim());
      return { attribute, coefficient: Number(coefficient) };
    });
  draft = r;
  el('draft-status').textContent =
    'Draft changed; validation and commit remain explicit.';
  fields();
  return { status: 'draft' };
}
function project() {
  const r = runtime.read(),
    positions = r.blocked ? [] : r.view.stock.positions,
    next = JSON.stringify(positions);
  if (next === projection) return;
  const created = [];
  try {
    for (const [i, p] of positions.entries()) {
      const lane = p.container.startsWith('source')
        ? -3
        : p.container.includes('holding')
          ? -1
          : p.container.includes('output')
            ? 3
            : 1;
      created.push(
        context.world.spawn(
          Name({ name: `stock:${p.container}:${p.batch}` }),
          Transform({
            x: lane,
            y: 0.2 + p.quantity * 0.04,
            z: ((i % 5) - 2) * 0.8,
          }),
          Shape({
            kind: 'box',
            size: [0.55, 0.4 + p.quantity * 0.08, 0.55],
            color: p.container.includes('output') ? 0xe7bd67 : 0x75cabb,
          }),
        ),
      );
    }
  } catch (error) {
    created.forEach((e) => context.world.despawn(e));
    throw error;
  }
  entities.forEach((e) => context.world.despawn(e));
  entities = created;
  projection = next;
  context.world.touch();
}
function render() {
  if (!editor || !runtime) return;
  const e = editor.read(),
    r = runtime.read();
  el('compact-status').textContent =
    `Recipe ${e.recipe.id} v${e.recipe.version} · ${r.view.sessions.length} sessions · time ${r.view.clock}${r.pending ? ' · publication pending' : ''}`;
  if (!el('details')) return;
  for (const name of ['editor', 'runtime', 'survey'])
    el(`${name}-pane`).hidden = pane !== name;
  el('revisions').textContent =
    `Editable document r${e.revision}; accepted sessions retain their own recipe and batch facts.`;
  el('editor-message').textContent = e.blocked ?? e.message;
  el('recipe-values').textContent =
    e.evaluation?.status === 'evaluated'
      ? e.evaluation.values
          .map((v) => `${v.id}: ceiling ${v.ceiling}, initial ${v.value}`)
          .join('; ')
      : (e.evaluation?.reason ?? 'No isolated preview');
  el('commit-recipe').disabled = !e.candidate || !!e.blocked;
  el('sessions').replaceChildren(
    ...r.view.sessions.map((s) => {
      const row = document.createElement('p');
      row.textContent = `${s.id}: ${s.phase}; recipe ${s.recipe.id} v${s.recipe.version}; ${s.values.map((v) => `${v.id}=${v.value}`).join(', ')}${s.machine ? `; ${s.machine} cycle ${s.cycle}` : ''}`;
      return row;
    }),
  );
  options(
    el('session'),
    r.view.sessions.map((s) => s.id),
  );
  el('experiment').disabled = !r.view.sessions.find(
    (s) => s.id === el('session').value,
  )?.recipe.attributes.length;
  for (const name of ['from', 'to', 'capacity-container', 'harvest-container'])
    options(
      el(name),
      r.view.stock.containers.map((c) => c.id),
    );
  options(
    el('batch'),
    r.view.stock.batches.map((b) => b.id),
  );
  options(
    el('spawn'),
    r.view.spawns.map((s) => s.id),
  );
  el('stock').replaceChildren(
    ...r.view.stock.positions.map((p) => {
      const tr = document.createElement('tr'),
        batch = r.view.stock.batches.find((b) => b.id === p.batch);
      for (const value of [
        p.container,
        p.batch,
        p.quantity,
        p.quantity * batch.massMg,
      ]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      return tr;
    }),
  );
  el('machines').textContent =
    r.view.machines
      .map(
        (m) =>
          `${m.id}: ${m.progressJ} J, completed ${m.completed}${m.active ? ' (work protected)' : ''}`,
      )
      .join('; ') || 'No assigned machine';
  const spawn = r.view.spawns.find((s) => s.id === el('spawn').value);
  el('spawn-status').textContent = spawn
    ? `${spawn.id} incarnation ${spawn.incarnation}; remaining ${spawn.remaining}; expires ${spawn.deposit.expiresTick}`
    : 'No spawn';
  const observed = survey.read();
  el('survey-status').textContent =
    `${observed.status}: ${observed.points.length} observed points`;
  el('survey-map').replaceChildren(
    ...observed.points.map((p) => {
      const circle = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle',
      );
      circle.setAttribute('cx', 20 + p.x * 40);
      circle.setAttribute('cy', 20 + p.z * 40);
      circle.setAttribute('r', 3 + p.abundance * 12);
      circle.setAttribute('fill', '#75cabb');
      return circle;
    }),
  );
  el('candidate').textContent = prepared
    ? `${prepared.payload.kind}: ${r.pending ? 'exact pending envelope retained' : 'prepared, not accepted'}`
    : r.pending
      ? 'Pending exact envelope'
      : 'No candidate';
  el('commit-runtime').disabled = !prepared || r.pending || !!r.blocked;
  el('cancel-runtime').disabled = !prepared || r.pending;
  el('retry-runtime').disabled = !r.pending || !!r.blocked;
  el('ack-runtime').disabled = !r.canAcknowledge || !!r.blocked;
  el('persistence').textContent =
    `Recipe ${e.saveStatus} (${e.durable ? 'durable' : 'unsaved'}); runtime ${r.saveStatus} (${r.pending ? 'old accepted state retained' : r.durable ? 'durable' : 'unsaved'})${r.blocked ? `; recovery required: ${r.blocked}` : ''}`;
  el('fail-storage').checked = sessionStorage.getItem(failureKey) === 'yes';
  el('message').textContent = message;
}
function act(fn) {
  try {
    lastResult = fn();
    message = JSON.stringify({
      status: lastResult?.status,
      reason: lastResult?.reason,
    });
    project();
  } catch (error) {
    lastResult = { status: 'exception', reason: error.message };
    message = error.message;
  }
  render();
}
function prepare(payload) {
  if (prepared && !runtime.read().pending) runtime.cancel(prepared.candidate);
  prepared = null;
  const result = runtime.preview({ id: id(), payload });
  if (result.status === 'prepared')
    prepared = { candidate: result.candidate, payload };
  return result;
}
async function open() {
  if (sheet || !context) return;
  try {
    const element = document
      .importNode(el('details-template').content, true)
      .querySelector('#details');
    const opened = context.view.openReadingSheet({
      id: 'crafting-details',
      element,
      initialFocus: () => el('tab-editor'),
      returnFocus: () => el('open'),
    });
    sheet = opened;
    opened.signal.addEventListener(
      'abort',
      () => {
        editor.stopPreview();
        if (prepared && !runtime.read().pending) {
          runtime.cancel(prepared.candidate);
          prepared = null;
        }
        if (sheet === opened) sheet = null;
      },
      { once: true },
    );
    await opened.ready;
    if (opened.signal.aborted) return;
    const bind = (name, fn) =>
      el(name).addEventListener('click', () => act(fn), {
        signal: opened.signal,
      });
    bind('close', () => opened.close());
    for (const name of ['editor', 'runtime', 'survey'])
      bind(`tab-${name}`, () => {
        pane = name;
        fields();
      });
    bind('apply-fields', applyFields);
    bind('apply-json', () => {
      draft = JSON.parse(el('recipe-json').value);
      return { status: 'draft' };
    });
    bind('preview-recipe', () => editor.preview(recipe()));
    bind('commit-recipe', () => {
      const result = editor.commit();
      if (result.status === 'accepted') draft = null;
      fields();
      return result;
    });
    bind('discard-recipe', () => {
      draft = null;
      const result = editor.cancel();
      fields();
      return result;
    });
    for (const name of ['undo', 'redo'])
      bind(name, () => {
        const result = editor[name]();
        draft = null;
        fields();
        return result;
      });
    bind('save-recipe', () => editor.save());
    bind('begin', () =>
      prepare({
        kind: 'begin',
        recipe: editor.read().recipe,
        selections: ['a', 'b']
          .map((s) => ({
            slot: editor.read().recipe.slots[0].id,
            container: `source-${s}`,
            batch: `input-${s}`,
            quantity: number(`quantity-${s}`),
          }))
          .filter((s) => s.quantity > 0),
        pointBudget: number('point-budget'),
      }),
    );
    const session = () =>
      runtime.read().view.sessions.find((s) => s.id === el('session').value);
    bind('experiment', () =>
      prepare({
        kind: 'experiment',
        session: session().id,
        attribute: session().recipe.attributes[0].id,
        points: number('experiment-points'),
        effectPermille: session().recipe.attributes[0].effectPermille,
      }),
    );
    for (const kind of ['lock', 'cancel-session'])
      bind(kind, () => prepare({ kind, session: session().id }));
    bind('repeat', () =>
      prepare({
        kind: 'repeat',
        session: session().id,
        selections: ['a', 'b']
          .map((s) => ({
            slot: session().recipe.slots[0].id,
            container: `source-${s}`,
            batch: `input-${s}`,
            quantity: number(`quantity-${s}`),
          }))
          .filter((s) => s.quantity > 0),
      }),
    );
    bind('assign', () =>
      prepare({
        kind: 'assign',
        session: session().id,
        machine: el('machine').value,
      }),
    );
    bind('step', () =>
      prepare({
        kind: 'step',
        session: session().id,
        ticks: number('ticks'),
        power: number('power'),
      }),
    );
    bind('transfer', () =>
      prepare({
        kind: 'transfer',
        from: el('from').value,
        to: el('to').value,
        batch: el('batch').value,
        quantity: number('transfer-quantity'),
      }),
    );
    bind('resize', () =>
      prepare({
        kind: 'resize',
        container: el('capacity-container').value,
        mass: number('capacity-mass'),
        volume: number('capacity-volume'),
      }),
    );
    bind('advance', () => prepare({ kind: 'advance', time: number('clock') }));
    const spawn = () =>
      runtime.read().view.spawns.find((s) => s.id === el('spawn').value);
    bind('replace-spawn', () => {
      const s = spawn();
      return prepare({
        kind: 'replace-spawn',
        spawn: s.id,
        seed: s.deposit.seed + 1,
        cellSize: s.deposit.cellSize,
        expiresAt: runtime.read().view.clock + 100,
        reserve: 8,
        grade: 900,
      });
    });
    bind('harvest', () =>
      prepare({
        kind: 'harvest',
        spawn: spawn().id,
        incarnation: spawn().incarnation,
        container: el('harvest-container').value,
        quantity: number('harvest-quantity'),
      }),
    );
    bind('survey-start', () => {
      const result = survey.start(spawn().id);
      retainedSurvey = survey.capture();
      return result;
    });
    bind('survey-step', () => survey.step());
    bind('survey-late', () => retainedSurvey?.() ?? { status: 'empty' });
    bind('survey-cancel', () => survey.cancel());
    bind('commit-runtime', () =>
      prepared ? runtime.commit(prepared.candidate) : { status: 'empty' },
    );
    bind('cancel-runtime', () => {
      const result = prepared
        ? runtime.cancel(prepared.candidate)
        : { status: 'empty' };
      if (!runtime.read().pending) prepared = null;
      return result;
    });
    bind('retry-runtime', () => runtime.retry());
    bind('ack-runtime', () => {
      const result = runtime.acknowledge();
      if (!runtime.read().pending) prepared = null;
      if (result.status === 'accepted') opened.close();
      return result;
    });
    bind('reload', () => location.reload());
    for (const name of ['slot', 'attribute', 'output-property'])
      el(name).addEventListener('change', fields, { signal: opened.signal });
    el('session').addEventListener('change', render, { signal: opened.signal });
    el('spawn').addEventListener('change', render, { signal: opened.signal });
    el('fail-storage').addEventListener(
      'change',
      () => {
        sessionStorage.setItem(
          failureKey,
          el('fail-storage').checked ? 'yes' : 'no',
        );
        render();
      },
      { signal: opened.signal },
    );
    fields();
    render();
  } catch (error) {
    message = error.message;
    sheet = null;
    render();
  }
}
function refresh() {
  const e = editor.read(),
    r = runtime.read(),
    next = JSON.stringify([
      e.revision,
      e.saveStatus,
      e.blocked,
      r.envelope.revision,
      r.pending,
      r.saveStatus,
      r.canAcknowledge,
      r.blocked,
    ]);
  if (next !== signature) {
    signature = next;
    project();
    render();
  }
}
const scene = defineScene({
  id: 'sample',
  title: 'Accepted material custody',
  view: {
    camera: { position: [8, 7, 9], target: [0, 0, 0] },
    background: 0x172738,
  },
  enter(ctx) {
    context = ctx;
    life = new AbortController();
    editor = createEditorController({
      saveBuild,
      saveHandle: ctx.save(recipeSection),
      readPersisted: () => storage.get(recipeStorageKey),
    });
    runtime = createRuntimeController({
      saveBuild,
      saveHandle: ctx.save(runtimeSection),
      readPersisted: () => storage.get(runtimeStorageKey),
      resume: runtimeResume,
    });
    runtimeResume = null;
    survey = createSurveyAdapter({ readRuntime: () => runtime.read() });
    draft = null;
    prepared = null;
    projection = '';
    signature = '';
    entities = [];
    ctx.world.spawn(
      Transform({ y: -0.1 }),
      Shape({ kind: 'box', size: [9, 0.2, 6], color: 0x355065 }),
    );
    project();
    el('open').disabled = false;
    el('exit-scene').disabled = false;
    el('reenter').disabled = true;
    el('open').addEventListener('click', open, { signal: life.signal });
    render();
    const timer = setInterval(refresh, 150);
    life.signal.addEventListener('abort', () => clearInterval(timer), {
      once: true,
    });
  },
  exit() {
    el('open').disabled = true;
    el('exit-scene').disabled = true;
    life.abort();
    sheet?.close();
    sheet = null;
    survey.dispose();
    editor.dispose();
    runtimeResume = runtime.dispose();
    context = null;
    entities = [];
  },
});
const retiredScene = defineScene({
  id: 'retired',
  title: 'Retired crafting session',
  view: { background: 0x172738 },
  enter(ctx) {
    context = ctx;
    el('reenter').disabled = false;
    el('retired-survey').disabled = false;
  },
  exit() {
    context = null;
    el('reenter').disabled = true;
    el('retired-survey').disabled = true;
  },
});
el('exit-scene').addEventListener('click', () => {
  if (!context) return;
  retainedSurvey = survey.capture();
  el('open').disabled = true;
  el('exit-scene').disabled = true;
  sheet?.close();
  context.scene.goto('retired');
});
el('reenter').addEventListener('click', () => {
  if (context) {
    el('reenter').disabled = true;
    context.scene.goto('sample');
  }
});
el('retired-survey').addEventListener('click', () => {
  lastResult = retainedSurvey?.() ?? { status: 'empty' };
  el('compact-status').textContent = `Retained survey: ${lastResult.status}`;
});
const compiled = compileGame({
  brief,
  game,
  defs: [scene, retiredScene, recipeSection, runtimeSection],
});
const modules = layerModules(game, brief).map((m) =>
  m.id === 'core.save'
    ? saveModule({
        namespace: game.id,
        build: saveBuild,
        storage: () => ({ local: storage, session: browserPort('session') }),
      })
    : m,
);
const app = createApp([...modules, ...compiled.modules], {
  mode: 'test',
  flag: (id) => appFeatures().enabled(id),
  probes: true,
});
const booted = app.boot();
window.engine = createTestApi(app, booted);
window.craftingWorkbench = {
  read: () =>
    editor && runtime
      ? {
          editor: editor.read(),
          runtime: runtime.read(),
          survey: survey.read(),
        }
      : null,
  ui: () => ({
    sheet: !!sheet,
    message,
    result: lastResult,
    pane,
    active: !!context,
  }),
  world: () =>
    context
      ? [...context.world.query(Name)].map(([entity, name]) => ({
          entity,
          id: name.name,
          transform: context.world.get(entity, Transform),
          shape: context.world.get(entity, Shape),
        }))
      : [],
  captureSurvey: () => survey.capture(),
  dispose: () => app.dispose(),
};
await booted;
