import {openOverlayLayer, modalDialogAbove} from './keymap-overlay';
import {appLayers} from '../ui/runtime';
import {
  createInput,
  type Input,
  type SampledFrame,
  type ButtonAction,
  type Vec2,
  type WorldTap,
  type DeviceFamily,
  type InputContext,
} from '.';

/** What a hosted minigame reads each frame: the aim (keys, stick, d-pad), camera turn and zoom (drag, right stick,
 *  wheel, pinch, shoulder buttons), world taps on its canvas and discrete presses (A/Enter/Space, pad B, Start/P, Y/C, View/V).
 *  Keyboard Escape is the game's keymap overlay layer: `minigameEscape` below. */
export type MinigameFrame = {
  dt: number;
  move: Vec2;
  look: Vec2;
  zoom: number;
  taps: WorldTap[];
  pressed: Set<ButtonAction>;
  device: DeviceFamily;
};
export type MinigameInputOptions = {
  surface: HTMLCanvasElement;
  signal: AbortSignal;
  label: string;
  /** The hosting scene's input: its keyboard and pad reach the game through a viewer layer on its stack. */
  host?: Input | null;
  /** The tools panel that Start / P opens for d-pad navigation; B closes it again. */
  menu: HTMLElement;
  onMenu?: (open: boolean) => void;
};

/** Merge host-provided keyboard/pad frames with this canvas's own pointer and wheel. */
export function mergeFrames(
  dt: number,
  local: SampledFrame,
  host: {move: Vec2; look: Vec2; zoom: number; pressed: Set<ButtonAction>; device: DeviceFamily | null} | null,
): MinigameFrame {
  const pressed = new Set(local.pressed);
  let zoom = local.zoom.reduce((s, z) => s + z.notches, 0);
  if (host) {
    for (const p of host.pressed) pressed.add(p);
    zoom += host.zoom;
  }
  const move = host && (host.move.x || host.move.y) ? host.move : local.move;
  return {
    dt,
    move,
    look: {x: local.look.x + (host?.look.x ?? 0), y: local.look.y + (host?.look.y ?? 0)},
    zoom,
    taps: local.taps,
    pressed,
    device: host?.device ?? local.device,
  };
}

export function minigameInput(o: MinigameInputOptions) {
  const host = o.host ?? null;
  // The canvas always gets its own recognizer (drag, pinch, wheel, taps); keyboard and pad come from the host scene when it hosts us.
  const local = createInput({
    surface: o.surface,
    signal: o.signal,
    label: o.label,
    settings: {dpad: 'move'},
    devices: {keyboard: !host, gamepad: !host, pointer: true, wheel: true},
  });
  const pending = {
    move: {x: 0, y: 0},
    look: {x: 0, y: 0},
    zoom: 0,
    pressed: new Set<ButtonAction>(),
    device: null as DeviceFamily | null,
  };
  const owner = host ?? local;
  let menu: InputContext | null = null,
    lastDevice: DeviceFamily | null = null;
  const closeMenu = () => {
    if (!menu) return;
    const m = menu;
    menu = null;
    m.pop();
    o.onMenu?.(false);
  };
  const openMenu = () => {
    if (menu) return;
    menu = owner.openLayer('ui', {
      element: o.menu,
      label: o.label + '-tools',
      onFrame: f => {
        if (f.pressed.has('back') || f.pressed.has('pause')) closeMenu();
      },
    });
    o.onMenu?.(true);
  };
  const layer = host
    ? host.openLayer('viewer', {
        label: o.label,
        onFrame: f => {
          pending.move = f.move;
          pending.look.x += f.look.x;
          pending.look.y += f.look.y;
          for (const z of f.zoom) pending.zoom += z.notches;
          for (const p of f.pressed) pending.pressed.add(p);
          pending.device = f.device;
        },
      })
    : null;
  o.signal.addEventListener(
    'abort',
    () => {
      closeMenu();
      layer?.pop();
    },
    {once: true},
  );
  return {
    local,
    get menuOpen() {
      return !!menu;
    },
    openMenu,
    closeMenu,
    /** Hand the active pointer to the game (a grabbed marble or rock): no drag-look, no tap. */
    claimPointer() {
      local.pointer?.ignoreActive();
    },
    sample(dt: number): MinigameFrame {
      const f = local.sample(dt),
        mine = f.mine || !!host;
      const out = mergeFrames(dt, f, host && layer?.active && !menu ? pending : null);
      // While the tools menu (or another layer) holds the pad, keep the last real device so the hint chip does not flicker.
      if (host && (!layer?.active || menu) && lastDevice) out.device = lastDevice;
      else if (host && pending.device) lastDevice = out.device;
      pending.look = {x: 0, y: 0};
      pending.zoom = 0;
      pending.pressed = new Set();
      if (!layer?.active || menu) pending.move = {x: 0, y: 0};
      if (!mine || menu) return {...out, move: {x: 0, y: 0}, look: {x: 0, y: 0}, zoom: 0, taps: [], pressed: new Set()};
      return out;
    },
  };
}
export type MinigameInput = ReturnType<typeof minigameInput>;

/**
 * Keyboard Escape for a hosted minigame, through the keymap (ADR 0047): the game opens an overlay layer
 * whose Back closes its tools menu when open, else the game, once per press, from any focused control (sliders
 * included). Under a native modal dialog (Sound, Comfort, the guide) Escape stays the dialog's. Pad B still arrives as
 * `back` in the game's frame.
 */
export function minigameEscape(
  id: string,
  root: HTMLElement,
  signal: AbortSignal,
  menu: {readonly menuOpen: boolean; closeMenu(): void},
  close: () => void,
): void {
  openOverlayLayer({
    id: 'minigame:' + id,
    element: root,
    signal,
    onEscape: () => {
      if (modalDialogAbove(root)) return false;
      if (menu.menuOpen) menu.closeMenu();
      else close();
      return undefined;
    },
  });
}

/**
 * A hosted game's hold on its card: until the returned release runs,
 * the card's other children are inert, through the app's layers (`inertHost`). Call it before appending `root` to
 * `host`. The layer is non-modal and covers nothing: it takes no focus, moves none on release, and leaves Escape and
 * Tab to the game's own layers (the host's minigame layer is the scrim). The release is idempotent.
 */
export function coverHost(id: string, host: HTMLElement, root: HTMLElement): () => void {
  const layer = appLayers(host.ownerDocument).open({
    id: 'minigame-host:' + id,
    kind: 'panel',
    element: root,
    cover: 'none',
    modal: false,
    inertHost: host,
    onEscape: () => false,
  });
  return () => layer.close('program');
}
