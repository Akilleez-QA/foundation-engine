/**
 * platform/input/actions.ts: one action map (ADR 0044) with one owner per press (ADR 0047).
 *
 * Status: live since. `appInput()` (platform/ui/runtime.ts) is the app's one dispatcher, fed by one capture
 * keydown and one capture keyup listener on window; M mute is its first consumer. Since Escape and Tab for
 * the layer-managed overlays (panel cards, minigames with their own Escape, countdowns) come
 * through it too: Back reaches `layers.escape()` and the layer's `onEscape`, and Tab reaches the layer's own focus trap
 * (`src/keymap-overlay.ts`). `src/input/` keeps driving traversing, the pad and every other key, which pass through.
 *
 * - The open `inputActions` registry (STD-REG-6) is a core `defineRegistry` registry: rows carry id,
 *   label, scope, kind, key and pad defaults, an optional declared focus/menu path (`via`) and a reachability class.
 *   Its `validate` checks one row; its `problems` is the reach check, so an unreachable action fails it.
 * - `InputActions` is the one dispatcher. Keys, pad edges and pointer/shell activations resolve to registered
 *   actions; it never calls a handler bound to a key (STD-RUN-25). Order (STD-RUN-26):
 *     1. 'always' rows (M mutes under any modal); typing in a field is protected unless the row sets `inText`;
 *     2. focus cycling (Tab / Shift+Tab rows) inside the top modal-ish layer;
 *     3. layers from the top down: subscriptions scoped to that layer or its owner, then the layer owner's frame
 *        queue; a layer with `modal !== false` stops the traversal, and Back there goes to `layers.escape()`;
 *     4. 'global' rows, only when no modal layer blocked the traversal.
 *   Each press is delivered once, to one consumer: a DOM-style `onAction` subscriber OR an owner's frame queue
 *   (`drain`), never both (STD-RUN-27).
 * - Owner epochs: any change of the top layer, and route/player change, pause, blur, disconnect or remap
 *   (`cancel(reason)`), start a new epoch. Queued actions, repeats and held actions of the old epoch are dropped;
 *   a source that was down must be released before it can press again (the neutral gate). Input addressed to an
 *   old epoch never falls through to the new owner.
 * - `checkReach` is the reach check (STD-RUN-30, STD-RUN-31): every action is reachable from keyboard and from
 *   pad by a direct binding or a declared path, with no cycles, no modifier chord as the sole route, a Back route
 *   on both devices, and no overlapping effective bindings after remaps. The DOM half (traversing real focus) belongs
 *   to the verify browser; this is the Node registry-graph half.
 *
 * Layer rules: the dispatcher needs only a small layer view (`ActionLayers`), so tests can hand it a fake; the
 * LayerManager in platform/ui/layers.ts declares `implements ActionLayers`, so the compiler checks the two agree.
 * No clock is read here: callers pass `now`.
 */
import { adminOf, defineRegistry, type AdminRegistry, type EntryProblem, type Registry, type RegistryOptions } from '../../core/registry';

// ─────────────── vocabulary ───────────────

/** A registered action id: '<area>.<name>' ('core.back', 'shell.menu', 'quick.slot1', 'pack.sails/deploy'). */
export type ActionId = string;
export type ActionScope = 'always' | 'global' | 'layer';
/** press: fires on the press edge. hold: press and release both delivered, held state tracked. axis: analog, fed by adapters. */
export type ActionKind = 'press' | 'hold' | 'axis';
export type DeviceFamily = 'keyboard-mouse' | 'touch' | 'gamepad';
/** The devices the reach check proves independently. */
export type ReachDevice = 'keyboard' | 'pad';
export const REACH_DEVICES: readonly ReachDevice[] = ['keyboard', 'pad'];
/**
 * A key chord. Printable keys are matched by `key`, lower case ('m', '1', '+'); named keys keep their name
 * ('Escape', 'Enter', 'Space', 'Tab'); modifiers prefix ('Shift+Tab', 'Ctrl+s'). Physical keys are matched by
 * code with a 'code:' prefix ('code:KeyW', 'code:NumpadAdd'), so AZERTY traverses with ZQSD.
 */
export type KeyChord = string;
/** Standard-mapping pad inputs, named by position (glyphs come from the pad family, not from these names). */
export const PAD_INPUTS = [
  'a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', 'l3', 'r3',
  'dpad-up', 'dpad-down', 'dpad-left', 'dpad-right', 'home',
  'ls-up', 'ls-down', 'ls-left', 'ls-right', 'rs-up', 'rs-down', 'rs-left', 'rs-right',
] as const;
export type PadInput = typeof PAD_INPUTS[number];
/** W3C standard gamepad button index for each button input (sticks are axes and have none). */
export const PAD_BUTTON_INDEX: Readonly<Partial<Record<PadInput, number>>> = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9, l3: 10, r3: 11,
  'dpad-up': 12, 'dpad-down': 13, 'dpad-left': 14, 'dpad-right': 15, home: 16,
};
export interface ActionBindings { readonly keys?: readonly KeyChord[]; readonly pad?: readonly PadInput[] }

