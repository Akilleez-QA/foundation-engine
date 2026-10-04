/**
 * author/scene-sky.ts: the gradient sky and its stars on three.js (VIS-05), a lazy chunk: the scene runtime loads it
 * before the first frame of a scene whose environment has a `sky`, or when a later environment first asks for one.
 *
 * The sky is one CPU-generated `DataTexture` (sky-pixels.ts) on an inverted sphere centred on the camera, drawn first
 * with three's built-in unlit material: no custom shader, so the same data draws on the WebGPU backend (ADR 0078). It
 * is not fogged or tone-mapped, like the background colour, so a haze in the horizon colour meets it without a seam
 * (three applies fog after tone mapping). Stars are their own additive points, so a faint star fades into a bright sky
 * instead of darkening it. The texture is regenerated only when the sky's own fields change (a key compare, never per
 * frame), and the stars only when `stars` changes.
 */
import * as T from 'three';
import type {Sky} from './sky';
import {skyPixels, skyStars, skyTextureKey} from './sky-pixels';

/** The sky sphere's radius: inside the scene camera's far plane (500 m), centred on the camera like the star points. */
const SKY_RADIUS = 400;

export function createSkyLayer(scene: T.Scene) {
  let sky: {mesh: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>; key: string} | null = null;
  let stars: {points: T.Points<T.BufferGeometry, T.PointsMaterial>; key: string} | null = null;
  return {
    /** Show `next` (null hides the sky and its stars); `pointSize` is the environment's star size. */
    apply(next: Sky | null, pointSize: number, camera: T.Vector3): void {
      if (next) {
        const key = skyTextureKey(next);
        if (!sky) {
          const material = new T.MeshBasicMaterial({
            side: T.BackSide,
            depthTest: false,
            depthWrite: false,
            fog: false,
            toneMapped: false,
          });
          const mesh = new T.Mesh(new T.SphereGeometry(SKY_RADIUS, 32, 16), material);
          mesh.name = 'environment-sky';
          mesh.frustumCulled = false;
          mesh.renderOrder = -1001;
          mesh.position.copy(camera);
          scene.add(mesh);
          sky = {mesh, key: ''};
        }
        if (sky.key !== key) {
          const {width, height, data} = skyPixels(next);
          const texture = new T.DataTexture(data, width, height, T.RGBAFormat);
          texture.colorSpace = T.SRGBColorSpace;
          texture.magFilter = texture.minFilter = T.LinearFilter;
          texture.wrapS = T.RepeatWrapping;
          texture.needsUpdate = true;
          const retired = sky.mesh.material.map;
          sky.mesh.material.map = texture;
          sky.mesh.material.needsUpdate = !retired;
          retired?.dispose();
          sky.key = key;
        }
        sky.mesh.visible = true;
      } else if (sky) sky.mesh.visible = false;
      const starKey = next?.stars ? JSON.stringify(next.stars) : '';
      if (next?.stars && stars?.key !== starKey) {
        const geometry = new T.BufferGeometry();
        const at: number[] = [],
          tint: number[] = [];
        for (const s of skyStars(next.stars)) {
          const length = Math.hypot(...s.direction);
          at.push(...s.direction.map(v => (v / length) * 100));
          const c = new T.Color(s.color);
          tint.push(c.r, c.g, c.b);
        }
        geometry.setAttribute('position', new T.Float32BufferAttribute(at, 3));
        geometry.setAttribute('color', new T.Float32BufferAttribute(tint, 3));
        if (!stars) {
          const material = new T.PointsMaterial({
            size: 1,
            sizeAttenuation: false,
            vertexColors: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            fog: false,
            transparent: true,
            blending: T.AdditiveBlending,
          });
          const points = new T.Points(geometry, material);
          points.name = 'environment-stars';
          points.frustumCulled = false;
          points.renderOrder = -1000;
          points.position.copy(camera);
          scene.add(points);
          stars = {points, key: starKey};
        } else {
          const retired = stars.points.geometry;
          stars.points.geometry = geometry;
          stars.key = starKey;
          retired.dispose();
        }
      }
      if (stars) {
        stars.points.visible = !!starKey;
        stars.points.material.size = pointSize;
      }
    },
    /** Keep the sky and stars around the camera (orientation only, like the environment's points). */
    follow(camera: T.Vector3): void {
      sky?.mesh.position.copy(camera);
      stars?.points.position.copy(camera);
    },
    dispose(): void {
      if (sky) {
        scene.remove(sky.mesh);
        sky.mesh.geometry.dispose();
        sky.mesh.material.map?.dispose();
        sky.mesh.material.dispose();
        sky = null;
      }
      if (stars) {
        scene.remove(stars.points);
        stars.points.geometry.dispose();
        stars.points.material.dispose();
        stars = null;
      }
    },
  };
}
export type SkyLayer = ReturnType<typeof createSkyLayer>;
