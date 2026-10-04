#!/usr/bin/env node
// Pose-to-pose clip validator: checks an exported GLB against its animations.json. Offline, no browser.
// It collects every failure instead of stopping at the first, and exits 1 when any check fails.
// Usage: node tools/pose-to-pose/validate.mjs <model.glb> --definition <animations.json> [--json out.json]
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AnimationMixer, Quaternion, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PropertyBinding} from 'three';
import {loadDefinition, parseDefinition} from './definition.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const COMPONENTS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};
const ARRAYS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const NORMALISED = {5121: 255, 5123: 65535};

export function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) throw Error('not a binary glTF (.glb) file');
  if (bytes.readUInt32LE(4) !== 2) throw Error('glTF version must be 2');
  if (bytes.readUInt32LE(8) !== bytes.length) throw Error('GLB length header disagrees with the file size');
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw Error('first GLB chunk must be JSON');
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  let bin = null;
  const next = 20 + jsonLength;
  if (next + 8 <= bytes.length && bytes.readUInt32LE(next + 4) === 0x004e4942)
    bin = bytes.subarray(next + 8, next + 8 + bytes.readUInt32LE(next));
  return {json, bin};
}

/** Decoded accessor as an array of tuples (normalised integers become 0..1 floats). */
export function readAccessor(gltf, index) {
  const {json, bin} = gltf,
    acc = json.accessors[index],
    view = json.bufferViews[acc.bufferView],
    Array_ = ARRAYS[acc.componentType],
    size = COMPONENTS[acc.type];
  if (!Array_ || !size || !bin || acc.sparse) throw Error(`accessor ${index}: unsupported layout`);
  const stride = view.byteStride ?? size * Array_.BYTES_PER_ELEMENT,
    base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0),
    out = [];
  for (let i = 0; i < acc.count; i++) {
    const at = bin.byteOffset + base + i * stride;
    const row = Array.from(new Array_(bin.buffer.slice(at, at + size * Array_.BYTES_PER_ELEMENT)));
    out.push(acc.normalized && NORMALISED[acc.componentType] ? row.map(v => v / NORMALISED[acc.componentType]) : row);
  }
  return out;
}

const close = (a, b, eps) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const sameRotation = (a, b, eps) => Math.abs(a.reduce((s, v, i) => s + v * b[i], 0)) >= 1 - eps;

/** Rigid planar root transform at time t from the manifest's RootClip (same formula as createRootMotion). */
function rootAt(clip, t) {
  const keys = clip.keys;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].at <= t) i++;
  const a = keys[i],
    b = keys[i + 1] ?? a,
    u = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
  return {x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: a.yaw + (b.yaw - a.yaw) * u};
}
/** Root transform for loop time t in [0, 2 * duration]: the second cycle starts where the first ended. */
function rootLoop(clip, t) {
  if (t <= clip.duration) return rootAt(clip, t);
  return compose(rootAt(clip, clip.duration), rootAt(clip, t - clip.duration));
}
const compose = (a, b) => {
  const c = Math.cos(a.yaw),
    s = Math.sin(a.yaw);
  return {x: a.x + c * b.x + s * b.z, z: a.z - s * b.x + c * b.z, yaw: a.yaw + b.yaw};
};
const applyRoot = (r, p) => {
  const c = Math.cos(r.yaw),
    s = Math.sin(r.yaw);
  return {x: r.x + c * p.x + s * p.z, y: p.y, z: r.z - s * p.x + c * p.z};
};

/** Contiguous true runs of a boolean list. With `complete`, runs touching either end are dropped. */
function runs(flags, complete) {
  const out = [];
  let current = null;
  flags.forEach((f, i) => {
    if (f) (current ??= []).push(i);
    else if (current) (out.push(current), (current = null));
  });
  if (current) out.push(current);
  return complete ? out.filter(r => r[0] > 0 && r.at(-1) < flags.length - 1) : out;
}

