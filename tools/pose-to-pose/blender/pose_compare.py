"""Side-by-side for reference matching (GPL-3.0-only): the reference frame beside the rig in a key pose.

The agent poses the rig to match a chosen reference frame (a pose in poses.json), renders it from the
reference's camera view, and shows the pair to the user. Agents judge 3D poses from pictures poorly, so
the user approves each match (reference.mjs approve-pose) before the generator will use the pose.

blender --background --factory-startup --python-exit-code 1 --python pose_compare.py -- \
  --rigged rigged.blend --poses poses.json --pose contact --image ref.png --out compare.png \
  [--view side|front|three-quarter|back] [--azimuth 90 --elevation 10]
"""
import argparse
import math
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from animate import isolate  # noqa: E402
from common import PipelineError, export_armature, load_poses, resolve_pose, run, script_args  # noqa: E402
import render  # noqa: E402
from render import add_camera, add_floor, add_label, render_tile, setup_render, world_bounds  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--rigged', required=True)
    p.add_argument('--poses', required=True)
    p.add_argument('--pose', required=True)
    p.add_argument('--image', required=True, help='the reference frame (reference.mjs frame)')
    p.add_argument('--out', required=True)
    p.add_argument('--view', choices=['side', 'front', 'three-quarter', 'back'], default='side')
    p.add_argument('--azimuth', type=float, help='camera direction in degrees around +Z (0 = from +X, 90 = from +Y)')
    p.add_argument('--elevation', type=float, default=10, help='camera height angle in degrees')
    p.add_argument('--mirror', action='store_true', help='show the mirrored pose')
    args = p.parse_args(script_args())
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.rigged).resolve()))
    arm = export_armature()
    meshes = isolate(arm)
    bones = [b.name for b in arm.data.bones]
    poses = load_poses([args.poses], set(bones))
    if args.pose not in poses:
        raise PipelineError(f'pose {args.pose!r} is not in {args.poses}')
    pose = resolve_pose(poses[args.pose], bones, args.mirror, [['.L', '.R']])
    reference = bpy.data.images.load(str(Path(args.image).resolve()))
    width, height = reference.size
    ref = np.array(reference.pixels[:], dtype=np.float32).reshape(height, width, 4)
    if args.azimuth is not None:
        a, e = math.radians(args.azimuth), math.radians(args.elevation)
        render.VIEWS['custom'] = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        view = 'custom'
    else:
        view = args.view
    setup_render(height)
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = width, height
    lo, hi = world_bounds(meshes)
    lo.z = min(lo.z, 0)
    add_floor(lo, hi)
    cam = add_camera(lo, hi, view)
    for pb in arm.pose.bones:
        pb.location, pb.rotation_quaternion, pb.scale = pose[pb.name]
    bpy.context.view_layer.update()
    approval = (poses[args.pose].get('approval') or {}).get('status', 'none')
    label = add_label(cam, f'{args.pose}{" (mirror)" if args.mirror else ""}\napproval: {approval}', True)
    with tempfile.TemporaryDirectory() as tmp:
        posed = render_tile(Path(tmp) / 'posed.png', label)
    gap = np.ones((height, 8, 4), dtype=np.float32)
    gap[..., :3] = 0.11
    pair = np.concatenate([ref, gap, posed], axis=1)
    image = bpy.data.images.new('compare', pair.shape[1], pair.shape[0], alpha=True)
    image.pixels.foreach_set(pair.ravel())
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(out)
    image.file_format = 'PNG'
    image.save()
    print(f'pose-to-pose: reference | {args.pose} from the {view} view -> {out}')


run(main)
