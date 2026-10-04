"""Original GPL-3.0-only low-poly six-legged creature with a scorpion-like tail, built from separate parts.

Each moving part is its own low-poly object with a UV map, and every part of one kind shares one material:
the model-prep shape rigging works best with. Writes the model and the rigid skeleton.json that maps
each part to its bone.

blender --background --factory-startup --python-exit-code 1 --python build_bug.py -- \
  --out <bug.blend> --skeleton-out <skeleton.json>
"""
import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blender'))
from common import clear_scene, run, script_args, write_json  # noqa: E402

BODY_Z = 0.18
LEGS = {1: (-0.09, -0.08), 2: (0.02, 0.0), 3: (0.13, 0.09)}  # leg: (hip y, foot y offset)


def material(name, colour, roughness=0.55, metallic=0.0):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = colour
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat


def part(name, bm, mat, pivot):
    """Link a bmesh as an object whose origin is its bone's head, with a UV map and applied rotation/scale.
    Part objects are named '<bone>-part' so no glTF node shares a bone's name."""
    name = f'{name}-part'
    mesh = bpy.data.meshes.new(name)
    bmesh.ops.translate(bm, verts=bm.verts, vec=-pivot)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = pivot
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = False
    # Box-projected UVs, computed here so re-running the build gives identical bytes (Smart UV Project
    # varied between runs on some parts).
    uv = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(poly.normal[i]))
        a, b = [i for i in range(3) if i != axis]
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv = (co[a] * 2 + 0.5, co[b] * 2 + 0.5)
    return obj


def segment(a, b, r0, r1, sides=4):
    """A tapered low-poly prism from a to b."""
    bm = bmesh.new()
    axis = (b - a).normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u)
    rings = []
    for centre, r in ((a, r0), (b, r1)):
        ring = [bm.verts.new(centre + (u * math.cos(t) + v * math.sin(t)) * r)
                for t in (2 * math.pi * (k + 0.5) / sides for k in range(sides))]
        rings.append(ring)
    for k in range(sides):
        bm.faces.new((rings[0][k], rings[0][(k + 1) % sides], rings[1][(k + 1) % sides], rings[1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def blob(centre, size, segments=8, rings=5):
    """A low-poly ellipsoid built vertex by vertex: bmesh's UV sphere merges its poles in an order that
    varies between runs, and these parts must re-export byte for byte."""
    bm = bmesh.new()
    sx, sy, sz = size
    top = bm.verts.new(centre + Vector((0, 0, sz)))
    bottom = bm.verts.new(centre - Vector((0, 0, sz)))
    grid = []
    for r in range(1, rings):
        polar = math.pi * r / rings
        grid.append([bm.verts.new(centre + Vector((sx * math.sin(polar) * math.cos(a), sy * math.sin(polar) * math.sin(a),
                                                   sz * math.cos(polar))))
                     for a in (2 * math.pi * k / segments for k in range(segments))])
    for k in range(segments):
        n = (k + 1) % segments
        bm.faces.new((top, grid[0][n], grid[0][k]))
        for r in range(len(grid) - 1):
            bm.faces.new((grid[r][k], grid[r][n], grid[r + 1][n], grid[r + 1][k]))
        bm.faces.new((bottom, grid[-1][k], grid[-1][n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def cone(a, b, r, sides=6):
    bm = bmesh.new()
    axis = (b - a).normalized()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r, radius2=0, depth=(b - a).length,
                          matrix=Matrix.Translation((a + b) / 2) @ axis.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    return bm


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True)
    p.add_argument('--skeleton-out', required=True)
    args = p.parse_args(script_args())
    clear_scene()
    shell = material('shell', (0.18, 0.2, 0.16, 1), 0.45)
    team = material('team', (0.9, 0.35, 0.08, 1), 0.5)
    sting = material('stinger', (0.85, 0.82, 0.7, 1), 0.3)
    bones = [{'name': 'root', 'head': [0, 0, 0], 'tail': [0, 0.15, 0], 'parent': None, 'parts': []}]

    def bone(name, head, tail, parent, parts=()):
        bones.append({'name': name, 'head': [round(c, 5) for c in head], 'tail': [round(c, 5) for c in tail],
                      'parent': parent, 'parts': [f'{p}-part' for p in parts]})

    body_head, body_tail = Vector((0, 0.16, BODY_Z)), Vector((0, -0.16, BODY_Z))
    part('body', blob(Vector((0, 0, BODY_Z)), (0.11, 0.19, 0.065)), shell, body_head)
    # Team-colour convention: the back plate is its own material slot named "team".
    part('back-plate', blob(Vector((0, 0.02, BODY_Z + 0.055)), (0.075, 0.13, 0.025), 6, 4), team, body_head)
    bone('body', body_head, body_tail, 'root', ['body', 'back-plate'])
    head_a, head_b = Vector((0, -0.17, BODY_Z)), Vector((0, -0.29, BODY_Z - 0.01))
    part('head', blob(Vector((0, -0.23, BODY_Z)), (0.075, 0.07, 0.05), 6, 4), shell, head_a)
    bone('head', head_a, head_b, 'body', ['head'])
    tail = [Vector((0, 0.17, BODY_Z + 0.02)), Vector((0, 0.3, BODY_Z + 0.12)), Vector((0, 0.35, BODY_Z + 0.27)),
            Vector((0, 0.29, BODY_Z + 0.38)), Vector((0, 0.18, BODY_Z + 0.38))]
    parent = 'body'
    for i in range(3):
        name = f'tail.{i + 1}'
        part(name, segment(tail[i], tail[i + 1], 0.045 - 0.008 * i, 0.04 - 0.008 * i, 6), shell, tail[i])
        bone(name, tail[i], tail[i + 1], parent, [name])
        parent = name
    part('stinger', cone(tail[3], tail[4], 0.03), sting, tail[3])
    bone('stinger', tail[3], tail[4], 'tail.3', ['stinger'])
    for n, (hip_y, foot_dy) in LEGS.items():
        for side, sx in (('L', 1), ('R', -1)):
            hip = Vector((sx * 0.09, hip_y, BODY_Z))
            knee = Vector((sx * 0.22, hip_y + foot_dy * 0.5, BODY_Z + 0.09))
            foot = Vector((sx * 0.31, hip_y + foot_dy, 0.0))
            tip = foot + Vector((sx * 0.03, 0, 0))
            upper, lower = f'leg{n}_upper.{side}', f'leg{n}_lower.{side}'
            part(upper, segment(hip, knee, 0.022, 0.018), shell, hip)
            part(lower, segment(knee, foot + Vector((0, 0, 0.012)), 0.018, 0.008), shell, knee)
            bone(upper, hip, knee, 'body', [upper])
            bone(lower, knee, foot, upper, [lower])
            bone(f'leg{n}_tip.{side}', foot, tip, lower)  # contact point: no geometry
    bpy.context.view_layer.update()  # world matrices of the new parts
    for obj in bpy.data.objects:  # flat on the floor: nothing below z = 0
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            if w.z < 0:
                v.co.z -= w.z
    write_json(args.skeleton_out, {'schema': 1, 'bones': bones})
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.out).resolve()), compress=False)
    parts = [o for o in bpy.data.objects if o.type == 'MESH']
    tris = sum(len(p.vertices) - 2 for o in parts for p in o.data.polygons)
    print(f'bug: {len(parts)} parts, {tris} triangles, {len(bones)} bones -> {args.out}')


run(main)
