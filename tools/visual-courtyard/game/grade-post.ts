// A still scene for the post grade browser check (tools/visual-courtyard/post-browser.mjs): the glow box on its dark
// floor with bloom, and one grade feature chosen by the `look` parameter on entry:
//   - `plain`: bloom only (the reference picture);
//   - `lut`: plus a 3D lookup table (`luts/invert.cube`, made by tools/make-luts.ts), so the dark floor turns light;
//   - `ceiling`: plus an HDR ceiling of 1.5, so the over-range box blooms less than in `plain`.
// Nothing animates.
import {defineMaterial, defineScene, Name, Shape, Transform, type PostSettings} from '@engine';

const BASE: PostSettings = {bloom: {strength: 1, threshold: 0.9, radius: 0.5}};
const LOOKS: Readonly<Record<string, PostSettings>> = {
  plain: BASE,
  lut: {...BASE, grade: {lut: {file: 'luts/invert.cube'}}},
  ceiling: {...BASE, ceiling: 1.5},
};

export default defineScene({
  id: 'grade-post',
  title: 'Grade (post-processing)',
  view: {
    camera: {position: [0, 0.6, 5], target: [0, 0.6, 0], fov: 50},
    background: 0x05070d,
    output: {toneMapping: 'aces', exposure: 1},
    post: BASE,
  },
  enter(ctx) {
    ctx.view.post = LOOKS[ctx.scene.params.look ?? 'plain'] ?? BASE;
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
      defineMaterial({emissive: 0xffb04a, emissiveIntensity: 16}),
    ],
  ],
});