/** A point-in-time description, not a claim that a handler exists or an action is reachable. */
export interface ActionDescription {
  readonly labelKey: string;
  readonly keys: readonly KeyChord[];
  readonly pad: readonly PadInput[];
  /** Scope matches current layer traversal; excludes typing, handler and physical-source state. */
  readonly inContext: boolean;
}

export interface InputActionDef {
  id: ActionId;
  /** I18nKey shown in help, remapping and glyph prompts. */
  label: string;
  scope: ActionScope;
  kind: ActionKind;
  defaults: ActionBindings;
  /** For scope 'layer': the layer kinds or layer ids it applies in. Omitted: every layer. */
  context?: readonly string[];
  /** A declared focus/menu path per device, first step reachable on that device (ADR 0047). */
  via?: { readonly keyboard?: readonly ActionId[]; readonly pad?: readonly ActionId[] };
  /** Default 'every-device'. The exception needs `reason`, and stays visible in the reach report. */
  reachability?: 'every-device' | 'pointer-only-by-design';
  reason?: string;
  /** Fires while typing in a text field. */
  inText?: boolean;
  /** Key autorepeat re-fires it (zoom). Otherwise one physical press is one action. */
  repeat?: boolean;
  /** Hidden from help (debug keys). */
  hidden?: boolean;
  /**
   * The action fires but the key event is not consumed: page listeners still see it (no preventDefault or
   * stopPropagation, repeats included). Migration parity for a key that never stopped the event (M mute).
   */
  passThrough?: boolean;
}

export type ActionPhase = 'press' | 'release' | 'repeat';
export interface ActionEvent {
  readonly action: ActionId;
  readonly phase: ActionPhase;
  /** Milliseconds on the caller's clock. */
  readonly t: number;
  readonly device: DeviceFamily;
  /** The owner epoch the press was dispatched in. */
  readonly ownerEpoch: number;
  /** Physical source identity: 'key:Escape', 'pad:a', 'pointer:shell.map'. */
  readonly source: string;
}
export type CancelReason = 'owner' | 'route' | 'player' | 'pause' | 'overlay' | 'blur' | 'disconnect' | 'remap';
/** Per-action binding overrides as stored by the settings Controls section. */
export type ActionOverrides = Readonly<Record<ActionId, ActionBindings>>;

// ─────────────── the layer view the dispatcher needs (LayerManager implements it) ───────────────

export interface ActionLayerInfo {
  readonly id: string; readonly kind: string; readonly owner?: string; readonly modal: 'page' | 'scope' | false;
}
export interface ActionLayers {
  /** Live interactive layers, top first. */
  fromTop(): readonly ActionLayerInfo[];
  /** Back at a layer: true when a layer consumed it. */
  escape(): boolean;
  /** Tab cycling inside the top modal-ish layer: true when handled. */
  cycleFocus(backwards: boolean): boolean;
  /** Activate the focused actionable control in the top live modal, without global DOM handlers. */
  activateFocus?(): boolean;
  /** Page an explicitly marked, focused reading region in the current modal. */
  scrollFocus?(direction: -1 | 1): boolean;
  onChange(fn: () => void, signal?: AbortSignal): () => void;
}

// ─────────────── core rows ───────────────

export const PAGE_NEXT = 'core.page-next', PAGE_PREV = 'core.page-prev';
export const CONFIRM = 'core.confirm', BACK = 'core.back', FOCUS_NEXT = 'core.focus-next', FOCUS_PREV = 'core.focus-prev', SHELL_MENU = 'shell.menu';
const MODAL_KINDS = ['panel', 'sheet', 'modal'] as const;
/**
 * The genre-free rows owned by platform: back, pause, mute, focus and the shell menu. Every gameplay action (move,
 * jump, interact, zoom, a camera toggle) is the game's (`defineInput`) or a kit's, so a game's own bindings never
 * collide with an engine default. `shell.menu` on X and the menu paths follow ADR 0047.
 */
