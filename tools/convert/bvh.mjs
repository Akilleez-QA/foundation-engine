// tools/convert/bvh.mjs: BVH motion capture to a glTF animation, optionally retargeted by a bone map. BVH is a
// publicly documented text format (a joint hierarchy with offsets and per-joint channel lists, then one row of channel
// values per frame). Independent implementation.
//
// Conventions (the common ones, and those of three.js's BVH loader, which the tests use as an oracle):
//   - a joint's local translation is its OFFSET plus its position channels (when it has them);
//   - its local rotation is the product of the rotation channels in the order listed (intrinsic), in degrees.
// Retargeting renames joints through a bone map and folds every unmapped joint into its mapped descendants (local
// rotation and translation composed), so a clip binds by name to a target rig. It does not correct for different rest
// orientations: the target's joints must share the source's rest frame (see README).
import {createGltf} from './glb.mjs';
import {dmath} from '../../src/core/dmath.ts'; // the same output bytes on every machine

const AXES = {Xrotation: [1, 0, 0], Yrotation: [0, 1, 0], Zrotation: [0, 0, 1]};
const POSITIONS = ['Xposition', 'Yposition', 'Zposition'];

/** Parse BVH text. Limits: maxJoints, maxFrames. */
export function parseBvh(text, {maxJoints = 512, maxFrames = 1_000_000} = {}) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let t = 0;
  const peek = () => tokens[t];
  const take = expected => {
    const v = tokens[t++];
    if (v === undefined) throw Error(`BVH ends early${expected ? ` (expected ${expected})` : ''}`);
    if (expected && v !== expected) throw Error(`BVH: expected ${expected}, found ${v} (token ${t})`);
    return v;
  };
  const number = what => {
    const v = Number(take());
    if (!Number.isFinite(v)) throw Error(`BVH: ${what} is not a finite number (token ${t})`);
    return v;
  };
  take('HIERARCHY');
  const joints = [];
  let channelCount = 0;
  function joint(parent, isEnd) {
    const name = isEnd ? `${joints[parent].name}_end` : take();
    take('{');
    take('OFFSET');
    const offset = [number('OFFSET x'), number('OFFSET y'), number('OFFSET z')];
    const j = {name, parent, offset, channels: [], channelStart: channelCount, end: isEnd};
    if (joints.length >= maxJoints) throw Error(`more than ${maxJoints} joints`);
    joints.push(j);
    const index = joints.length - 1;
    if (!isEnd) {
      take('CHANNELS');
      const n = number('channel count');
      if (!Number.isInteger(n) || n < 0 || n > 6) throw Error(`joint ${name}: channel count ${n} outside 0..6`);
      for (let i = 0; i < n; i++) {
        const c = take();
        if (!AXES[c] && !POSITIONS.includes(c)) throw Error(`joint ${name}: unknown channel ${c}`);
        j.channels.push(c);
      }
      channelCount += n;
    }
    while (peek() !== '}') {
      const kind = take();
      if (kind === 'JOINT') joint(index, false);
      else if (kind === 'End') {
        take('Site');
        joint(index, true);
      } else throw Error(`BVH: unexpected ${kind} in joint ${name}`);
    }
    take('}');
  }
  take('ROOT');
  joint(-1, false);
  if (peek() === 'ROOT') throw Error('BVH files with more than one ROOT are not supported');
  take('MOTION');
  take('Frames:');
  const frames = number('frame count');
  if (!Number.isInteger(frames) || frames < 1 || frames > maxFrames)
    throw Error(`frame count ${frames} outside 1..${maxFrames}`);
  take('Frame');
  take('Time:');
  const frameTime = number('frame time');
  if (!(frameTime > 0)) throw Error('frame time must be positive');
  if (tokens.length - t < frames * channelCount)
    throw Error(`BVH has fewer values than ${frames} frames × ${channelCount} channels`);
  const values = new Float64Array(frames * channelCount);
  for (let i = 0; i < values.length; i++) values[i] = number(`frame ${Math.floor(i / channelCount)} value`);
  return {joints, frames, frameTime, channelCount, values};
}

