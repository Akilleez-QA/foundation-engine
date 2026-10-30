// The pose-to-pose exports in the stock model loader: the robot walks by the root motion its clip
// declares (no foot sliding), waves on request; the creature scuttles in place and strikes, its `impact`
// event firing from the strike clip's own clock through @kits/animation markers.
import {defineScene, defineSystem, Model, Name, Shape, Transform, type SceneContext} from '@engine';
import {applyRootMotion} from '@kits/locomotion';
import {clipEvents, clipRootMotion, manifestClip, type Manifest} from './clip-events';
import robotManifest from './public/models/pose-robot.clips.json';
import bugManifest from './public/models/pose-bug.clips.json';

const robotClips = robotManifest as Manifest;
const bugClips = bugManifest as Manifest;
const WALK = manifestClip(robotClips, 'walk');
const STRIKE = manifestClip(bugClips, 'strike');
/** The robot walks between these z values, then is placed back at the start (a seek: no motion). */
const START_Z = -1.6,
  END_Z = 1.6;

let walk = clipRootMotion(WALK),
  walkTime = 0,
  strike: ReturnType<typeof clipEvents> | undefined,
  strikeTime = 0,
  strikes = 0;

const model = (ctx: SceneContext, name: string) => ctx.world.get(ctx.named(name)!, Model)!;

const animate = defineSystem({
  id: 'pose-to-pose-animate',
  run(ctx) {
    const robot = ctx.named('robot')!,
      bug = ctx.named('bug')!;
    const dt = Number(ctx.state.lastT) >= 0 ? ctx.time.t - Number(ctx.state.lastT) : 0;
    ctx.state.lastT = ctx.time.t;
    ctx.state.robotStatus = ctx.modelState(robot).status;
    ctx.state.bugStatus = ctx.modelState(bug).status;
    ctx.state.robotEntity = robot;
    ctx.state.bugEntity = bug;
    const ready = ctx.state.robotStatus === 'ready' && ctx.state.bugStatus === 'ready';
    const r = model(ctx, 'robot'),
      b = model(ctx, 'bug');
    if (ready && ctx.input.pressed('wave')) {
      const waving = r.clip !== 'wave';
      r.clip = waving ? 'wave' : 'walk';
      r.loop = !waving; // the wave holds its last pose
      r.revision++;
      walkTime = 0;
      walk.seek(0);
      ctx.world.touch();
    }
    if (ready && ctx.input.pressed('strike') && b.clip !== 'strike') {
      b.clip = 'strike';
      b.loop = false;
      b.revision++;
      strikeTime = 0;
      strike = clipEvents(STRIKE, `bug-strike-${++strikes}`);
      ctx.world.touch();
    }
    if (!ready) return;
    // The walk's declared stride moves the robot: the clip is authored in place.
    if (r.clip === 'walk' && r.playing) {
      walkTime += dt * r.speed;
      const delta = walk.advance(walkTime);
      applyRootMotion(ctx, robot, delta, {owns: () => true});
      const tr = ctx.world.get(robot, Transform)!;
      ctx.state.travelled = Number(ctx.state.travelled) + Math.hypot(delta.x, delta.z);
      if (tr.z > END_Z) {
        tr.z = START_Z;
        walk.seek(walkTime);
      }
      ctx.world.touch();
    }
    const tr = ctx.world.get(robot, Transform)!;
    ctx.state.robotX = tr.x;
    ctx.state.robotZ = tr.z;
    ctx.state.walkTime = walkTime;
    // Effects fire from the strike clip's clock: the marker track advances with the clip's time.
    if (strike && b.clip === 'strike') {
      strikeTime = Math.min(strikeTime + dt * b.speed, STRIKE.duration);
      for (const event of strike.advance(strikeTime))
        if (event.marker === 'impact') {
          ctx.state.impacts = Number(ctx.state.impacts) + 1;
          ctx.state.impactAt = event.at;
        }
      if (strikeTime >= STRIKE.duration) {
        b.clip = 'scuttle';
        b.loop = true;
        b.revision++;
        strike = undefined;
        ctx.world.touch();
      }
    }
    ctx.state.bugClip = b.clip;
    ctx.state.robotClip = r.clip;
  },
});

export default defineScene({
  id: 'main',
  title: 'Pose to pose',
  view: {camera: {position: [3.4, 2.2, 3.2], target: [0, 0.6, 0]}, background: 0x141a24},
  entities: [
    [Name({name: 'robot'}), Transform({x: -0.6, z: START_Z}), Model({asset: 'pose-robot', clip: 'walk'})],
    [Name({name: 'bug'}), Transform({x: 0.9, z: 0.4, ry: -0.6}), Model({asset: 'pose-bug', clip: 'scuttle'})],
    [Name({name: 'floor'}), Transform(), Shape({kind: 'plane', size: [6, 0, 6], color: 0x2a3342})],
  ],
  systems: [animate],
  enter(ctx) {
    walk = clipRootMotion(WALK);
    walkTime = 0;
    strike = undefined;
    strikeTime = 0;
    Object.assign(ctx.state, {lastT: -1, travelled: 0, impacts: 0, impactAt: -1});
  },
});
