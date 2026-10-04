"""Generator (GPL-3.0-only): key poses + animations.json -> one baked action per clip -> GLB + manifest.

Each clip becomes one slotted action (Blender 4.4+ layers, strips and channelbags). In-betweens are
computed segment by segment: quaternion slerp for rotations, linear location and scale, with the
segment's easing applied to time. Every frame is keyed (baked). Loop clips end on a frame identical to
their first and their F-curves get a Cycles modifier. Export: glTF Actions mode, sampling on, deform
bones only, at most four influences, clip names exactly as defined. The manifest beside the GLB
(<model>.clips.json) lists playback, duration, fps, keys, events, controls and root motion.

Review gate (review.json beside the definition): the rig must be approved; while no clip is approved
only one clip may be drafted; approved clips are frozen (their baked samples must not change).
--no-review skips the gate for an unattended example and records that in the provenance.

blender --background --factory-startup --python-exit-code 1 --python animate.py -- \
  --rigged rigged.blend --poses poses.json --definition animations.json --out model.glb
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (PipelineError, bound_meshes, expand_clip, export_armature, load_definition,  # noqa: E402
                    load_poses, read_json, resolve_pose, rig_sha256, run, script_args, sha256, write_json)

CHANNELS = (('location', 3), ('rotation_quaternion', 4), ('scale', 3))


def isolate(arm):
    """Keep only the export skeleton and the meshes it carries; drop control rigs and their constraints."""
    keep = {arm, *bound_meshes(arm)}
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    for coll in list(bpy.data.collections):
        if not coll.all_objects:
            bpy.data.collections.remove(coll)
    bpy.context.view_layer.update()
    for pb in arm.pose.bones:
        for con in list(pb.constraints):
            pb.constraints.remove(con)
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis.identity()
    if arm.animation_data:
        arm.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    return sorted(keep - {arm}, key=lambda o: o.name)


def bone_lean(arm, bone, bank, twist):
    """Bone-local rotation equal to an armature-space bank (about forward, -Y) then twist (about up, +Z)."""
    rest = arm.data.bones[bone].matrix_local.to_quaternion()
    world = Quaternion((0, 0, 1), math.radians(twist)) @ Quaternion((0, -1, 0), math.radians(bank))
    return rest.inverted() @ world @ rest


def bake_frames(name, expanded, poses, bones, mirror_pairs, lean):
    keys = []
    for i, key in enumerate(expanded['keys']):
        if key['pose'] not in poses:
            raise PipelineError(f'clip {name!r} key {i}: unknown pose {key["pose"]!r}')
        noise = key['noise']
        if noise is not None and not (isinstance(noise, dict) and isinstance(noise.get('degrees'), (int, float))
                                      and 0 < noise['degrees'] <= 15 and 'seed' in noise):
            raise PipelineError(f'clip {name!r} key {i}: noise is {{"seed": any, "degrees": 0..15, "bones"?: [...]}}')
        resolved = resolve_pose(poses[key['pose']], bones, key['mirror'], mirror_pairs, key['scale'], noise,
                                noise_key=f'{key["pose"]}|{key["mirror"]}')
        if lean:
            bone, q = lean
            loc, rot, s = resolved[bone]
            resolved[bone] = (loc, q @ rot, s)
        keys.append((key, resolved))
    total = expanded['frames']
    out, previous = [], {}
    for f in range(total + 1):
        if expanded['loop'] and f == total:
            out.append({b: tuple(c.copy() for c in t) for b, t in out[0].items()})
            break
        seg = next(i for i in range(1, len(keys)) if keys[i][0]['frame'] >= f) if f else 1
        (ka, a), (kb, b) = keys[seg - 1], keys[seg]
        u = kb['easing']((f - ka['frame']) / (kb['frame'] - ka['frame']))
        frame = {}
        for bone in bones:
            la, ra, sa = a[bone]
            lb, rb, sb = b[bone]
            if ra.dot(rb) < 0:
                rb = Quaternion((-rb.w, -rb.x, -rb.y, -rb.z))
            rot = ra.slerp(rb, u)
            if bone in previous and previous[bone].dot(rot) < 0:
                rot = Quaternion((-rot.w, -rot.x, -rot.y, -rot.z))  # continuous hemisphere between frames
            previous[bone] = rot
            frame[bone] = (la.lerp(lb, u), rot, sa.lerp(sb, u))
        out.append(frame)
    start, end = expanded['trim']
    return out[start:end + 1]


def root_motion(spec, duration, playback, where):
    """Planar root motion in glTF axes (+Z forward, yaw about +Y), as an @kits/animation RootClip."""
    if spec is None:
        return None
    feet = spec.get('feet', [])
    for foot in feet:
        if not isinstance(foot, dict) or not isinstance(foot.get('bone'), str):
            raise PipelineError(f'{where}: rootMotion.feet entries are {{"bone": ..., "toe"?: ...}}')
    if 'stride' in spec:
        stride, yaw = spec['stride'], spec.get('yawPerCycle', 0)
        if playback != 'loop' or not isinstance(stride, (int, float)) or not math.isfinite(stride) or stride < 0:
            raise PipelineError(f'{where}: rootMotion.stride is metres per cycle of a loop clip')
        yaw_rad, count = math.radians(yaw), (8 if yaw else 1)
        keys = []
        for k in range(count + 1):
            t = k / count
            h = yaw_rad * t
            x, z = ((stride / yaw_rad) * (1 - math.cos(h)), (stride / yaw_rad) * math.sin(h)) if yaw else (0.0, stride * t)
            keys.append({'at': round(duration * t, 9), 'x': round(x, 9), 'z': round(z, 9), 'yaw': round(h, 9)})
        kind = {'stride': stride, 'yawPerCycle': yaw}
    elif 'delta' in spec:
        d = spec['delta']
        if not all(isinstance(d.get(k, 0), (int, float)) and math.isfinite(d.get(k, 0)) for k in ('x', 'z', 'yaw')):
            raise PipelineError(f'{where}: rootMotion.delta is {{"x": m, "z": m, "yaw": degrees}} over the clip')
        keys = [{'at': 0, 'x': 0, 'z': 0, 'yaw': 0},
                {'at': round(duration, 9), 'x': d.get('x', 0), 'z': d.get('z', 0), 'yaw': math.radians(d.get('yaw', 0))}]
        kind = {'delta': d}
    else:
        raise PipelineError(f'{where}: rootMotion needs stride (loops) or delta (one-shot clips)')
    return dict(kind, feet=feet, footSlideTolerance=spec.get('footSlideTolerance', 0.04),
                contactHeight=spec.get('contactHeight', 0.02), flatFootTolerance=spec.get('flatFootTolerance', 8),
                clip={'duration': duration, 'keys': keys})


def sample_sha256(frames, bones, meta):
    """Identity of a baked clip: what an approval freezes."""
    h = hashlib.sha256(json.dumps({k: meta[k] for k in ('playback', 'fps', 'frames', 'events', 'rootMotion')
                                   if k in meta}, sort_keys=True).encode())
    for frame in frames:
        for bone in bones:
            loc, rot, scale = frame[bone]
            h.update(','.join(f'{v:.6f}' for v in (*loc, *rot, *scale)).encode())
    return h.hexdigest()


def build_clips(arm, poses, definition_path):
    """Bake every clip. Returns (fps, [(name, frames, meta)]) without touching Blender actions."""
    bones = [b.name for b in arm.data.bones]
    data, fps, clips, mirror = load_definition(definition_path)
    built = []
    for name, clip in clips.items():
        expanded = expand_clip(name, clip, fps, clips)
        where = f'clip {name!r}'
        for bone in expanded['controls'] + [b for e in expanded['events'] for b in e['floor']]:
            if bone not in bones:
                raise PipelineError(f'{where}: names bone {bone!r}, which the skeleton lacks')
        lean, sign = None, 1
        derive = clip.get('derive')
        if derive:
            if derive.get('bone') not in bones:
                raise PipelineError(f'{where}: derive.bone must name the bone that leans into the turn')
            sign = {'left': 1, 'right': -1}.get(derive.get('turn'))
            if sign is None:
                raise PipelineError(f'{where}: derive.turn is left or right')
            lean = (derive['bone'], bone_lean(arm, derive['bone'], sign * derive.get('lean', 0),
                                              sign * derive.get('twist', 0)))
        frames = bake_frames(name, expanded, poses, bones, mirror['pairs'], lean)
        count = len(frames) - 1
        duration = count / fps
        rm_spec = clip.get('rootMotion')
        if derive and clips[derive['from']].get('rootMotion'):
            rm_spec = dict(clips[derive['from']]['rootMotion'], **(rm_spec or {}))
            rm_spec['yawPerCycle'] = sign * abs(derive.get('yawPerCycle', 0))
        start, end = expanded['trim']
        meta = {'name': name, 'playback': expanded['playback'], 'loop': expanded['loop'], 'fps': fps,
                'frames': count, 'duration': duration, 'controls': expanded['controls'],
                'events': [{'name': e['name'], 'at': e['at'], 'frame': e['frame'], 'floor': e['floor']}
                           for e in expanded['events']],
                'keys': [{'pose': k['pose'], 'mirror': k['mirror'], 'frame': k['frame'] - start,
                          'easing': k['easingSpec']} for k in expanded['keys'] if start <= k['frame'] <= end],
                'poses': {p: hashlib.sha256(json.dumps({b: [list(c) for c in t] for b, t in poses[p]['bones'].items()},
                                                       sort_keys=True).encode()).hexdigest()[:16]
                          for p in sorted({k['pose'] for k in expanded['keys']})}}
        if derive:
            meta['derivedFrom'] = derive['from']
        rm = root_motion(rm_spec, duration, expanded['playback'], where)
        if rm:
            meta['rootMotion'] = rm
        meta['sampleSha256'] = sample_sha256(frames, bones, meta)
        built.append((name, frames, meta))
    return fps, built


def write_action(arm, name, frames, loop, bones, meta):
    action = bpy.data.actions.new(name)
    slot = action.slots.new(id_type='OBJECT', name=arm.name)
    strip = action.layers.new('Layer').strips.new(type='KEYFRAME')
    bag = strip.channelbag(slot, ensure=True)
    count = len(frames)
    for bone in bones:
        group = bag.groups.new(bone)
        for c, (prop, size) in enumerate(CHANNELS):
            for index in range(size):
                curve = bag.fcurves.new(f'pose.bones["{bone}"].{prop}', index=index)
                curve.group = group
                values = []
                for f, frame in enumerate(frames):
                    value = frame[bone][c][index]
                    if not math.isfinite(value):
                        raise PipelineError(f'clip {name!r}: non-finite {prop} on {bone} at frame {f}')
                    values += [float(f), float(value)]
                curve.keyframe_points.add(count)
                curve.keyframe_points.foreach_set('co', values)
                for point in curve.keyframe_points:
                    point.interpolation = 'LINEAR'
                if loop:
                    curve.modifiers.new('CYCLES')
                curve.update()
    action.use_fake_user = True
    action.use_frame_range = True
    action.frame_start, action.frame_end = 0, count - 1
    action.use_cyclic = loop
    action['pose_to_pose'] = json.dumps({k: meta[k] for k in ('playback', 'duration', 'events')}, sort_keys=True)
    return action, slot


def review_gate(review_path, rig_hash, built, enabled):
    """Enforce rig approval, one representative clip first, and frozen approved clips."""
    if not enabled:
        return {'review': 'off'}
    review = read_json(review_path) if Path(review_path).exists() else {'schema': 1, 'rig': {}, 'clips': {}}
    rig = review.get('rig') or {}
    if rig.get('status') != 'approved':
        raise PipelineError('the rig test poses are not approved yet: render them with test_poses.py, show the '
                            'sheet to the user, and record their approval with review.mjs approve-rig')
    if rig.get('sha256') != rig_hash:
        raise PipelineError('the rig changed after its test poses were approved: re-run test_poses.py and ask again')
    approved = {n: c for n, c in (review.get('clips') or {}).items() if c.get('status') == 'approved'}
    drafts = []
    for name, frames, meta in built:
        if name in approved:
            if approved[name].get('sampleSha256') != meta['sampleSha256']:
                raise PipelineError(f'clip {name!r} is approved and frozen, but its baked samples changed (a pose, '
                                    'timing or rig edit reached it). Revert that edit, or unfreeze the clip with '
                                    'review.mjs unfreeze and have it approved again.')
        else:
            drafts.append(name)
    if not approved and len(drafts) > 1:
        raise PipelineError(f'draft one representative clip first and have it approved; the definition drafts '
                            f'{drafts}. Remove the others until the first is approved.')
    return {'review': 'on', 'draftClips': drafts}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--rigged', required=True)
    p.add_argument('--poses', required=True, action='append')
    p.add_argument('--definition', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--review', help='review ledger (default: review.json beside the definition)')
    p.add_argument('--no-review', action='store_true',
                   help='unattended example export: skip the approval gate and record review: off')
    p.add_argument('--provenance', help='JSON of authorship fields to record (author, licence, source)')
    p.add_argument('--allow-unapproved', action='store_true',
                   help='draft export: accept reference-matched poses the user has not approved yet')
    args = p.parse_args(script_args())
    out = Path(args.out).resolve()
    if out.suffix != '.glb':
        raise PipelineError('--out must end in .glb')
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.rigged).resolve()))
    arm = export_armature()
    meshes = isolate(arm)
    bones = [b.name for b in arm.data.bones]
    poses = load_poses(args.poses, set(bones))
    fps, built = build_clips(arm, poses, args.definition)
    unapproved = sorted({k['pose'] for _, _, m in built for k in m['keys']
                         if poses[k['pose']]['source'].get('kind') == 'reference'
                         and (poses[k['pose']].get('approval') or {}).get('status') != 'approved'})
    if unapproved and not args.allow_unapproved:
        raise PipelineError(f'reference-matched poses need the user\'s approval first: {unapproved}. Render the '
                            'side-by-side with pose_compare.py, show it, and record approval in the pose file.')
    rig_hash = rig_sha256(arm, meshes)
    gate = review_gate(args.review or Path(args.definition).with_name('review.json'), rig_hash, built,
                       not args.no_review)
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = fps, 1
    actions = [write_action(arm, name, frames, meta['loop'], bones, meta) for name, frames, meta in built]
    arm.animation_data_create()
    arm.animation_data.action, arm.animation_data.action_slot = actions[0]
    bpy.context.view_layer.update()
    for obj in bpy.data.objects:
        obj.select_set(obj == arm or obj in meshes)
    bpy.context.view_layer.objects.active = arm
    out.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(out), export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_step=1, export_frame_range=False, export_anim_slide_to_zero=False,
        export_def_bones=True, export_skins=True, export_influence_nb=4, export_all_influences=False,
        export_anim_single_armature=True, export_reset_pose_bones=True, export_rest_position_armature=True,
        export_optimize_animation_size=False, export_extras=True, export_cameras=False, export_lights=False,
        export_materials='EXPORT', export_morph=False)
    if result != {'FINISHED'}:
        raise PipelineError(f'glTF export did not finish: {result}')
    manifest = {'schema': 1, 'model': out.name, 'fps': fps, 'skeleton': arm.name, 'bones': len(bones),
                'rigSha256': rig_hash, 'clips': [m for _, _, m in built]}
    write_json(out.with_suffix('.clips.json'), manifest)
    script_dir = Path(__file__).resolve().parent
    inputs = {Path(x).name: sha256(x) for x in [args.definition, *args.poses]}
    inputs.update({f'blender/{f.name}': sha256(f) for f in sorted(script_dir.glob('*.py'))})
    raw = out.read_bytes()
    generator = json.loads(raw[20:20 + int.from_bytes(raw[12:16], 'little')])['asset'].get('generator', '')
    provenance = dict(read_json(args.provenance) if args.provenance else {}, schema=1,
                      blender=bpy.app.version_string, tool=f'Blender {bpy.app.version_string}',
                      generator=generator, artifact=out.name, sha256=sha256(out),
                      clipsManifestSha256=sha256(out.with_suffix('.clips.json')), inputs=inputs,
                      clips=[m['name'] for _, _, m in built], bones=len(bones), rigSha256=rig_hash,
                      triangles=sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes),
                      unapprovedPoses=unapproved, **gate)
    write_json(out.with_suffix('.provenance.json'), provenance)
    print(f'pose-to-pose: exported {[m["name"] for _, _, m in built]} ({len(bones)} bones, review '
          f'{gate["review"]}) -> {out}')


if __name__ == '__main__':
    run(main)
