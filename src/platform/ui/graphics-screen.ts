/**
 * platform/ui/graphics-screen.ts: the Graphics settings screen (ADR 0029; STD-SET-8,
 * STD-SET-11, STD-SET-14). A screen to tune the picture to the device.
 *
 * - Opened by a **Graphics…** button in the shell's settings menu. It is a `modal` layer with `cover: 'none'`
 *   and `preview: true`, so the scene underneath keeps rendering and every change is seen live.
 * - **Presets** (Reference, High, Medium, Low) with the detected-for-this-device tag and its reasons. Detection
 *   applies only the design-bar quality; when it thinks the device is weak it suggests a lighter preset here, never applies it.
 * - **Only knobs that take effect are shown** (`wired`, see `shownKnobs`): a control that changes nothing looks broken.
 *   The presets still set every registered knob.
 * - **Per-feature controls are generated from the knob registry** (`quality.knobs()`), group by group: a new effect
 *   appears here by registering a knob, never by editing this file. Each shows when it applies and, where the knob
 *   declares one, its relative cost.
 * - **Readout:** frame time (typical and slow frames), frame rate, and the pixel ratio and backbuffer of the view.
 * - The choice is saved per device by the quality service (section `graphics.settings`); nothing here stores it.
 * - The frame-time governor stays off: it has no control here until the scenes render through the one loop and can
 *   feed it rendered-frame samples (ADR 0029 keeps it opt-in).
 *
 * Styled as the other settings dialogs (`.settings-dialog`). Keyboard: Tab order, Escape closes (layers plus the action
 * dispatcher). Gamepad: the d-pad moves focus through the dialog, A presses, B closes (the mover's DOM-modal path).
 */
import {
  PRESETS,
  type AnyKnobDef,
  type KnobApplies,
  type KnobGroup,
  type Quality,
  type QualityPreset,
} from '../render/quality';
import type {FrameLoop, TickerHandle} from '../../core/activity/loop';
import type {LayerHandle, LayerManager} from './layers';
import {appShell} from './shell';
import {GRAPHICS_ROW, graphicsButton} from './graphics-button';

// ------------------------------------------------------------------------------------------------ words
export const PRESET_WORDS: Readonly<Record<QualityPreset, {name: string; note: string}>> = {
  reference: {name: 'Reference', note: 'Full quality, as designed'},
  high: {name: 'High', note: 'Sharp, a little lighter'},
  medium: {name: 'Medium', note: 'Balanced rendering cost'},
  low: {name: 'Low', note: 'Lowest rendering cost'},
};
const GROUP_WORDS: Readonly<Record<KnobGroup, string>> = {
  resolution: 'Resolution',
  shadows: 'Shadows',
  atmosphere: 'Atmosphere',
  clouds: 'Clouds',
  terrain: 'Terrain',
  post: 'Post-processing',
  effects: 'Effects',
  sky: 'Sky',
  reflections: 'Reflections',
  textures: 'Textures',
  'frame-rate': 'Frame rate',
  interface: 'Interface',
};
/** English for the core knobs' string keys; a knob registered later without words here shows its own key's tail. */
const KNOB_WORDS: Readonly<Record<string, string>> = {
  'graphics.resolution.scale': 'Resolution scale',
  'graphics.resolution.max-pixel-ratio': 'Sharpest pixel ratio',
  'graphics.resolution.antialias': 'Smooth edges (antialiasing)',
  'graphics.shadows.quality': 'Shadow quality',
  'graphics.textures.max-size': 'Largest texture',
  'graphics.textures.anisotropy': 'Sharp textures at an angle',
  'graphics.textures.canvas-budget': 'Painted-surface memory',
  'graphics.post.mode': 'Post-processing',
  'graphics.effects.particles': 'Particle density',
  'graphics.effects.scatter-density': 'Scattered detail (grass, rocks)',
  'graphics.lights.local-max': 'Local lights',
  'graphics.lights.shadowed-max': 'Lamp shadows',
  'graphics.frame-rate.cap': 'Frame-rate cap',
  'graphics.frame-rate.display': 'Display rate',
  'graphics.interface.backdrop-blur': 'Blurred panel backgrounds',
  'graphics.interface.live-contexts': 'Live 3D views at once',
};
export const APPLIES_WORDS: Readonly<Record<KnobApplies, string>> = {
  live: 'Changes now',
  'reenter-scene': 'Changes when you move back in',
  'next-context': 'Changes next time a view starts',
};
const words = (key: string) =>
  KNOB_WORDS[key] ?? (key.split('.').pop() ?? key).replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());

