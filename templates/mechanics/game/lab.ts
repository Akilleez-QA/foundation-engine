import { defineScene, defineSystem, defineMaterial, Name, Shape, Transform, Model, type SceneContext } from '@engine';
import { cameraSystem } from '@kits/camera';
import { Character, characterSystem, Walls, Solid } from '@kits/character';
import { VehicleRider } from '@kits/vehicles';
import { createSession, type LabSession } from './session';
const sessions = new WeakMap<object, LabSession>();
const panels = new WeakMap<object, { render(): void; dispose(): void }>();
export const sessionFor = (ctx: SceneContext) => sessions.get(ctx.world)!;
function enter(ctx: SceneContext) {
  const s = createSession(ctx); sessions.set(ctx.world, s);
  const doc = ctx.view.overlay?.ownerDocument; if (!doc) return;
  const panel = doc.createElement('section'), message = doc.createElement('p'), button = doc.createElement('button');
  panel.setAttribute('aria-label', ctx.text('lab.title'));
  panel.style.cssText = 'position:absolute;bottom:12px;left:12px;right:12px;max-width:320px;padding:12px;border-radius:12px;background:#102431ed;color:white;pointer-events:auto;font:500 16px/1.4 system-ui';
  message.setAttribute('role', 'status'); message.style.cssText = 'margin:0 0 10px';
  button.type = 'button'; button.style.cssText = 'min-height:48px;min-width:48px;padding:8px 12px;border:0;border-radius:8px;font:inherit;background:#a7eddb;color:#102431';
  button.onclick = () => s.next(ctx); panel.append(message, button); ctx.view.overlay!.append(panel);
  let last = '';
  const render = () => { const key = s.status() + s.label(); if (key === last) return; last = key; message.textContent = ctx.text(s.status()); button.textContent = ctx.text(s.label()); button.disabled = s.status() === 'lab.wait'; };
  panels.set(ctx.world, { render, dispose() { button.onclick = null; panel.remove(); } }); render();
}
const guide = defineSystem({ id: 'lab-guide', run(ctx, dt) {
  const s = sessionFor(ctx); if (!s) return;
  if (ctx.input.pressed('lab-next')) s.next(ctx); s.update(ctx, dt); panels.get(ctx.world)?.render();
} });
const follow = defineSystem({ id: 'lab-rider', run(ctx, dt) { const s = sessionFor(ctx); if (s) s.riderSystem.run(ctx, dt); } });
export default defineScene({ id: 'lab', title: 'lab.title', type: 'area',
  view: { background: 0x91bacd, environment: { background: 0x91bacd, cube: { faces: ['lab-sky-px', 'lab-sky-nx', 'lab-sky-py', 'lab-sky-ny', 'lab-sky-pz', 'lab-sky-nz'], screenPx: 64 }, ambient: { sky: 0xffffff, ground: 0x667788, intensity: 2 }, directional: { color: 0xffffff, intensity: 2, position: [3, 8, 5] }, haze: null, points: [], pointSize: 1 }, camera: { position: [0, 12, 15], target: [0, 0, 0], fov: 52, minWidthFov: 70 } },
  entities: [
    // Material: the panel texture tiled across the floor (tinted by the shape colour) and a softly lit kiosk.
    [Name({ name: 'floor' }), Transform({ y: -.12 }), Shape({ kind: 'box', size: [16, .2, 12], color: 0x6f8fa3 }), defineMaterial({ texture: 'lab-panel', repeat: [8, 6], roughness: .85 })],
    [Walls({ minX: -7, maxX: 7, minZ: -5, maxZ: 5 })],
    [Name({ name: 'platform' }), Transform({ x: -3, y: .2 }), Shape({ kind: 'box', size: [2.4, .4, 2], color: 0x5bc8c0 })],
    [Name({ name: 'player' }), Transform({ x: -3, y: .7 }), Shape({ kind: 'capsule', size: [.6, 1.2, .6], color: 0xf5d798 }), Character(), VehicleRider({ id: 'player' })],
    [Name({ name: 'kiosk' }), Transform({ y: .6, z: 2 }), Shape({ kind: 'box', size: [1, 1.2, 1], color: 0x66aee0 }), defineMaterial({ texture: 'lab-panel', roughness: .4, metalness: .3, emissive: 0x0b2a3a })],
    [Transform({ x: 2.1, z: -2 }), Solid({ halfX: .1, halfZ: .5 })],
    [Name({ name: 'beacon' }), Transform({ x: 1.5, y: .8, z: -2 }), Model({ asset: 'lab-beacon', clip: 'pulse' })],
    [Name({ name: 'target' }), Transform({ x: 4, y: 1, z: -1 }), Shape({ kind: 'sphere', size: [.9, .9, .9], color: 0xf4bf47 })],
    [Name({ name: 'probe' }), Transform(), Shape({ kind: 'box', size: [.2, .2, .6], color: 0xdaf1f9, visible: false })],
    [Name({ name: 'beam' }), Transform({ x: 3, y: 1, z: -1 }), Shape({ kind: 'box', size: [6, .06, .06], color: 0xd7fff5, visible: false })],
  ], enter,
  exit(ctx) { sessionFor(ctx)?.dispose(); sessions.delete(ctx.world); panels.get(ctx.world)?.dispose(); panels.delete(ctx.world); },
  systems: [guide, characterSystem({ relative: 'world', pointer: false, when: ctx => { const s = sessionFor(ctx); return Boolean(s && s.owner.owns('character') && s.snapshot().phase > 1); } }), follow, cameraSystem('fixed', { position: [0, 12, 15], lookAt: [0, 0, 0], resetRevision: ctx => sessionFor(ctx)?.owner.state.revision ?? 0 })],
});
