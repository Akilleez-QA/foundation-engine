"""Shared helpers for the pose-to-pose Blender scripts (GPL-3.0-only).

Run every script with: blender --background --factory-startup --python-exit-code 1 --python <script> -- <args>
Nothing here loads or saves the user's open Blender session; each script works on the file it is given.
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

SCHEMA = 1
EXPORT_TAG = 'pose_to_pose_export'  # custom property on the deform skeleton that is exported
CONTROL_TAG = 'pose_to_pose_control'  # custom property on an optional control rig (Rigify)
EASINGS = ('linear', 'ease-in', 'ease-out', 'ease-in-out')


class PipelineError(RuntimeError):
    """A clear, user-facing failure. Scripts exit non-zero (--python-exit-code 1)."""


def script_args():
    argv = sys.argv
    return argv[argv.index('--') + 1:] if '--' in argv else []


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        raise PipelineError(f'missing file: {path}') from None
    except json.JSONDecodeError as error:
        raise PipelineError(f'{path}: invalid JSON: {error}') from None


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def clear_scene():
    """Factory startup still has a cube, camera and light: remove every object and orphan data."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions,
                       bpy.data.cameras, bpy.data.lights):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1


def import_model(path):
    """Import a mesh source. Returns the new mesh objects. .blend files are appended, not opened."""
    path = Path(path).resolve()
    before = set(bpy.data.objects)
    suffix = path.suffix.lower()
    if not path.exists():
        raise PipelineError(f'missing model: {path}')
    if suffix in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == '.obj':
        bpy.ops.wm.obj_import(filepath=str(path))
    elif suffix == '.fbx':
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif suffix == '.blend':
        with bpy.data.libraries.load(str(path), link=False) as (src, dst):
            dst.objects = list(src.objects)
        for obj in dst.objects:
            if obj is not None:
                bpy.context.collection.objects.link(obj)
    else:
        raise PipelineError(f'unsupported model format {suffix}: use .blend, .glb, .gltf, .obj or .fbx')
    added = [o for o in bpy.data.objects if o not in before]
    meshes = sorted((o for o in added if o.type == 'MESH'), key=lambda o: o.name)
    if not meshes:
        raise PipelineError(f'{path} contains no mesh objects')
    # Imported armatures, lights and cameras are not part of the source mesh contract.
    for obj in added:
        if obj.type not in ('MESH',):
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in meshes:
        if obj.parent is not None and obj.parent.name not in bpy.data.objects:
            obj.parent = None
    return meshes


def select_only(objects, active=None):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or (objects[0] if objects else None)


# ---------------------------------------------------------------------------------------------
# Mirroring
# ---------------------------------------------------------------------------------------------
DEFAULT_MIRROR = {'pairs': [['.L', '.R']], 'axis': 'X'}


def mirror_name(name, pairs):
    for left, right in pairs:
        for a, b in ((left, right), (right, left)):
            # Suffix form: hand.L, or a side marker followed by a segment index: upper_arm.L.001
            pattern = re.escape(a) + r'(?=$|\.\d+$)'
            if re.search(pattern, name):
                return re.sub(pattern, b, name, count=1)
    return name


def mirror_transform(t):
    """Blender's flipped paste in local space, valid for X-symmetric rest poses with mirrored rolls."""
    loc, rot, scale = t
    return (Vector((-loc.x, loc.y, loc.z)), Quaternion((rot.w, rot.x, -rot.y, -rot.z)), scale.copy())


# ---------------------------------------------------------------------------------------------
# Poses
# ---------------------------------------------------------------------------------------------
IDENTITY = (Vector((0, 0, 0)), Quaternion((1, 0, 0, 0)), Vector((1, 1, 1)))


def _finite(values, where):
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
        raise PipelineError(f'{where}: values must be finite numbers')
    return values


