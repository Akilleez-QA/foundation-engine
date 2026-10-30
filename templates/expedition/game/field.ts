import {createDoorway} from './doorway';
import {
  defineScene,
  defineSystem,
  defineMesh,
  Name,
  Shape,
  Transform,
  defineEnvironment,
  type SceneContext,
} from '@engine';
import {createSurface} from '@kits/terrain';
import {createRouteQueue, createRouteFollower, type PathSearch} from '@kits/navigation';
import {decorativeStars} from '@kits/space';
import {createObjectiveRun} from '@kits/objectives';
import {createInventoryLedger} from '@kits/inventory';
import {createDialogue} from '@kits/dialogue';
import {createCueMixer} from '@kits/audio-mixer';
import {
  enterResources,
  exitResources,
  cancelResources,
  actResources,
  resourceView,
  resourceStationSystem,
} from './resources-station';
import {
  briefing,
  expeditionSave,
  objectiveOptions,
  inventoryOptions,
  visitStation,
  prepareSurvey,
  walkingPace,
} from './session';

export const surface = createSurface({
  id: 'expedition-field',
  revision: 1,
  seed: 42,
  originX: -8,
  originZ: -8,
  spacing: 1,
  cellsX: 16,
  cellsZ: 16,
  baseHeight: 0,
  layers: [
    {kind: 'radial', x: -3, z: -2, radius: 5, height: 1.8},
    {kind: 'noise', frequency: 0.4, amplitude: 0.12},
  ],
});
export const stations = [
  {x: -5, z: -3},
  {x: 0, z: -5},
  {x: 5, z: -2},
];
type Mixer = ReturnType<typeof createCueMixer>;
interface Session {
  doorway: ReturnType<typeof createDoorway>;
  queue: ReturnType<typeof createRouteQueue>;
  follower: ReturnType<typeof createRouteFollower> | null;
  search: PathSearch | null;
  points: Map<string, {x: number; z: number}>;
  route: string[];
  index: number;
  station: number;
  pace: number;
  status: 'idle' | 'planning' | 'walking' | 'stopped';
  mixer: Mixer;
  dispose(): void;
  render(): void;
}
const sessions = new WeakMap<SceneContext['world'], Session>();
const count = (ctx: SceneContext) =>
  createObjectiveRun(objectiveOptions, ctx.save(expeditionSave).get().objective).progress()[0]!.count;
