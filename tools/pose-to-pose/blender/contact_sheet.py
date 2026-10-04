"""Contact sheet (GPL-3.0-only): render key poses and in-betweens from the exported GLB.

It re-imports the shipped GLB, so the sheet shows what the engine receives, not the authoring scene.
Each clip starts a new row; key-pose tiles are labelled KEY with the pose name, in-betweens show the
frame, and event frames show the event name.

blender --background --factory-startup --python-exit-code 1 --python contact_sheet.py -- \
  --glb model.glb --out sheet.png [--clip walk --clip wave] [--every 2] [--view side|front|three-quarter]
"""
import argparse
import sys
import tempfile
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PipelineError, clear_scene, read_json, run, script_args  # noqa: E402
from render import add_camera, add_floor, add_label, render_tile, save_sheet, setup_render, world_bounds  # noqa: E402


def imported_action(name):
    action = bpy.data.actions.get(name)
    if action is None:
        action = next((a for a in bpy.data.actions if a.name.rsplit('_', 1)[0] == name), None)
    if action is None:
        raise PipelineError(f'the importer found no action for clip {name!r}')
    return action


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--glb', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--clip', action='append')
    p.add_argument('--every', type=int, default=2, help='render every Nth in-between frame')
    p.add_argument('--view', choices=['side', 'front', 'three-quarter', 'back', 'top'], default='three-quarter')
    p.add_argument('--tile', type=int, default=240)
    p.add_argument('--columns', type=int, default=8, help='tiles per row before wrapping')
    args = p.parse_args(script_args())
    glb = Path(args.glb).resolve()
    manifest = read_json(glb.with_suffix('.clips.json'))
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(glb))
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(arms) != 1:
        raise PipelineError(f'expected one armature in {glb}, found {len(arms)}')
    arm = arms[0]
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    lo, hi = world_bounds(meshes)
    lo.z = min(lo.z, 0)
    setup_render(args.tile)
    add_floor(lo, hi)
    cam = add_camera(lo, hi, args.view)
    clips = {c['name']: c for c in manifest['clips']}
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for name in args.clip or list(clips):
            if name not in clips:
                raise PipelineError(f'clip {name!r} is not in {glb.name}')
            action = imported_action(name)
            arm.animation_data_create()
            arm.animation_data.action = action
            if action.slots:
                arm.animation_data.action_slot = action.slots[0]
            clip = clips[name]
            keys = {k['frame']: k for k in clip['keys']}
            events = {}
            for e in clip.get('events', []):
                events.setdefault(e['frame'], []).append(e['name'])
            frames = sorted(set(range(0, clip['frames'] + 1, max(1, args.every))) | set(keys) | set(events))
            tiles = []
            for f in frames:
                bpy.context.scene.frame_set(f)
                key = keys.get(f)
                label = f'{name} f{f}'
                if key:
                    label += f"\nKEY {key['pose']}{' (mirror)' if key['mirror'] else ''}"
                if f in events:
                    label += '\n! ' + ', '.join(events[f])
                text = add_label(cam, label, key is not None)
                tiles.append(render_tile(Path(tmp) / f'{name}-{f:04d}.png', text))
                bpy.data.objects.remove(text, do_unlink=True)
            rows.append(tiles)
    width, height = save_sheet(rows, args.columns, args.out)
    print(f'pose-to-pose: contact sheet {width}x{height} ({sum(len(r) for r in rows)} tiles) -> {args.out}')


run(main)
