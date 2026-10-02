// The one scene: a board everyone shares. Each player is a capsule; Space paints the cell under you.
// One session owner per visit: created in `enter`, driven by the `sync` frame system, disposed in `exit`.
// Opened with `?host=<port>&join=<code>` (as `npm run host` prints) it joins that host; otherwise it plays locally
// with the same rules (session.ts), so it also runs in tests, play:snap and the gate without a host.
import { defineComponent, defineEntity, defineScene, defineSystem, Name, Shape, Transform, type Entity, type SceneContext } from '@engine';
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
export const tile = defineEntity({ id: 'tile', components: [Transform({ y: 0.01 }), Shape({ kind: 'box', size: [0.9, 0.02, 0.9] })] });

// Per-visit owners. A scene runs one visit at a time; `enter` resets them and `exit` releases them.
let session: Session<Action> | null = null;
let shown = -1, cooldown = 0;
const avatars = new Map<string, Entity>(), tiles = new Map<number, Entity>();

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
  cells.forEach((mark, i) => {
    const e = tiles.get(i);
    if (!mark) { if (e !== undefined) { ctx.world.despawn(e); tiles.delete(i); } return; }
    const color = COLORS[mark - 1] ?? 0xffffff;
    if (e === undefined) tiles.set(i, ctx.spawn(tile, Transform({ x: at(i % SIZE), y: 0.01, z: at(Math.floor(i / SIZE)) }), Shape({ kind: 'box', size: [0.9, 0.02, 0.9], color })));
    else { const shape = ctx.world.get(e, Shape)!; if (shape.color !== color) shape.color = color; }
  });
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
  entities: [floor],
  systems: [controls, sync, glide],
  enter(ctx) {
    session?.dispose();
    avatars.clear(); tiles.clear(); shown = -1; cooldown = 0;
    session = createSession({ rules, endpoint: sessionEndpointFromPage() });
    const s = session.read();
    Object.assign(ctx.state, { session: s.status, player: s.player ?? '', players: 0, painted: 0 });
  },
  exit() { session?.dispose(); session = null; },
});
