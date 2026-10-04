import * as T from 'three';
import {defineEnvironment, type EnvironmentState} from './environment';
/** The sun's shadow, when the scene opted into shadows (scene-light-rig.ts `createSunShadow`, a lazy chunk). */
export type SunShadowApply = (
  light: T.DirectionalLight,
  spec: {extent: number; softness: 'hard' | 'soft'} | null,
  position: readonly [number, number, number],
) => boolean;
/** Per-view resources: no shared transforms, renderer state changes, or extra context. */
export function bindEnvironment(scene: T.Scene, sunShadow?: SunShadowApply) {
  const ambient = new T.HemisphereLight(),
    directional = new T.DirectionalLight();
  let geometry = new T.BufferGeometry();
  const originalBackground = scene.background,
    originalFog = scene.fog;
  let ownedBackground: T.Color | null = null,
    ownedFog: T.Fog | null = null;
  const cameraPosition = new T.Vector3();
  const material = new T.PointsMaterial({
    size: 1,
    sizeAttenuation: false,
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const points = new T.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1000;
  scene.add(ambient, directional, points);
  let previous: EnvironmentState | undefined,
    closed = false;
  return {
    sync(value: EnvironmentState, camera: T.Camera): boolean {
      if (closed) return false;
      // Background depends on orientation only, while ordinary geometry retains parallax.
      camera.getWorldPosition(cameraPosition);
      points.position.copy(cameraPosition);
      if (previous === value) return false;
      const e = defineEnvironment(value);
      ownedBackground = new T.Color(e.background);
      scene.background = ownedBackground;
      ambient.color.setHex(e.ambient.sky);
      ambient.groundColor.setHex(e.ambient.ground);
      ambient.intensity = e.ambient.intensity;
      directional.color.setHex(e.directional.color);
      directional.intensity = e.directional.intensity;
      directional.position.set(...e.directional.position);
      // Only a scene with shadows passes `sunShadow`; without one the sun is exactly as it always was.
      sunShadow?.(
        directional,
        e.directional.shadow
          ? {extent: e.directional.shadow.extent, softness: e.directional.shadow.softness ?? 'soft'}
          : null,
        e.directional.position,
      );
      ownedFog = e.haze ? new T.Fog(e.haze.color, e.haze.near, e.haze.far) : null;
      scene.fog = ownedFog;
      const positions: number[] = [],
        colors: number[] = [];
      for (const p of e.points) {
        const length = Math.hypot(...p.direction);
        positions.push(...p.direction.map(v => (v / length) * 100));
        const c = new T.Color(p.color);
        colors.push(c.r, c.g, c.b);
      }
      const oldPositions = geometry.getAttribute('position'),
        oldColors = geometry.getAttribute('color');
      if (oldPositions?.count === e.points.length && oldColors?.count === e.points.length) {
        oldPositions.array.set(positions);
        oldPositions.needsUpdate = true;
        oldColors.array.set(colors);
        oldColors.needsUpdate = true;
      } else {
        const replacement = new T.BufferGeometry();
        replacement.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
        replacement.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
        const retired = geometry;
        geometry = replacement;
        points.geometry = geometry;
        retired.dispose();
      }
      points.visible = e.points.length > 0;
      material.size = e.pointSize;
      previous = value;
      return true;
    },
    dispose() {
      if (closed) return;
      closed = true;
      scene.remove(ambient, directional, points);
      if (scene.background === ownedBackground) scene.background = originalBackground;
      if (scene.fog === ownedFog) scene.fog = originalFog;
      geometry.dispose();
      material.dispose();
    },
  };
}
