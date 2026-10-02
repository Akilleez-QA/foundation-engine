// The one scene: a board everyone shares. Each player is a capsule; Space paints the cell under you.
// One session owner per visit: created in `enter`, driven by the `sync` frame system, disposed in `exit`.
// Opened with `?host=<port>&join=<code>` (as `npm run host` prints) it joins that host; otherwise it plays locally
// with the same rules (session.ts), so it also runs in tests, play:snap and the gate without a host.
import { defineComponent, defineEntity, defineMesh, defineScene, defineSystem, Mesh, Name, Shape, Transform, type Entity, type SceneContext } from '@engine';
import { createSession, sessionEndpointFromPage, type Session, type SessionWorld } from '@kits/network';
import { hud } from '@kits/ui';
import rules, { COLORS, isAvatar, SIZE, type Action, type Board } from './session';

/** Seconds between steps while a direction is held. */
export const STEP_SECONDS = 0.12;
const HALF = (SIZE - 1) / 2;
const at = (cell: number) => cell - HALF;

/** Where an avatar is heading; the `glide` system eases its Transform there. */
export const Glide = defineComponent('glide', { x: 0, z: 0 });
const floor = defineEntity({ id: 'floor', components: [Name({ name: 'floor' }), Transform(), Shape({ kind: 'plane', size: [SIZE + 0.4, 0, SIZE + 0.4], color: 0x2a3342 })] });
export const avatar = defineEntity({ id: 'avatar', components: [Transform({ y: 0.5 }), Shape({ kind: 'capsule', size: [0.55, 1, 0.55] }), Glide()] });

// The painted cells are one mesh (one draw for the whole board): a quad per cell, recolored when the board changes.
const FLOOR = 0x2a3342, CELL = 0.45;
/** sRGB hex to the linear RGB a mesh's vertex colors use. */
const linear = (hex: number) => [16, 8, 0].map(shift => {
  const c = ((hex >> shift) & 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
function boardColors(cells: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) { const rgb = linear(cells[i] ? COLORS[cells[i]! - 1] ?? 0xffffff : FLOOR); for (let v = 0; v < 4; v++) out.push(...rgb); }
  return out;
}
const positions: number[] = [], indices: number[] = [];
for (let i = 0; i < SIZE * SIZE; i++) {
  const x = at(i % SIZE), z = at(Math.floor(i / SIZE)), n = i * 4;
  positions.push(x - CELL, 0, z - CELL, x - CELL, 0, z + CELL, x + CELL, 0, z + CELL, x + CELL, 0, z - CELL);
  indices.push(n, n + 1, n + 2, n, n + 2, n + 3); // Counter-clockwise seen from above: faces up.
}
export const board = defineEntity({ id: 'board', components: [Name({ name: 'board' }), Transform({ y: 0.01 }),
  defineMesh({ positions, indices, colors: boardColors([]) })] });

// Per-visit owners. A scene runs one visit at a time; `enter` resets them and `exit` releases them.
let session: Session<Action> | null = null;
let shown = -1, cooldown = 0;
const avatars = new Map<string, Entity>();
let painted = '';

/** The session this visit owns (tests and the dev probe read it). */
export const currentSession = () => session;

/** Mirror the session world into entities: spawn, recolor and despawn only what changed. */
function project(ctx: SceneContext, world: SessionWorld) {
  const players = Object.entries(world).filter(([, v]) => isAvatar(v));
  for (const [id, e] of avatars) if (!isAvatar(world[id])) { ctx.world.despawn(e); avatars.delete(id); }
  for (const [id, a] of players) {
    if (!isAvatar(a)) continue;
    const color = COLORS[a.color] ?? 0xffffff;
    let e = avatars.get(id);
    if (e === undefined) {
      e = ctx.spawn(avatar, Name({ name: `avatar:${id}` }), Transform({ x: at(a.x), y: 0.5, z: at(a.z) }), Shape({ kind: 'capsule', size: [0.55, 1, 0.55], color }));
      avatars.set(id, e);
    }
    const glide = ctx.world.get(e, Glide)!;
    glide.x = at(a.x); glide.z = at(a.z);
  }
  const cells = (world.board as Board | undefined)?.cells ?? [];
  const key = cells.join();
  const mesh = ctx.world.get(ctx.named('board')!, Mesh);
  if (mesh && key !== painted) { painted = key; mesh.colors = boardColors(cells); mesh.revision++; }
  ctx.state.players = players.length;
  ctx.state.painted = cells.filter(Boolean).length;
  ctx.world.touch();
}

/** Actions from input: a step per held direction every STEP_SECONDS, a paint per press. */
export const controls = defineSystem({
  id: 'controls',
  run(ctx, dt) {
    if (!session) return;
    cooldown = Math.max(0, cooldown - dt);
    if (ctx.input.pressed('paint')) session.act({ type: 'paint' });
    const dx = Math.round(ctx.input.axis('move-x')), dz = Math.round(ctx.input.axis('move-z'));
    if ((dx || dz) && cooldown === 0 && session.act({ type: 'step', dx, dz }).status !== 'refused') cooldown = STEP_SECONDS;
  },
});

/** Drive the session (network intake, views, reconnect) and redraw when its world moved. */
export const sync = defineSystem({
  id: 'sync', phase: 'frame',
  run(ctx) {
    if (!session) return;
    session.update(ctx.time.now);
    const s = session.read();
    ctx.state.session = s.status;
    ctx.state.player = s.player ?? '';
    if (s.revision !== shown) { shown = s.revision; project(ctx, s.world); }
    const h = hud(ctx);
    const vars = { player: s.player ?? '', players: ctx.state.players as number, reason: s.reason ?? '',
      seconds: s.retryAt === null ? 0 : Math.max(0, Math.ceil((s.retryAt - ctx.time.now) / 1000)) };
    const status = s.status === 'joined' && s.stale ? 'game.session.waiting' : `game.session.${s.status}`;
    h.line('session', ctx.text(status, vars));
    h.line('painted', ctx.text('game.painted', { n: ctx.state.painted as number, total: SIZE * SIZE }));
    h.prompt(ctx.text('game.hint'));
  },
});

/** Ease each avatar towards its cell; touch the world only while something moves. */
export const glide = defineSystem({
  id: 'glide', phase: 'frame',
  run(ctx, dt) {
    let moved = false;
    for (const [, tr, g] of ctx.world.query(Transform, Glide)) {
      if (tr.x === g.x && tr.z === g.z) continue;
      const k = Math.min(1, dt * 14);
      tr.x = Math.abs(g.x - tr.x) < 0.005 ? g.x : tr.x + (g.x - tr.x) * k;
      tr.z = Math.abs(g.z - tr.z) < 0.005 ? g.z : tr.z + (g.z - tr.z) * k;
      moved = true;
    }
    if (moved) ctx.world.touch();
  },
});

export default defineScene({
  id: 'world', title: 'World', type: 'level',
  view: { camera: { position: [0, 8.5, 7.5], target: [0, 0, 0.4], fov: 50 }, background: 0x141a24 },
  entities: [floor, board],
  systems: [controls, sync, glide],
  enter(ctx) {
    session?.dispose();
    avatars.clear(); painted = ''; shown = -1; cooldown = 0;
    session = createSession({ rules, endpoint: sessionEndpointFromPage() });
    const s = session.read();
    Object.assign(ctx.state, { session: s.status, player: s.player ?? '', players: 0, painted: 0 });
  },
  exit() { session?.dispose(); session = null; },
});
