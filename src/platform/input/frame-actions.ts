/** The shared action vocabulary. Devices write into an ActionLatch from DOM events or the
 * frame poll; game code reads one InputFrame per frame and never raw keys, buttons or deltas.
 * Zoom notches: +1 is one wheel notch outward (toward Map), −1 inward (toward My eyes).
 * Look is radians this frame: +x turns the view right (scenes: yaw -= x), +y tilts it down.
 */
import type {ContextKind} from './context';
export type Vec2 = {x: number; y: number};
export type Direction = 'up' | 'down' | 'left' | 'right';
export type DeviceFamily = 'keyboard-mouse' | 'touch' | 'gamepad';
export type ZoomSource = 'wheel' | 'trackpad' | 'pinch' | 'key' | 'repeat' | 'pad';
export type ZoomStep = {notches: number; source: ZoomSource; t: number; momentum?: boolean | undefined};
/** cycle: V / View. anchor: R3, Roblox order third → first → overhead. */
export type CameraModeRequest = 'cycle' | 'anchor' | 'first' | 'third' | 'overhead';
export type QuickSlot = 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5' | 'slot6';
export type ButtonAction = 'interact' | 'back' | 'cameraMode' | 'recentre' | 'pause' | 'mute' | QuickSlot;
export type ActionEvent = {action: ButtonAction; t: number; device: DeviceFamily; mode?: CameraModeRequest | undefined};
export type WorldTap = {x: number; y: number; t: number; duration: number; pointerType: string};

export const NOTCH_PX = 100,
  LINE_PX = 16,
  PAGE_FRACTION = 0.9,
  MAX_NOTCHES_PER_EVENT = 1.5,
  TRACKPAD_GAIN = 0.8;
/** one notch moves z by .073; pinch moves .45 z per e-fold of scale. */
export const ZOOM_Z_PER_NOTCH = 0.073,
  PINCH_Z_PER_EFOLD = 0.45,
  PINCH_NOTCHES_PER_EFOLD = PINCH_Z_PER_EFOLD / ZOOM_Z_PER_NOTCH;
export const clampNotches = (n: number) =>
  Number.isFinite(n) ? Math.max(-MAX_NOTCHES_PER_EVENT, Math.min(MAX_NOTCHES_PER_EVENT, n)) : 0;
export const QUICK_SLOTS: readonly QuickSlot[] = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];
export const isMoveDirection = (v: string): v is Direction =>
  v === 'up' || v === 'down' || v === 'left' || v === 'right';

/** Held actions keyed per physical source ('key:KeyW', 'pointer:7', 'padkey:up'), generalising
 * AliasHeldInput: releasing one alias never releases another, and repeats never arm a source,
 * so input cleared by a lifecycle or context change needs a real release and press. */
export class HeldInput<A extends string = string> {
  private held = new Map<string, A>();
  press(source: string, action: A, repeat = false) {
    if (repeat) return false;
    const fresh = this.held.get(source) !== action;
    this.held.set(source, action);
    return fresh;
  }
  release(source: string) {
    return this.held.delete(source);
  }
  releaseWhere(test: (source: string) => boolean) {
    for (const source of [...this.held.keys()]) if (test(source)) this.held.delete(source);
  }
  has(action: A) {
    for (const value of this.held.values()) if (value === action) return true;
    return false;
  }
  get size() {
    return this.held.size;
  }
  clear() {
    this.held.clear();
  }
}
/** Clamp to the unit disc, keeping direction: W+D is as fast as W, W+ArrowUp is not faster. */
export const toDisc = (x: number, y: number): Vec2 => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return {x: 0, y: 0};
  const m = Math.hypot(x, y);
  return m > 1 ? {x: x / m, y: y / m} : {x, y};
};
export const heldVector = (held: HeldInput<string>): Vec2 => {
  const x = Number(held.has('right')) - Number(held.has('left')),
    y = Number(held.has('up')) - Number(held.has('down'));
  const m = Math.hypot(x, y);
  return m ? {x: x / m, y: y / m} : {x: 0, y: 0};
};

/** Press edge fires at once; holding repeats after `delay` ms every `interval` ms. A new key restarts it. */
export class Repeater {
  private key: string | null = null;
  private next = 0;
  constructor(
    readonly delay: number,
    readonly interval: number,
    readonly maxBurst = 3,
  ) {}
  update(key: string | null, now: number): {first: boolean; repeats: number} {
    if (key === null) {
      this.key = null;
      return {first: false, repeats: 0};
    }
    if (key !== this.key) {
      this.key = key;
      this.next = now + this.delay;
      return {first: true, repeats: 0};
    }
    let repeats = 0;
    while (now >= this.next && repeats < this.maxBurst) {
      repeats++;
      this.next += this.interval;
    }
    if (now >= this.next) this.next = now + this.interval;
    return {first: false, repeats};
  }
  reset() {
    this.key = null;
  }
}

export type InputFrame = {
  dt: number;
  /** Camera-relative move: +x right, +y forward, length ≤ 1. */
  move: Vec2;
  /** A move source was freshly pressed since the last frame (cancel routes and settles). */
  moveStarted: boolean;
  look: Vec2;
  zoom: ZoomStep[];
  actions: ActionEvent[];
  pressed: Set<ButtonAction>;
  taps: WorldTap[];
  /** Any look, zoom or camera-mode input this frame (auto-follow hold-off). */
  cameraInput: boolean;
  dragging: boolean;
  pinching: boolean;
  device: DeviceFamily;
};

/** Everything that happens between two samples, latched so a sub-frame tap is never lost. */
export class ActionLatch {
  private actions: ActionEvent[] = [];
  private zooms: ZoomStep[] = [];
  private taps: WorldTap[] = [];
  private lookX = 0;
  private lookY = 0;
  private started = false;
  action(event: ActionEvent) {
    this.actions.push(event);
  }
  zoom(step: ZoomStep) {
    if (step.notches) this.zooms.push(step);
  }
  look(x: number, y: number) {
    if (Number.isFinite(x)) this.lookX += x;
    if (Number.isFinite(y)) this.lookY += y;
  }
  tap(tap: WorldTap) {
    this.taps.push(tap);
  }
  moveStarted() {
    this.started = true;
  }
  drain() {
    const out = {
      actions: this.actions,
      zoom: this.zooms.sort((a, b) => a.t - b.t),
      taps: this.taps,
      look: {x: this.lookX, y: this.lookY},
      moveStarted: this.started,
    };
    this.clear();
    return out;
  }
  clear() {
    this.actions = [];
    this.zooms = [];
    this.taps = [];
    this.lookX = this.lookY = 0;
    this.started = false;
  }
}

/** What device modules write into. The facade implements it; tests use a recording fake. */
export type InputSink = {
  held: HeldInput<Direction>;
  latch: ActionLatch;
  /** Kind of the top input context: movement, look and zoom only flow in gameplay and viewer. */
  kind(): ContextKind;
  device(family: DeviceFamily, t: number): void;
  mouseMove?(dx: number, dy: number, t: number): void;
  /** Spatial UI navigation in ui/modal contexts; false when the target keeps its native arrows. */
  nav?(direction: Direction, target: EventTarget | null): boolean;
};
export const worldKind = (kind: ContextKind) => kind === 'gameplay' || kind === 'viewer';
export const stamp = (e: {timeStamp?: number}, now: () => number) =>
  e.timeStamp && e.timeStamp > 0 ? e.timeStamp : now();
