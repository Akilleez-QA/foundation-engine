// A still scene for the browser check (tools/visual-courtyard/browser.mjs): one lantern custom object on a floor, drawn
// through an EffectComposer with bloom. No system and no frame hook, so it draws only when something changes.
import {defineMaterial, defineScene, Name, Shape, Transform} from '@engine';
import {sceneThree, ThreeObject} from '@kits/three';
import {lantern} from './lantern';
import {bloom} from './look';

export default defineScene({
  id: 'glow',
  title: 'Lantern',
  extensions: [
    sceneThree({
      objects: [lantern],
      max: 1,
      setup: three => bloom(three, {strength: 0.8, radius: 0.4, threshold: 0.85}),
    }),
  ],
  view: {camera: {position: [0, 5, 7], target: [0, 1, 0], fov: 50}, background: 0x05070d, lights: 'none'},
  entities: [
    [
      Name({name: 'floor'}),
      Transform(),
      Shape({kind: 'plane', size: [16, 0, 16], color: 0x9a948c}),
      defineMaterial({roughness: 0.9}),
    ],
    [Name({name: 'lantern'}), Transform({x: -2}), ThreeObject({use: 'lantern'})],
  ],
});
