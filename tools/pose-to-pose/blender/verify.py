"""Verify after export (GPL-3.0-only): what the engine will load matches what was authored.

1. Copies the GLB and its manifest into a fresh temporary folder (catches dependencies on the working
   folder) and imports it into an empty factory-startup scene.
2. Checks clip names, count, durations and the scene rate against the manifest.
3. Re-bakes every clip from the source (rigged.blend + poses + definition, with the generator's own
   code) and compares joint positions with the re-imported clip, every frame, in one world space.
4. At every event with a `floor` list, checks that the deformed mesh around those bones (vertices
   they dominate, or rigid parts parented to them) touches the floor: its lowest point within
   --floor-tolerance of z = 0. This judges the skinned sole, not bone heights.

blender --background --factory-startup --python-exit-code 1 --python verify.py -- \
  --glb model.glb --rigged rigged.blend --poses poses.json --definition animations.json --report verify.json
"""
import argparse
import shutil
import sys
import tempfile
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from animate import build_clips  # noqa: E402
from common import EXPORT_TAG, PipelineError, load_poses, read_json, run, script_args, write_json  # noqa: E402


def append_source(rigged):
    """Append the source skeleton and the meshes it carries; drop control rigs and constraints."""
    with bpy.data.libraries.load(str(rigged), link=False) as (src, dst):
        dst.objects = list(src.objects)
    added = [o for o in dst.objects if o is not None]
    arms = [o for o in added if o.type == 'ARMATURE' and o.get(EXPORT_TAG)]
    if len(arms) != 1:
        raise PipelineError('the rigged file must hold one exported skeleton')
    arm = arms[0]
    keep = {arm, *(o for o in added if o.type == 'MESH' and (o.parent == arm or any(
        m.type == 'ARMATURE' and m.object == arm for m in o.modifiers)))}
    for obj in added:
        if obj in keep:
            bpy.context.collection.objects.link(obj)
        else:
            bpy.data.objects.remove(obj, do_unlink=True)
    for pb in arm.pose.bones:
        for con in list(pb.constraints):
            pb.constraints.remove(con)
        pb.rotation_mode = 'QUATERNION'
    if arm.animation_data:
        arm.animation_data_clear()
    return arm


def joint_positions(arm):
    return {pb.name: arm.matrix_world @ pb.head for pb in arm.pose.bones}


