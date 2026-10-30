// A still scene for the post-processing browser check (tools/visual-courtyard/post-browser.mjs): one emissive box in
// the middle of the view on a dark floor, ACES tone mapping, and bloom and vignette. Nothing animates.
import {defineMaterial, defineScene, Name, Shape, Transform} from '@engine';

export default defineScene({
  id: 'glow-post',
  title: 'Glow (post-processing)',
  view: {
    camera: {position: [0, 0.6, 5], target: [0, 0.6, 0], fov: 50},
    background: 0x05070d,
    output: {toneMapping: 'aces', exposure: 1},
    post: {bloom: {strength: 1, threshold: 0.9, radius: 0.5}, vignette: {amount: 0.3}},
  },
  entities: [
    [
      Name({name: 'floor'}),
      Transform(),
      Shape({kind: 'plane', size: [16, 0, 16], color: 0x303236}),
      defineMaterial({roughness: 0.9}),
    ],
    [
      Name({name: 'glass'}),
      Transform({y: 0.6}),
      Shape({kind: 'box', size: [0.6, 0.6, 0.6], color: 0xffd28a}),
      defineMaterial({emissive: 0xffb04a, emissiveIntensity: 6}),
    ],
  ],
});