/** How a knob option reads on its button. */
export function optionWords(def: AnyKnobDef, value: unknown, index: number): string {
  const c = def.control;
  if (c.kind === 'choice' && c.optionLabels?.[index] !== undefined) {
    const l = c.optionLabels[index];
    return /^[\d.]+$/.test(l) ? l : words(l);
  }
  if (typeof value === 'string')
    return value
      .replace(/\+/g, ' + ')
      .replace(/-/g, ' ')
      .replace(/^./, ch => ch.toUpperCase());
  if (typeof value === 'number') {
    if (def.id === 'resolution.max-pixel-ratio') return `${value}×`;
    if (def.id === 'textures.max-size') return `${value} px`;
    if (def.id === 'textures.canvas-budget-mib') return `${value} MB`;
    if (def.id === 'textures.anisotropy') return `${value}×`;
    if (def.id === 'effects.particles') return `${Math.round(value * 100)} %`;
    return String(value);
  }
  return String(value);
}

// ------------------------------------------------------------------------------------------------ the model
export interface KnobRow {
  def: AnyKnobDef;
  label: string;
  applies: string;
  value: unknown;
  overridden: boolean;
}
export interface GroupRow {
  group: KnobGroup;
  label: string;
  knobs: KnobRow[];
}
/** The knobs the screen shows: those the game reads today (`KnobDef.wired`). Unwired rows stay registered and resolved. */
export const shownKnobs = (q: Pick<Quality, 'knobs'>): readonly AnyKnobDef[] =>
  q.knobs().filter(d => d.wired !== undefined);
/** The screen's content, generated from the registry and the resolved values (STD-SET-8). */
export function graphicsModel(q: Quality): GroupRow[] {
  const resolved = q.resolved(),
    overrides = q.settings.overrides as Record<string, unknown>,
    out: GroupRow[] = [];
  for (const def of shownKnobs(q)) {
    let row = out[out.length - 1];
    if (!row || row.group !== def.group)
      out.push((row = {group: def.group, label: GROUP_WORDS[def.group] ?? words(def.group), knobs: []}));
    row.knobs.push({
      def,
      label: words(def.label),
      applies: APPLIES_WORDS[def.applies],
      value: resolved.values.get(def.id),
      overridden: def.id in overrides,
    });
  }
  return out;
}
/** The line under the presets: why this device got its first preset, or that the page pins it. */
export function detectionWords(q: Quality): string {
  if (q.source === 'pinned')
    return `Pinned to ${PRESET_WORDS[q.preset].name} by the page address. Changes here last until you reload and are not saved.`;
  const d = q.settings.detected;
  if (!d) return 'No automatic pick on this device. Choose what suits it.';
  return `Picked ${PRESET_WORDS[d.preset].name} for this device: ${d.reasons.join(', ') || 'no details'}.`;
}
/** A gentle suggestion when detection thought this device may run smoother lighter; it is never applied for you. */
export function suggestionWords(q: Quality): string {
  const s = q.settings.detected?.suggested;
  if (!s || q.source === 'pinned' || PRESETS.indexOf(q.preset) >= PRESETS.indexOf(s)) return '';
  return `If the game feels slow here, ${PRESET_WORDS[s].name} may run smoother. It makes the picture softer.`;
}

// ------------------------------------------------------------------------------------------------ the screen
export interface GraphicsScreenOptions {
  quality: Quality;
  layers: LayerManager;
  /** Paces the readout while the screen is open. */
  loop: FrameLoop;
  doc?: Document;
  /** Where the Graphics… button goes (default: the shell's settings menu row, platform/ui/shell.ts). */
  menu?: HTMLElement | null;
  /** The Graphics… button already in the page (graphics-button.ts, which installs it at boot and loads this screen on
   *  its first press). It keeps its own row and click; the screen only adopts it. */
  button?: HTMLButtonElement;
}
export interface GraphicsScreen {
  readonly dialog: HTMLDialogElement;
  readonly button: HTMLButtonElement;
  readonly isOpen: boolean;
  /** `from`: the element focus returns to on close (default: whatever has focus now). */
  open(from?: HTMLElement | null): void;
  close(): void;
  dispose(): void;
}

