// The one scene: dodge falling blocks. Systems run at the fixed step in this order: steer, spawn, fall, collide,
// then the frame-phase HUD. World state (ctx.state): phase 'playing' | 'over', score, best, time.
import { defineScene, defineSystem, Transform, type SceneContext } from '@engine';
import { hud } from '@kits/ui';
import best from './best';
import { ball, block, Hazard, lane, LANE, BOTTOM } from './components';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const playing = (ctx: SceneContext) => ctx.state.phase === 'playing';

export const steer = defineSystem({
  id: 'steer',
  run(ctx, dt) {
    const e = ctx.named('player'), tr = e === undefined ? undefined : ctx.world.get(e, Transform);
    if (!tr || !playing(ctx)) return;
    const p = ctx.input.pointer;
    // Keys and stick steer at 7 m/s; a held pointer (touch, mouse) pulls the ball towards it.
    const goal = p.down ? p.x * (LANE + 1) : null;
    const dir = goal === null ? ctx.input.axis('steer') : clamp((goal - tr.x) * 2, -1, 1);
    const x = clamp(tr.x + dir * 7 * dt, -LANE, LANE);
    if (x !== tr.x) { tr.x = x; tr.rz = -x * 0.4; }
  },
});

export const spawn = defineSystem({
  id: 'spawn',
  run(ctx, dt) {
    if (!playing(ctx)) return;
    const time = (ctx.state.time as number) + dt;
    ctx.state.time = time;
    ctx.state.next = (ctx.state.next as number) - dt;
    if ((ctx.state.next as number) > 0) return;
    ctx.state.next = Math.max(0.35, 0.9 - time * 0.02);
    ctx.spawn(block, Transform({ x: (ctx.random() * 2 - 1) * LANE, y: 0.45, z: -9 }), Hazard({ speed: Math.min(12, 4 + time * 0.15) }));
  },
});

export const fall = defineSystem({
  id: 'fall',
  run(ctx, dt) {
    if (!playing(ctx)) return;
    for (const [e, tr, h] of ctx.world.query(Transform, Hazard)) {
      tr.z += h.speed * dt;
      tr.ry += dt * 2;
      if (tr.z > BOTTOM) { ctx.world.despawn(e); ctx.state.score = (ctx.state.score as number) + 1; }
    }
  },
});

export const collide = defineSystem({
  id: 'collide',
  run(ctx) {
    const e = ctx.named('player'), me = e === undefined ? undefined : ctx.world.get(e, Transform);
    if (!me || !playing(ctx)) return;
    for (const [, tr] of ctx.world.query(Transform, Hazard)) {
      if (Math.abs(tr.x - me.x) < 0.9 && Math.abs(tr.z - me.z) < 0.9) {
        ctx.state.phase = 'over';
        ctx.world.emit('crashed', { score: ctx.state.score });
        ctx.play('ui.bump');
        const save = ctx.save(best), score = ctx.state.score as number;
        save.update(d => { d.runs++; if (score > d.score) d.score = score; });
        ctx.state.best = save.get().score;
        return;
      }
    }
  },
});

export const again = defineSystem({
  id: 'again',
  run(ctx) { if (!playing(ctx) && ctx.input.pressed('restart')) ctx.scene.restart(); },
});

export const showHud = defineSystem({
  id: 'show-hud', phase: 'frame',
  run(ctx) {
    const h = hud(ctx);
    h.line('score', ctx.text('game.hud.score', { n: ctx.state.score as number }));
    h.line('best', ctx.text('game.hud.best', { n: ctx.state.best as number }));
    const over = !playing(ctx);
    h.banner(over ? ctx.text('game.over', { n: ctx.state.score as number }) : null);
    h.prompt(over ? ctx.text('game.restart-hint') : (ctx.state.time as number) < 3 ? ctx.text('game.steer-hint') : null);
  },
});

export default defineScene({
  id: 'play', title: 'Play', type: 'level',
  view: { camera: { position: [0, 15, 12], target: [0, 0, 0.5], fov: 55, minWidthFov: 50 }, background: 0x121826 },
  entities: [lane, ball],
  systems: [steer, spawn, fall, collide, again, showHud],
  enter(ctx) {
    Object.assign(ctx.state, { phase: 'playing', score: 0, time: 0, next: 1, best: ctx.save(best).get().score });
  },
});
