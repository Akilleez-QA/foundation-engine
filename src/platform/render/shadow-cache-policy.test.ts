import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {adoptStaticShadowCache, staticShadowPolicyOf} from './shadow-cache-policy';

test('art membership belongs to one private scene and excludes undeclared actors', () => {
  const scene = new T.Scene(),
    copy = new T.Scene(),
    staticRoot = new T.Group();
  scene.add(staticRoot);
  const fixed = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  fixed.castShadow = true;
  staticRoot.add(fixed);
  const actor = fixed.clone();
  scene.add(actor);
  const owner = adoptStaticShadowCache(scene, [staticRoot]);
  assert.deepEqual(staticShadowPolicyOf(scene)?.casters, [fixed]);
  assert.equal(staticShadowPolicyOf(copy), undefined);
  const replacement = adoptStaticShadowCache(scene, [staticRoot]);
  owner.dispose();
  assert.ok(staticShadowPolicyOf(scene));
  replacement.dispose();
  assert.equal(staticShadowPolicyOf(scene), undefined);
});
