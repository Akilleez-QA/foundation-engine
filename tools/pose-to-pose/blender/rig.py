"""Rig step (GPL-3.0-only): pre-rig check, skeleton, binding and weight validation.

Humanoid:  Rigify basic metarig fitted to landmarks (or bounds), generated control rig, then a clean
           deform-only skeleton (GameRig is used when installed; otherwise a deform-only flatten).
           Bound with automatic weights (bone heat); falls back to a voxel-remeshed proxy plus a Data
           Transfer modifier. Bad weights fail the step; they are never shipped silently.
Rigid:     every part object is parented to one bone of a skeleton.json (mechanical models, creatures
           built from separate rigid parts). --rigid-bind merge joins the parts into one skinned mesh
           with 100% single-bone weights instead (one draw call).

blender --background --factory-startup --python-exit-code 1 --python rig.py -- \
  --input model.blend --kind humanoid --landmarks landmarks.json --name pose-robot \
  --out rigged.blend --report rig-report.json
"""
import argparse
import sys
from pathlib import Path

import addon_utils
import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (CONTROL_TAG, EXPORT_TAG, PipelineError, clear_scene, import_model, read_json,  # noqa: E402
                    rig_sha256, run, script_args, select_only, write_json)

DENSE_TRIANGLES = 20000


# ---------------------------------------------------------------------------------------------
# Pre-rig check
# ---------------------------------------------------------------------------------------------
def prerig_check(meshes, kind):
    parts, warnings, errors = [], [], []
    total = 0
    for obj in meshes:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        tris = sum(len(f.verts) - 2 for f in bm.faces)
        non_manifold = sum(1 for e in bm.edges if len(e.link_faces) not in (2,) and e.link_faces)
        boundary = sum(1 for e in bm.edges if len(e.link_faces) == 1)
        loose_verts = sum(1 for v in bm.verts if not v.link_edges)
        loose_edges = sum(1 for e in bm.edges if not e.link_faces)
        bad = sum(1 for v in bm.verts if not all(abs(c) < 1e6 for c in v.co))
        bm.free()
        rot_applied = all(abs(v) < 1e-6 for v in obj.rotation_euler) and obj.rotation_mode in ('XYZ', 'QUATERNION') \
            and (obj.rotation_mode != 'QUATERNION' or abs(obj.rotation_quaternion.w - 1) < 1e-6)
        scale_applied = all(abs(v - 1) < 1e-6 for v in obj.scale)
        part = {'name': obj.name, 'triangles': tris, 'nonManifoldEdges': non_manifold - boundary,
                'boundaryEdges': boundary, 'looseVertices': loose_verts, 'looseEdges': loose_edges,
                'location': [round(v, 6) for v in obj.location], 'rotationApplied': rot_applied,
                'scaleApplied': scale_applied, 'uvLayers': len(obj.data.uv_layers),
                'materials': [m.name for m in obj.data.materials if m]}
        parts.append(part)
        total += tris
        if bad:
            errors.append(f'{obj.name}: {bad} vertices have non-finite or huge coordinates')
        if any(v < 0 for v in obj.scale):
            errors.append(f'{obj.name}: negative scale flips normals and skinning; apply or fix it first')
        elif not scale_applied or not rot_applied:
            warnings.append(f'{obj.name}: rotation/scale are not applied (Ctrl+A > All Transforms); they are baked now')
        if loose_verts or loose_edges:
            warnings.append(f'{obj.name}: {loose_verts} loose vertices and {loose_edges} loose edges (delete loose geometry)')
        if part['nonManifoldEdges']:
            warnings.append(f'{obj.name}: {part["nonManifoldEdges"]} non-manifold edges; bone heat may fail on them')
        if not part['uvLayers']:
            warnings.append(f'{obj.name}: no UV map; a packed texture atlas needs clean UVs')
    if len(meshes) == 1 and total > DENSE_TRIANGLES:
        warnings.append(f'one merged mesh with {total} triangles: rigging and weights work far better on separate '
                        'low-poly parts (legs, claws, tail) with one packed texture atlas')
    if kind == 'rigid' and len(meshes) == 1:
        warnings.append('a rigid rig needs one object per moving part; a single object can only follow one bone')
    report = {'objects': len(meshes), 'triangles': total, 'parts': parts, 'warnings': warnings, 'errors': errors}
    if errors:
        raise PipelineError('pre-rig check failed: ' + '; '.join(errors))
    return report