def parse_bone_transform(raw, where):
    """{rotation:[w,x,y,z]} or {euler:[x,y,z] degrees, order}, optional location and scale."""
    unknown = set(raw) - {'rotation', 'euler', 'order', 'location', 'scale'}
    if unknown:
        raise PipelineError(f'{where}: unknown fields {sorted(unknown)}')
    if 'rotation' in raw and 'euler' in raw:
        raise PipelineError(f'{where}: give rotation (quaternion) or euler (degrees), not both')
    rot = Quaternion((1, 0, 0, 0))
    if 'rotation' in raw:
        q = _finite(raw['rotation'], where)
        if len(q) != 4 or math.sqrt(sum(v * v for v in q)) < 1e-6:
            raise PipelineError(f'{where}: rotation must be a non-zero [w, x, y, z] quaternion')
        rot = Quaternion(q).normalized()
    elif 'euler' in raw:
        e = _finite(raw['euler'], where)
        order = raw.get('order', 'XYZ')
        if len(e) != 3 or order not in ('XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'):
            raise PipelineError(f'{where}: euler is [x, y, z] degrees with an order such as XYZ')
        rot = Euler([math.radians(v) for v in e], order).to_quaternion()
    loc = Vector(_finite(raw.get('location', [0, 0, 0]), where))
    scale = raw.get('scale', [1, 1, 1])
    scale = [scale] * 3 if isinstance(scale, (int, float)) else scale
    scale = Vector(_finite(scale, where))
    if len(loc) != 3 or len(scale) != 3 or min(scale) <= 0:
        raise PipelineError(f'{where}: location is [x, y, z]; scale is positive (one number or [x, y, z])')
    return (loc, rot, scale)


def load_poses(paths, bone_names):
    """Merge pose files. Returns {name: {'bones': {bone: (loc, quat, scale)}, 'source': {...}, 'approval': {...}}}."""
    poses = {}
    for path in paths:
        data = read_json(path)
        if data.get('schema') != SCHEMA or not isinstance(data.get('poses'), dict):
            raise PipelineError(f'{path}: expected {{"schema": 1, "poses": {{...}}}}')
        for name, pose in data['poses'].items():
            if name in poses:
                raise PipelineError(f'pose {name!r} is defined twice ({path})')
            bones = {}
            for bone, raw in pose.get('bones', {}).items():
                if bone not in bone_names:
                    raise PipelineError(f'{path}: pose {name!r} names bone {bone!r}, which the skeleton lacks')
                bones[bone] = parse_bone_transform(raw, f'{path}: pose {name!r} bone {bone!r}')
            poses[name] = {'bones': bones, 'source': pose.get('source', {'kind': 'json'}),
                           'approval': pose.get('approval')}
    return poses


def resolve_pose(pose, bone_names, mirror=False, pairs=None, scale=None, noise=None, noise_key=''):
    """Full skeleton transform for one key: unlisted bones are at rest."""
    out = {b: tuple(c.copy() for c in pose['bones'].get(b, IDENTITY)) for b in bone_names}
    if mirror:
        flipped = {}
        for bone, t in out.items():
            target = mirror_name(bone, pairs)
            if target not in out:
                raise PipelineError(f'mirror of bone {bone!r} is {target!r}, which the skeleton lacks')
            flipped[target] = mirror_transform(t)
        out = flipped
    for bone, value in (scale or {}).items():
        if bone not in out:
            raise PipelineError(f'scale key names bone {bone!r}, which the skeleton lacks')
        s = [value] * 3 if isinstance(value, (int, float)) else value
        _finite(s, f'scale key {bone}')
        if len(s) != 3 or min(s) <= 0:
            raise PipelineError(f'scale key {bone!r}: positive number or [x, y, z]')
        loc, rot, base = out[bone]
        out[bone] = (loc, rot, Vector((base.x * s[0], base.y * s[1], base.z * s[2])))
    if noise:
        degrees = noise['degrees']
        for bone in sorted(out):
            if noise.get('bones') and bone not in noise['bones']:
                continue
            # Deterministic per (seed, key, bone): no global random state, so a re-export is identical.
            digest = hashlib.sha256(f"{noise['seed']}|{noise_key}|{bone}".encode()).digest()
            axis = Vector([(digest[i] / 255.0) * 2 - 1 for i in range(3)])
            if axis.length < 1e-6:
                continue
            angle = math.radians(degrees) * (digest[3] / 255.0)
            loc, rot, s = out[bone]
            out[bone] = (loc, rot @ Quaternion(axis.normalized(), angle), s)
    return out