async function footChecks(bytes, clip, name, fps, rm, failures) {
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const animation = gltf.animations.find(a => a.name === name);
  const node = bone => scene.getObjectByName(PropertyBinding.sanitizeNodeName(bone));
  const feet = (rm.feet ?? []).map(f => ({...f, joint: node(f.bone), toeJoint: f.toe ? node(f.toe) : null}));
  for (const f of feet)
    if (!f.joint || (f.toe && !f.toeJoint)) {
      failures.push(`${name}: rootMotion.feet names a bone the GLB lacks (${f.bone}${f.toe ? ', ' + f.toe : ''})`);
      return null;
    }
  const pitch = f => {
    const a = f.joint.getWorldPosition(new Vector3()),
      b = f.toeJoint.getWorldPosition(new Vector3());
    return (Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)) * 180) / Math.PI;
  };
  const restPitch = feet.map(f => (f.toeJoint ? pitch(f) : null));
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(animation).play();
  // A loop is sampled over two cycles so a stance that crosses the seam is measured whole.
  const frames = clip.loop ? 2 * clip.frames : clip.frames,
    samples = feet.map(() => []);
  for (let f = 0; f <= frames; f++) {
    const local = clip.loop ? (f % clip.frames) / fps : f / fps;
    mixer.setTime(Math.min(local, animation.duration));
    scene.updateMatrixWorld(true);
    const root = clip.loop ? rootLoop(rm.clip, f / fps) : rootAt(rm.clip, f / fps);
    feet.forEach((foot, i) => {
      const p = foot.joint.getWorldPosition(new Vector3());
      const toe = foot.toeJoint ? foot.toeJoint.getWorldPosition(new Vector3()) : p;
      samples[i].push({
        local: p.clone(),
        world: applyRoot(root, p),
        toe,
        toeWorld: applyRoot(root, toe),
        pitch: foot.toeJoint ? pitch(foot) : null,
      });
    });
  }
  const tolerance = rm.footSlideTolerance ?? 0.04,
    contact = rm.contactHeight ?? 0.02,
    flatTolerance = rm.flatFootTolerance ?? 8;
  const report = [],
    toeSlide = feet.map(() => 0);
  feet.forEach((foot, i) => {
    const s = samples[i];
    const low = Math.min(...s.map(p => p.local.y));
    // With a toe joint, the ankle counts as planted only while the foot is flat: ankle and ball both down
    // and the foot within flatFootTolerance of its rest pitch (a toes-up retarget fault never gets there);
    // the ball carries the stance after the heel lifts and is measured as its own contact. Heel-only
    // contact has no joint and is left to the deformed-sole check in verify.py.
    const lowToe = foot.toeJoint ? Math.min(...s.map(p => p.toe.y)) : 0;
    const flat = p => Math.abs(p.pitch - restPitch[i]) <= flatTolerance;
    const planted = runs(
      s.map(p => p.local.y <= low + contact && (!foot.toeJoint || (p.toe.y <= lowToe + contact && flat(p)))),
      clip.loop,
    );
    if (foot.toeJoint) {
      for (const run of runs(
        s.map(p => p.toe.y <= lowToe + contact),
        clip.loop,
      )) {
        const pts = run.map(j => s[j].toeWorld);
        for (const a of pts) for (const b of pts) toeSlide[i] = Math.max(toeSlide[i], Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    if (process.env.POSE_TO_POSE_DEBUG)
      console.error(name, foot.bone, s.map((p, j) => `${j}:${p.local.y.toFixed(3)}/${p.world.z.toFixed(3)}`).join(' '));
    let slide = 0;
    for (const run of planted) {
      const pts = run.map(j => s[j].world);
      for (const a of pts) for (const b of pts) slide = Math.max(slide, Math.hypot(a.x - b.x, a.z - b.z));
    }
    const entry = {
      bone: foot.bone,
      plantedFrames: planted.reduce((n, r) => n + r.length, 0) / (clip.loop ? 2 : 1),
      plantedRuns: planted.length,
      maxSlide: Number(slide.toFixed(4)),
    };
    if (foot.toeJoint) {
      entry.maxToeSlide = Number(toeSlide[i].toFixed(4));
      slide = Math.max(slide, toeSlide[i]);
    }
    if (!planted.length)
      failures.push(
        foot.toeJoint
          ? `${name}: ${foot.bone} is never flat on the ground (ankle and ${foot.toe} down, within ${flatTolerance}° of rest pitch); toes-up retarget fault?`
          : `${name}: ${foot.bone} never reaches the ground`,
      );
    if (slide > tolerance)
      failures.push(
        `${name}: ${foot.bone} slides ${slide.toFixed(3)} m while planted (tolerance ${tolerance} m at stride ${rm.stride} m per cycle)`,
      );
    if (foot.toeJoint) {
      entry.restPitch = Number(restPitch[i].toFixed(2));
      entry.stancePitch = [
        Number(Math.min(...s.map(p => p.pitch - restPitch[i])).toFixed(1)),
        Number(Math.max(...s.map(p => p.pitch - restPitch[i])).toFixed(1)),
      ];
    }
    report.push(entry);
  });
  mixer.stopAllAction();
  return report;
}

export async function validate(file, definitionInput, options = {}) {
  const failures = [],
    warnings = [],
    report = {file, clips: {}, failures, warnings};
  const def = typeof definitionInput === 'string' ? loadDefinition(definitionInput) : parseDefinition(definitionInput);
  const bytes = readFileSync(file);
  const gltf = parseGlb(bytes);
  const {json} = gltf;
  // Provenance and the generator's clips manifest.
  const manifestPath = file.replace(/\.glb$/, '.clips.json'),
    provenancePath = file.replace(/\.glb$/, '.provenance.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  if (!manifest) failures.push(`missing clips manifest ${manifestPath}`);
  if (options.provenance !== false) {
    if (!existsSync(provenancePath)) failures.push(`missing provenance ${provenancePath}`);
    else {
      const prov = JSON.parse(readFileSync(provenancePath, 'utf8'));
      if (prov.sha256 !== digest(bytes)) failures.push('GLB hash disagrees with its provenance: regenerate');
      if (manifest && prov.clipsManifestSha256 !== digest(readFileSync(manifestPath)))
        failures.push('clips manifest hash disagrees with its provenance: regenerate');
      if (prov.unapprovedPoses?.length)
        failures.push(`draft export: poses not yet approved by the user: ${prov.unapprovedPoses.join(', ')}`);
      report.review = prov.review ?? 'missing';
      if (typeof definitionInput === 'string') {
        const name = definitionInput.split(/[\\/]/).pop();
        if (prov.inputs?.[name] && prov.inputs[name] !== digest(readFileSync(definitionInput)))
          failures.push(`${name} changed after this GLB was exported: regenerate`);
      }
      if (prov.review === 'off' && !options.allowUnreviewed)
        failures.push(
          'exported with --no-review: the rig and clips were never approved (pass --allow-unreviewed for an unattended example)',
        );
      if (prov.review !== 'off' && prov.review !== 'on') failures.push('provenance does not record the review gate');
      if (prov.draftClips?.length && !options.allowDraft)
        failures.push(
          `draft clips awaiting the user's approval: ${prov.draftClips.join(', ')} (pass --allow-draft to check a draft)`,
        );
    }
  }
  // Container.
  if ((json.buffers ?? []).some(b => b.uri)) failures.push('buffers must be embedded in the GLB');
  if ((json.images ?? []).some(i => i.uri)) failures.push('images must be embedded in the GLB');
  if (json.extensionsRequired?.length) warnings.push(`extensions required: ${json.extensionsRequired.join(', ')}`);
  // Skeleton.
  const nodes = json.nodes ?? [];
  const parent = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
  const skins = json.skins ?? [];
  const animated = new Set((json.animations ?? []).flatMap(a => a.channels.map(c => c.target.node)));
  const joints = new Set(skins.length ? skins.flatMap(s => s.joints) : animated);
  report.bones = joints.size;
  // Engine lookups (sockets, pose overrides, inspection) go by node name: a joint must not share its name.
  for (const j of joints) {
    const same = nodes.filter(n => n.name === nodes[j].name).length;
    if (same > 1) failures.push(`node name ${nodes[j].name} is used by ${same} nodes; bones need unique names`);
  }
  const jointNamed = name => [...joints].find(j => nodes[j].name === name) ?? nodes.findIndex(n => n.name === name);
  if (joints.size > def.skeleton.maxBones)
    failures.push(`${joints.size} bones exceed the declared limit of ${def.skeleton.maxBones}`);
  const rootName = def.skeleton.root;
  if (rootName) {
    const root = nodes.findIndex(n => n.name === rootName);
    if (root < 0) failures.push(`root bone ${rootName} is missing`);
    else
      for (const j of joints) {
        let k = j;
        while (k !== undefined && k !== root) k = parent.get(k);
        if (k !== root) {
          failures.push(`bone ${nodes[j].name} is not under the root bone ${rootName}`);
          break;
        }
      }
  }
  // Influences.
  let skinnedVertices = 0;
  (json.meshes ?? []).forEach(mesh =>
    mesh.primitives.forEach(prim => {
      const a = prim.attributes;
      if (a.JOINTS_1 !== undefined || a.WEIGHTS_1 !== undefined)
        failures.push(`mesh ${mesh.name}: more than four influences (JOINTS_1/WEIGHTS_1)`);
      if (a.JOINTS_0 === undefined) return;
      const skinIndex = nodes.find(n => n.mesh === json.meshes.indexOf(mesh))?.skin;
      const jointCount = skins[skinIndex]?.joints.length ?? 0;
      const js = readAccessor(gltf, a.JOINTS_0),
        ws = readAccessor(gltf, a.WEIGHTS_0);
      js.forEach((row, v) => {
        skinnedVertices++;
        const w = ws[v];
        if (!w.every(x => Number.isFinite(x) && x >= 0)) failures.push(`mesh ${mesh.name} vertex ${v}: bad weights`);
        const used = w.filter(x => x > 1e-6).length;
        if (used > def.skeleton.maxInfluences)
          failures.push(`mesh ${mesh.name} vertex ${v}: ${used} influences > ${def.skeleton.maxInfluences}`);
        if (Math.abs(w.reduce((s, x) => s + x, 0) - 1) > 2e-3)
          failures.push(`mesh ${mesh.name} vertex ${v}: weights sum to ${w.reduce((s, x) => s + x, 0)}`);
        if (row.some((j, k) => w[k] > 0 && j >= jointCount))
          failures.push(`mesh ${mesh.name} vertex ${v}: joint index outside the skin`);
      });
    }),
  );
  report.skinnedVertices = skinnedVertices;
  for (const [role, name] of Object.entries(def.materials))
    if (!(json.materials ?? []).some(m => m.name === name)) failures.push(`material slot ${name} (${role}) is missing`);
  // Clips.
  const animations = json.animations ?? [];
  const names = animations.map(a => a.name);
  if (new Set(names).size !== names.length) failures.push(`duplicate clip names: ${names.join(', ')}`);
  for (const name of Object.keys(def.clips))
    if (!names.includes(name)) failures.push(`declared clip ${name} is missing (found: ${names.join(', ') || 'none'})`);
  for (const name of names) if (!def.clips[name]) failures.push(`clip ${name} is not declared in the definition`);
  for (const animation of animations) {
    const clip = def.clips[animation.name];
    if (!clip) continue;
    const name = animation.name,
      expected = clip.frames / def.fps,
      entry = {loop: clip.loop, frames: clip.frames, duration: expected};
    report.clips[name] = entry;
    let duration = 0,
      nan = 0,
      seam = 0;
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      const input = readAccessor(gltf, sampler.input).map(r => r[0]),
        output = readAccessor(gltf, sampler.output);
      nan += input.filter(v => !Number.isFinite(v)).length + output.flat().filter(v => !Number.isFinite(v)).length;
      if (input.some((t, i) => i && t <= input[i - 1])) failures.push(`${name}: key times are not increasing`);
      if (input[0] > 1e-6) failures.push(`${name}: a track starts at ${input[0]} s, not 0`);
      duration = Math.max(duration, input.at(-1));
      if (clip.loop && sampler.interpolation !== 'CUBICSPLINE' && output.length > 1) {
        const path = channel.target.path,
          a = output[0],
          b = output.at(-1);
        const same = path === 'rotation' ? sameRotation(a, b, 1e-6) : close(a, b, 1e-4);
        if (!same) seam++;
      }
    }
    entry.measuredDuration = Number(duration.toFixed(6));
    for (const bone of clip.controls) {
      const target = jointNamed(bone);
      let motion = 0;
      for (const channel of animation.channels.filter(c => c.target.node === target)) {
        const out = readAccessor(gltf, animation.samplers[channel.sampler].output);
        for (const v of out)
          motion = Math.max(
            motion,
            channel.target.path === 'rotation'
              ? (2 * Math.acos(Math.min(1, Math.abs(v.reduce((acc, x, i) => acc + x * out[0][i], 0)))) * 180) / Math.PI
              : Math.max(...v.map((x, i) => Math.abs(x - out[0][i]) * 1000)),
          );
      }
      if (target < 0) failures.push(`${name}: control bone ${bone} is missing`);
      else if (motion < 1) failures.push(`${name}: control bone ${bone} does not move (needs > 1° or 1 mm)`);
    }
    if (nan) failures.push(`${name}: ${nan} NaN or infinite key values`);
    if (Math.abs(duration - expected) > 0.5 / def.fps)
      failures.push(`${name}: duration ${duration.toFixed(4)} s, definition says ${expected.toFixed(4)} s`);
    if (seam) failures.push(`${name}: loop clip has ${seam} channels whose first and last keys differ (seam pop)`);
    // The generator's expansion must agree with this one.
    const m = manifest?.clips.find(c => c.name === name);
    if (manifest && !m) failures.push(`${name}: missing from the clips manifest`);
    if (m) {
      const keys = k => k.map(x => `${x.pose}${x.mirror ? '~' : ''}@${x.frame}`).join(' ');
      const events = e => e.map(x => `${x.name}@${x.frame}/${x.at}`).join(' ');
      if (
        m.frames !== clip.frames ||
        m.playback !== clip.playback ||
        keys(m.keys) !== keys(clip.keys) ||
        events(m.events) !== events(clip.events)
      )
        failures.push(`${name}: generator and validator expand the definition differently`);
      entry.playback = m.playback;
      entry.events = m.events.map(e => ({name: e.name, at: e.at, frame: e.frame}));
      const rm = m.rootMotion;
      if (clip.rootMotion && !rm) failures.push(`${name}: rootMotion declared but not exported`);
      if (rm) {
        const want = clip.rootMotion;
        entry.rootMotion = 'stride' in rm ? {stride: rm.stride, yawPerCycle: rm.yawPerCycle} : {delta: rm.delta};
        const same =
          'stride' in want
            ? Math.abs(rm.stride - want.stride) < 1e-9 && rm.yawPerCycle === (want.yawPerCycle ?? 0)
            : JSON.stringify(rm.delta) === JSON.stringify(want.delta);
        if (!same) failures.push(`${name}: exported root motion differs from the definition`);
        if (rm.feet?.length) entry.feet = await footChecks(bytes, clip, name, def.fps, rm, failures);
      }
    }
  }
  report.passed = failures.length === 0;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = flag => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args.splice(i, 2)[1];
  };
  const flag = name => {
    const i = args.indexOf(name);
    return i >= 0 && Boolean(args.splice(i, 1));
  };
  const definition = option('--definition'),
    out = option('--json'),
    allowDraft = flag('--allow-draft'),
    allowUnreviewed = flag('--allow-unreviewed');
  if (args.length !== 1 || !definition) {
    console.error(
      'usage: validate.mjs <model.glb> --definition <animations.json> [--json report.json] [--allow-draft] [--allow-unreviewed]',
    );
    process.exit(2);
  }
  let report;
  try {
    report = await validate(resolve(args[0]), resolve(definition), {allowDraft, allowUnreviewed});
  } catch (error) {
    console.error(`pose-to-pose validator: ${error.message}`);
    process.exit(1);
  }
  if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) {
    console.error(`pose-to-pose validator: ${report.failures.length} failure(s)`);
    process.exit(1);
  }
}