def floor_height(arm, meshes, bones):
    """Lowest evaluated (deformed) vertex around `bones`, in world z."""
    deps = bpy.context.evaluated_depsgraph_get()
    low = None
    for obj in meshes:
        ev = obj.evaluated_get(deps)
        if obj.parent_type == 'BONE':
            if obj.parent_bone not in bones:
                continue
            mesh = ev.to_mesh()
            zs = [(ev.matrix_world @ v.co).z for v in mesh.vertices]
        else:
            names = {g.index: g.name for g in obj.vertex_groups}
            members = set()
            for v in obj.data.vertices:
                ws = [(names[g.group], g.weight) for g in v.groups if g.weight > 1e-6 and g.group in names]
                if ws and max(ws, key=lambda x: x[1])[0] in bones:
                    members.add(v.index)
            mesh = ev.to_mesh()
            zs = [(ev.matrix_world @ mesh.vertices[i].co).z for i in members]
        ev.to_mesh_clear()
        if zs:
            low = min(zs) if low is None else min(low, min(zs))
    return low


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--glb', required=True)
    p.add_argument('--rigged', required=True)
    p.add_argument('--poses', required=True, action='append')
    p.add_argument('--definition', required=True)
    p.add_argument('--report', required=True)
    p.add_argument('--tolerance', type=float, default=0.002, help='joint position tolerance, metres')
    p.add_argument('--floor-tolerance', type=float, default=0.015, help='sole height tolerance, metres')
    args = p.parse_args(script_args())
    glb = Path(args.glb).resolve()
    manifest = read_json(glb.with_suffix('.clips.json'))
    failures = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fps = manifest['fps']
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = fps, 1  # the importer converts seconds to frames at this rate
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / 'copied' / glb.name
        copy.parent.mkdir()
        shutil.copy2(glb, copy)
        bpy.ops.import_scene.gltf(filepath=str(copy))
    imported = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(imported) != 1:
        raise PipelineError(f'expected one armature after re-import, found {len(imported)}')
    imp = imported[0]
    imp_meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    actions = {a.name: a for a in bpy.data.actions}
    names = [c['name'] for c in manifest['clips']]
    found = {n: actions.get(n) or next((a for a in actions.values() if a.name.rsplit('_', 1)[0] == n), None)
             for n in names}
    missing = [n for n, a in found.items() if a is None]
    if missing:
        failures.append(f're-import has no action for clips {missing}')
    if len(bpy.data.actions) != len(names):
        failures.append(f're-import found {len(bpy.data.actions)} actions, manifest lists {len(names)}')
    # The source, baked again with the generator's code, in the same scene.
    src = append_source(Path(args.rigged).resolve())
    bones = [b.name for b in src.data.bones]
    poses = load_poses(args.poses, set(bones))
    _, built = build_clips(src, poses, args.definition)
    report = {'schema': 1, 'glb': glb.name, 'copiedFolder': True, 'clips': {}, 'failures': failures}
    for name, frames, meta in built:
        action = found.get(name)
        if action is None:
            continue
        entry = {'frames': meta['frames'], 'maxJointError': 0.0, 'floor': []}
        start, end = (int(round(v)) for v in action.frame_range)
        if end - start != meta['frames']:
            failures.append(f'{name}: re-imported range is {end - start} frames, manifest says {meta["frames"]}')
        imp.animation_data_create()
        imp.animation_data.action = action
        if action.slots:
            imp.animation_data.action_slot = action.slots[0]
        floor_at = {}
        for event in meta['events']:
            if event['floor']:
                floor_at.setdefault(event['frame'], []).append(event)
        for f, values in enumerate(frames):
            for pb in src.pose.bones:
                pb.location, pb.rotation_quaternion, pb.scale = values[pb.name]
            scene.frame_set(start + f)
            bpy.context.view_layer.update()
            a, b = joint_positions(src), joint_positions(imp)
            for bone in bones:
                if bone in b:
                    entry['maxJointError'] = max(entry['maxJointError'], (a[bone] - b[bone]).length)
            for event in floor_at.get(f, []):
                low = floor_height(imp, imp_meshes, set(event['floor']))
                ok = low is not None and abs(low) <= args.floor_tolerance
                entry['floor'].append({'event': event['name'], 'frame': f, 'bones': event['floor'],
                                       'lowest': None if low is None else round(low, 4), 'ok': ok})
                if not ok:
                    failures.append(f'{name}: at event {event["name"]} (frame {f}) the deformed mesh around '
                                    f'{event["floor"]} is at z={low if low is None else round(low, 4)}, '
                                    f'not on the floor (tolerance {args.floor_tolerance} m)')
        entry['maxJointError'] = round(entry['maxJointError'], 6)
        if entry['maxJointError'] > args.tolerance:
            failures.append(f'{name}: re-imported joints differ from the source by up to '
                            f'{entry["maxJointError"]:.4f} m (tolerance {args.tolerance} m)')
        report['clips'][name] = entry
    missing_bones = sorted(set(bones) - {pb.name for pb in imp.pose.bones})
    if missing_bones:
        failures.append(f're-import lacks bones {missing_bones}')
    report['bones'] = len(imp.pose.bones)
    report['passed'] = not failures
    write_json(args.report, report)
    for name, entry in report['clips'].items():
        floors = ', '.join(f"{x['event']} {x['lowest']}" for x in entry['floor'])
        print(f'pose-to-pose: verify {name}: max joint error {entry["maxJointError"]} m' +
              (f'; floor {floors}' if floors else ''))
    if failures:
        raise PipelineError('verify failed: ' + '; '.join(failures))
    print(f'pose-to-pose: verified {len(report["clips"])} clips from a copied folder -> {args.report}')


run(main)