def apply_transforms(meshes):
    select_only(meshes)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


# ---------------------------------------------------------------------------------------------
# Humanoid: Rigify metarig fitting
# ---------------------------------------------------------------------------------------------
def bounds(meshes):
    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def estimate_landmarks(meshes):
    """Proportional landmarks from bounds when no landmarks.json is given (A/T-pose, facing -Y)."""
    lo, hi = bounds(meshes)
    h = hi.z - lo.z
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    span = (hi.x - lo.x) / 2
    z = lambda f: lo.z + h * f  # noqa: E731
    return {
        'hips': [cx, cy, z(0.56)], 'neck': [cx, cy, z(0.83)], 'head': [cx, cy, z(0.875)],
        'headTop': [cx, cy, hi.z], 'shoulder.L': [cx + 0.04 * h, cy, z(0.81)],
        'upperArm.L': [cx + 0.12 * h, cy, z(0.80)], 'elbow.L': [cx + 0.12 * h + (span - 0.12 * h) * 0.45, cy + 0.01, z(0.75)],
        'wrist.L': [cx + 0.12 * h + (span - 0.12 * h) * 0.85, cy, z(0.69)], 'handTip.L': [cx + span, cy, z(0.66)],
        'hip.L': [cx + 0.06 * h, cy, z(0.55)], 'knee.L': [cx + 0.06 * h, cy - 0.02 * h, z(0.30)],
        'ankle.L': [cx + 0.06 * h, cy, z(0.06)], 'toe.L': [cx + 0.06 * h, lo.y, z(0.01)],
        'heel.L': [cx + 0.06 * h, cy + 0.04 * h, lo.z],
    }


def fit_metarig(landmarks):
    lm = {k: Vector(v) for k, v in landmarks.items() if isinstance(v, list)}
    for key in list(lm):
        if key.endswith('.L'):
            lm[key[:-2] + '.R'] = Vector((-lm[key].x, lm[key].y, lm[key].z))
    required = ['hips', 'neck', 'head', 'headTop', 'shoulder.L', 'upperArm.L', 'elbow.L', 'wrist.L', 'handTip.L',
                'hip.L', 'knee.L', 'ankle.L', 'toe.L', 'heel.L']
    missing = [k for k in required if k not in lm]
    if missing:
        raise PipelineError(f'landmarks missing: {missing}')
    bpy.ops.object.armature_basic_human_metarig_add()
    meta = bpy.context.object
    bpy.ops.object.mode_set(mode='EDIT')
    eb = meta.data.edit_bones
    for name in ('breast.L', 'breast.R', 'pelvis.L', 'pelvis.R'):
        eb.remove(eb[name])
    torso = [lm['hips'].lerp(lm['neck'], f) for f in (0, 0.22, 0.45, 0.68, 1.0)]
    chain = {'spine': (torso[0], torso[1]), 'spine.001': (torso[1], torso[2]), 'spine.002': (torso[2], torso[3]),
             'spine.003': (torso[3], torso[4]), 'spine.004': (lm['neck'], lm['neck'].lerp(lm['head'], 0.5)),
             'spine.005': (lm['neck'].lerp(lm['head'], 0.5), lm['head']), 'spine.006': (lm['head'], lm['headTop'])}
    for s in ('L', 'R'):
        ball = lm[f'toe.{s}'].lerp(lm[f'ankle.{s}'], 0.35)
        ball.z = max(lm[f'toe.{s}'].z, 0.02)
        heel = lm[f'heel.{s}']
        half = 0.04 if s == 'L' else -0.04
        chain.update({
            f'shoulder.{s}': (lm[f'shoulder.{s}'], lm[f'upperArm.{s}']),
            f'upper_arm.{s}': (lm[f'upperArm.{s}'], lm[f'elbow.{s}']),
            f'forearm.{s}': (lm[f'elbow.{s}'], lm[f'wrist.{s}']),
            f'hand.{s}': (lm[f'wrist.{s}'], lm[f'handTip.{s}']),
            f'thigh.{s}': (lm[f'hip.{s}'], lm[f'knee.{s}']),
            f'shin.{s}': (lm[f'knee.{s}'], lm[f'ankle.{s}']),
            f'foot.{s}': (lm[f'ankle.{s}'], ball),
            f'toe.{s}': (ball, lm[f'toe.{s}']),
            f'heel.02.{s}': (heel - Vector((half, 0, 0)), heel + Vector((half, 0, 0))),
        })
    connected = {name: eb[name].use_connect for name in chain}
    for name, (head, tail) in chain.items():
        bone = eb[name]
        bone.use_connect = False
        bone.head, bone.tail = head, tail
    for name, was in connected.items():
        bone = eb[name]
        if was and (bone.parent.tail - bone.head).length > 1e-5:
            raise PipelineError(f'landmarks break the connected metarig chain at {name}')
        bone.use_connect = was
    bpy.ops.armature.select_all(action='SELECT')
    # Rigify derives limb rotation axes from the bends; rolls only need to be consistent and mirrored.
    bpy.ops.armature.calculate_roll(type='GLOBAL_POS_Y')
    bpy.ops.object.mode_set(mode='POSE')
    for name in ('upper_arm.L', 'upper_arm.R', 'thigh.L', 'thigh.R'):
        meta.pose.bones[name].rigify_parameters.segments = 1  # one deform bone per limb segment for games
    bpy.ops.object.mode_set(mode='OBJECT')
    return meta