export const CORE_INPUT_ACTIONS: readonly InputActionDef[] = [
  { id: BACK, label: 'input.back', scope: 'layer', kind: 'press', inText: true, defaults: { keys: ['Escape'], pad: ['b'] } },
  { id: 'core.pause', label: 'input.pause', scope: 'global', kind: 'press', defaults: { keys: ['p'], pad: ['menu'] } },
  { id: 'core.mute', label: 'input.mute', scope: 'always', kind: 'press', passThrough: true, defaults: { keys: ['m'] }, via: { pad: [SHELL_MENU] } },
  { id: FOCUS_NEXT, label: 'input.focus-next', scope: 'layer', context: MODAL_KINDS, kind: 'press', inText: true, defaults: { keys: ['Tab'], pad: ['dpad-down'] } },
  { id: FOCUS_PREV, label: 'input.focus-prev', scope: 'layer', context: MODAL_KINDS, kind: 'press', inText: true, defaults: { keys: ['Shift+Tab'], pad: ['dpad-up'] } },
  { id: CONFIRM, label: 'input.confirm', scope: 'layer', context: MODAL_KINDS, kind: 'press', defaults: { keys: ['Enter'], pad: ['a'] } },
  { id: PAGE_NEXT, label: 'input.page-next', scope: 'layer', context: MODAL_KINDS, kind: 'press', defaults: { keys: ['PageDown'], pad: ['rb'] } },
  { id: PAGE_PREV, label: 'input.page-prev', scope: 'layer', context: MODAL_KINDS, kind: 'press', defaults: { keys: ['PageUp'], pad: ['lb'] } },
  { id: SHELL_MENU, label: 'shell.menu', scope: 'global', kind: 'press', defaults: { pad: ['x'] }, via: { keyboard: [FOCUS_NEXT] } },
];
/** `settings.nintendoSwap` as a preset of overrides: the bottom face button goes back (a game swaps its own confirm). */
export const NINTENDO_SWAP: ActionOverrides = { [BACK]: { pad: ['a'] }, [CONFIRM]: { pad: ['b'] } };

// ─────────────── registry ───────────────

declare module '../../core/registry' {
  interface Registries { inputActions: Registry<InputActionDef> }
}

const ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9/-]*)+$/;
const PAD_SET = new Set<string>(PAD_INPUTS);

/** Problems in one row by itself: the `inputActions` registry's `validate`. */
export function actionRowProblems(def: InputActionDef): string[] {
  const out: string[] = [];
  if (!ID.test(def.id)) out.push(`id must be '<area>.<name>'`);
  if (!def.label) out.push('missing label');
  for (const p of def.defaults.pad ?? []) if (!PAD_SET.has(p)) out.push(`unknown pad input '${p}'`);
  for (const k of def.defaults.keys ?? []) if (!k || /\s/.test(k)) out.push(`bad key chord '${k}'`);
  if (def.reachability === 'pointer-only-by-design' && !def.reason) out.push('a pointer-only exception needs a reason');
  if (def.context && def.scope !== 'layer') out.push("context applies only to scope 'layer'");
  return out;
}

/**
 * The open `inputActions` registry (STD-REG-1, STD-REG-6), created with core's `defineRegistry`.
 * `validate` is `actionRowProblems`; `problems` is the reach check over the default bindings, so an action that
 * keyboard or pad cannot reach, a missing Back route or an overlapping default binding fails the registry's check.
 * A problem that names one row is attributed to it (ADR 0043: a pack's bad row disables only that pack).
 */
export const inputActionRegistryOptions: RegistryOptions<InputActionDef> = {
  validate: actionRowProblems,
  problems: all => reachOf(all).problems.map((p): string | EntryProblem => {
    const at = p.indexOf(': '), id = p.slice(0, at);
    return at > 0 && all.some(d => d.id === id) ? { id, problem: p.slice(at + 2) } : p;
  }),
};
/** A standalone `inputActions` registry (the kernel builds the app's from `inputActionRegistryOptions` in `defines`). */
export function defineInputActions(owner = 'core'): AdminRegistry<InputActionDef> {
  return defineRegistry<InputActionDef>('inputActions', inputActionRegistryOptions, owner);
}

/** Rows turned away while a table was built, per registry (read by `checkReach`). */
const turnedAway = new WeakMap<Registry<InputActionDef>, readonly string[]>();

/**
 * A frozen `inputActions` registry holding `rows` (the app's table today; module boot fills it once modules own
 * their rows). A duplicate or invalid row is recorded as a problem and left out, never fatal:
 * `checkReach` reports it ('<id>: registered twice').
 */
export function inputActionRegistry(rows: readonly InputActionDef[] = [], source = 'core'): Registry<InputActionDef> {
  const registry = defineInputActions(), issues: string[] = [];
  for (const def of rows) {
    const own = actionRowProblems(def);
    if (registry.find(def.id)) own.push('registered twice');
    if (own.length) { issues.push(...own.map(p => `${def.id}: ${p}`)); continue; }
    registry.add(def, source);
  }
  adminOf(registry).freeze();
  turnedAway.set(registry, issues);
  return registry;
}

/** Effective bindings: an override replaces the device it names and keeps the other device's defaults. */
export function effectiveBindings(def: InputActionDef, overrides: ActionOverrides = {}): Required<ActionBindings> {
  const o = overrides[def.id];
  return { keys: o?.keys ?? def.defaults.keys ?? [], pad: o?.pad ?? def.defaults.pad ?? [] };
}

// ─────────────── key normalisation ───────────────

export interface KeyEventLike {
  key: string; code?: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean;
  repeat?: boolean; isComposing?: boolean; target?: EventTarget | null; defaultPrevented?: boolean;
  preventDefault(): void; stopPropagation(): void;
}
/** The chord a key event matches by `key`: 'm', 'Escape', 'Space', 'Shift+Tab', 'Ctrl+s'. */
export function comboOf(e: Pick<KeyEventLike, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): KeyChord {
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Meta', e.shiftKey && key.length > 1 && 'Shift'].filter(Boolean);
  return [...mods, key].join('+');
}
/** The chord a key event matches by physical position: 'code:KeyW'. Modified presses never match a code chord. */
export const codeChordOf = (e: Pick<KeyEventLike, 'code' | 'ctrlKey' | 'altKey' | 'metaKey'>): KeyChord | null =>
  e.code && !e.ctrlKey && !e.altKey && !e.metaKey ? 'code:' + e.code : null;
