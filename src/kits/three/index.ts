/**
 * @kits/three: full three.js for a game that opts in (README.md). @unstable: it tracks the three.js version the engine
 * bundles (r186); a three upgrade may break code written against it, and that code is the game's to maintain.
 *
 *   defineGame({ kits: [three()] })                          the game opts in (lint:layers then allows `three` imports)
 *   defineScene({ extensions: [sceneThree({ setup })] })      a scene gets a handle per visit
 *   useThree(ctx)                                             the handle: THREE, scene, root, camera, renderer, canvas,
 *                                                             requestRender, onFrame, onBeforeRender, onResize,
 *                                                             setRenderOverride, own
 *   customObject({ create, update, dispose }) + ThreeObject   the convenience path: an object per entity
 *
 * Prefer the engine's own data (`@engine`: environment, materials, particles) where it can say what you want: it keeps
 * quality tiers, backends and upgrades the engine's problem. This kit is the full-power path for everything else.
 */
import * as THREE from 'three';
import {defineKit, type KitDefinition} from '../../author';

export {THREE};
export {
  sceneThree,
  useThree,
  hasThree,
  type ThreeHandle,
  type ThreeFrame,
  type ThreeRenderFrame,
  type ThreeSize,
  type SceneThreeOptions,
} from './handle';
export {
  customObject,
  ThreeObject,
  measureTree,
  CUSTOM_OBJECT_LIMITS,
  type CustomObject,
  type CustomObjectInput,
  type CustomObjectContext,
  type CustomObjectFrame,
  type CustomObjectLimits,
  type CustomObjectStats,
} from './custom-object';

/** The kit: list it in `defineGame({ kits })` to opt the game into three.js. */
export function three(): KitDefinition {
  return defineKit({id: 'three'});
}