def generate_rigify(meta):
    before = set(bpy.data.objects)
    select_only([meta], meta)
    result = bpy.ops.pose.rigify_generate()
    if result != {'FINISHED'}:
        raise PipelineError(f'Rigify generation failed: {result}')
    rigs = [o for o in bpy.data.objects if o not in before and o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise PipelineError('Rigify did not produce exactly one rig')
    rig = rigs[0]
    rig[CONTROL_TAG] = True
    return rig


def gamerig_available():
    return any(m.__name__.lower().endswith('gamerig') and addon_utils.check(m.__name__)[1]
               for m in addon_utils.modules())


def flatten_deform(rig, name):
    """Deform-only game skeleton: every DEF- bone (prefix dropped) under a root, parented to the nearest DEF
    ancestor. Each bone follows the control rig with Copy Transforms so the user can pose the Rigify controls."""
    bpy.ops.object.mode_set(mode='OBJECT')
    select_only([rig], rig)
    bpy.ops.object.mode_set(mode='EDIT')
    src = {}
    ebs = rig.data.edit_bones

    def deform_parent(b):
        # The ORG hierarchy mirrors the metarig: DEF-X follows DEF-<first ORG ancestor of ORG-X with a DEF twin>.
        org = ebs.get('ORG-' + b.name[4:])
        node = org.parent if org else None
        while node is not None:
            if node.name.startswith('ORG-') and ('DEF-' + node.name[4:]) in ebs:
                return 'DEF-' + node.name[4:]
            node = node.parent
        node = b.parent  # segment bones without an ORG twin: nearest DEF ancestor
        while node is not None and not node.name.startswith('DEF-'):
            node = node.parent
        return node.name if node else None

    for b in ebs:
        if b.name.startswith('DEF-'):
            src[b.name] = (b.head.copy(), b.tail.copy(), b.roll, deform_parent(b))
    bpy.ops.object.mode_set(mode='OBJECT')
    if not src:
        raise PipelineError('the generated rig has no DEF- bones')
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(arm)
    select_only([arm], arm)
    bpy.ops.object.mode_set(mode='EDIT')
    root = data.edit_bones.new('root')
    root.head, root.tail, root.roll = Vector((0, 0, 0)), Vector((0, 0.3, 0)), 0
    for def_name, (head, tail, roll, _) in src.items():
        bone = data.edit_bones.new(def_name[4:])
        bone.head, bone.tail, bone.roll = head, tail, roll
    for def_name, (head, _, _, parent) in src.items():
        bone = data.edit_bones[def_name[4:]]
        bone.parent = data.edit_bones[parent[4:]] if parent else root
        bone.use_connect = bool(parent) and (bone.parent.tail - head).length < 1e-5
    for bone in data.edit_bones:
        bone.bbone_segments = 1
        bone.use_deform = True
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        con = pb.constraints.new('COPY_TRANSFORMS')
        con.target, con.subtarget = rig, ('DEF-' + pb.name) if pb.name != 'root' else 'root'
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


# ---------------------------------------------------------------------------------------------
# Binding and weight validation
# ---------------------------------------------------------------------------------------------
def segment_distance(p, head, tail):
    closest, f = intersect_point_line(p, head, tail)
    if f < 0:
        closest = head
    elif f > 1:
        closest = tail
    return (p - closest).length


def weight_report(meshes, arm, height, max_influences):
    bones = {b.name: (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local)
             for b in arm.data.bones if b.use_deform}
    stats = {'vertices': 0, 'unweighted': 0, 'overInfluence': 0, 'unnormalised': 0, 'farDominant': 0,
             'wrongSide': 0, 'emptyBones': []}
    used = set()
    side_tol = 0.06 * height
    for obj in meshes:
        names = {g.index: g.name for g in obj.vertex_groups}
        for v in obj.data.vertices:
            stats['vertices'] += 1
            ws = [(names[g.group], g.weight) for g in v.groups if g.weight > 1e-6 and names[g.group] in bones]
            if not ws:
                stats['unweighted'] += 1
                continue
            used.update(b for b, _ in ws)
            if len(ws) > max_influences:
                stats['overInfluence'] += 1
            if abs(sum(w for _, w in ws) - 1) > 1e-3:
                stats['unnormalised'] += 1
            bone = max(ws, key=lambda x: x[1])[0]
            p = obj.matrix_world @ v.co
            if segment_distance(p, *bones[bone]) > 0.25 * height:
                stats['farDominant'] += 1
            if (bone.endswith('.L') and p.x < -side_tol) or (bone.endswith('.R') and p.x > side_tol):
                stats['wrongSide'] += 1
    stats['emptyBones'] = sorted(b for b in bones if b not in used and b != 'root')
    problems = []
    if stats['unweighted']:
        problems.append(f"{stats['unweighted']} vertices have no weights")
    if stats['overInfluence']:
        problems.append(f"{stats['overInfluence']} vertices exceed {max_influences} influences")
    if stats['unnormalised']:
        problems.append(f"{stats['unnormalised']} vertices have weights that do not sum to 1")
    if stats['farDominant']:
        problems.append(f"{stats['farDominant']} vertices follow a bone more than a quarter of the height away")
    if stats['wrongSide']:
        problems.append(f"{stats['wrongSide']} vertices follow a bone on the opposite side")
    limbs = [b for b in stats['emptyBones'] if any(k in b for k in ('arm', 'thigh', 'shin', 'spine', 'hand', 'foot'))]
    if limbs:
        problems.append(f'limb bones received no weights: {limbs}')
    return stats, problems


def clean_weights(meshes, max_influences):
    for obj in meshes:
        select_only([obj], obj)
        if not obj.vertex_groups:
            continue
        bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=max_influences)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)