export function isTyping(target: EventTarget | null | undefined): boolean {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return false;
  if ((el as HTMLElement).isContentEditable === true) return true;
  if (el.closest('textarea,select,[contenteditable=true]')) return true;
  const input = el.closest('input') as HTMLInputElement | null;
  return !!input && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes((input.getAttribute('type') ?? 'text').toLowerCase());
}
const MODIFIER = /^(Ctrl|Alt|Meta)\+/;
const singleCharacter = (chord: KeyChord) => chord.length === 1 && chord !== ' ';

// ─────────────── dispatcher ───────────────

export type ActionHandler = (e: ActionEvent) => void | boolean;
interface Subscription { action: ActionId; fn: ActionHandler; layer?: string; owner?: string }
type Target = { kind: 'sub'; sub: Subscription } | { kind: 'queue'; owner: string };
interface Down { action: ActionId; epoch: number; target: Target; kind: ActionKind }

export interface InputActionsOptions {
  registry: Registry<InputActionDef>;
  layers: ActionLayers;
  /** The caller's clock in ms (the core clock seam); never read from a global here. */
  now: () => number;
  overrides?: ActionOverrides;
  /** WCAG 2.1.4: single-character shortcuts can be switched off. Escape, Enter, Space and Tab stay. */
  singleKeyShortcuts?: () => boolean;
  /** Where a throwing handler is reported (default console.error). */
  report?: (error: unknown) => void;
  /** Maximum simultaneously owned external input sources. Default 128. */
  maxOwnedSources?: number;
}

/** Detach the signal listener when ownership ends manually as well as on abort. */
function subscriptionLifetime(cleanup: () => void, signal?: AbortSignal): () => void {
  let active = true;
  const off = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', off);
    cleanup();
  };
  signal?.addEventListener('abort', off, { once: true });
  if (signal?.aborted) off();
  return off;
}

export class InputActions {
  private sourceAdmission?: { count: number; serial: number };
  private overrides: ActionOverrides;
  private remapRevision = 0;
  private remapping = false;
  private subs: Subscription[] = [];
  private frameOwners = new Set<string>();
  private queue: { owner: string; event: ActionEvent }[] = [];
  /** Sources down and accepted, keyed by source identity. */
  private down = new Map<string, Down>();
  /** Sources that were down across a cancel: ignored until released (the neutral gate). */
  private blocked = new Set<string>();
  private cancelListeners = new Set<(reason: CancelReason) => void>();
  private epochValue = 0;
  private topKey: string | null;
  /** The row that took the current key press (or its repeat) asked not to consume the event. */
  private passing = false;

  constructor(private readonly opts: InputActionsOptions, signal?: AbortSignal) {
    this.overrides = opts.overrides ?? {};
    this.topKey = this.currentTopKey();
    opts.layers.onChange(() => {
      const key = this.currentTopKey();
      if (key !== this.topKey) { this.topKey = key; this.cancel('owner'); }
    }, signal);
  }

  /** The current owner epoch. */
  get epoch(): number { return this.epochValue; }

  effective(id: ActionId): Required<ActionBindings> {
    const def = this.opts.registry.find(id);
    return def ? effectiveBindings(def, this.overrides) : { keys: [], pad: [] };
  }
  /**
   * Describe a known action using current remaps and layer scope. Hidden rows remain available to explicit
   * lookup; `hidden` suppresses discovery through help only. The returned snapshot cannot mutate bindings.
   */
  describeAction(id: ActionId): ActionDescription | null {
    const def = this.opts.registry.find(id);
    if (!def) return null;
    const bindings = this.effective(id);
    let matches = def.scope === 'always';
    let blocked = false;
    for (const layer of this.opts.layers.fromTop()) {
      if (def.scope === 'layer' && inContext(def, layer)) matches = true;
      if (layer.modal !== false) { blocked = true; break; }
    }
    if (def.scope === 'global') matches = !blocked;
    return Object.freeze({
      labelKey: def.label,
      keys: Object.freeze([...bindings.keys]),
      pad: Object.freeze([...bindings.pad]),
      inContext: matches,
    });
  }
  /** Remap: replaces the stored overrides. Held and queued input is cancelled first (a remap while held never leaks). */
  setOverrides(overrides: ActionOverrides): void {
    const revision = ++this.remapRevision;
    if (this.remapping) { this.overrides = overrides; return; }
    this.remapping = true;
    try {
      this.cancel('remap');
      if (revision === this.remapRevision) this.overrides = overrides;
    } finally { this.remapping = false; }
  }

