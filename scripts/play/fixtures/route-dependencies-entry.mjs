// Finite intended-use consumer, not an installed movement/publication framework.
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild, defineGame, defineScene, defineSystem, defineEntity, Name, Transform, Shape} from '../../../src/author/index.ts';
import {createTestApi} from '../../../src/dev/test-api.ts';
import {createLifetimeRouteQueue, createRouteDependencies, createNavigationGraph, definePortal, crossPortal} from '../../../src/kits/navigation/index.ts';
import {createFrames} from '../../../src/kits/frames/frame.ts';

const brief = defineBuild({goal: 'Observe ticket-checked movement and portal revalidation.', genre: 'diagnostic',
  pitch: 'Two independent authored scopes and one finite crossing.', coreLoop: ['Prepare', 'Accept', 'Step', 'Replan'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [{id: 'S1', check: 'Invalid routes cannot move their actors', how: 'playtest', by: 'scripts/play/route-dependencies-check.mjs'}]});
const labels = {reset: 'Reset', prepare: 'Prepare west change', reject: 'Reject preparation', accept: 'Accept west change',
  step: 'Step movement', replan: 'Replan west', unavailable: 'West not ready', revise: 'Revise portal', cross: 'Cross portal', refresh: 'Refresh crossing revision'};
const game = defineGame({id: 'route-dependencies', version: '0.1.0', title: 'Route dependency diagnostic', firstScene: 'sample',
  strings: {en: Object.fromEntries(Object.entries(labels).map(([key, value]) => [`game.${key}`, value]))}});
const shape = (id, x, z, color, size = [.4, .4, .4]) => defineEntity({id, components: [Name({name: id}),
  Transform({x, y: .2, z}), Shape({kind: 'box', size, color})]});
let ctx, queue, owner, deps, actors, scopes, prepared, accepted, notification, pending, commands = 0;
let frames, portal, crossingRevision, crossing, history = [];
const tr = id => ctx.world.get(ctx.named(id), Transform);
const point = id => { const p = tr(id); return [p.x, p.z]; };
const scope = (id, revision = 0, ready = true) => ({id, incarnation: 0, revision, ready});
function disposeRoutes() { deps?.dispose(); owner?.retire(); queue?.dispose(); }
function offer(id, coordinates) {
  // Prepared topology is a handwritten chain; search still runs through the real queue.
  const names = coordinates.map((_, i) => `n${i}`);
  const graph = createNavigationGraph(names.map((name, i) => ({id: name,
    edges: i + 1 < names.length ? [{to: names[i + 1], cost: 1}] : []})));
  const admission = deps.offer({id, generation: 0, graph, start: names[0], goal: names.at(-1)}, [scopes[id]]);
  if (admission.status !== 'accepted') throw Error(`route admission: ${admission.status}`);
  queue.pump(128);
  if (deps.check(admission.ticket) !== 'valid') throw Error('invalid adoption');
  const result = deps.result(admission.ticket);
  if (result?.status !== 'arrived') throw Error('finite route did not complete within 128 work units');
  actors[id] = {ticket: admission.ticket, path: result.path.map(name => [...coordinates[names.indexOf(name)]]), next: 1};
}
function reset() {
  disposeRoutes();
  queue = createLifetimeRouteQueue({maxOwners: 1, maxRequests: 2, maxNodes: 10});
  const opened = queue.openOwner({label: 'diagnostic visit'});
  if (opened.status !== 'accepted') throw Error(opened.status);
  owner = opened.owner;
  deps = createRouteDependencies(owner, {maxScopes: 2, maxRoutes: 2, maxDependencies: 2, maxIdentityLength: 16});
  scopes = {west: scope('west'), east: scope('east')};
  for (const value of Object.values(scopes)) deps.acceptScope(value);
  actors = {}; history = []; prepared = null; accepted = false; notification = null;
  for (const [id, x, z] of [['west', -4, 0], ['east', -4, 4], ['traveler', -1, -3], ['obstacle', 0, 0]]) {
    Object.assign(tr(id), {x, z, y: .2});
  }
  ctx.world.get(ctx.named('obstacle'), Shape).visible = false;
  offer('west', [[-4, 0], [4, 0]]); offer('east', [[-4, 4], [4, 4]]);
  frames = createFrames(1, 1);
  frames.set({id: 'world', generation: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]});
  portal = definePortal({id: 'link', revision: 0, from: {frame: {id: 'world', generation: 0}, position: [-1, .2, -3]},
    to: {frame: {id: 'world', generation: 0}, position: [1, .2, -3]}, width: 1, height: 1, open: true});
  crossingRevision = 0; crossing = null; ctx.world.touch();
}
function move() {
  for (const [id, actor] of Object.entries(actors)) {
    // Required even though the completed path above was copied into consumer state.
    if (deps.check(actor.ticket) !== 'valid') continue;
    const target = actor.path[actor.next]; if (!target) continue;
    const p = tr(id), dx = target[0] - p.x, dz = target[1] - p.z, distance = Math.hypot(dx, dz);
    const fraction = Math.min(.5 / distance, 1);
    p.x += dx * fraction; p.z += dz * fraction;
    if (distance <= .5) actor.next++;
    ctx.world.touch();
  }
}
const actions = {
  reset,
  prepare() { prepared = scope('west', scopes.west.revision + 1); },
  reject() { prepared = null; },
  accept() {
    if (!prepared) throw Error('prepare before accepting');
    // This finite fixture installs its authored obstacle before notifying dependencies.
    ctx.world.get(ctx.named('obstacle'), Shape).visible = true; accepted = true; scopes.west = prepared; prepared = null;
    notification = deps.acceptScope(scopes.west); ctx.world.touch();
  },
  step: move,
  replan() {
    if (!accepted || !scopes.west.ready) throw Error('accept a ready west obstacle before replanning');
    deps.release(actors.west.ticket);
    const [x, z] = point('west');
    if (x >= -1.2 || z !== 0) throw Error('finite example replans only before the obstacle');
    offer('west', [[x, z], [x, 2], [3, 2], [3, 0], [4, 0]]);
  },
  unavailable() { scopes.west = scope('west', scopes.west.revision + 1, false); notification = deps.acceptScope(scopes.west); },
  revise() { portal = definePortal({...portal, revision: portal.revision + 1}); },
  refresh() { crossingRevision = portal.revision; },
  cross() {
    crossing = crossPortal(portal, crossingRevision, {radius: .2, height: .4}, frames, () => true,
      (from, to) => from[2] === -3 && to[2] === -3); // Authored clear lane, no inferred collision geometry.
    if (crossing.status === 'ready') {
      Object.assign(tr('traveler'), {x: crossing.to[0], y: crossing.to[1], z: crossing.to[2]}); ctx.world.touch();
    }
  },
};
function snapshot() {
  return {commands, prepared, accepted, scopes, notification, crossingRevision, portalRevision: portal.revision, crossing,
    positions: Object.fromEntries(['west', 'east', 'traveler'].map(id => [id, point(id)])),
    tickets: Object.fromEntries(Object.entries(actors).map(([id, actor]) => [id, deps.check(actor.ticket)])),
    queue: queue.stats, dependencies: deps.stats};
}
const consumer = defineSystem({id: 'route-consumer', phase: 'frame', run() {
  if (!pending) return;
  const action = pending; pending = null;
  actions[action](); commands++;
  if (history.length === 128) history.shift();
  history.push({action, ...snapshot()});
  document.querySelector('#metadata').textContent = JSON.stringify(snapshot(), null, 2);
}});
const sample = defineScene({id: 'sample', title: 'Authored route scopes', systems: [consumer],
  entities: [shape('west', -4, 0, 0xffad42), shape('east', -4, 4, 0x55ccff), shape('traveler', -1, -3, 0xb999ff),
    shape('obstacle', 0, 0, 0xdd4455, [2, .4, 1]), shape('portal-from', -1, -3, 0x7755aa, [.1, 1, 1]), shape('portal-to', 1, -3, 0x7755aa, [.1, 1, 1])],
  view: {camera: {position: [0, 13, 11], target: [0, 0, .5]}, background: 0x17212b},
  enter(context) {
    ctx = context; reset();
    const controls = document.querySelector('#controls');
    for (const id of Object.keys(labels)) {
      const button = document.createElement('button'); button.textContent = ctx.text(`game.${id}`); button.dataset.action = id;
      button.onclick = () => { if (pending) throw Error('diagnostic command already pending'); pending = id; };
      controls.append(button);
    }
    document.querySelector('#metadata').textContent = JSON.stringify(snapshot(), null, 2);
  },
  exit() { pending = null; disposeRoutes(); document.querySelector('#controls').replaceChildren(); },
});
const compiled = compileGame({brief, game, defs: [sample]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {mode: 'test', flag: id => appFeatures().enabled(id), probes: true});
const booted = app.boot();
window.engine = createTestApi(app, booted);
window.routeDiagnostic = {cleanup: () => ({queue: queue.stats, dependencies: deps.stats, controls: document.querySelector('#controls').children.length}), snapshot, history: () => history, ready: () => Boolean(ctx), dispose: () => app.dispose()};
