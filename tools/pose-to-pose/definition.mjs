// The animations.json contract, shared by the validator and its tests. The generator's Python twin is
// blender/common.py (expand_clip); the validator compares both expansions through the clips manifest.
import {readFileSync} from 'node:fs';

export const SCHEMA = 1;
const EASINGS = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
const KEY_FIELDS = new Set(['pose', 'mirror', 'frames', 'seconds', 'easing', 'scale', 'noise']);
const finite = v => typeof v === 'number' && Number.isFinite(v);

export class DefinitionError extends Error {}
const fail = message => {
  throw new DefinitionError(message);
};

export function loadDefinition(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${path}: ${error.message}`);
  }
  return parseDefinition(data, path);
}

export function parseDefinition(data, where = 'definition') {
  if (data?.schema !== SCHEMA) fail(`${where}: expected "schema": 1`);
  const fps = data.fps ?? 30;
  if (!Number.isInteger(fps) || fps < 1 || fps > 240) fail(`${where}: fps must be a whole number from 1 to 240`);
  const clips = data.clips;
  if (!clips || typeof clips !== 'object' || !Object.keys(clips).length)
    fail(`${where}: clips must name at least one clip`);
  for (const name of Object.keys(clips))
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) fail(`${where}: clip name ${name} must be 1-64 letters, digits, _ or -`);
  const skeleton = {maxBones: 64, maxInfluences: 4, ...data.skeleton};
  if (!Number.isInteger(skeleton.maxBones) || skeleton.maxBones < 1 || skeleton.maxBones > 256)
    fail(`${where}: skeleton.maxBones is 1..256`);
  if (!Number.isInteger(skeleton.maxInfluences) || skeleton.maxInfluences < 1 || skeleton.maxInfluences > 4)
    fail(`${where}: skeleton.maxInfluences is 1..4 (one JOINTS_0/WEIGHTS_0 set)`);
  const expanded = {};
  for (const [name, clip] of Object.entries(clips)) expanded[name] = expandClip(name, clip, fps, clips);
  return {data, fps, skeleton, clips: expanded, materials: data.materials ?? {}};
}

function segmentFrames(key, fps, speed, where) {
  const hasFrames = 'frames' in key,
    hasSeconds = 'seconds' in key;
  if (hasFrames === hasSeconds) fail(`${where}: give exactly one of frames or seconds for the segment ending here`);
  const raw = hasFrames ? key.frames : key.seconds * fps;
  if (!finite(raw) || raw <= 0) fail(`${where}: segment length must be positive`);
  const frames = raw / speed,
    rounded = Math.round(frames);
  if (rounded < 1) fail(`${where}: segment is shorter than one frame at ${fps} fps and speed ${speed}`);
  if (Math.abs(frames - rounded) > 1e-6)
    fail(
      `${where}: segment is ${frames} frames at ${fps} fps and speed ${speed}; choose lengths that land on whole frames`,
    );
  return rounded;
}

function checkEasing(easing, where) {
  if (easing === undefined || EASINGS.has(easing)) return;
  const b = easing?.bezier;
  if (
    easing &&
    Object.keys(easing).length === 1 &&
    Array.isArray(b) &&
    b.length === 4 &&
    b.every(finite) &&
    b[0] >= 0 &&
    b[0] <= 1 &&
    b[2] >= 0 &&
    b[2] <= 1
  )
    return;
  fail(`${where}: easing is linear, ease-in, ease-out, ease-in-out or {"bezier": [x1, y1, x2, y2]}`);
}

const sameKey = (a, b) => a.pose === b.pose && Boolean(a.mirror) === Boolean(b.mirror);

const CLIP_FIELDS = new Set([
  'playback',
  'fps',
  'keys',
  'repeatMirrored',
  'speed',
  'trim',
  'events',
  'controls',
  'rootMotion',
  'derive',
  'reference',
  'note',
]);
export const PLAYBACK = new Set(['loop', 'once', 'hold']);

/** Ordered keys with absolute frames, total frames, events and controls, exactly as the generator bakes them. */
export function expandClip(name, clip, fps, clips) {
  const where = `clip ${name}`;
  const unknownFields = Object.keys(clip).filter(k => !CLIP_FIELDS.has(k));
  if (unknownFields.length) fail(`${where}: unknown fields ${unknownFields.join(', ')}`);
  if (clip.derive) {
    const base = clips[clip.derive.from];
    if (!base || base.derive) fail(`${where}: derive.from must name a non-derived clip`);
    if (!['left', 'right'].includes(clip.derive.turn)) fail(`${where}: derive.turn is left or right`);
    const {derive, ...rest} = clip;
    const {rootMotion, ...baseRest} = base;
    const out = expandClip(name, {...baseRest, ...rest}, fps, clips);
    out.derivedFrom = derive.from;
    if (rootMotion || rest.rootMotion) {
      out.rootMotion = {...rootMotion, ...rest.rootMotion};
      out.rootMotion.yawPerCycle = (derive.turn === 'left' ? 1 : -1) * Math.abs(derive.yawPerCycle ?? 0);
    }
    return out;
  }
  if ((clip.fps ?? fps) !== fps)
    fail(
      `${where}: fps ${clip.fps} differs from the file fps ${fps}; one GLB is sampled at one rate, so resample the clip (changing fps alone changes playback speed)`,
    );
  if (!PLAYBACK.has(clip.playback)) fail(`${where}: playback is loop, once or hold`);
  const loop = clip.playback === 'loop';
  let keys = clip.keys;
  if (!Array.isArray(keys) || keys.length < 2) fail(`${where}: keys must list at least two poses (start and end)`);
  const speed = clip.speed ?? 1;
  if (!finite(speed) || speed < 0.01 || speed > 100) fail(`${where}: speed must be between 0.01 and 100`);
  keys.forEach((key, i) => {
    if (typeof key?.pose !== 'string') fail(`${where} key ${i}: pose must name a key pose`);
    if (i === 0 && ('frames' in key || 'seconds' in key))
      fail(`${where} key 0: the first key starts the clip and has no segment length`);
    const unknown = Object.keys(key).filter(k => !KEY_FIELDS.has(k));
    if (unknown.length) fail(`${where} key ${i}: unknown fields ${unknown.join(', ')}`);
    checkEasing(key.easing, `${where} key ${i}`);
  });
  if (clip.repeatMirrored) {
    if (!loop) fail(`${where}: repeatMirrored builds a closed loop; set playback: loop`);
    const first = keys[0],
      last = keys.at(-1);
    if (!(last.pose === first.pose && Boolean(last.mirror) !== Boolean(first.mirror)))
      fail(`${where}: with repeatMirrored the half cycle must end on the mirror of its first pose`);
    keys = [...keys, ...keys.slice(1).map(k => ({...k, mirror: !k.mirror}))];
  }
  if (loop && !sameKey(keys[0], keys.at(-1)))
    fail(
      `${where}: a loop must end on its first pose (${keys[0].pose}); the last pose of the chain is the first pose of the next cycle`,
    );
  let frame = 0;
  const out = keys.map((key, i) => {
    if (i) frame += segmentFrames(key, fps, speed, `${where} key ${i}`);
    return {pose: key.pose, mirror: Boolean(key.mirror), frame};
  });
  let start = 0,
    end = frame;
  if (clip.trim !== undefined) {
    if (loop) fail(`${where}: trim cuts a one-shot clip to game length; a loop cannot be trimmed`);
    start = clip.trim.start ?? 0;
    end = clip.trim.end ?? frame;
    if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= frame))
      fail(`${where}: trim needs whole frames 0 <= start < end <= ${frame}`);
  }
  const duration = (end - start) / fps;
  const events = (clip.events ?? []).map((event, i) => {
    if (typeof event?.name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(event.name))
      fail(`${where} event ${i}: name is 1-64 letters, digits, _, . or -`);
    if (!finite(event.at) || event.at < 0 || event.at >= duration)
      fail(`${where} event ${event.name}: at is seconds in [0, ${duration})`);
    const unknown = Object.keys(event).filter(k => !['name', 'at', 'floor'].includes(k));
    if (unknown.length) fail(`${where} event ${event.name}: unknown fields ${unknown.join(', ')}`);
    return {name: event.name, at: event.at, frame: Math.round(event.at * fps), floor: event.floor ?? []};
  });
  if (new Set(events.map(e => e.name)).size !== events.length) fail(`${where}: event names must be unique`);
  const controls = clip.controls ?? [];
  if (!Array.isArray(controls) || !controls.every(c => typeof c === 'string'))
    fail(`${where}: controls lists the bones that must move in this clip`);
  const result = {
    playback: clip.playback,
    loop,
    frames: end - start,
    duration,
    events,
    controls,
    keys: out.filter(k => k.frame >= start && k.frame <= end).map(k => ({...k, frame: k.frame - start})),
  };
  if (clip.rootMotion) result.rootMotion = {...clip.rootMotion};
  return result;
}
