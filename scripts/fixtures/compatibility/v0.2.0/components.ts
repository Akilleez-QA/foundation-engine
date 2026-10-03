// Components and prefabs of the play scene (a helper file: no default export, so it is not a definition).
import { defineComponent, defineEntity, Name, Shape, Transform } from '@engine';

/** A falling block and how fast it falls, m/s. */
export const Hazard = defineComponent('hazard', { speed: 4 });

export const LANE = 4.5;       // the ball stays within ±LANE
export const TOP = -9, BOTTOM = 8;

export const ball = defineEntity({ id: 'ball', components: [Name({ name: 'player' }), Transform({ y: 0.5, z: 5 }), Shape({ kind: 'sphere', size: [1, 1, 1], color: 0xffcc33 })] });
export const block = defineEntity({ id: 'block', components: [Transform({ y: 0.45, z: TOP }), Shape({ kind: 'box', size: [0.9, 0.9, 0.9], color: 0xff5a5f }), Hazard()] });
export const lane = defineEntity({ id: 'lane', components: [Name({ name: 'lane' }), Transform({ z: -0.5 }), Shape({ kind: 'plane', size: [2 * LANE + 1, 0, BOTTOM - TOP + 1], color: 0x243044 })] });
