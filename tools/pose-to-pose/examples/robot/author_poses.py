"""Agent-authored key poses for the robot example (GPL-3.0-only).

No user was present to pose this example in Blender, so the agent wrote its key poses as code: it places
the feet and hips for each walk pose, solves each leg with a planar two-bone solve, and converts
armature-space rotations into the bone-local rotations of poses.json. A creator normally poses in
Blender and runs capture_poses.py instead; this script exists only so the example is reproducible.

blender --background --factory-startup --python-exit-code 1 --python author_poses.py -- \
  --rigged robot-rigged.blend --out poses.json
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blender'))
from common import export_armature, run, script_args, transform_to_json, write_json  # noqa: E402

STRIDE = 1.0  # metres per cycle (two steps)
CYCLE = 32  # frames per cycle; must agree with animations.json
V = STRIDE / CYCLE  # in-place stance foot speed, metres per frame (backwards, +Y)


def rx(deg):
    return Quaternion((1, 0, 0), math.radians(deg))


def ry(deg):
    return Quaternion((0, 1, 0), math.radians(deg))


def rz(deg):
    return Quaternion((0, 0, 1), math.radians(deg))


class Skeleton:
    def __init__(self, arm):
        self.arm = arm
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}
        self.parent = {b.name: b.parent.name if b.parent else None for b in arm.data.bones}
        self.head = {b.name: b.head_local.copy() for b in arm.data.bones}
        self.tail = {b.name: b.tail_local.copy() for b in arm.data.bones}

    def local(self, world, hips=None, locations=None):
        """world: bone -> armature-space delta rotation (applied to the rest orientation)."""
        out = {}
        for bone in self.rest:
            parent = self.parent[bone]
            wp = Quaternion()
            while parent is not None:
                if parent in world:
                    wp = world[parent]
                    break
                parent = self.parent[parent]
            w = world.get(bone, wp)  # an unlisted bone follows its parent (identity local rotation)
            q = self.rest[bone].inverted() @ wp.inverted() @ w @ self.rest[bone]
            loc = Vector((0, 0, 0))
            offset = hips if bone == 'spine' and hips is not None else (locations or {}).get(bone)
            if offset is not None:
                # Bone-local translation from an armature-space offset (the parent is at rest orientation).
                loc = self.rest[bone].inverted() @ offset
            out[bone] = (loc, q.normalized(), Vector((1, 1, 1)))
        return {b: transform_to_json(t) for b, t in out.items() if transform_to_json(t)}

    def plane(self, bone):
        h, t = self.head[bone], self.tail[bone]
        return math.atan2(t.z - h.z, t.y - h.y), (t - h).length


def solve_leg(sk, side, hip_z, foot):
    """Planar (Y forward-back, Z up) two-bone leg. foot: ('flat', ankle_y) | ('heel', heel_y, pitch)
    | ('ball', ball_y, pitch[, lift]) | ('swing', ankle_y, ankle_z, pitch). Pitch degrees: + toes down."""
    s = side
    ankle_rest = sk.head[f'foot.{s}']
    ball_rest = sk.tail[f'foot.{s}']
    heel_rest = Vector((ankle_rest.x, ankle_rest.y + 0.05, 0.0))
    kind = foot[0]

    def rotate(v, deg):
        a = math.radians(deg)
        return Vector((v.x, v.y * math.cos(a) - v.z * math.sin(a), v.y * math.sin(a) + v.z * math.cos(a)))
    if kind == 'flat':
        ankle, pitch = Vector((ankle_rest.x, foot[1], ankle_rest.z)), 0.0
    elif kind == 'heel':
        pitch = foot[2]
        ankle = Vector((ankle_rest.x, foot[1], 0)) + rotate(ankle_rest - heel_rest, pitch)
    elif kind == 'ball':
        pitch, lift = foot[2], (foot[3] if len(foot) > 3 else 0.0)
        ankle = Vector((ankle_rest.x, foot[1], ball_rest.z + lift)) + rotate(ankle_rest - ball_rest, pitch)
    else:
        ankle, pitch = Vector((ankle_rest.x, foot[1], foot[2])), foot[3]
    hip = Vector((sk.head[f'thigh.{s}'].x, 0.0, hip_z))
    phi_t0, l1 = sk.plane(f'thigh.{s}')
    phi_s0, l2 = sk.plane(f'shin.{s}')
    dy, dz = ankle.y - hip.y, ankle.z - hip.z
    d = min(math.hypot(dy, dz), (l1 + l2) * 0.999)
    a = math.acos(max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
    phi = math.atan2(dz, dy)
    phi_t = phi - a  # knee forward (-Y)
    knee = (hip.y + l1 * math.cos(phi_t), hip.z + l1 * math.sin(phi_t))
    phi_s = math.atan2(ankle.z - knee[1], ankle.y - knee[0])
    deg = math.degrees
    return {f'thigh.{s}': rx(deg(phi_t - phi_t0)), f'shin.{s}': rx(deg(phi_s - phi_s0)),
            f'foot.{s}': rx(pitch), f'toe.{s}': Quaternion()}  # toes stay level: on the ground when the heel lifts


def arms(swing_l, swing_r, lower=55, bend=12):
    """Arms down from the A-pose, then swung (+ backwards, - forwards) with a slight elbow bend."""
    return {'upper_arm.L': rx(swing_l) @ ry(lower), 'forearm.L': rx(swing_l - bend) @ ry(lower),
            'hand.L': rx(swing_l - bend) @ ry(lower),
            'upper_arm.R': rx(swing_r) @ ry(-lower), 'forearm.R': rx(swing_r - bend) @ ry(-lower),
            'hand.R': rx(swing_r - bend) @ ry(-lower)}


def walk_pose(sk, hip_z, left, right, swing):
    world = {}
    world.update(solve_leg(sk, 'L', hip_z, left))
    world.update(solve_leg(sk, 'R', hip_z, right))
    world.update(arms(swing, -swing))
    return sk.local(world, hips=Vector((0, 0, hip_z - sk.head['thigh.L'].z)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--rigged', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--test-out', required=True, help='rig test poses for test_poses.py')
    args = p.parse_args(script_args())
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.rigged).resolve()))
    sk = Skeleton(export_armature())
    y0 = -0.26  # front ankle (flat-foot equivalent) at contact
    ball = sk.tail['foot.L'].y - sk.head['foot.L'].y  # ball offset from the ankle (negative: forward)
    heel = 0.05
    back_ball = y0 + 16 * V + ball  # where the stance ball is at the next (mirrored) contact
    poses = {
        # Left heel strikes in front; the right foot is on its ball behind, heel raised.
        'walk_contact': walk_pose(sk, 0.848, ('heel', y0 + heel, -6), ('ball', back_ball, 28), 18),
        # Weight accepted: lowest hips, left foot flat; the right toe lifts straight off the ground.
        'walk_down': walk_pose(sk, 0.832, ('flat', y0 + 3 * V), ('ball', back_ball + 3 * V, 55, 0.04), 14),
        # Left leg under the body; right foot passes, lifted, knee bent.
        'walk_passing': walk_pose(sk, 0.872, ('flat', y0 + 8 * V), ('swing', 0.02, 0.19, 15), 0),
        # Highest hips; left heel starts to lift; right leg reaches forward.
        'walk_up': walk_pose(sk, 0.884, ('flat', y0 + 12 * V), ('swing', -0.2, 0.15, -8), -12),
    }
    wave_start = arms(0, 0, lower=60, bend=6)
    wave_end = arms(0, 0, lower=60, bend=6)
    wave_end.update({'upper_arm.R': ry(105), 'forearm.R': ry(150), 'hand.R': rz(-20) @ ry(150),
                     'spine.004': ry(8), 'spine.002': ry(-4)})
    poses['wave_start'] = sk.local(wave_start)
    poses['wave_end'] = sk.local(wave_end)
    source = {'kind': 'json', 'author': 'agent',
              'note': 'No user was present: the agent authored this pose with author_poses.py.'}
    write_json(args.out, {'schema': 1, 'poses': {name: {'source': source, 'bones': bones}
                                                 for name, bones in poses.items()}})
    # Extreme poses for the rig gate: deep elbow and knee bends, arms overhead, a spine twist and a split.
    tests = {
        'elbows-knees-120': dict(arms(0, 0, lower=50, bend=120), **solve_leg(sk, 'L', 0.62, ('swing', -0.25, 0.35, 0)),
                                 **solve_leg(sk, 'R', 0.62, ('swing', -0.25, 0.35, 0))),
        'arms-up-twist': {'upper_arm.L': ry(-110), 'forearm.L': ry(-110), 'hand.L': ry(-110),
                          'upper_arm.R': ry(110), 'forearm.R': ry(110), 'hand.R': ry(110),
                          'spine.002': rz(35), 'spine.004': rz(35) @ ry(15)},
        'split-reach': dict(arms(-80, 60, lower=40, bend=30), **{'thigh.L': rx(-75), 'shin.L': rx(10),
                                                                  'thigh.R': rx(45), 'shin.R': rx(60),
                                                                  'spine.001': rx(-25)}),
    }
    write_json(args.test_out, {'schema': 1, 'poses': {name: {'source': source, 'bones': sk.local(world)}
                                                      for name, world in tests.items()}})
    print(f'pose-to-pose: wrote {len(poses)} poses -> {args.out}, {len(tests)} test poses -> {args.test_out}')


if __name__ == '__main__':
    run(main)
