"""Pose capture (GPL-3.0-only): the user's Blender key poses -> poses.json in deform-skeleton space.

Reads, from the user's saved .blend (never modified):
  * pose assets: actions marked as assets (Blender's Pose Library: Pose Mode > Asset Shelf >
    Create Pose Asset, saved to the current file), applied to whichever armature they were made on;
  * marker poses: every timeline marker; the pose at the marker's frame is captured under its name.
The user can pose the Rigify control rig (IK, FK, torso controls) or the deform skeleton directly.
Each pose is evaluated (constraints included) and stored as bone-local rotations and locations of the
exported deform skeleton, so the generator interpolates exactly what the engine will play.

blender --background --factory-startup --python-exit-code 1 --python capture_poses.py -- \
  --blend posed.blend --out poses.json [--only contact --only passing] [--merge existing.json]
"""
import argparse
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (CONTROL_TAG, PipelineError, export_armature, pose_basis_from_matrices, read_json,  # noqa: E402
                    run, script_args, transform_to_json, write_json)


def action_bones(action):
    names = set()
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    if curve.data_path.startswith('pose.bones["'):
                        names.add(curve.data_path.split('"')[1])
    return names


def reset(armatures):
    for arm in armatures:
        for pb in arm.pose.bones:
            pb.matrix_basis.identity()
            # apply_pose_from_action only touches selected bones when any are selected: select none.
            for owner in (pb, pb.bone):
                if hasattr(owner, 'select'):
                    owner.select = False


def capture(arm):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    basis = pose_basis_from_matrices(arm.evaluated_get(deps))
    return {bone: t for bone, t in ((b, transform_to_json(v)) for b, v in basis.items()) if t}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--blend', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--only', action='append', help='capture only these pose names')
    p.add_argument('--merge', help='existing pose file to extend (names must not collide)')
    args = p.parse_args(script_args())
    blend = Path(args.blend).resolve()
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    arm = export_armature()
    controls = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o.get(CONTROL_TAG)]
    armatures = [arm, *controls]
    poses = read_json(args.merge)['poses'] if args.merge else {}
    captured = {}
    scene = bpy.context.scene
    # Marker poses first, with the animation the user keyed.
    for marker in sorted(scene.timeline_markers, key=lambda m: m.frame):
        scene.frame_set(marker.frame)
        captured[marker.name] = ({'kind': 'marker', 'file': blend.name, 'frame': marker.frame}, capture(arm))
    # Pose assets: applied with every armature's own animation unassigned, so nothing overrides them.
    saved = {a.name: (a.animation_data.action, a.animation_data.action_slot) if a.animation_data else None
             for a in armatures}
    for a in armatures:
        if a.animation_data:
            a.animation_data.action = None
    for action in sorted((a for a in bpy.data.actions if a.asset_data), key=lambda a: a.name):
        bones = action_bones(action)
        target = max(armatures, key=lambda a: len(bones & {b.name for b in a.data.bones}))
        if not bones & {b.name for b in target.data.bones}:
            print(f'pose-to-pose: WARNING: pose asset {action.name!r} keys no bone of this rig; skipped')
            continue
        reset(armatures)
        target.pose.apply_pose_from_action(action, evaluation_time=action.frame_range[0])
        if action.name in captured:
            raise PipelineError(f'{action.name!r} is both a marker and a pose asset; rename one')
        captured[action.name] = ({'kind': 'pose-asset', 'file': blend.name, 'armature': target.name}, capture(arm))
    for a in armatures:
        if saved[a.name]:
            a.animation_data.action, a.animation_data.action_slot = saved[a.name]
    if not captured:
        raise PipelineError(f'{blend.name} has no pose assets and no timeline markers to capture')
    for name, (source, bones) in captured.items():
        if args.only and name not in args.only:
            continue
        if name in poses:
            raise PipelineError(f'pose {name!r} already exists in {args.merge}')
        poses[name] = {'source': source, 'bones': bones}
    write_json(args.out, {'schema': 1, 'poses': poses})
    print(f'pose-to-pose: captured {sorted(n for n in captured if not args.only or n in args.only)} -> {args.out}')


run(main)