// Quaternions are [x, y, z, w].
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]),
    ty = 2 * (z * v[0] - x * v[2]),
    tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Each joint's local [translation, rotation] at one frame. */
function localPose(bvh, frame) {
  const row = frame * bvh.channelCount;
  return bvh.joints.map(j => {
    const t = [...j.offset];
    let q = [0, 0, 0, 1];
    j.channels.forEach((c, k) => {
      const v = bvh.values[row + j.channelStart + k];
      if (AXES[c]) {
        const half = (v * Math.PI) / 360;
        const s = dmath.sin(half);
        const a = AXES[c];
        q = qmul(q, [a[0] * s, a[1] * s, a[2] * s, dmath.cos(half)]);
      } else t[POSITIONS.indexOf(c)] += v;
    });
    return {t, q};
  });
}

/**
 * Convert to GLB. Options: boneMap ({source: target}; unmapped joints are folded away when any joint is mapped),
 * scale (translation units, e.g. 0.01 for centimetres to metres), keepEndSites (default false), rootTranslation
 * ('all' | 'none' | 'horizontal-none' to drop the root's ground-plane motion), name (clip name).
 */
export function bvhToGlb(text, options = {}) {
  const {
    boneMap = null,
    scale = 1,
    keepEndSites = false,
    rootTranslation = 'all',
    name = 'motion',
    generator = 'foundation tools/convert bvh',
  } = options;
  if (!['all', 'none', 'horizontal-none'].includes(rootTranslation))
    throw Error(`rootTranslation must be all, none or horizontal-none`);
  if (!(scale > 0) || !Number.isFinite(scale)) throw Error('scale must be a positive number');
  const bvh = parseBvh(text, options);
  const names = new Map();
  bvh.joints.forEach((j, i) => {
    if (names.has(j.name)) throw Error(`duplicate joint name ${j.name}`);
    names.set(j.name, i);
  });
  // Which joints survive, and under which name.
  const keep = bvh.joints.map(j => (j.end ? keepEndSites : true));
  const outName = bvh.joints.map(j => j.name);
  if (boneMap) {
    for (const [source, target] of Object.entries(boneMap)) {
      if (!names.has(source)) throw Error(`bone map names ${source}, which the BVH does not have`);
      if (typeof target !== 'string' || !target) throw Error(`bone map target for ${source} must be a name`);
    }
    const targets = Object.values(boneMap);
    if (new Set(targets).size !== targets.length) throw Error('bone map sends two joints to one target');
    bvh.joints.forEach((j, i) => {
      keep[i] = Object.hasOwn(boneMap, j.name);
      if (keep[i]) outName[i] = boneMap[j.name];
    });
    if (!keep.some(Boolean)) throw Error('the bone map keeps no joints');
  }
  // Nearest kept ancestor of each joint.
  const keptParent = bvh.joints.map((_, i) => {
    let p = bvh.joints[i].parent;
    while (p >= 0 && !keep[p]) p = bvh.joints[p].parent;
    return p;
  });
  const kept = bvh.joints.map((_, i) => i).filter(i => keep[i]);
  const roots = kept.filter(i => keptParent[i] < 0);
  /** Pose of joint i relative to its kept parent: compose the folded chain. */
  function relative(pose, i) {
    let t = pose[i].t,
      q = pose[i].q;
    let p = bvh.joints[i].parent;
    while (p >= 0 && !keep[p]) {
      t = rotate(pose[p].q, t).map((v, k) => v + pose[p].t[k]);
      q = qmul(pose[p].q, q);
      p = bvh.joints[p].parent;
    }
    return {t, q};
  }
  const frames = bvh.frames;
  const maxSamples = options.maxSamples ?? 1 << 22;
  if (frames * kept.length > maxSamples)
    throw Error(
      `${frames} frames × ${kept.length} joints exceeds ${maxSamples} joint samples; trim the clip or map fewer joints`,
    );
  const times = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    times[f] = f * bvh.frameTime;
    if (f > 0 && !(times[f] > times[f - 1]))
      throw Error(`frame time ${bvh.frameTime} is too small for ${frames} distinct float32 key times`);
  }
  const tracks = kept.map(() => ({t: new Float32Array(frames * 3), q: new Float32Array(frames * 4)}));
  let prev = null;
  const pose0 = localPose(bvh, 0);
  const rest = kept.map(i => relative(pose0, i).t.map(v => v * scale));
  for (let f = 0; f < frames; f++) {
    const pose = localPose(bvh, f);
    kept.forEach((i, k) => {
      const r = relative(pose, i);
      let t = r.t.map(v => v * scale);
      if (roots.includes(i) && rootTranslation !== 'all')
        t = rootTranslation === 'none' ? rest[k] : [rest[k][0], t[1], rest[k][2]];
      tracks[k].t.set(t, f * 3);
      let q = r.q;
      const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
      q = q.map(v => v / l);
      // keep successive quaternions in one hemisphere so linear interpolation takes the short way
      const last = prev?.[k];
      if (last && last[0] * q[0] + last[1] * q[1] + last[2] * q[2] + last[3] * q[3] < 0) q = q.map(v => -v);
      tracks[k].q.set(q, f * 4);
      (prev ??= [])[k] = q;
    });
  }
  const doc = createGltf(generator);
  const nodeOf = new Map();
  kept.forEach((i, k) => {
    nodeOf.set(i, k);
    doc.json.nodes.push({
      name: outName[i],
      translation: Array.from(tracks[k].t.subarray(0, 3)),
      rotation: Array.from(tracks[k].q.subarray(0, 4)),
    });
  });
  kept.forEach(i => {
    const p = keptParent[i];
    if (p >= 0) (doc.json.nodes[nodeOf.get(p)].children ??= []).push(nodeOf.get(i));
  });
  doc.json.scenes[0].nodes.push(...roots.map(i => nodeOf.get(i)));
  const input = doc.accessor(times, 'SCALAR', {bounds: true});
  let still = null; // a one-key input for tracks that never change: the joint is bound by the clip, at no cost per frame
  const channels = [],
    samplers = [];
  kept.forEach((i, k) => {
    // Translation is animated only when it changes (position channels, or folded ancestors that rotate it).
    const tr = tracks[k].t;
    let moves = false;
    for (let x = 3; x < tr.length && !moves; x++) moves = tr[x] !== tr[x % 3];
    let turns = false;
    const qr = tracks[k].q;
    for (let x = 4; x < qr.length && !turns; x++) turns = qr[x] !== qr[x % 4];
    const animated = [...(moves ? ['translation'] : []), ...(turns || !bvh.joints[i].end ? ['rotation'] : [])];
    for (const path of animated) {
      const constant = path === 'rotation' && !turns;
      if (constant && still === null) still = doc.accessor(Float32Array.of(0), 'SCALAR', {bounds: true});
      const data = path === 'translation' ? tracks[k].t : constant ? tracks[k].q.subarray(0, 4) : tracks[k].q;
      samplers.push({
        input: constant ? still : input,
        output: doc.accessor(data, path === 'translation' ? 'VEC3' : 'VEC4'),
        interpolation: 'LINEAR',
      });
      channels.push({sampler: samplers.length - 1, target: {node: nodeOf.get(i), path}});
    }
  });
  doc.json.animations.push({name, channels, samplers});
  return {
    glb: doc.toGlb(),
    summary: {
      joints: kept.length,
      frames,
      duration: (frames - 1) * bvh.frameTime,
      folded: bvh.joints.filter((j, i) => !keep[i] && !j.end).length,
    },
  };
}