# ---------------------------------------------------------------------------------------------
# Animation definition (animations.json). The JavaScript twin lives in ../definition.mjs; the
# validator compares both expansions through the sidecar clips manifest.
# ---------------------------------------------------------------------------------------------
def cubic_bezier(x1, y1, x2, y2):
    """CSS-style timing curve through (0,0), (x1,y1), (x2,y2), (1,1); solved for x by bisection."""
    def coord(t, a, b):
        return 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3

    def ease(u):
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if coord(mid, x1, x2) < u:
                lo = mid
            else:
                hi = mid
        return coord((lo + hi) / 2, y1, y2)
    return ease


def easing_function(spec, where):
    if spec in (None, 'linear'):
        return lambda u: u
    if spec == 'ease-in':
        return cubic_bezier(0.42, 0, 1, 1)
    if spec == 'ease-out':
        return cubic_bezier(0, 0, 0.58, 1)
    if spec == 'ease-in-out':
        return cubic_bezier(0.42, 0, 0.58, 1)
    if isinstance(spec, dict) and set(spec) == {'bezier'}:
        b = spec['bezier']
        if len(b) != 4 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in b) \
                or not (0 <= b[0] <= 1 and 0 <= b[2] <= 1):
            raise PipelineError(f'{where}: bezier is [x1, y1, x2, y2] with x1 and x2 in 0..1')
        return cubic_bezier(*b)
    raise PipelineError(f'{where}: easing is linear, ease-in, ease-out, ease-in-out or {{"bezier": [x1, y1, x2, y2]}}')


def segment_frames(key, fps, speed, where):
    has_frames, has_seconds = 'frames' in key, 'seconds' in key
    if has_frames == has_seconds:
        raise PipelineError(f'{where}: give exactly one of frames or seconds for the segment ending here')
    raw = key['frames'] if has_frames else key['seconds'] * fps
    if not isinstance(raw, (int, float)) or not math.isfinite(raw) or raw <= 0:
        raise PipelineError(f'{where}: segment length must be positive')
    frames = raw / speed
    rounded = round(frames)
    if rounded < 1:
        raise PipelineError(f'{where}: segment is shorter than one frame at {fps} fps and speed {speed}')
    if abs(frames - rounded) > 1e-6:
        raise PipelineError(f'{where}: segment is {frames:g} frames at {fps} fps and speed {speed}; '
                            'choose lengths that land on whole frames')
    return rounded


def same_key(a, b):
    return a['pose'] == b['pose'] and bool(a.get('mirror')) == bool(b.get('mirror'))


PLAYBACK = ('loop', 'once', 'hold')
CLIP_FIELDS = {'playback', 'fps', 'keys', 'repeatMirrored', 'speed', 'trim', 'events', 'controls', 'rootMotion',
               'derive', 'reference', 'note'}


