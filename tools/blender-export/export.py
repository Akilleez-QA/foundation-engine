"""Original GPL-3.0-only sample. Run with Blender --background --factory-startup."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.output).resolve()
if out.suffix != '.glb':
    raise ValueError('output must end in .glb')
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1
# Mesh coordinates establish a base-centre origin without unapplied object transforms.
verts = [(x, y, z) for z in (0, 1) for y in (-.5, .5) for x in (-.5, .5)]
faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
mesh = bpy.data.meshes.new('metre-block')
mesh.from_pydata(verts, [], faces)
mesh.update()
obj = bpy.data.objects.new('metre-block', mesh)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
for name, colour in [('body-blue', (.04, .35, .8, 1)), ('top-gold', (.9, .5, .03, 1))]:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = colour
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['Roughness'].default_value = 1
    obj.data.materials.append(material)
mesh.polygons[1].material_index = 1
result = bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_animations=False, export_materials='EXPORT',
    export_cameras=False, export_lights=False)
if result != {'FINISHED'}:
    raise RuntimeError(f'export did not finish: {result}')
manifest = dict(schema=1, author='Foundation Engine contributors', licence='GPL-3.0-only',
    source='tools/blender-export/export.py', sourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    blender=bpy.app.version_string, artifact=out.name, sha256=hashlib.sha256(out.read_bytes()).hexdigest(),
    units='metres', up='+Y', pivot='base centre', bounds=[[-.5, 0, -.5], [.5, 1, .5]],
    materials=2, triangles=12, textures=0, animation='none')
out.with_suffix('.provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
