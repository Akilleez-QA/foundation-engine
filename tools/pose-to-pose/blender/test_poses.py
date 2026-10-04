"""Rig test-pose gate (GPL-3.0-only): run before any clip is authored, then the user approves it.

Renders a weights tile (each vertex coloured by its dominant bone; magenta = no weights) and extreme
test poses from two views into one sheet, and reports wrong-side, unweighted and island vertices.
The report carries the rig hash that review.mjs approve-rig records; the generator refuses to export
clips for a rig whose test poses were not approved, or that changed since.

blender --background --factory-startup --python-exit-code 1 --python test_poses.py -- \
  --rigged rigged.blend --out testposes.png --report testposes.json [--poses testposes.pose.json]
"""
import argparse
import colorsys
import math
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Quaternion

sys.path.insert(0, str(Path(__file__).resolve().parent))
from animate import isolate  # noqa: E402
from common import (PipelineError, export_armature, load_poses, resolve_pose, rig_sha256, run,  # noqa: E402
                    script_args, write_json)
from render import add_camera, add_floor, add_label, render_tile, save_sheet, setup_render, world_bounds  # noqa: E402


def default_poses(bones, angle):
    """Fallback stress poses when the model has no test-pose file: every bone bent the same way."""
    out = {}
    for label, axis, sign in (('bend', (1, 0, 0), 1), ('bend-back', (1, 0, 0), -1), ('side', (0, 0, 1), 1),
                              ('twist', (0, 1, 0), 1)):
        pose = resolve_pose({'bones': {}}, bones)
        q = Quaternion(axis, math.radians(angle * sign))
        for bone in bones:
            if bone != 'root':
                pose[bone] = (pose[bone][0], q.copy(), pose[bone][2])
        out[label] = pose
    return out


def weight_analysis(meshes, arm):
    """Dominant bone per vertex, wrong-side and unweighted counts, and disconnected islands per bone."""
    bones = [b.name for b in arm.data.bones]
    result = {'vertices': 0, 'unweighted': 0, 'wrongSide': 0, 'islands': {}, 'rigid': []}
    for obj in meshes:
        if obj.parent_type == 'BONE':
            result['rigid'].append({'part': obj.name, 'bone': obj.parent_bone})
            continue
        names = {g.index: g.name for g in obj.vertex_groups}
        dominant = []
        for v in obj.data.vertices:
            ws = [(names[g.group], g.weight) for g in v.groups if g.weight > 1e-6 and names.get(g.group) in bones]
            bone = max(ws, key=lambda x: x[1])[0] if ws else None
            dominant.append(bone)
            result['vertices'] += 1
            x = (obj.matrix_world @ v.co).x
            if bone is None:
                result['unweighted'] += 1
            elif (bone.endswith('.L') and x < -0.02) or (bone.endswith('.R') and x > 0.02):
                result['wrongSide'] += 1
        adjacency = [[] for _ in obj.data.vertices]
        for e in obj.data.edges:
            a, b = e.vertices
            adjacency[a].append(b)
            adjacency[b].append(a)
        seen = set()
        for start, bone in enumerate(dominant):
            if bone is None or start in seen:
                continue
            stack = [start]
            seen.add(start)
            while stack:
                for n in adjacency[stack.pop()]:
                    if n not in seen and dominant[n] == bone:
                        seen.add(n)
                        stack.append(n)
            result['islands'][bone] = result['islands'].get(bone, 0) + 1
        attr = obj.data.color_attributes.new('dominant', 'FLOAT_COLOR', 'POINT')
        for i, bone in enumerate(dominant):
            if bone is None:
                attr.data[i].color = (1, 0, 1, 1)
            else:
                h = (bones.index(bone) * 0.61803) % 1
                attr.data[i].color = (*colorsys.hsv_to_rgb(h, 0.65, 0.95), 1)
        obj.data.color_attributes.active_color = attr
    result['multiIslandBones'] = sorted(b for b, n in result['islands'].items() if n > 1)
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--rigged', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--report', required=True)
    p.add_argument('--poses', help='pose file whose poses are the test poses (bone-local, like poses.json)')
    p.add_argument('--angle', type=float, default=20, help='per-bone angle of the fallback stress poses')
    p.add_argument('--tile', type=int, default=240)
    args = p.parse_args(script_args())
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.rigged).resolve()))
    arm = export_armature()
    meshes = isolate(arm)
    bones = [b.name for b in arm.data.bones]
    rig_hash = rig_sha256(arm, meshes)
    if args.poses:
        poses = {n: resolve_pose(p, bones) for n, p in load_poses([args.poses], set(bones)).items()}
        source = Path(args.poses).name
    else:
        poses = default_poses(bones, args.angle)
        source = f'fallback stress poses ({args.angle:g} degrees per bone)'
    weights = weight_analysis(meshes, arm)
    setup_render(args.tile)
    lo, hi = world_bounds(meshes)
    lo.z = min(lo.z, 0)
    add_floor(lo, hi)
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for view in ('front', 'three-quarter'):
            cam = add_camera(lo, hi, view)
            tiles = []
            bpy.context.scene.display.shading.color_type = 'VERTEX'
            for pb in arm.pose.bones:
                pb.matrix_basis.identity()
            text = add_label(cam, f'{view}\nweights (magenta: none)', True)
            tiles.append(render_tile(Path(tmp) / f'{view}-weights.png', text))
            bpy.data.objects.remove(text, do_unlink=True)
            bpy.context.scene.display.shading.color_type = 'MATERIAL'
            for name, pose in poses.items():
                for pb in arm.pose.bones:
                    loc, rot, scale = pose[pb.name]
                    pb.location, pb.rotation_quaternion, pb.scale = loc, rot, scale
                bpy.context.view_layer.update()
                text = add_label(cam, f'{view}\nTEST {name}', False)
                tiles.append(render_tile(Path(tmp) / f'{view}-{name}.png', text))
                bpy.data.objects.remove(text, do_unlink=True)
            rows.append(tiles)
            bpy.data.objects.remove(cam, do_unlink=True)
    width, height = save_sheet(rows, len(rows[0]), args.out)
    problems = []
    if weights['unweighted']:
        problems.append(f"{weights['unweighted']} vertices have no weights")
    if weights['wrongSide']:
        problems.append(f"{weights['wrongSide']} vertices follow a bone on the opposite side")
    report = {'schema': 1, 'rigSha256': rig_hash, 'sheet': Path(args.out).name, 'poses': list(poses),
              'poseSource': source, 'weights': weights, 'problems': problems,
              'review': ['bones with more than one weight island: ' + ', '.join(weights['multiIslandBones'])]
              if weights['multiIslandBones'] else []}
    write_json(args.report, report)
    print(f'pose-to-pose: test poses {width}x{height} -> {args.out}; problems: {problems or "none"}')
    if problems:
        raise PipelineError('rig test poses found weight problems: ' + '; '.join(problems))


run(main)
