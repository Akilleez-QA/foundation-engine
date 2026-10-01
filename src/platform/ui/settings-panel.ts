/**
 * platform/ui/settings-panel.ts: a settings panel generated from the settings schema (STD-SET-1).
 *
 * `renderSettingsPanel` fills a host (a dialog opened through `openModalDialog`, so the layer and focus rules are the
 * dialog's) with one control per visible definition of a section, in `order`:
 *   bool   → <label><input type="checkbox"> Label</label>
 *   range  → <label>Label <input type="range"></label>      (saved on `change`, the release, never on `input`)
 *   choice → <label>Label <select>…</select></label>
 * followed by its help as a paragraph, then the static blocks contributed for that section (`addSettingsBlock`).
 * The controls write through `settings.set` and follow `settings.subscribe`, so another tab, an import or a reset
 * shows at once. Labels are i18n keys looked up in `strings` until the UI catalogue lands.
 */
import type { SettingDef, SettingId, SettingSection, Settings } from '../../core/settings/settings';

/** A static help block under a section's controls (the Comfort glossary). */
export type SettingsBlock = (doc: Document) => Node[];
const blocks = new Map<SettingSection, SettingsBlock[]>();
/** Contributes a static block to a section's generated panel. */
export function addSettingsBlock(section: SettingSection, render: SettingsBlock): () => void {
  const list = blocks.get(section) ?? [];
  list.push(render); blocks.set(section, list);
  return () => { const i = list.indexOf(render); if (i >= 0) list.splice(i, 1); };
}

export interface SettingsPanelOptions {
  settings: Settings;
  section: SettingSection;
  /** Text for each i18n key a definition names (label and help). */
  strings: Readonly<Record<string, string>>;
  /** Element ids for controls that other code already knows by id (verifiers, CSS). Default: the id with '.' → '-'. */
  ids?: Partial<Record<SettingId, string>>;
  /** Ends the subscriptions (the panel's owner goes away). */
  signal?: AbortSignal;
}

const text = (strings: Readonly<Record<string, string>>, key: string): string => {
  const t = strings[key];
  if (t === undefined) throw Error(`settings panel: no text for "${key}"`);
  return t;
};

/** Appends the section's generated controls, their help and the section's blocks to `host`. Returns the controls. */
export function renderSettingsPanel(host: HTMLElement, o: SettingsPanelOptions): HTMLElement[] {
  const doc = host.ownerDocument, controls: HTMLElement[] = [];
  for (const def of o.settings.defs(o.section)) {
    if (def.hidden) continue;
    const control = renderControl(doc, def, o);
    host.append(control.label);
    if (def.help) { const p = doc.createElement('p'); p.textContent = text(o.strings, def.help); host.append(p); }
    controls.push(control.input);
  }
  for (const render of blocks.get(o.section) ?? []) host.append(...render(doc));
  return controls;
}

function renderControl(doc: Document, def: SettingDef, o: SettingsPanelOptions): { label: HTMLLabelElement; input: HTMLElement } {
  const label = doc.createElement('label'), name = text(o.strings, def.label), id = o.ids?.[def.id] ?? def.id.replace(/\./g, '-');
  const { settings, signal } = o;
  if (def.type === 'bool') {
    const input = doc.createElement('input');
    input.id = id; input.type = 'checkbox';
    const show = () => { input.checked = settings.get(def.id) === true; };
    show();
    input.addEventListener('change', () => settings.set(def.id, input.checked as never));
    settings.subscribe(def.id, show, signal);
    label.append(input, ' ' + name);
    return { label, input };
  }
  if (def.type === 'range') {
    const input = doc.createElement('input');
    input.id = id; input.type = 'range';
    input.min = String(def.range.min); input.max = String(def.range.max); input.step = String(def.range.step);
    const show = () => { input.value = String(settings.get(def.id)); };
    show();
    input.addEventListener('change', () => settings.set(def.id, Number(input.value) as never));   // on release only
    settings.subscribe(def.id, show, signal);
    label.append(name + ' ', input);
    return { label, input };
  }
  const select = doc.createElement('select');
  select.id = id;
  for (const choice of def.choices) {
    const option = doc.createElement('option'), value = String(choice);
    option.value = value; option.textContent = o.strings[`${def.label}.${value}`] ?? value;
    select.append(option);
  }
  const show = () => { select.value = String(settings.get(def.id)); };
  show();
  select.addEventListener('change', () => settings.set(def.id, def.choices.find(c => String(c) === select.value) as never));
  settings.subscribe(def.id, show, signal);
  label.append(name + ' ', select);
  return { label, input: select };
}
