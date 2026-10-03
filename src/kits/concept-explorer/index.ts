/**
 * kits/concept-explorer: look at a model from every side and learn its parts.
 *   - orbit: drag the view (or the `explorer-orbit` axis: `,` `.` and the right stick) to turn the camera around a
 *     target; a timeline or game may set yaw, pitch and distance (`explorer(ctx).orbit`);
 *   - parts: entities with `Part` (a label key, a layer, a pick radius); tap one to show its label pinned beside it,
 *     and the world event 'part' ({ id }) fires;
 *   - layers: parts belong to layers that can be shown or hidden (`explorer(ctx).layers`), with toggles in the view;
 *   - a parameter slider and a mini quiz (ui.ts) for scrubbing a quantity and checking understanding.
 * Cost: no draws of its own; DOM for pins and controls, changed only when their state changes.
 */
import {
  defineComponent,
  defineInput,
  defineKit,
  defineSystem,
  projectToView,
  Shape,
  Transform,
  viewRay,
  type KitDefinition,
  type SceneContext,
  type SystemDefinition,
  type Vec3,
} from '../../author';
import {cameraPose} from '../camera';
import {createPin, type Pin} from './ui';

/** A part of the model: `label` is a string key; `layer` groups parts that show and hide together. */
export const Part = defineComponent('part', {id: '', label: '', layer: 'main', radius: 0.5});

export const orbitInput = defineInput({
  id: 'explorer-orbit',
  label: 'Turn the view',
  axis: {
    negative: {keys: [','], pad: ['rs-left']},
    positive: {keys: ['.'], pad: ['rs-right']},
  },
});

export interface ExplorerState {
  orbit: {yaw: number; pitch: number; distance: number; target: Vec3};
  layers: Record<string, boolean>;
  selected: string | null;
  enabled: boolean;
}
interface Internal {
  s: ExplorerState;
  drag: {x: number; y: number; moved: number} | null;
  pin: Pin | null;
}
const states = new WeakMap<object, Internal>();

/** This scene visit's explorer state (create on first use). */
export function explorer(ctx: SceneContext): ExplorerState {
  return internal(ctx).s;
}
function internal(ctx: SceneContext): Internal {
  let i = states.get(ctx.world);
  if (!i) {
    i = {
      s: {orbit: {yaw: 0.6, pitch: 0.35, distance: 8, target: [0, 0, 0]}, layers: {}, selected: null, enabled: true},
      drag: null,
      pin: null,
    };
    states.set(ctx.world, i);
  }
  return i;
}

/** The part a view point (NDC) hits: the nearest part whose pick sphere the ray passes through. */
export function pickPart(ctx: SceneContext, ndc: {x: number; y: number}): string | null {
  const {origin, dir} = viewRay(ctx.view, ndc);
  let best: string | null = null,
    bestT = Infinity;
  for (const [, tr, part, sh] of ctx.world.query(Transform, Part, Shape)) {
    if (!sh.visible) continue;
    const c: Vec3 = [tr.x - origin[0], tr.y - origin[1], tr.z - origin[2]],
      t = c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2];
    if (t <= 0) continue;
    const d2 = c[0] ** 2 + c[1] ** 2 + c[2] ** 2 - t * t;
    if (d2 <= part.radius ** 2 && t < bestT) {
      bestT = t;
      best = part.id;
    }
  }
  return best;
}

export function explorerSystem(o: {smooth?: number} = {}): SystemDefinition {
  return defineSystem({
    id: 'explorer',
    phase: 'frame',
    run(ctx, dt) {
      const i = internal(ctx),
        s = i.s;
      for (const [, part, sh] of ctx.world.query(Part, Shape)) {
        const on = s.enabled && s.layers[part.layer] !== false;
        if (sh.visible !== on) sh.visible = on;
      }
      if (!s.enabled) {
        i.pin?.set(null);
        return;
      }
      const p = ctx.input.pointer;
      if (p.pressed) i.drag = {x: p.x, y: p.y, moved: 0};
      if (i.drag && p.down) {
        const dx = p.x - i.drag.x,
          dy = p.y - i.drag.y;
        i.drag.moved += Math.abs(dx) + Math.abs(dy);
        s.orbit.yaw -= dx * 2.5;
        s.orbit.pitch = Math.max(-1.2, Math.min(1.2, s.orbit.pitch - dy * 1.5));
        i.drag.x = p.x;
        i.drag.y = p.y;
      } else if (i.drag && !p.down) {
        if (i.drag.moved < 0.03) {
          s.selected = pickPart(ctx, i.drag);
          if (s.selected) ctx.world.emit('part', {id: s.selected});
        }
        i.drag = null;
      }
      s.orbit.yaw += ctx.input.axis('explorer-orbit') * 1.5 * dt;
      const pose = cameraPose(
        'orbit',
        {x: s.orbit.target[0], y: s.orbit.target[1], z: s.orbit.target[2], heading: 0},
        s.orbit,
      );
      const k = (o.smooth ?? 0.1) <= 0 ? 1 : 1 - Math.exp(-dt / (o.smooth ?? 0.1));
      const ease = (a: Vec3, b: Vec3) => {
        const n = a.map((v, j) => v + (b[j]! - v) * k) as Vec3;
        return n.every((v, j) => Math.abs(v - b[j]!) < 1e-3) ? b : n;
      }; // j < 3 over Vec3 tuples
      const cam = ctx.view.camera,
        np = ease(cam.position, pose.position),
        nt = ease(cam.target, pose.target);
      if (np.some((v, j) => v !== cam.position[j]) || nt.some((v, j) => v !== cam.target[j])) {
        cam.position = np;
        cam.target = nt;
      }
      // The selected part's label, pinned beside it.
      if (ctx.view.overlay && !i.pin) i.pin = createPin(ctx.view.overlay);
      let label: {text: string; x: number; y: number} | null = null;
      if (s.selected)
        for (const [, tr, part] of ctx.world.query(Transform, Part))
          if (part.id === s.selected) {
            const at = projectToView(ctx.view, [tr.x, tr.y + part.radius, tr.z]);
            if (at) label = {text: ctx.text(part.label), x: at.x, y: at.y};
          }
      i.pin?.set(label);
    },
  });
}

export {createSlider, createQuizPanel, createLayerToggles, type Slider, type QuizPanel, type QuizPanelView} from './ui';
/** The kit: the orbit axis. Requires the camera kit (its poses). */
export function conceptExplorer(): KitDefinition {
  return defineKit({id: 'concept-explorer', requires: ['camera'], defs: [orbitInput]});
}