  /** DOM-side delivery. Unscoped: for 'always'/'global' rows. Scoped: only while traversing that layer or owner. */
  onAction(action: ActionId, fn: ActionHandler, scope: { layer?: string; owner?: string; signal?: AbortSignal } = {}): () => void {
    if (scope.signal?.aborted) return () => {};
    const sub: Subscription = { action, fn, layer: scope.layer, owner: scope.owner };
    this.subs.push(sub);
    return subscriptionLifetime(() => { this.subs = this.subs.filter(s => s !== sub); }, scope.signal);
  }
  /** Frame-side delivery: the owner reads its actions with `drain(owner)` once per frame. */
  claimFrames(owner: string, signal?: AbortSignal): () => void {
    if (signal?.aborted) return () => {};
    this.frameOwners.add(owner);
    return subscriptionLifetime(() => {
      this.frameOwners.delete(owner);
      this.queue = this.queue.filter(q => q.owner !== owner);
    }, signal);
  }
  /** Actions addressed to `owner` in the current epoch, oldest first. Old-epoch leftovers are discarded. */
  drain(owner: string): ActionEvent[] {
    const mine: ActionEvent[] = [], rest: typeof this.queue = [];
    for (const q of this.queue) {
      if (q.event.ownerEpoch !== this.epochValue) continue;
      if (q.owner === owner) mine.push(q.event); else rest.push(q);
    }
    this.queue = rest;
    return mine;
  }
  /** True while a hold action is held in the current epoch. */
  held(action: ActionId): boolean {
    for (const d of this.down.values()) if (d.action === action && d.kind !== 'press' && d.epoch === this.epochValue) return true;
    return false;
  }
  /** Adapters (the gamepad reader's requireNeutral, pointer capture) hook the cancel here. */
  onCancel(fn: (reason: CancelReason) => void, signal?: AbortSignal): () => void {
    if (signal?.aborted) return () => {};
    this.cancelListeners.add(fn);
    return subscriptionLifetime(() => { this.cancelListeners.delete(fn); }, signal);
  }

  /**
   * A new owner epoch. Drops queued actions, repeats and held state; every source that is down must be released
   * before it presses again. Called automatically when the top layer changes; the router, player switch, pause,
   * window blur, pad disconnect and remap call it with their reason.
   */
  cancel(reason: CancelReason): void {
    this.epochValue++;
    this.queue = [];
    for (const source of this.down.keys()) this.blocked.add(source);
    this.down.clear();
    for (const fn of [...this.cancelListeners]) this.safely(() => fn(reason));
  }

  // ── raw input in ──

