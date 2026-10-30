// The trial courtyard with the author API's own post-processing: ACES tone mapping (view.output) and bloom, vignette
// and grade (view.post) at the player's post.mode tier. No three.js: compare with courtyard (none) and courtyard-lit
// (@kits/three).
import {defineScene, sceneParticles} from '@engine';
import {lanternRows} from './courtyard';
import {courtyardRows, courtyardSystems, courtyardView, LANTERNS} from './parts';

export default defineScene({
  id: 'courtyard-post',
  title: 'Courtyard (post-processing)',
  particles: sceneParticles({emitters: 32, max: 4096}),
  view: {
    ...courtyardView,
    output: {toneMapping: 'aces', exposure: 0.9},
    post: {
      bloom: {strength: 0.65, threshold: 0.9, radius: 0.5},
      vignette: {amount: 0.45},
      grade: {lift: [0, 0.005, 0.03], gain: [1.05, 1, 0.95], saturation: 1.05},
    },
  },
  entities: [...courtyardRows(), ...LANTERNS.flatMap(([x, z]) => lanternRows(x, z))],
  systems: courtyardSystems,
  enter(ctx) {
    ctx.state.collected = 0;
    ctx.state.t = 0;
  },
});
