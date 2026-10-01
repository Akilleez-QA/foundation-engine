import {createAuthoredDocument, createAuthoringSession} from '../../src/kits/authoring/index.ts';
import {documentId, limits, validDocument} from './document.mjs';

// UI and DOM-free callers receive exactly the same commands. Projection is a
// consumer, not part of the kit's document-only publication transaction.
export function createController({value, saveHandle, projection, hasEnvelope, notify = () => {}}) {
  const document = createAuthoredDocument({id: documentId, json: JSON.stringify(value), limits, validate: validDocument});
  const session = createAuthoringSession(document, {maxEntries: 16, maxHistoryBytes: 65536});
  let selected = value.objects[0]?.id ?? '', blocked = false, retired = false, message = 'Select an object, then preview a change.';
  const cancelDraft = () => { session.cancel(); projection.clearGhost(); };
  const state = () => {
    const snapshot = document.read();
    const status = saveHandle.status();
    const matches = JSON.stringify(saveHandle.get()) === snapshot.json;
    let persistence = 'Unsaved changes';
    if (status === 'saved' && matches) persistence = hasEnvelope() ? 'Saved locally' : 'Not saved yet';
    else if (status === 'session') persistence = 'Unsaved — storage write failed. Restore access and retry Save.';
    else if (status === 'unavailable') persistence = 'Storage unavailable — accepted document retained; restore access and retry Save.';
    else if (status === 'newer') persistence = 'Newer stored version — read-only save. Open with a compatible build.';
    else if (status === 'quarantined') persistence = 'Stored data quarantined — defaults loaded; inspect recovery data before saving.';
    return {value: snapshot.value, revision: snapshot.ticket.revision, selected, blocked, retired, message, persistence, saveStatus: status,
      history: session.stats(), preview: session.readPreview()?.value ?? null};
  };
  const emit = () => { const result = state(); notify(result); return result; };
  const command = fn => (...args) => {
    if (retired) return {status: 'retired'};
    try { fn(...args); } catch (error) { message = error.message; }
    return emit();
  };
  const editable = () => { if (blocked) throw Error('Projection needs recovery. Rebuild the world before editing.'); };
  const reconcile = () => {
    try { projection.apply(document.read().value); blocked = false; }
    catch (error) { blocked = true; message = `Projection failed: ${error.message}. Accepted data retained; use Rebuild world.`; }
  };
  const publish = action => {
    editable();
    const result = action();
    message = `Edit ${result.status}.`;
    if (result.status === 'accepted') { projection.clearGhost(); reconcile(); }
  };
  const commands = {
    select: command(id => { editable(); cancelDraft(); selected = id; message = `Selected ${id || 'no object'}.`; }),
    invalidate: command(() => { cancelDraft(); message = 'Form changed. Preview again before committing.'; }),
    preview: command(fields => {
      editable(); cancelDraft();
      const numbers = Object.fromEntries(['x', 'y', 'z', 'ry'].map(k => [k, fields[k] === '' || fields[k] == null ? NaN : Number(fields[k])]));
      const current = document.read();
      if (!current.value.objects.some(o => o.id === selected)) throw Error('Select an existing object.');
      const next = {...current.value, objects: current.value.objects.map(o => o.id === selected ? {...o, ...numbers} : o)};
      // Validate before JSON serialization can turn nonfinite values into null.
      if (!validDocument(next)) throw Error('Enter finite values: X/Z ±4 m, Y ±2 m, rotation ±2π rad. Preview cleared.');
      const result = session.preview(current.ticket, () => JSON.stringify(next));
      if (result.status === 'prepared') {
        try { projection.ghost(next.objects.find(o => o.id === selected)); }
        catch (error) { cancelDraft(); throw error; }
      }
      message = result.status === 'prepared' ? 'Preview ready — amber marker is provisional. Commit or Cancel.' : `Preview ${result.status}.`;
    }),
    cancel: command(() => { cancelDraft(); message = 'Preview cancelled. Accepted objects unchanged.'; }),
    commit: command(() => publish(() => session.commit())),
    undo: command(() => { cancelDraft(); publish(() => session.undo()); }),
    redo: command(() => { cancelDraft(); publish(() => session.redo()); }),
    remove: command(() => {
      editable(); cancelDraft();
      const current = document.read();
      if (!current.value.objects.some(o => o.id === selected)) throw Error('Select an existing object.');
      const result = session.preview(current.ticket, () => JSON.stringify({...current.value, objects: current.value.objects.filter(o => o.id !== selected)}));
      if (result.status !== 'prepared') throw Error(`Remove ${result.status}`);
      publish(() => session.commit());
    }),
    save: command(() => {
      editable();
      try {
        saveHandle.update(draft => { Object.assign(draft, structuredClone(document.read().value)); }, {now: true});
        message = 'Save attempted. Persistence status below reflects the actual section result.';
      } catch (error) {
        // A subscriber can throw after memory publication. Re-read get/status via emit;
        // never claim rollback, discard history or retry an edit automatically.
        message = `Save raised: ${error.message}. Accepted document retained; check status and retry Save.`;
      }
    }),
    checkStatus: command(() => { message = 'Persistence status refreshed.'; }),
    recover: command(() => { cancelDraft(); reconcile(); if (!blocked) message = 'World rebuilt from the accepted document. Editing resumed.'; }),
  };
  reconcile();
  return {...commands, state, dispose() {
    if (retired) return;
    retired = true;
    const errors = [];
    // Retirement is terminal, but one replaceable adapter must not strand the other owners.
    for (const cleanup of [() => projection.clearGhost(), () => session.dispose(), () => document.dispose(), () => projection.dispose()]) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Authoring controller cleanup failed');
  }};
}
