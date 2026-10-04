"""Shared Workbench rendering for contact sheets (GPL-3.0-only). Background mode, no GPU features needed
beyond Workbench; nothing here touches the user's session."""
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

BACKGROUND = (0.11, 0.13, 0.17)
VIEWS = {'side': Vector((1, 0, 0.12)), 'front': Vector((0, -1, 0.15)),
         'three-quarter': Vector((0.75, -0.75, 0.35)), 'back': Vector((0, 1, 0.15)),
         'top': Vector((0.0001, -0.3, 1))}


def setup_render(tile):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = scene.render.resolution_y = tile
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'MATERIAL'
    shading.show_object_outline = True
    shading.show_shadows = True
    scene.display.shadow_shift = 0.1
    world = scene.world or bpy.data.worlds.new('sheet')
    scene.world = world
    world.color = BACKGROUND


def world_bounds(objects):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for obj in objects:
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in mesh.vertices]
        ev.to_mesh_clear()
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def add_floor(lo, hi, stripe=0.1):
    """A floor striped every `stripe` metres across the walking axis, so foot sliding shows on the sheet."""
    span = max(hi.x - lo.x, hi.y - lo.y) * 1.6 + 1.0
    mats = []
    for name, colour in (('floor-a', (0.24, 0.27, 0.32, 1)), ('floor-b', (0.3, 0.34, 0.4, 1))):
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = colour
        mats.append(mat)
    for i in range(int(span / stripe)):
        bpy.ops.mesh.primitive_plane_add(size=1)
        plane = bpy.context.object
        plane.name = 'sheet-floor'
        plane.scale = (span, stripe, 1)
        plane.location = (0, -span / 2 + stripe / 2 + i * stripe, -0.001)
        plane.data.materials.append(mats[i % 2])


def add_camera(lo, hi, view, margin=1.35):
    centre = (lo + hi) / 2
    centre.z += (hi.z - lo.z) * 0.08  # headroom for the label
    cam = bpy.data.objects.new('sheet-camera', bpy.data.cameras.new('sheet-camera'))
    bpy.context.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(hi.z - lo.z, hi.x - lo.x, hi.y - lo.y) * margin
    cam.location = centre + VIEWS[view].normalized() * 10
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def add_label(cam, text, highlight):
    curve = bpy.data.curves.new('label', 'FONT')
    curve.body = text
    curve.size = cam.data.ortho_scale * 0.075
    obj = bpy.data.objects.new('label', curve)
    bpy.context.collection.objects.link(obj)
    mat = bpy.data.materials.new('label')
    mat.diffuse_color = (1, 0.82, 0.25, 1) if highlight else (0.92, 0.94, 0.97, 1)
    curve.materials.append(mat)
    obj.parent = cam
    half = cam.data.ortho_scale / 2
    obj.location = (-half * 0.95, half * 0.86, -1)
    return obj


def _render(path):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path))
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(image.size[1], image.size[0], 4)
    bpy.data.images.remove(image)
    return pixels


def render_tile(path, label=None):
    """Render the scene; a label is rendered in a second flat-lit transparent pass and composited, so the
    text stays legible whatever the studio lighting does."""
    scene = bpy.context.scene
    if label is not None:
        label.hide_render = True
    pixels = _render(path)
    if label is None:
        return pixels
    hidden = [o for o in scene.objects if o is not label and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    label.hide_render = False
    scene.render.film_transparent, scene.display.shading.light = True, 'FLAT'
    text = _render(Path(path).with_suffix('.label.png'))
    scene.render.film_transparent, scene.display.shading.light = False, 'STUDIO'
    for o in hidden:
        o.hide_render = False
    alpha = text[..., 3:4]
    pixels[..., :3] = pixels[..., :3] * (1 - alpha) + text[..., :3] * alpha
    return pixels


def save_sheet(rows, columns, out):
    """rows: lists of tiles (top row first). Wraps each row at `columns` tiles."""
    lines = []
    for tiles in rows:
        for start in range(0, len(tiles), columns):
            chunk = tiles[start:start + columns]
            blank = np.ones_like(chunk[0])
            blank[..., :3] = chunk[0][-1, 0, :3]  # the rendered background colour
            lines.append(np.concatenate(chunk + [blank] * (columns - len(chunk)), axis=1))
    sheet = np.concatenate(lines[::-1], axis=0)  # Blender images are stored bottom row first
    image = bpy.data.images.new('sheet', sheet.shape[1], sheet.shape[0], alpha=True)
    image.pixels.foreach_set(sheet.ravel())
    out = Path(out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(out)
    image.file_format = 'PNG'
    image.save()
    return sheet.shape[1], sheet.shape[0]
