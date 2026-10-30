"""Low-poly lantern: an original GPL-3.0-only example asset, built from nothing by this script.

Run headless from the repository root (never in a Blender session holding unsaved work):

    blender --background --factory-startup --python tools/blender-export/game/tools/lantern/export.py

Optional: `-- --output <path>.glb` writes elsewhere (for a scratch comparison). The script writes the GLB and its
adjacent `.provenance.json`; the creator's limits are in `lantern.contract.json` next to the default output, checked
with `npm run asset:verify -- tools/blender-export/game/public/models/lantern.glb`.

Contract: metres, origin at the base centre, Blender Z-up exported as glTF +Y, no object transforms (coordinates are
authored in the mesh), flat-shaded, two Principled BSDF materials, no textures, lights, cameras or animation.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix

SOURCE = 'tools/blender-export/game/tools/lantern/export.py'
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / 'public' / 'models' / 'lantern.glb'

parser = argparse.ArgumentParser()
parser.add_argument('--output', default=str(DEFAULT_OUTPUT))
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
out = Path(args.output).resolve()
if out.suffix != '.glb':
    raise ValueError('output must end in .glb')
out.parent.mkdir(parents=True, exist_ok=True)

# Factory startup gives a throwaway scene; clear it so only the lantern is exported.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1

IRON, GLOW = 0, 1
bm = bmesh.new()


def tag(material, build):
    """Run a bmesh builder and give every face it creates one material."""
    before = set(bm.faces)
    build()
    for face in set(bm.faces) - before:
        face.material_index = material
        face.smooth = False


def prism(radius_bottom, radius_top, z0, z1):
    """An eight-sided prism or frustum from z0 to z1 (metres), capped at both ends."""
    def build():
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=radius_bottom,
            radius2=radius_top, depth=z1 - z0, matrix=Matrix.Translation((0, 0, (z0 + z1) / 2)))
    return build


def ring(major, minor, z_centre, segments=8, sides=4):
    """A handle: a low-poly torus standing upright in the XZ plane, centred on z_centre."""
    def build():
        rows = []
        for i in range(segments):
            t = 2 * math.pi * i / segments
            radial = (math.cos(t), 0.0, math.sin(t))
            centre = (major * radial[0], 0.0, z_centre + major * radial[2])
            row = []
            for j in range(sides):
                p = 2 * math.pi * j / sides
                offset = [minor * (math.cos(p) * radial[k] + math.sin(p) * (1.0 if k == 1 else 0.0)) for k in range(3)]
                row.append(bm.verts.new(tuple(centre[k] + offset[k] for k in range(3))))
            rows.append(row)
        for i in range(segments):
            a, b = rows[i], rows[(i + 1) % segments]
            for j in range(sides):
                bm.faces.new((a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]))
    return build


tag(IRON, prism(0.09, 0.09, 0.0, 0.03))        # base plate
tag(GLOW, prism(0.065, 0.065, 0.03, 0.2))      # glass chimney
tag(IRON, prism(0.095, 0.03, 0.2, 0.26))       # roof
tag(IRON, ring(0.04, 0.008, 0.3))              # carrying handle
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

mesh = bpy.data.meshes.new('lantern')
bm.to_mesh(mesh)
bm.free()
mesh.update()
obj = bpy.data.objects.new('lantern', mesh)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

for name, colour, metallic, roughness, emission in [
    ('lantern-iron', (0.08, 0.07, 0.06, 1), 0.6, 0.55, None),
    ('lantern-glow', (1.0, 0.62, 0.2, 1), 0.0, 0.3, (1.0, 0.55, 0.15, 1)),
]:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = colour
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = emission
        bsdf.inputs['Emission Strength'].default_value = 1.0
    obj.data.materials.append(material)

result = bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_animations=False, export_materials='EXPORT',
    export_cameras=False, export_lights=False)
if result != {'FINISHED'}:
    raise RuntimeError(f'export did not finish: {result}')

glb = out.read_bytes()
generator = json.loads(glb[20:20 + int.from_bytes(glb[12:16], 'little')])['asset']['generator']
manifest = dict(schema=1, author='Foundation Engine contributors', licence='GPL-3.0-only', source=SOURCE,
    sourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    tool=f'Blender {bpy.app.version_string}', generator=generator, artifact=out.name,
    sha256=hashlib.sha256(glb).hexdigest(), units='metres', up='+Y', pivot='base centre',
    origin='original: generated from scratch by this script; no third-party models, textures or scans',
    authoring='agent-assisted Blender Python, reviewed and committed by the contributors')
out.with_suffix('.provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
