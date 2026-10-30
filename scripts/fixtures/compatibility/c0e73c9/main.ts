// The one scene: a cube on a floor. The `turn` action starts a quarter turn; the `spin` system eases towards it.
import { defineComponent, defineEntity, defineScene, defineSystem, Name, Shape, Transform } from '@engine';

/** How far the cube should have turned, in quarter turns. */
export const Turning = defineComponent('turning', { quarters: 0 });

export const cube = defineEntity({ id: 'cube', components: [Name({ name: 'cube' }), Transform({ y: 0.6 }), Shape({ kind: 'box', size: [1.2, 1.2, 1.2], color: 0x4f8cff }), Turning()] });
const floor = defineEntity({ id: 'floor', components: [Name({ name: 'floor' }), Transform(), Shape({ kind: 'plane', size: [8, 0, 8], color: 0x2a3342 })] });

export const spin = defineSystem({
  id: 'spin',
  run(ctx, dt) {
    for (const [, tr, turning] of ctx.world.query(Transform, Turning)) {
      if (ctx.input.pressed('turn')) { turning.quarters++; ctx.state.turns = turning.quarters; ctx.play('ui.click'); }
      const goal = (turning.quarters * Math.PI) / 2;
      if (tr.ry === goal) continue;
      tr.ry = Math.abs(goal - tr.ry) < 0.001 ? goal : tr.ry + (goal - tr.ry) * Math.min(1, dt * 12);
      ctx.world.touch();
    }
  },
});

export default defineScene({
  id: 'main', title: 'Main',
  view: { camera: { position: [3.5, 3, 4.5], target: [0, 0.5, 0] }, background: 0x141a24 },
  entities: [floor, cube],
  systems: [spin],
  enter(ctx) { ctx.state.turns = 0; },
});