def expand_clip(name, clip, fps, clips):
    """Return {keys: [{pose, mirror, frame, easing, ...}], frames, trim, loop, playback, events, controls}."""
    where = f'clip {name!r}'
    unknown = set(clip) - CLIP_FIELDS
    if unknown:
        raise PipelineError(f'{where}: unknown fields {sorted(unknown)}')
    if 'derive' in clip:
        base_name = clip['derive'].get('from')
        if base_name not in clips or 'derive' in clips[base_name]:
            raise PipelineError(f'{where}: derive.from must name a non-derived clip')
        merged = {k: v for k, v in clips[base_name].items() if k != 'rootMotion'}
        merged.update({k: v for k, v in clip.items() if k != 'derive'})
        return expand_clip(name, merged, fps, clips)
    if clip.get('fps', fps) != fps:
        raise PipelineError(f'{where}: fps {clip.get("fps")} differs from the file fps {fps}; one GLB is sampled '
                            'at one rate, so resample the clip (changing fps alone changes playback speed)')
    playback = clip.get('playback')
    if playback not in PLAYBACK:
        raise PipelineError(f'{where}: playback is loop, once or hold')
    loop = playback == 'loop'
    keys = clip.get('keys')
    if not isinstance(keys, list) or len(keys) < 2:
        raise PipelineError(f'{where}: keys must list at least two poses (start and end)')
    speed = clip.get('speed', 1)
    if not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.01 <= speed <= 100:
        raise PipelineError(f'{where}: speed must be between 0.01 and 100')
    for i, key in enumerate(keys):
        if not isinstance(key.get('pose'), str):
            raise PipelineError(f'{where} key {i}: pose must name a key pose')
        if i == 0 and ('frames' in key or 'seconds' in key):
            raise PipelineError(f'{where} key 0: the first key starts the clip and has no segment length')
        unknown = set(key) - {'pose', 'mirror', 'frames', 'seconds', 'easing', 'scale', 'noise'}
        if unknown:
            raise PipelineError(f'{where} key {i}: unknown fields {sorted(unknown)}')
    keys = [dict(k) for k in keys]
    if clip.get('repeatMirrored'):
        if not loop:
            raise PipelineError(f'{where}: repeatMirrored builds a closed loop; set playback: loop')
        last = keys[-1]
        if not (last['pose'] == keys[0]['pose'] and bool(last.get('mirror')) != bool(keys[0].get('mirror'))):
            raise PipelineError(f'{where}: with repeatMirrored the half cycle must end on the mirror of its first pose')
        keys = keys + [dict(k, mirror=not k.get('mirror')) for k in keys[1:]]
    if loop and not same_key(keys[0], keys[-1]):
        raise PipelineError(f'{where}: a loop must end on its first pose ({keys[0]["pose"]}); '
                            'the last pose of the chain is the first pose of the next cycle')
    frame = 0
    out = []
    for i, key in enumerate(keys):
        if i:
            frame += segment_frames(key, fps, speed, f'{where} key {i}')
        out.append({'pose': key['pose'], 'mirror': bool(key.get('mirror')), 'frame': frame,
                    'easing': easing_function(key.get('easing'), f'{where} key {i}'),
                    'easingSpec': key.get('easing', 'linear'), 'scale': key.get('scale'),
                    'noise': key.get('noise')})
    trim = clip.get('trim')
    if trim is not None:
        if loop:
            raise PipelineError(f'{where}: trim cuts a one-shot clip to game length; a loop cannot be trimmed')
        start, end = trim.get('start', 0), trim.get('end', frame)
        if not (isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= frame):
            raise PipelineError(f'{where}: trim needs whole frames 0 <= start < end <= {frame}')
    else:
        start, end = 0, frame
    duration = (end - start) / fps
    events = []
    for i, event in enumerate(clip.get('events', [])):
        if not isinstance(event.get('name'), str) or not re.fullmatch(r'[A-Za-z0-9_.\-]{1,64}', event['name']):
            raise PipelineError(f'{where} event {i}: name is 1-64 letters, digits, _, . or -')
        at = event.get('at')
        if not isinstance(at, (int, float)) or not math.isfinite(at) or not 0 <= at < duration:
            raise PipelineError(f'{where} event {event["name"]!r}: at is seconds in [0, {duration:g})')
        unknown = set(event) - {'name', 'at', 'floor'}
        if unknown:
            raise PipelineError(f'{where} event {event["name"]!r}: unknown fields {sorted(unknown)}')
        events.append({'name': event['name'], 'at': at, 'frame': round(at * fps), 'floor': event.get('floor', [])})
    if len({e['name'] for e in events}) != len(events):
        raise PipelineError(f'{where}: event names must be unique')
    controls = clip.get('controls', [])
    if not isinstance(controls, list) or not all(isinstance(c, str) for c in controls):
        raise PipelineError(f'{where}: controls lists the bones that must move in this clip')
    return {'keys': out, 'frames': frame, 'trim': [start, end], 'loop': loop, 'playback': playback,
            'events': events, 'controls': controls}