def bind_bone_heat(meshes, arm):
    for obj in meshes:
        obj.vertex_groups.clear()
    root = arm.data.bones['root']
    root.use_deform = False  # the root carries motion, never vertices
    select_only(meshes + [arm], arm)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    root.use_deform = True


def bind_voxel_proxy(meshes, arm, height):
    """Bone heat on a watertight voxel remesh of all parts, then nearest-face weight transfer back."""
    copies = []
    for obj in meshes:
        copy = obj.copy()
        copy.data = obj.data.copy()
        copy.modifiers.clear()
        copy.vertex_groups.clear()
        copy.parent = None
        bpy.context.collection.objects.link(copy)
        copies.append(copy)
    select_only(copies, copies[0])
    if len(copies) > 1:
        bpy.ops.object.join()
    proxy = bpy.context.object
    proxy.name = 'weight-proxy'
    remesh = proxy.modifiers.new('voxel', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = height / 80
    select_only([proxy], proxy)
    bpy.ops.object.modifier_apply(modifier='voxel')
    bind_bone_heat([proxy], arm)
    for obj in meshes:
        obj.vertex_groups.clear()
        for group in proxy.vertex_groups:
            obj.vertex_groups.new(name=group.name)
        mod = obj.modifiers.new('weights', 'DATA_TRANSFER')
        mod.object = proxy
        mod.use_vert_data = True
        mod.data_types_verts = {'VGROUP_WEIGHTS'}
        mod.vert_mapping = 'POLYINTERP_NEAREST'
        mod.layers_vgroup_select_src = 'ALL'
        mod.layers_vgroup_select_dst = 'NAME'
        select_only([obj], obj)
        while obj.modifiers[0].name != 'weights':
            bpy.ops.object.modifier_move_up(modifier='weights')
        bpy.ops.object.modifier_apply(modifier='weights')
    bpy.data.objects.remove(proxy, do_unlink=True)


def bind_humanoid(meshes, arm, height, max_influences, force_fallback):
    attempts = []
    if not force_fallback:
        bind_bone_heat(meshes, arm)
        clean_weights(meshes, max_influences)
        stats, problems = weight_report(meshes, arm, height, max_influences)
        attempts.append({'method': 'bone-heat', 'stats': stats, 'problems': problems})
        if not problems:
            return attempts
        print('pose-to-pose: bone heat weights rejected (' + '; '.join(problems) + '); trying the voxel proxy')
    bind_voxel_proxy(meshes, arm, height)
    clean_weights(meshes, max_influences)
    stats, problems = weight_report(meshes, arm, height, max_influences)
    attempts.append({'method': 'voxel-proxy-data-transfer', 'stats': stats, 'problems': problems})
    for obj in meshes:
        if not any(m.type == 'ARMATURE' for m in obj.modifiers):
            mod = obj.modifiers.new('armature', 'ARMATURE')
            mod.object = arm
        obj.parent = arm
        obj.matrix_parent_inverse = arm.matrix_world.inverted()
    return attempts


# ---------------------------------------------------------------------------------------------
# Rigid
# ---------------------------------------------------------------------------------------------
def build_rigid(meshes, skeleton_path, name, mode):
    spec = read_json(skeleton_path)
    bones = spec.get('bones')
    if spec.get('schema') != 1 or not isinstance(bones, list) or not bones:
        raise PipelineError(f'{skeleton_path}: expected {{"schema": 1, "bones": [...]}}')
    by_part = {}
    for b in bones:
        for part in b.get('parts', []):
            if part in by_part:
                raise PipelineError(f'part {part!r} is assigned to both {by_part[part]!r} and {b["name"]!r}')
            by_part[part] = b['name']
    names = {o.name for o in meshes}
    unassigned = sorted(names - set(by_part))
    unknown = sorted(set(by_part) - names)
    if unassigned or unknown:
        raise PipelineError(f'rigid parts must map one-to-one to bones: unassigned {unassigned}, unknown {unknown}')
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(arm)
    select_only([arm], arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for b in bones:
        bone = data.edit_bones.new(b['name'])
        bone.head, bone.tail, bone.roll = Vector(b['head']), Vector(b['tail']), b.get('roll', 0)
        bone.use_deform = True
    for b in bones:
        if b.get('parent'):
            if b['parent'] not in data.edit_bones:
                raise PipelineError(f'bone {b["name"]!r} has unknown parent {b["parent"]!r}')
            data.edit_bones[b['name']].parent = data.edit_bones[b['parent']]
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    bpy.ops.object.mode_set(mode='OBJECT')
    if mode == 'parent':
        for obj in meshes:
            select_only([obj, arm], arm)
            arm.data.bones.active = arm.data.bones[by_part[obj.name]]
            bpy.ops.object.parent_set(type='BONE', keep_transform=True)
        return arm, meshes
    # merge: one skinned mesh, each vertex 100% on its part's bone.
    for obj in meshes:
        group = obj.vertex_groups.new(name=by_part[obj.name])
        group.add(range(len(obj.data.vertices)), 1.0, 'REPLACE')
    select_only(meshes, meshes[0])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = name + '-mesh'
    mod = merged.modifiers.new('armature', 'ARMATURE')
    mod.object = arm
    merged.parent = arm
    return arm, [merged]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--kind', choices=['humanoid', 'rigid'], required=True)
    p.add_argument('--name', required=True, help='skeleton/armature name, also the exported scene root')
    p.add_argument('--landmarks', help='humanoid landmarks.json; estimated from bounds when omitted')
    p.add_argument('--skeleton', help='rigid skeleton.json: bones with head, tail, parent and parts')
    p.add_argument('--rigid-bind', choices=['parent', 'merge'], default='parent')
    p.add_argument('--max-influences', type=int, default=4)
    p.add_argument('--max-bones', type=int, default=64)
    p.add_argument('--force-fallback', action='store_true', help='skip bone heat and use the voxel proxy')
    p.add_argument('--out', required=True)
    p.add_argument('--report', required=True)
    args = p.parse_args(script_args())
    clear_scene()
    meshes = import_model(args.input)
    report = {'schema': 1, 'input': Path(args.input).name, 'kind': args.kind, 'blender': bpy.app.version_string}
    report['prerig'] = prerig_check(meshes, args.kind)
    for w in report['prerig']['warnings']:
        print('pose-to-pose: WARNING: ' + w)
    apply_transforms(meshes)
    for obj in meshes:
        if obj.name == args.name:
            obj.name = args.name + '-mesh'  # the skeleton takes the asset name; objects share one namespace
    if args.kind == 'humanoid':
        addon_utils.enable('rigify', default_set=True)
        landmarks = read_json(args.landmarks) if args.landmarks else estimate_landmarks(meshes)
        report['landmarks'] = 'file' if args.landmarks else 'estimated-from-bounds'
        meta = fit_metarig(landmarks)
        rig = generate_rigify(meta)
        report['controlRig'] = rig.name
        report['deformExport'] = 'gamerig' if gamerig_available() else 'deform-only-flatten'
        if report['deformExport'] == 'gamerig':
            print('pose-to-pose: GameRig is installed but not yet driven by this script; using the deform-only flatten')
            report['deformExport'] = 'deform-only-flatten'
        arm = flatten_deform(rig, args.name)
        meta.hide_set(True)
        meta.hide_render = True
        lo, hi = bounds(meshes)
        report['weights'] = bind_humanoid(meshes, arm, hi.z - lo.z, args.max_influences, args.force_fallback)
        final = report['weights'][-1]
        if final['problems']:
            write_json(args.report, dict(report, passed=False))
            raise PipelineError('weights failed after every method: ' + '; '.join(final['problems']) +
                                f' (details in {args.report})')
    else:
        if not args.skeleton:
            raise PipelineError('--kind rigid needs --skeleton skeleton.json')
        arm, meshes = build_rigid(meshes, args.skeleton, args.name, args.rigid_bind)
        report['weights'] = [{'method': f'rigid-{args.rigid_bind}', 'problems': []}]
    arm[EXPORT_TAG] = True
    bones = len(arm.data.bones)
    report['bones'] = bones
    if bones > args.max_bones:
        raise PipelineError(f'skeleton has {bones} bones; the limit is {args.max_bones}')
    report['meshes'] = [o.name for o in meshes]
    report['rigSha256'] = rig_sha256(arm, meshes)
    report['passed'] = True
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=False)
    write_json(args.report, report)
    print(f'pose-to-pose: rigged {args.name}: {bones} bones, {report["weights"][-1]["method"]} -> {out}')


run(main)
