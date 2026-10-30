import {createAuthoredDocument} from '../../src/kits/authoring/document.ts';
import {createAuthoringSession} from '../../src/kits/authoring/session.ts';
import {captureRecipe, initialRecipe, recipeLimits, evaluateRecipe, recipeSectionDefinition} from './recipe.mjs';
export {recipeSectionDefinition, recipeStorageKey} from './recipe.mjs';
const json = value => JSON.stringify(value);
/** Creator-owned recipe editor. Preview runs cannot access the accepted craftingtime or its persistence. */
export function createEditorController({saveHandle, readPersisted, saveBuild}) {
  if (typeof saveBuild !== 'string' || !saveBuild.length || saveBuild.length > 256) throw Error('saveBuild required');
  if (typeof readPersisted !== 'function') throw Error('readPersisted required');
  let recipe = initialRecipe(),
    blocked = null,
    retired = false,
    busy = false,
    message = '',
    preview = null,
    lastRaw,
    parsedRaw,
    parsedRecipe,
    terminal;
  const physical = raw => {
    if (raw !== parsedRaw) {
      if (
        typeof raw !== 'string' ||
        raw.length > 131072 ||
        new TextEncoder().encode(raw).length > recipeLimits.maxBytes
      )
        throw Error('recipe storage bound');
      const envelope = JSON.parse(raw);
      if (envelope.v !== 1) throw Error('recipe storage version');
      parsedRecipe = captureRecipe(envelope.data);
      parsedRaw = raw;
    }
    return parsedRecipe;
  };
  try {
    const status = saveHandle.status();
    if (['newer', 'quarantined', 'unavailable'].includes(status)) throw Error(`recovery-required:${status}`);
    recipe = captureRecipe(saveHandle.get());
    lastRaw = readPersisted();
    if (lastRaw !== null && json(physical(lastRaw)) !== json(recipe)) throw Error('external-conflict');
    if (lastRaw === null && json(recipe) !== json(initialRecipe())) throw Error('missing-envelope');
  } catch (error) {
    blocked = error.message;
  }
  const document = createAuthoredDocument({
    id: 'authored-recipe',
    json: json(recipe),
    limits: recipeLimits,
    validate: value => {
      try {
        captureRecipe(value);
        return true;
      } catch {
        return false;
      }
    },
  });
  const session = createAuthoringSession(document, {
    maxEntries: 16,
    maxHistoryBytes: 524288,
  });
  let expectedHandle = json(recipe),
    writingTarget = null,
    heldRef,
    heldJson;
  const handleJson = () => {
    const held = saveHandle.get();
    if (held !== heldRef) {
      heldJson = json(captureRecipe(held));
      heldRef = held;
    }
    return heldJson;
  };
  const stop = () => {
    preview = null;
  };
  const observe = () => {
    let saveStatus = 'unavailable',
      durable = false;
    try {
      saveStatus = saveHandle.status();
      if (['newer', 'quarantined', 'unavailable'].includes(saveStatus)) blocked ??= `recovery-required:${saveStatus}`;
      const memory = handleJson();
      if (memory !== expectedHandle && memory !== writingTarget) blocked ??= 'external-conflict';
      const raw = readPersisted();
      if (raw !== null) {
        const stored = physical(raw);
        if (raw !== lastRaw && json(stored) !== expectedHandle && json(stored) !== writingTarget)
          blocked ??= 'external-conflict';
        lastRaw = raw;
        durable = saveStatus === 'saved' && json(stored) === document.read().json;
      } else if (lastRaw !== null && lastRaw !== undefined) blocked ??= 'external-conflict';
    } catch (error) {
      blocked ??= error.message;
    }
    return {saveStatus, durable: durable && !blocked};
  };
  const read = () => {
    if (terminal) return terminal;
    const persistence = observe(),
      snapshot = document.read();
    return Object.freeze({
      recipe: snapshot.value,
      candidate: session.readPreview()?.value ?? null,
      revision: snapshot.ticket.revision,
      evaluation: preview?.evaluation ?? null,
      history: session.stats(),
      blocked,
      retired,
      message,
      ...persistence,
    });
  };
  const guard = fn => {
    if (retired) return {status: 'retired'};
    if (busy) return {status: 'busy'};
    busy = true;
    try {
      observe();
      if (retired) return {status: 'retired'};
      if (blocked) return {status: 'refused', reason: blocked};
      return fn();
    } catch (error) {
      message = error.message;
      return {status: 'rejected', reason: message};
    } finally {
      busy = false;
    }
  };
  const start = () => {
    stop();
    const recipe = session.readPreview()?.value ?? document.read().value;
    let evaluation;
    try {
      evaluation = {status: 'evaluated', ...evaluateRecipe(recipe)};
    } catch (error) {
      evaluation = {status: 'incompatible', reason: error.message};
    }
    preview = {recipe, evaluation: Object.freeze(evaluation)};
    return {status: 'started', evaluation: preview.evaluation};
  };
  return {
    read,
    preview: raw =>
      guard(() => {
        stop();
        session.cancel();
        const recipe = captureRecipe(raw);
        if (retired) return {status: 'retired'};
        const result = session.preview(document.read().ticket, () => json(recipe));
        if (result.status === 'prepared') {
          start();
          message = 'Provisional recipe and runtime only.';
        }
        return result;
      }),
    commit: () =>
      guard(() => {
        stop();
        const result = session.commit();
        message = result.status === 'accepted' ? 'Recipe committed; accepted crafting unchanged.' : result.status;
        return result;
      }),
    cancel: () =>
      guard(() => {
        stop();
        return session.cancel();
      }),
    undo: () =>
      guard(() => {
        stop();
        session.cancel();
        const result = session.undo();
        message = `Undo ${result.status}; inspect save status.`;
        return result;
      }),
    redo: () =>
      guard(() => {
        stop();
        session.cancel();
        const result = session.redo();
        message = `Redo ${result.status}; inspect save status.`;
        return result;
      }),
    startPreview: () => guard(start),
    stopPreview: () =>
      guard(() => {
        stop();
        return {status: 'stopped'};
      }),
    save: () =>
      guard(() => {
        const accepted = document.read();
        const wrapper = JSON.stringify({
          v: recipeSectionDefinition.version,
          by: saveBuild,
          data: accepted.value,
        });
        if (
          wrapper.length > recipeSectionDefinition.maxChars ||
          new TextEncoder().encode(wrapper).length > recipeLimits.maxBytes
        )
          throw Error('storage-capacity');
        writingTarget = accepted.json;
        try {
          saveHandle.update(
            draft => {
              for (const key of Object.keys(draft)) delete draft[key];
              Object.assign(draft, structuredClone(accepted.value));
            },
            {now: true},
          );
        } finally {
          try {
            const memory = handleJson();
            if (memory === writingTarget) expectedHandle = writingTarget;
            else if (memory !== expectedHandle) blocked ??= 'external-conflict';
          } finally {
            writingTarget = null;
          }
        }
        if (retired) return {status: 'retired'};
        const state = observe();
        message = state.durable ? 'Authored recipe saved; accepted crafting unchanged.' : 'Recipe remains unsaved.';
        return {status: state.durable ? 'saved' : 'unsaved', ...state};
      }),
    dispose() {
      if (retired) return;
      retired = true;
      stop();
      session.dispose();
      document.dispose();
      terminal = Object.freeze({
        ...read(),
        retired: true,
        evaluation: null,
        candidate: null,
      });
    },
  };
}
