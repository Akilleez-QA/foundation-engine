// "Before": the visual-capability trial's courtyard, author API only. There are no local lights, so each lantern paints
// its light onto the ground with stacked transparent discs and fakes a glow with an additive particle halo.
import {defineEmitter, defineMaterial, defineScene, sceneParticles, Shape, Transform} from '@engine';
import {Solid} from '@kits/character';
import {courtyardRows, courtyardSystems, courtyardView, LANTERNS, WARM, type Row} from './parts';

/** A lantern on a post: iron post, glowing glass, a cap, a fake light pool on the ground and a halo of soft light. */
const lantern = (x: number, z: number): Row[] => [
  [
    Transform({x, y: 1.1, z}),
    Shape({kind: 'cylinder', size: [0.14, 2.2, 0.14], color: 0x1c1f26}),
    defineMaterial({metalness: 0.8, roughness: 0.4}),
    Solid({r: 0.2}),
  ],
  [
    Transform({x, y: 2.45, z}),
    Shape({kind: 'box', size: [0.42, 0.5, 0.42], color: 0xffd28a}),
    defineMaterial({emissive: WARM, emissiveIntensity: 6, roughness: 0.2}),
  ],
  [
    Transform({x, y: 2.8, z}),
    Shape({kind: 'cone', size: [0.6, 0.3, 0.6], color: 0x1c1f26}),
    defineMaterial({metalness: 0.8, roughness: 0.4}),
  ],
  ...[6, 4.6, 3.2, 1.8].map((d, i): Row => [
    Transform({x, y: 0.012 + i * 0.003, z}),
    Shape({kind: 'cylinder', size: [d, 0.01, d], color: 0x000000}),
    defineMaterial({emissive: WARM, emissiveIntensity: 1, opacity: 0.11, transparent: true}),
  ]),
  [
    Transform({x, y: 2.45, z}),
    defineEmitter({
      mode: 'continuous',
      rate: 10,
      max: 16,
      lifetime: [1.2, 1.6],
      speed: [0, 0.05],
      spread: Math.PI,
      size: [2.2, 2.6],
      color: [WARM],
      opacity: [0, 0.35, 0],
      essential: true,
    }),
  ],
];

export default defineScene({
  id: 'courtyard',
  title: 'Courtyard (author API)',
  particles: sceneParticles({emitters: 32, max: 4096}),
  view: courtyardView,
  entities: [...courtyardRows(), ...LANTERNS.flatMap(([x, z]) => lantern(x, z))],
  systems: courtyardSystems,
  enter(ctx) {
    ctx.state.collected = 0;
    ctx.state.t = 0;
  },
});