  /** A keydown from the one capture listener. Returns true when an action consumed it (default prevented). */
  keyDown(e: KeyEventLike): boolean {
    if (e.defaultPrevented || e.isComposing) return false;
    // Native activation outside modal routing belongs to the focused control, not the scene below.
    // Modified chords remain authored actions; modal confirm retains its owned one-press handling.
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && (e.key === 'Enter' || e.key === ' ')
      && !this.opts.layers.fromTop().some(layer => layer.modal !== false)) {
      const target = e.target as Element | null;
      const selector = 'button,summary,input[type="button"],input[type="submit"],input[type="reset"]'
        + (e.key === 'Enter' ? ',a[href]' : ',input[type="checkbox"],input[type="radio"]');
      if (target && typeof target.closest === 'function' && target.closest(selector)) return false;
    }
    const code = codeChordOf(e), combo = comboOf(e), source = 'key:' + (e.code || e.key);
    const rows = this.rowsFor(def => {
      const keys = this.effective(def.id).keys;
      if (code && keys.includes(code)) return true;
      if (!keys.includes(combo)) return false;
      return !(singleCharacter(combo) && this.opts.singleKeyShortcuts?.() === false);
    });
    this.passing = false;
    const consumed = this.input(rows, source, 'keyboard-mouse', !!e.repeat, isTyping(e.target));
    // A swallowed repeat after a cancel names no row: it passes when every row the key could mean passes.
    if (consumed && (this.passing || rows.every(r => r.passThrough === true))) return false;
    if (consumed) { e.preventDefault(); e.stopPropagation(); }
    return consumed;
  }
  keyUp(e: Pick<KeyEventLike, 'key' | 'code'>): void { this.release('key:' + (e.code || e.key)); }

  /** One pad edge from the pad adapter (after dead zones and hysteresis). */
  pad(input: PadInput, pressed: boolean): boolean {
    const source = 'pad:' + input;
    if (!pressed) { this.release(source); return false; }
    return this.input(this.rowsFor(def => this.effective(def.id).pad.includes(input)), source, 'gamepad', false, false);
  }
  /**
   * The edges of one pad poll, in order. When an earlier edge changes the owner (a press opens a menu), the
   * remaining presses were addressed to the old epoch and are discarded; releases still clear bookkeeping.
   */
  padFrame(edges: readonly { input: PadInput; pressed: boolean }[]): void {
    const epoch = this.epochValue;
    for (const edge of edges) {
      if (edge.pressed && this.epochValue !== epoch) { this.blocked.add('pad:' + edge.input); continue; }
      this.pad(edge.input, edge.pressed);
    }
  }
  /** @internal Trusted optional adapter capability; not a sandbox or a creator-facing producer API. */
  sourceAccess() {
    return {
      registry: this.opts.registry,
      limit: this.opts.maxOwnedSources ?? 128,
      admission: this.sourceAdmission ??= { count: 0, serial: 0 },
      press: (row: InputActionDef, source: string, device: DeviceFamily, valid: () => boolean) => this.input([row], source, device, false, false, valid),
      release: (source: string) => this.release(source),
    };
  }

  /** A pointer or shell-button activation of a registered action (ShellButtonDef.action). */
  activate(action: ActionId, device: DeviceFamily = 'keyboard-mouse', source = 'pointer:' + action): boolean {
    const def = this.opts.registry.find(action);
    if (!def) return false;
    const ok = this.input([def], source, device, false, false);
    if (ok && def.kind !== 'press') this.release(source);
    return ok;
  }

  // ── help ──

  /** Rows reachable right now with their effective bindings, for generated help and glyph prompts (STD-RUN-29). */
  help(): { id: ActionId; label: string; keys: readonly KeyChord[]; pad: readonly PadInput[] }[] {
    const rows: InputActionDef[] = [], seen = new Set<string>();
    const add = (d: InputActionDef) => { if (!d.hidden && !seen.has(d.id)) { seen.add(d.id); rows.push(d); } };
    const all = this.opts.registry.all();
    all.filter(d => d.scope === 'always').forEach(add);
    let blocked = false;
    for (const layer of this.opts.layers.fromTop()) {
      all.filter(d => d.scope === 'layer' && inContext(d, layer)).forEach(add);
      if (layer.modal !== false) { blocked = true; break; }
    }
    if (!blocked) all.filter(d => d.scope === 'global').forEach(add);
    return rows.map(d => ({ id: d.id, label: d.label, ...this.effective(d.id) }));
  }

  // ── internals ──

  private rowsFor(match: (def: InputActionDef) => boolean): InputActionDef[] {
    return this.opts.registry.all().filter(match);
  }

  private release(source: string) {
    this.blocked.delete(source);
    const d = this.down.get(source);
    if (!d) return;
    this.down.delete(source);
    if (d.epoch !== this.epochValue || d.kind === 'press') return;
    this.deliver(d.target, this.event(d.action, 'release', source, this.deviceOf(source)));
  }

  /** Route one press to one consumer. Returns true when it was consumed. */
  private input(rows: readonly InputActionDef[], source: string, device: DeviceFamily, repeat: boolean, typing: boolean, valid?: () => boolean): boolean {
    if (!rows.length) return false;
    const usable = rows.filter(d => (!typing || d.inText) && d.kind !== 'axis');
    if (!usable.length) return false;
    const epoch = this.epochValue, layers = this.opts.layers;
    const focusRow = usable.find(d => d.id === FOCUS_NEXT || d.id === FOCUS_PREV);
    if (repeat) {
      // Held Tab keeps moving focus inside the trap, as native Tab does.
      if (focusRow && !this.blocked.has(source)) {
        if (layers.cycleFocus(focusRow.id === FOCUS_PREV)) return true;
        // A non-modal layer that traps Tab itself (a panel card, a minigame) decides each repeat as it decides a
        // press: it wraps at either end and otherwise leaves the key to native Tab.
        const sub = this.focusSubscriber(focusRow.id);
        if (sub) return this.deliver({ kind: 'sub', sub }, this.event(focusRow.id, 'repeat', source, device));
      }
      return this.repeat(source, device);
    }
    // A fresh press proves the old one was released (a lost keyup after blur): it rearms the source.
    this.blocked.delete(source);
    if (this.down.has(source)) this.release(source);
    const tryRow = (d: InputActionDef, target: Target | null) => target !== null && this.press(d, target, source, device, epoch, valid);

    // 1. always
    for (const d of usable) if (d.scope === 'always' && tryRow(d, this.unscoped(d.id))) return true;
    // 2. focus cycling inside the top modal-ish layer
    if (focusRow && layers.cycleFocus(focusRow.id === FOCUS_PREV)) return true;
    // 3. layers top-down
    for (const layer of layers.fromTop()) {
      const confirm = usable.find(d => d.id === CONFIRM && inContext(d, layer));
      if (confirm && layer.modal !== false && layers.activateFocus) {
        // Mark ownership before click: it may synchronously close this modal.
        this.blocked.add(source);
        if (layers.activateFocus() || this.epochValue !== epoch) return true;
        this.blocked.delete(source);
      }
      const page = usable.find(d => (d.id === PAGE_NEXT || d.id === PAGE_PREV) && inContext(d, layer));
      if (page && layer.modal !== false && layers.scrollFocus) {
        this.blocked.add(source);
        if (layers.scrollFocus(page.id === PAGE_NEXT ? 1 : -1) || this.epochValue !== epoch) return true;
        this.blocked.delete(source);
      }
      for (const d of usable) {
        if (d.scope === 'always') continue;
        const sub = this.subs.find(s => s.action === d.id && (s.layer === layer.id || (s.owner !== undefined && s.owner === layer.owner)));
        if (sub && tryRow(d, { kind: 'sub', sub })) return true;
        if (d.scope === 'layer' && inContext(d, layer) && layer.owner && this.frameOwners.has(layer.owner) && d.id !== BACK) {
          if (tryRow(d, { kind: 'queue', owner: layer.owner })) return true;
        }
      }
      const back = usable.some(d => d.id === BACK);
      // blocked: lower layers and the world never see it; Back goes to the layer manager
      if (layer.modal !== false) return back ? this.escape(source) : false;
      if (back && layer.kind !== 'scene' && this.escape(source)) return true;
      if (back && layer.kind === 'scene' && layer.owner && this.frameOwners.has(layer.owner)) {
        const d = usable.find(r => r.id === BACK)!;
        if (tryRow(d, { kind: 'queue', owner: layer.owner })) return true;
      }
    }
    // 4. global: an unscoped subscriber, else the frame queue of the topmost frame owner
    const frameOwner = layers.fromTop().find(l => l.owner && this.frameOwners.has(l.owner))?.owner;
    for (const d of usable) {
      if (d.scope !== 'global') continue;
      if (tryRow(d, this.unscoped(d.id))) return true;
      if (frameOwner && tryRow(d, { kind: 'queue', owner: frameOwner })) return true;
    }
    return false;
  }

  /** Back through the layer manager. The press stays owned until released, so its autorepeat closes nothing more. */
  private escape(source: string): boolean {
    const handled = this.opts.layers.escape();
    if (handled) this.blocked.add(source);
    return handled;
  }

  /** The topmost layer-scoped subscriber of a focus row, above the first modal layer. */
  private focusSubscriber(action: ActionId): Subscription | null {
    for (const layer of this.opts.layers.fromTop()) {
      const sub = this.subs.find(s => s.action === action && (s.layer === layer.id || (s.owner !== undefined && s.owner === layer.owner)));
      if (sub) return sub;
      if (layer.modal !== false) return null;
    }
    return null;
  }

  private unscoped(action: ActionId): Target | null {
    const sub = this.subs.find(s => s.action === action && s.layer === undefined && s.owner === undefined);
    return sub ? { kind: 'sub', sub } : null;
  }

  private press(d: InputActionDef, target: Target, source: string, device: DeviceFamily, epoch: number, valid?: () => boolean): boolean {
    if ((valid && !valid()) || this.epochValue !== epoch) return true;
    const event = this.event(d.id, 'press', source, device);
    const ok = this.deliver(target, event);
    if (valid && !valid()) return true;
    if (this.epochValue !== epoch) { this.blocked.add(source); return true; }
    if (!ok) return false;
    this.passing = d.passThrough === true;
    // A handler that changed the owner ended this press's epoch: nothing of it survives into the new owner.
    if (this.epochValue === epoch) this.down.set(source, { action: d.id, epoch, target, kind: d.kind });
    else this.blocked.add(source);
    return true;
  }

  private repeat(source: string, device: DeviceFamily): boolean {
    if (this.blocked.has(source)) return true; // swallow repeats of a press from the old owner
    const d = this.down.get(source);
    if (!d || d.epoch !== this.epochValue) return false;
    const def = this.opts.registry.find(d.action);
    this.passing = def?.passThrough === true;
    if (!def?.repeat) return true; // one physical press is one action, but the key stays owned
    this.deliver(d.target, this.event(d.action, 'repeat', source, device));
    return true;
  }

  private deliver(target: Target, event: ActionEvent): boolean {
    if (target.kind === 'queue') {
      if (!this.frameOwners.has(target.owner)) return false;
      this.queue.push({ owner: target.owner, event });
      return true;
    }
    if (!this.subs.includes(target.sub)) return false;
    let result: unknown;
    this.safely(() => { result = target.sub.fn(event); });
    return result !== false;
  }

  private event(action: ActionId, phase: ActionPhase, source: string, device: DeviceFamily): ActionEvent {
    return { action, phase, t: this.opts.now(), device, ownerEpoch: this.epochValue, source };
  }
  private deviceOf(source: string): DeviceFamily { return source.startsWith('pad:') ? 'gamepad' : source.startsWith('touch:') ? 'touch' : 'keyboard-mouse'; }
  private currentTopKey(): string | null {
    const top = this.opts.layers.fromTop()[0];
    return top ? `${top.id}\u0000${top.owner ?? ''}` : null;
  }
  private safely(fn: () => void) {
    try { fn(); }
    catch (err) {
      try { (this.opts.report ?? console.error)(err); }
      catch { /* Diagnostics must not interrupt sibling ownership cleanup. */ }
    }
  }
}