let uid = 0;
const READOUT_EVERY_S = 0.5;

export function installGraphicsScreen(o: GraphicsScreenOptions): GraphicsScreen {
  const doc = o.doc ?? document,
    q = o.quality,
    id = `graphics-${++uid}`;
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<Record<string, string>> = {},
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) if (v !== undefined) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const dialog = el('dialog', {
    class: 'settings-dialog graphics-screen',
    id: 'graphics-settings',
    'aria-labelledby': `${id}-title`,
    'aria-describedby': `${id}-intro`,
  });
  const closeButton = el(
    'button',
    {type: 'button', class: 'dialog-close', 'aria-label': 'Close graphics settings'},
    '×',
  );
  const eyebrow = el('p', {class: 'eyebrow'}, 'THIS DEVICE');
  const title = el('h2', {id: `${id}-title`}, 'Graphics');
  const intro = el(
    'p',
    {id: `${id}-intro`},
    'Tune the picture to this device. Lower settings make the game lighter to run; every scene and object stays the same. Your choice is saved on this device only.',
  );

  // presets
  const presetHeading = el('h3', {id: `${id}-presets`}, 'Preset');
  const presetRow = el('div', {class: 'graphics-presets', role: 'group', 'aria-labelledby': `${id}-presets`});
  const presetButtons = new Map<QualityPreset, HTMLButtonElement>();
  for (const p of PRESETS) {
    const b = el('button', {
      type: 'button',
      class: 'graphics-preset',
      'data-preset': p,
      'aria-describedby': `${id}-preset-${p}`,
    });
    b.append(
      el('strong', {}, PRESET_WORDS[p].name),
      el('span', {id: `${id}-preset-${p}`}, PRESET_WORDS[p].note),
      el('em', {class: 'graphics-tag'}),
    );
    b.addEventListener('click', () => q.setPreset(p));
    presetButtons.set(p, b);
    presetRow.append(b);
  }
  const detection = el('p', {class: 'graphics-detected', id: `${id}-detected`});
  const suggestion = el('p', {class: 'graphics-suggestion'});
  const trySuggested = el('button', {type: 'button', 'data-suggested': ''});
  trySuggested.addEventListener('click', () => {
    const p = q.settings.detected?.suggested;
    if (p) q.setPreset(p);
  });
  const resets = el('div', {class: 'graphics-resets'});
  const resetDetected = el('button', {type: 'button', 'data-reset': 'detected'}, 'Use the pick for this device');
  const resetReference = el('button', {type: 'button', 'data-reset': 'reference'}, 'Reset to Reference');
  resetDetected.addEventListener('click', () => {
    const d = q.settings.detected;
    if (d) q.setPreset(d.preset);
  });
  resetReference.addEventListener('click', () => q.setPreset('reference'));
  resets.append(trySuggested, resetDetected, resetReference);

  // generated knob groups
  const knobsHeading = el('h3', {}, 'Details');
  const groupsHost = el('div', {class: 'graphics-groups'});
  type Control = {def: AnyKnobDef; sync(value: unknown, overridden: boolean): void};
  let controls: Control[] = [],
    builtFor = -1;
  const buildGroups = () => {
    controls = [];
    groupsHost.replaceChildren();
    for (const g of graphicsModel(q)) {
      const gid = `${id}-group-${g.group}`;
      const fieldset = el('fieldset', {class: 'graphics-group', 'data-group': g.group});
      fieldset.append(el('legend', {id: gid}, g.label));
      for (const k of g.knobs) {
        const knobId = `${id}-knob-${k.def.id.replace(/[^a-z0-9]+/gi, '-')}`;
        const row = el('div', {class: 'graphics-knob', 'data-knob': k.def.id});
        const hint = el('small', {id: `${knobId}-hint`}, k.applies);
        const cost = k.def.cost
          ? (el('meter', {
              min: '0',
              max: '1',
              class: 'graphics-cost',
              'aria-label': `${k.label}: relative cost`,
            }) as HTMLMeterElement)
          : null;
        const c = k.def.control;
        if (c.kind === 'choice') {
          row.append(el('span', {id: knobId, class: 'graphics-knob-label'}, k.label));
          const group = el('div', {
            role: 'group',
            class: 'graphics-choices',
            'aria-labelledby': `${gid} ${knobId}`,
            'aria-describedby': `${knobId}-hint`,
          });
          const buttons = (c.options as readonly unknown[]).map((v, i) => {
            const b = el('button', {type: 'button', 'data-value': String(v)}, optionWords(k.def, v, i));
            b.addEventListener('click', () => q.setKnob(k.def.id, v as never));
            group.append(b);
            return {v, b};
          });
          row.append(group);
          controls.push({
            def: k.def,
            sync(value) {
              for (const {v, b} of buttons) b.setAttribute('aria-pressed', String(v === value));
              if (cost) cost.value = (k.def.cost as (v: unknown) => number)(value);
            },
          });
        } else if (c.kind === 'range') {
          const label = el('label', {for: knobId, class: 'graphics-knob-label'}, k.label);
          const input = el('input', {
            type: 'range',
            id: knobId,
            min: String(c.min),
            max: String(c.max),
            step: String(c.step),
            'aria-describedby': `${knobId}-hint`,
          });
          const output = el('output', {for: knobId});
          input.addEventListener('input', () => q.setKnob(k.def.id, Number(input.value) as never));
          row.append(label, input, output);
          controls.push({
            def: k.def,
            sync(value) {
              const n = Number(value),
                pct = `${Math.round(n * 100)}%`;
              if (Number(input.value) !== n) input.value = String(n);
              input.setAttribute('aria-valuetext', pct);
              output.textContent = pct;
              if (cost) cost.value = (k.def.cost as (v: unknown) => number)(value);
            },
          });
        } else {
          const label = el('label', {class: 'graphics-knob-label'});
          const input = el('input', {type: 'checkbox', id: knobId, 'aria-describedby': `${knobId}-hint`});
          input.addEventListener('change', () => q.setKnob(k.def.id, input.checked as never));
          label.append(input, doc.createTextNode(` ${k.label}`));
          row.append(label);
          controls.push({
            def: k.def,
            sync(value) {
              input.checked = value === true;
              if (cost) cost.value = (k.def.cost as (v: unknown) => number)(value);
            },
          });
        }
        if (cost) row.append(cost);
        row.append(hint);
        fieldset.append(row);
      }
      groupsHost.append(fieldset);
    }
    builtFor = q.knobs().length;
  };

  // readout
  const readoutHeading = el('h3', {id: `${id}-readout-title`}, 'How it runs right now');
  const readout = el('p', {class: 'graphics-readout', id: `${id}-readout`, 'aria-labelledby': `${id}-readout-title`});
  const readoutFrame = el('span', {'data-readout': 'frame'}, 'Measuring…');
  const readoutView = el('span', {'data-readout': 'view'});
  readout.append(readoutFrame, el('br'), readoutView);

  dialog.append(
    closeButton,
    eyebrow,
    title,
    intro,
    presetHeading,
    presetRow,
    detection,
    suggestion,
    resets,
    knobsHeading,
    groupsHost,
    readoutHeading,
    readout,
  );
  doc.body.append(dialog);

  const sync = () => {
    if (builtFor !== q.knobs().length) buildGroups();
    const detected = q.settings.detected?.preset;
    for (const [p, b] of presetButtons) {
      b.setAttribute('aria-pressed', String(p === q.preset));
      const tag = b.querySelector('.graphics-tag')!;
      tag.textContent = p === detected ? 'Picked for this device' : '';
    }
    detection.textContent = detectionWords(q);
    resetDetected.hidden = !detected || q.source === 'pinned';
    suggestion.textContent = suggestionWords(q);
    suggestion.hidden = trySuggested.hidden = !suggestion.textContent;
    const suggested = q.settings.detected?.suggested;
    trySuggested.textContent = suggested ? `Try ${PRESET_WORDS[suggested].name}` : '';
    const resolved = q.resolved(),
      overrides = q.settings.overrides as Record<string, unknown>;
    for (const c of controls) c.sync(resolved.values.get(c.def.id), c.def.id in overrides);
  };

  /** The biggest visible canvas: the view the player is looking at. */
  const mainCanvas = (): HTMLCanvasElement | null => {
    let best: HTMLCanvasElement | null = null,
      area = 0;
    for (const c of Array.from(doc.querySelectorAll('canvas'))) {
      if (dialog.contains(c)) continue;
      const r = c.getBoundingClientRect(),
        a = r.width * r.height;
      if (a > area) {
        area = a;
        best = c;
      }
    }
    return best;
  };
  const showReadout = () => {
    const s = q.stats();
    readoutFrame.textContent =
      s.fps > 0
        ? `Frame time ${s.p50Ms.toFixed(1)} ms typical, ${s.p95Ms.toFixed(1)} ms for the slowest frames · ${Math.round(s.fps)} frames a second`
        : 'Measuring…';
    const c = mainCanvas(),
      cssW = c?.getBoundingClientRect().width ?? 0;
    readoutView.textContent =
      c && cssW > 0
        ? `Pixel ratio ${(c.width / cssW).toFixed(2)}× · ${c.width} × ${c.height} pixels drawn`
        : 'No 3D view is showing.';
  };

  let layer: LayerHandle | null = null,
    ticker: TickerHandle | null = null,
    opener: HTMLElement | null = null,
    stopWatching: (() => void) | null = null;
  const focusable = (e: HTMLElement | null) => !!e && e.isConnected && e.getClientRects().length > 0;
  const returnTarget = () =>
    focusable(opener) ? opener : doc.querySelector<HTMLElement>('details.shell-menu > summary');

  const startReadout = () => {
    let last: number | null = null,
      since = 0,
      opened: number | null = null;
    ticker = o.loop.add({
      owner: 'graphics-screen',
      mode: 'continuous',
      whenCovered: 'run',
      maxDt: 1,
      update(f) {
        const t = f.t * 1000;
        opened ??= t;
        if (last !== null && t > last)
          q.frame({
            intervalMs: t - last,
            rendered: true,
            hidden: false,
            sinceEnterMs: t - opened,
            draws: 0,
            triangles: 0,
          });
        last = t;
        since += f.dt;
        if (since >= READOUT_EVERY_S) {
          since = 0;
          showReadout();
        }
      },
    });
  };

  const button = o.button ?? graphicsButton(doc);
  const screen: GraphicsScreen = {
    dialog,
    button,
    get isOpen() {
      return layer !== null;
    },
    open(from) {
      if (layer) return;
      const active = from !== undefined ? from : (doc.activeElement as HTMLElement | null);
      opener = active && active !== doc.body ? active : null;
      // Synced after it shows, so a range input paints its filled track at the value it holds.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      sync();
      showReadout();
      stopWatching = q.subscribe(sync);
      layer = o.layers.open({
        id: 'modal.graphics',
        kind: 'modal',
        element: dialog,
        cover: 'none',
        preview: true,
        modal: 'page',
        initialFocus: () => presetButtons.get(q.preset) ?? null,
        returnFocus: returnTarget,
        onClose: () => {
          layer = null;
          ticker?.remove();
          ticker = null;
          stopWatching?.();
          stopWatching = null;
          if (typeof dialog.close === 'function') {
            if (dialog.open) dialog.close();
          } else dialog.removeAttribute('open');
        },
      });
      startReadout();
    },
    close() {
      layer?.close('exit');
    },
    dispose() {
      layer?.close('owner-left');
      dialog.remove();
      if (row) row.remove();
      else if (!o.button) screen.button.remove();
    },
  };

  closeButton.addEventListener('click', () => screen.close());
  // Escape is the layers' Back: the action dispatcher closes the screen in the capture phase; the pad's B arrives as an
  // Escape the dispatcher leaves alone, and closes it here. The browser's own Escape handling is always cancelled, so a
  // late native close request cannot shut the screen the next time it opens.
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    layer?.close('escape');
  });
  // A native close (a form, or a close request that got through) closes the layer too.
  // The close event is queued as a task: one from the previous closing can arrive after the screen reopened, so only
  // a dialog that is really shut closes the layer.
  dialog.addEventListener('close', () => {
    if (layer && !dialog.open) layer.close('escape');
  });

  if (!o.button) button.addEventListener('click', () => screen.open());
  // A shell row in the settings menu, unless the caller names a host or brings its own button.
  const row = o.button || o.menu !== undefined ? null : appShell(doc).add(GRAPHICS_ROW(button));
  if (!o.button) o.menu?.append(button);
  return screen;
}