function begin(ctx: SceneContext, s: Session, assisted = false) {
  const saved = ctx.save(expeditionSave).get();
  const d = createDialogue(briefing, 'expedition-briefing', saved.dialogue),
    v = d.view(new Set());
  if (v) {
    const result = d.choose(
      {session: v.session, revision: v.revision, node: v.node, option: assisted ? 'assisted' : 'begin'},
      new Set(),
    );
    if (result.status !== 'applied') return;
    ctx.save(expeditionSave).update(draft => {
      Object.assign(draft, prepareSurvey(draft, assisted));
      draft.dialogue = d.snapshot();
    });
    s.pace = walkingPace(ctx.save(expeditionSave).get());
  }
  if (count(ctx) >= 3) {
    if (resourceView(ctx).message === 'expedition.resource.complete') ctx.scene.goto('shelter');
    else actResources(ctx);
    return;
  }
  if (s.search || s.route.length) return;
  const tr = ctx.world.get(ctx.named('player')!, Transform)!;
  const target = stations[count(ctx)]!;
  s.station = count(ctx);
  // This open field's authored approach is traversable. A terrain sampler alone is not a general nav mesh.
  s.points = new Map([
    ['start', {x: tr.x, z: tr.z}],
    ['approach', s.station === 0 ? {x: 0, z: 2} : {x: target.x, z: 1}],
    ...(s.station === 0 ? [['door', {x: 0, z: 0}] as const] : []),
    ['station', target],
  ]);
  const distance = (a: string, b: string) => {
    const p = s.points.get(a)!,
      q = s.points.get(b)!;
    return Math.hypot(p.x - q.x, p.z - q.z);
  };
  s.queue.dispose();
  s.queue = createRouteQueue({maxRequests: 4, maxNodes: 64});
  const ids = [...s.points.keys()];
  const graph = s.doorway.graph(
    ids.map((id, i) => ({id, edges: i + 1 < ids.length ? [{to: ids[i + 1]!, cost: distance(id, ids[i + 1]!)}] : []})),
  );
  s.queue.offer({id: 'route', owner: 'guide', generation: 0, graph, start: 'start', goal: 'station'});
  s.search = {
    get result() {
      return s.queue.result('route')!;
    },
    step(work) {
      const used = s.queue.pump(work);
      return {result: s.queue.result('route')!, work: used};
    },
    cancel() {
      s.queue.dispose();
    },
  };
  s.follower = createRouteFollower({arrivalRadius: 0.015, blockedSeconds: 1, maxReplans: 1});
  s.status = 'planning';
  s.render();
}
function stop(ctx: SceneContext, s: Session) {
  cancelResources(ctx);
  s.search?.cancel();
  s.search = null;
  s.route = [];
  s.follower?.cancel();
  s.status = 'stopped';
  s.render();
}
function enter(ctx: SceneContext) {
  const mixer = createCueMixer({output: {playVoice: (id, o) => ctx.playVoice(id, o)}, maxLogical: 4, maxAudible: 2});
  const s: Session = {
    doorway: createDoorway(),
    queue: createRouteQueue({maxRequests: 4, maxNodes: 64}),
    follower: null,
    search: null,
    points: new Map(),
    route: [],
    index: 0,
    station: 0,
    pace: walkingPace(ctx.save(expeditionSave).get()),
    status: 'idle',
    mixer,
    dispose: () => {},
    render: () => {},
  };
  sessions.set(ctx.world, s);
  const overlay = ctx.view.overlay,
    doc = overlay?.ownerDocument;
  let panel: HTMLElement | undefined,
    message: HTMLElement | undefined,
    progress: HTMLElement | undefined,
    go: HTMLButtonElement | undefined,
    halt: HTMLButtonElement | undefined,
    assist: HTMLButtonElement | undefined;
  if (overlay && doc) {
    panel = doc.createElement('section');
    panel.setAttribute('aria-label', ctx.text('expedition.progress', {n: count(ctx)}));
    panel.style.cssText =
      'position:absolute;bottom:12px;left:12px;right:12px;max-width:320px;padding:12px;border-radius:12px;background:#102431ed;color:white;pointer-events:auto;font:500 16px/1.4 system-ui';
    progress = doc.createElement('strong');
    message = doc.createElement('p');
    message.style.cssText = 'margin:6px 0;';
    message.setAttribute('role', 'status');
    const row = doc.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
    go = doc.createElement('button');
    assist = doc.createElement('button');
    halt = doc.createElement('button');
    for (const b of [go, assist, halt]) {
      b.type = 'button';
      b.style.cssText = 'min-height:48px;min-width:48px;padding:8px 12px;border:0;border-radius:8px;font:inherit';
      row.append(b);
    }
    go.onclick = () => begin(ctx, s);
    assist.onclick = () => begin(ctx, s, true);
    halt.onclick = () => stop(ctx, s);
    panel.append(progress, message, row);
    overlay.append(panel);
  }
  s.render = () => {
    const n = count(ctx),
      saved = ctx.save(expeditionSave).get(),
      briefingOpen = saved.dialogue.node !== null;
    const resources = resourceView(ctx);
    const key = n >= 3 ? resources.message : briefingOpen ? 'expedition.welcome' : `expedition.${s.status}`;
    if (progress) progress.textContent = ctx.text('expedition.progress', {n});
    if (message) message.textContent = ctx.text(key, {n: s.station + 1, ore: resources.ore, plates: resources.plates});
    if (go) {
      go.textContent = ctx.text(
        n >= 3
          ? resources.message === 'expedition.resource.complete'
            ? 'expedition.shelter.enter'
            : resources.action
          : briefingOpen
            ? 'expedition.begin'
            : s.status === 'stopped'
              ? 'expedition.continue'
              : 'expedition.next',
      );
      go.disabled =
        n >= 3
          ? resources.message === 'expedition.resource.complete'
            ? false
            : resources.disabled
          : s.status === 'planning' || s.status === 'walking';
    }
    if (assist) {
      assist.textContent = ctx.text('expedition.assisted');
      assist.hidden = !briefingOpen;
    }
    if (halt) {
      halt.hidden = briefingOpen;
      halt.textContent = ctx.text('expedition.stop');
      halt.disabled =
        n >= 3
          ? ![
              'expedition.resource.scanning',
              'expedition.resource.extracting',
              'expedition.resource.crafting',
            ].includes(resources.message)
          : s.status !== 'planning' && s.status !== 'walking';
    }
    ctx.state.expedition = {
      status: s.status,
      collected: n,
      badges: createInventoryLedger(inventoryOptions, saved.inventory).quantity('collection', 'survey-badge-v1'),
      search: s.search?.result.status ?? null,
      pace: s.pace,
      equipment: saved.equipment.equipped,
    };
  };
  s.dispose = () => {
    s.doorway.dispose();
    s.queue.dispose();
    s.follower?.cancel();
    exitResources(ctx);
    s.search?.cancel();
    s.route = [];
    s.mixer.dispose();
    panel?.remove();
    sessions.delete(ctx.world);
  };
  const tr = ctx.world.get(ctx.named('player')!, Transform)!;
  const n = count(ctx);
  for (let i = 0; i < n; i++) {
    const marker = ctx.world.get(ctx.named(`station-${i}`)!, Shape);
    if (marker) marker.color = 0x7de5c2;
  }
  if (n > 0) {
    tr.x = stations[n - 1]!.x;
    tr.z = stations[n - 1]!.z;
    tr.y = surface.sample(tr.x, tr.z)!.height + 0.6;
  }
  enterResources(ctx, () => s.render());
  s.render();
}
export const expeditionSystem = defineSystem({
  id: 'expedition-guide',
  run(ctx, dt) {
    const s = sessions.get(ctx.world);
    if (!s) return;
    s.doorway.pump(ctx);
    if (ctx.input.pressed('expedition-cancel')) stop(ctx, s);
    else if (ctx.input.pressed('expedition-next')) begin(ctx, s);
    if (s.search) {
      const result = s.search.step(2).result;
      if (result.status === 'arrived') {
        s.route = [...result.path];
        s.index = 1;
        s.search = null;
        s.queue.release('route');
        s.follower!.accept(
          0,
          s.route.slice(1).map(id => {
            const p = s.points.get(id)!;
            return [p.x, 0, p.z] as const;
          }),
        );
        s.status = 'walking';
        s.render();
      } else if (result.status !== 'pending') stop(ctx, s);
    }
    if (s.route.length) {
      const tr = ctx.world.get(ctx.named('player')!, Transform)!,
        target = s.points.get(s.route[s.index]!)!;
      const crossing = s.route[s.index] === 'door' ? s.doorway.cross().status : 'ready';
      const dx = target.x - tr.x,
        dz = target.z - tr.z,
        d = Math.hypot(dx, dz),
        step = crossing === 'ready' ? Math.min(d, dt * s.pace) : 0;
      if (d > 0) {
        tr.x += (dx / d) * step;
        tr.z += (dz / d) * step;
        tr.ry = Math.atan2(dx, dz);
      }
      tr.y = surface.sample(tr.x, tr.z)!.height + 0.6;
      const outcome = s.follower!.observe([tr.x, 0, tr.z], dt);
      if (outcome === 'blocked') {
        s.follower!.replan();
        s.route = [];
        s.status = 'stopped';
        s.render();
        return;
      }
      if (d <= step + 1e-8) {
        s.index++;
        if (s.index >= s.route.length) {
          s.route = [];
          s.status = 'idle';
          ctx.save(expeditionSave).update(draft => Object.assign(draft, visitStation(draft, s.station)));
          s.mixer.request(
            {cue: count(ctx) >= 3 ? 'ui.success' : 'ui.arrive', expiresAt: ctx.time.t + 2, priority: 1},
            ctx.time.t,
          );
          const marker = ctx.world.get(ctx.named(`station-${s.station}`)!, Shape);
          if (marker) marker.color = 0x7de5c2;
          s.render();
        }
      }
    }
    s.mixer.pump(ctx.time.t);
  },
});
export function setDoorOpen(ctx: SceneContext, open: boolean) {
  sessions.get(ctx.world)?.doorway.setOpen(open);
}
const mesh = surface.mesh();
export const environment = defineEnvironment({
  background: 0x18324b,
  ambient: {sky: 0xd8edff, ground: 0x6d7951, intensity: 1},
  directional: {color: 0xffe6be, intensity: 1.4, position: [-4, 8, 5]},
  haze: null,
  points: decorativeStars(14, 96),
  pointSize: 2,
});
export default defineScene({
  id: 'field',
  title: 'Field expedition',
  type: 'area',
  view: {
    camera: {position: [0, 16, 15], target: [0, 0, 0], fov: 52, minWidthFov: 62},
    background: 0x18324b,
    environment,
  },
  entities: [
    [Transform(), defineMesh({...mesh, color: 0x739174})],
    [
      Name({name: 'player'}),
      Transform({x: 0, y: surface.sample(0, 5)!.height + 0.6, z: 5}),
      Shape({kind: 'capsule', size: [0.6, 1.2, 0.6], color: 0xffce62}),
    ],
    ...[-0.9, 0.9].map(x => [
      Transform({x, y: 1.2, z: 1}),
      Shape({kind: 'box', size: [0.2, 2.4, 0.25], color: 0x9dd4da}),
    ]),
    ...stations.map((p, i) => [
      Name({name: `station-${i}`}),
      Transform({x: p.x, y: surface.sample(p.x, p.z)!.height + 0.35, z: p.z}),
      Shape({kind: 'cylinder', size: [0.7, 0.7, 0.7], color: 0x76b9ee}),
    ]),
  ],
  enter,
  exit: ctx => sessions.get(ctx.world)?.dispose(),
  systems: [expeditionSystem, resourceStationSystem],
});
