// The sim's 3D content, loaded with the lesson: the Sun, the Earth (turned by the lesson's 'spin' parameter) and a
// flag on the Earth's surface that is in daylight or in the dark.
import {defineSystem, Name, Shape, Transform, type SceneBody} from '@engine';
import {Part} from '@kits/concept-explorer';

const EARTH_R = 1.3;
export const Flag = {lat: 0};

/** Where the flag is for a spin angle (degrees): on the equator, facing the Sun (at -x) at 0°. */
export function flagAt(spinDeg: number): {x: number; z: number; day: boolean} {
  const a = Math.PI + (spinDeg * Math.PI) / 180;
  const x = Math.cos(a) * EARTH_R * 1.02,
    z = -Math.sin(a) * EARTH_R * 1.02;
  return {x: 2 + x, z, day: x < 0};
}

export const spinEarth = defineSystem({
  id: 'spin-earth',
  phase: 'frame',
  run(ctx) {
    const learn = ctx.state.learn as {param: number | null} | undefined;
    const spin = learn?.param ?? 0;
    const earth = ctx.named('earth'),
      flag = ctx.named('flag');
    const et = earth === undefined ? undefined : ctx.world.get(earth, Transform),
      ft = flag === undefined ? undefined : ctx.world.get(flag, Transform);
    if (!et || !ft) return;
    const ry = (spin * Math.PI) / 180;
    if (et.ry !== ry) et.ry = ry;
    const f = flagAt(spin);
    if (ft.x !== f.x || ft.z !== f.z) {
      ft.x = f.x;
      ft.z = f.z;
    }
    const sh = ctx.world.get(flag!, Shape)!,
      color = f.day ? 0xffd166 : 0x8a6d2a;
    if (sh.color !== color) sh.color = color;
    ctx.state.flagInDaylight = f.day;
  },
});

const body: SceneBody = {
  entities: [
    [
      Name({name: 'sun'}),
      Transform({x: -4}),
      Shape({kind: 'sphere', size: [2.2, 2.2, 2.2], color: 0xffc94d}),
      Part({id: 'sun', label: 'lesson.part.sun', radius: 1.2}),
    ],
    [
      Name({name: 'earth'}),
      Transform({x: 2}),
      Shape({kind: 'sphere', size: [2 * EARTH_R, 2 * EARTH_R, 2 * EARTH_R], color: 0x3b82c4}),
      Part({id: 'earth', label: 'lesson.part.earth', radius: EARTH_R}),
    ],
    [
      Name({name: 'flag'}),
      Transform({x: 2 - EARTH_R, y: 0, z: 0}),
      Shape({kind: 'cone', size: [0.3, 0.5, 0.3], color: 0xffd166}),
      Part({id: 'flag', label: 'lesson.part.flag', radius: 0.35}),
    ],
  ],
  systems: [spinEarth],
};
export default body;
