"""Original GPL-3.0-only low-poly humanoid robot, built procedurally from landmarks.json.

blender --background --factory-startup --python-exit-code 1 --python build_robot.py -- --out <robot.blend>
"""
import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blender'))
from common import clear_scene, read_json, run, script_args  # noqa: E402

HERE = Path(__file__).resolve().parent


def material(name, colour, roughness=0.6, metallic=0.0):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True  # older Blender; 5.x materials always have a node tree
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = colour
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args(script_args())
    clear_scene()
    lm = {k: Vector(v) for k, v in read_json(HERE / 'landmarks.json').items() if isinstance(v, list)}
    for key in list(lm):
        if key.endswith('.L'):
            lm[key[:-2] + '.R'] = Vector((-lm[key].x, lm[key].y, lm[key].z))
    chest = (lm['hips'] + lm['neck']) / 2 + Vector((0, 0, 0.12))
    # A skin-modifier graph gives one connected, manifold quad mesh: a good input for bone heat weighting.
    points = {'hips': lm['hips'], 'chest': chest, 'neck': lm['neck'], 'head': lm['head'],
              'headTop': lm['headTop']}
    radius = {'hips': (0.15, 0.1), 'chest': (0.19, 0.12), 'neck': (0.05, 0.05), 'head': (0.1, 0.1),
              'headTop': (0.1, 0.1)}
    edges = [('hips', 'chest'), ('chest', 'neck'), ('neck', 'head'), ('head', 'headTop')]
    for side in ('L', 'R'):
        for key, r in (('upperArm', (0.055, 0.055)), ('elbow', (0.045, 0.045)), ('wrist', (0.04, 0.035)),
                       ('handTip', (0.035, 0.02)), ('hip', (0.07, 0.07)), ('knee', (0.06, 0.06)),
                       ('ankle', (0.05, 0.05)), ('toe', (0.05, 0.02))):
            points[f'{key}.{side}'] = lm[f'{key}.{side}']
            radius[f'{key}.{side}'] = r
        edges += [('chest', f'upperArm.{side}'), (f'upperArm.{side}', f'elbow.{side}'),
                  (f'elbow.{side}', f'wrist.{side}'), (f'wrist.{side}', f'handTip.{side}'),
                  ('hips', f'hip.{side}'), (f'hip.{side}', f'knee.{side}'), (f'knee.{side}', f'ankle.{side}'),
                  (f'ankle.{side}', f'toe.{side}')]
    names = list(points)
    mesh = bpy.data.meshes.new('pose-robot')
    mesh.from_pydata([points[n] for n in names], [(names.index(a), names.index(b)) for a, b in edges], [])
    obj = bpy.data.objects.new('pose-robot', mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    skin = obj.modifiers.new('skin', 'SKIN')
    skin.use_smooth_shade = False
    skin.branch_smoothing = 0
    for i, n in enumerate(names):
        sv = mesh.skin_vertices[0].data[i]
        sv.radius = radius[n]
        sv.use_root = n == 'hips'
    bpy.ops.object.modifier_apply(modifier='skin')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.delete_loose()  # the skin modifier can leave an unused vertex
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in obj.data.vertices:
        v.co.z = max(v.co.z, 0.0)  # flat soles resting on the floor at z = 0
    # Team-colour convention: the chest plate is its own material slot named "team".
    obj.data.materials.append(material('body', (0.55, 0.58, 0.62, 1), 0.5, 0.3))
    obj.data.materials.append(material('team', (0.9, 0.35, 0.08, 1), 0.5))
    obj.data.materials.append(material('visor', (0.05, 0.08, 0.12, 1), 0.2))
    for poly in obj.data.polygons:
        c, n = poly.center, poly.normal
        if n.y < -0.7 and 1.05 < c.z < 1.3 and abs(c.x) < 0.12:
            poly.material_index = 1
        elif n.y < -0.6 and c.z > 1.5:
            poly.material_index = 2
    obj.data.uv_layers.new(name='UVMap')
    for p in obj.data.polygons:
        p.use_smooth = False
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.out).resolve()), compress=False)
    print(f'robot: {len(obj.data.polygons)} faces, {len(obj.data.vertices)} vertices -> {args.out}')


run(main)