def load_definition(path):
    data = read_json(path)
    if data.get('schema') != SCHEMA:
        raise PipelineError(f'{path}: expected "schema": 1')
    fps = data.get('fps', 30)
    if not isinstance(fps, int) or not 1 <= fps <= 240:
        raise PipelineError(f'{path}: fps must be a whole number from 1 to 240')
    clips = data.get('clips')
    if not isinstance(clips, dict) or not clips:
        raise PipelineError(f'{path}: clips must name at least one clip')
    for name in clips:
        if not re.fullmatch(r'[A-Za-z0-9_\-]{1,64}', name):
            raise PipelineError(f'{path}: clip name {name!r} must be 1-64 letters, digits, _ or -')
    mirror = data.get('mirror', DEFAULT_MIRROR)
    return data, fps, clips, mirror


# ---------------------------------------------------------------------------------------------
# Review identities: the rig hash and the clip sample hash are what an approval freezes.
# ---------------------------------------------------------------------------------------------
def rig_sha256(arm, meshes):
    """Bones (names, parents, rest matrices) and every bound vertex with its weights."""
    h = hashlib.sha256()
    for b in arm.data.bones:
        h.update(f'{b.name}|{b.parent.name if b.parent else ""}|'.encode())
        h.update(','.join(f'{v:.5f}' for row in b.matrix_local for v in row).encode())
    for obj in sorted(meshes, key=lambda o: o.name):
        names = {g.index: g.name for g in obj.vertex_groups}
        h.update(f'#{obj.name}|{obj.parent_bone}|'.encode())
        h.update(','.join(f'{v:.5f}' for row in obj.matrix_world for v in row).encode())
        for v in obj.data.vertices:
            ws = sorted((names[g.group], round(g.weight, 4)) for g in v.groups if g.weight > 1e-6)
            h.update(f'{v.co.x:.5f},{v.co.y:.5f},{v.co.z:.5f}:{ws};'.encode())
    return h.hexdigest()


def bound_meshes(arm):
    return sorted((o for o in bpy.data.objects if o.type == 'MESH' and (o.parent == arm or any(
        m.type == 'ARMATURE' and m.object == arm for m in o.modifiers))), key=lambda o: o.name)


def quat_slerp(a, b, u):
    return a.slerp(b, u)


def armature_bone_names(arm):
    return [b.name for b in arm.data.bones]


def export_armature():
    found = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o.get(EXPORT_TAG)]
    if len(found) != 1:
        raise PipelineError(f'expected one exported skeleton tagged {EXPORT_TAG}; found {len(found)}. Run rig.py first.')
    return found[0]


def pose_basis_from_matrices(arm_eval):
    """Local (basis) transforms of every bone from evaluated armature-space pose matrices (includes constraints)."""
    out = {}
    for pb in arm_eval.pose.bones:
        bone = pb.bone
        if pb.parent:
            parent_rest = pb.parent.bone.matrix_local
            basis = (parent_rest.inverted() @ bone.matrix_local).inverted() @ pb.parent.matrix.inverted() @ pb.matrix
        else:
            basis = bone.matrix_local.inverted() @ pb.matrix
        loc, rot, scale = basis.decompose()
        out[pb.name] = (loc, rot.normalized(), scale)
    return out


def transform_to_json(t):
    """Compact bone-local transform; drops components within 0.01 degree, 0.05 mm or 0.01 % of rest."""
    loc, rot, scale = t
    out = {}
    if rot.w < 0:
        rot = Quaternion((-rot.w, -rot.x, -rot.y, -rot.z))
    if rot.angle > math.radians(0.01):
        out['rotation'] = [round(v, 6) for v in rot]
    if loc.length > 5e-5:
        out['location'] = [round(v, 6) for v in loc]
    if (scale - Vector((1, 1, 1))).length > 1e-4:
        out['scale'] = [round(v, 6) for v in scale]
    return out


def run(main):
    """Run a script body; print one clear error line and exit 1 on a PipelineError."""
    try:
        main()
    except PipelineError as error:
        print(f'pose-to-pose: ERROR: {error}', file=sys.stderr)
        sys.stderr.flush()
        raise SystemExit(1)