function inContext(d: InputActionDef, layer: ActionLayerInfo): boolean {
  return !d.context || d.context.includes(layer.kind) || d.context.includes(layer.id);
}

// ─────────────── reach check ───────────────

export interface ReachReport {
  /** Failures: the check passes only when this is empty. */
  problems: string[];
  /** Pointer-only exceptions with their reasons, always shown in the report. */
  exceptions: { id: ActionId; reason: string }[];
  /** How each action is reached per device: 'direct' or the path. */
  routes: Record<ActionId, Record<ReachDevice, 'direct' | readonly ActionId[] | null>>;
}

/**
 * The Node half of `verify:input-reach` (ADR 0044, ADR 0047): every action is reachable from the keyboard and
 * from the pad by a direct binding or a declared path whose first step is itself reachable on that device.
 * Rejects cycles with no entry, a modifier chord as the sole keyboard route, missing Back routes and overlapping
 * effective bindings after remaps. The browser half traverses real DOM focus and activation.
 */
export function checkReach(registry: Registry<InputActionDef>, overrides: ActionOverrides = {}): ReachReport {
  const report = reachOf(registry.all(), overrides);
  report.problems.unshift(...turnedAway.get(registry) ?? []);
  return report;
}

/** The reach graph over `rows` with `overrides` applied (the registry's `problems` uses the defaults). */
function reachOf(rows: readonly InputActionDef[], overrides: ActionOverrides = {}): ReachReport {
  const report: ReachReport = { problems: [], exceptions: [], routes: {} };
  const byId = new Map(rows.map(d => [d.id, d]));
  const direct = (d: InputActionDef, device: ReachDevice) => {
    const b = effectiveBindings(d, overrides);
    return device === 'pad' ? b.pad.length > 0 : b.keys.some(k => !MODIFIER.test(k));
  };
  const memo = new Map<string, boolean>();
  const reachable = (id: ActionId, device: ReachDevice, visiting: Set<ActionId>): boolean => {
    const key = device + ' ' + id;
    if (memo.has(key)) return memo.get(key)!;
    const d = byId.get(id);
    if (!d || d.reachability === 'pointer-only-by-design') return false;
    if (direct(d, device)) { memo.set(key, true); return true; }
    const path = d.via?.[device];
    if (!path?.length || visiting.has(id)) return false; // no route, or a cycle with no entry
    visiting.add(id);
    const ok = path.every(step => byId.has(step) && step !== id) && reachable(path[0], device, visiting);
    visiting.delete(id);
    memo.set(key, ok);
    return ok;
  };
  for (const d of rows) {
    report.routes[d.id] = { keyboard: null, pad: null };
    if (d.reachability === 'pointer-only-by-design') { report.exceptions.push({ id: d.id, reason: d.reason ?? '' }); continue; }
    for (const device of REACH_DEVICES) {
      const path = d.via?.[device];
      if (reachable(d.id, device, new Set())) { report.routes[d.id][device] = direct(d, device) ? 'direct' : path!; continue; }
      const b = effectiveBindings(d, overrides);
      if (device === 'keyboard' && b.keys.length && b.keys.every(k => MODIFIER.test(k)) && !path?.length) {
        report.problems.push(`${d.id}: a modifier chord is the only keyboard route`);
      } else if (path?.length) {
        const missing = path.filter(step => !byId.has(step));
        report.problems.push(missing.length ? `${d.id}: ${device} path names unregistered ${missing.join(', ')}`
          : `${d.id}: ${device} path ${path.join(' → ')} has no reachable entry (cycle or unreachable first step)`);
      } else report.problems.push(`${d.id}: unreachable by ${device}`);
    }
  }
  const back = byId.get(BACK);
  if (!back) report.problems.push(`${BACK}: no Back action registered`);
  else for (const device of REACH_DEVICES) if (!direct(back, device)) report.problems.push(`${BACK}: no direct ${device} Back route`);
  report.problems.push(...bindingConflicts(rows, overrides));
  return report;
}

/**
 * Overlapping effective bindings after remaps: an 'always' binding shared with anything, two 'global' rows, or two
 * 'layer' rows whose contexts overlap. A 'layer' row over a 'global' row on the same input is ownership by design
 * (the layer traversal runs first), not a conflict.
 */
export function bindingConflicts(rows: readonly InputActionDef[], overrides: ActionOverrides = {}): string[] {
  const out: string[] = [], by = new Map<string, InputActionDef[]>();
  for (const d of rows) {
    const b = effectiveBindings(d, overrides);
    for (const k of b.keys) push(by, 'key ' + k, d);
    for (const p of b.pad) push(by, 'pad ' + p, d);
  }
  for (const [input, list] of by) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (overlaps(a, b)) out.push(`${input}: ${a.id} (${a.scope}) and ${b.id} (${b.scope}) overlap`);
  }
  return out;
}
function push<K, V>(m: Map<K, V[]>, k: K, v: V) { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); }
function overlaps(a: InputActionDef, b: InputActionDef): boolean {
  if (a.scope === 'always' || b.scope === 'always') return true;
  if (a.scope !== b.scope) return false;
  if (a.scope === 'global') return true;
  if (!a.context || !b.context) return true;
  return a.context.some(c => b.context!.includes(c));
}
