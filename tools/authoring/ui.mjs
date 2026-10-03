export function mountEditor(host, commands) {
  const abort = new AbortController();
  host.innerHTML = `<p class="eyebrow">DOCUMENT / MANUAL-SAMPLE</p><h2>Object properties</h2>
    <label for="selection">Authored object</label><select id="selection"></select>
    <p class="hint">World coordinates, Y up. X/Z ±4 m; Y ±2 m. Rotation around Y, ±2π radians.</p>
    <form id="properties" novalidate><div class="fields">
    ${[
      ['x', 'X · metres'],
      ['y', 'Y · metres'],
      ['z', 'Z · metres'],
      ['ry', 'Y rotation · radians'],
    ]
      .map(
        ([id, label]) =>
          `<div><label for="${id}">${label}</label><input id="${id}" name="${id}" type="number" step="any" required></div>`,
      )
      .join('')}
    </div><div class="buttons"><button type="submit" id="preview">Preview</button><button type="button" id="cancel">Cancel</button>
    <button type="button" class="primary" id="commit">Commit</button><button type="button" id="remove">Remove</button></div></form>
    <div class="buttons"><button id="undo">Undo</button><button id="redo">Redo</button></div>
    <div class="buttons"><button id="save" class="primary">Save</button><button id="reload">Reload</button><button id="checkStatus">Check status</button><button id="recover">Rebuild world</button></div>
    <p class="hint">Reload discards unsaved changes and reverses spawn order. Only accepted data is saved.</p>
    <div class="status" role="status" aria-live="polite" aria-atomic="true"><p id="persistence"></p><p id="message"></p><p id="history"></p></div>`;
  const el = id => host.querySelector(`#${id}`);
  let lastRevision = -1,
    lastSelection = null;
  const render = state => {
    const ids = state.value.objects.map(o => o.id);
    const shown = ids.includes(state.selected) ? state.selected : '';
    if (JSON.stringify([...el('selection').options].map(o => o.value)) !== JSON.stringify(['', ...ids])) {
      el('selection').replaceChildren(
        new Option('Choose an object', ''),
        ...ids.map(id => new Option(`Object ${id}`, id)),
      );
    }
    el('selection').value = shown;
    if (state.revision !== lastRevision || state.selected !== lastSelection) {
      const object = state.value.objects.find(o => o.id === shown);
      for (const key of ['x', 'y', 'z', 'ry']) el(key).value = object?.[key] ?? '';
      lastRevision = state.revision;
      lastSelection = state.selected;
    }
    el('persistence').textContent = state.persistence;
    el('message').textContent = state.message;
    el('history').textContent =
      `Revision ${state.revision} · History ${state.history.cursor}/${state.history.entries} · ${state.history.bytes}/65536 bytes`;
    for (const id of ['preview', 'remove']) el(id).disabled = state.blocked || !shown;
    el('commit').disabled = state.blocked || !state.preview;
    el('cancel').disabled = !state.preview;
    el('undo').disabled = state.blocked || state.history.cursor === 0;
    el('redo').disabled = state.blocked || state.history.cursor === state.history.entries;
    el('save').disabled = state.blocked || state.saveStatus === 'newer';
    el('recover').disabled = !state.blocked;
  };
  const on = (id, type, fn) => el(id).addEventListener(type, fn, {signal: abort.signal});
  on('selection', 'change', () => commands.select(el('selection').value));
  on('properties', 'submit', event => {
    event.preventDefault();
    commands.preview(Object.fromEntries(['x', 'y', 'z', 'ry'].map(k => [k, el(k).value])));
  });
  for (const key of ['x', 'y', 'z', 'ry']) on(key, 'input', () => commands.invalidate());
  for (const id of ['cancel', 'commit', 'remove', 'undo', 'redo', 'save', 'checkStatus', 'recover', 'reload'])
    on(id, 'click', () => commands[id]());
  render(commands.state());
  return {
    render,
    dispose() {
      abort.abort();
      host.replaceChildren();
    },
  };
}
