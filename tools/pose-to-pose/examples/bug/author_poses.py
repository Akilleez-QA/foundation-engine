"""Agent-authored key poses for the creature example (GPL-3.0-only).

No user was present to pose this example in Blender, so the agent wrote its key poses as code: a
tripod gait (front and rear legs of one side with the middle leg of the other) whose stance feet sweep
back at the declared stride while the swing feet lift and reach forward, and a tail strike. Each leg is
solved in its own vertical plane. A creator normally poses in Blender and runs capture_poses.py.

blender --background --factory-startup --python-exit-code 1 --python author_poses.py -- \
  --rigged bug-rigged.blend --out poses.json --test-out testposes.json
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'blender'))
sys.path.insert(0, str(HERE.parent / 'robot'))
from author_poses import Skeleton, rx, rz  # noqa: E402
from common import export_armature, run, script_args, write_json  # noqa: E402

STRIDE = 0.24  # metres per cycle
CYCLE = 24  # frames per cycle; must agree with animations.json
SWEEP = STRIDE / 2  # each foot's stance sweep (duty factor 0.5)
TRIPOD = {'A': ['leg1_upper.L', 'leg2_upper.R', 'leg3_upper.L'], 'B': ['leg1_upper.R', 'leg2_upper.L', 'leg3_upper.R']}


def solve_leg(sk, upper, dy, lift, offset=Vector()):
    """Yaw the leg's plane and bend it so the foot tip lands `dy` metres forward (-Y) of its rest place and
    `lift` up, while the body (and so the hip) is moved by `offset`."""
    lower = upper.replace('upper', 'lower')
    hip0, knee0, foot = sk.head[upper], sk.head[lower], sk.tail[lower]
    hip, knee = hip0 + offset, knee0 + offset
    target = foot + Vector((0, -dy, lift))
    flat = lambda v: Vector((v.x, v.y, 0))  # noqa: E731
    d0, d1 = flat(foot - hip), flat(target - hip)
    psi = math.atan2(d1.y, d1.x) - math.atan2(d0.y, d0.x)
    l1, l2 = (knee - hip).length, (foot - knee).length
    r, h = d1.length, target.z - hip.z
    dist = min(math.hypot(r, h), (l1 + l2) * 0.999)
    a = math.acos(max(-1, min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))))
    phi_upper = math.atan2(h, r) + a  # knee above the hip-foot line
    kr, kz = l1 * math.cos(phi_upper), l1 * math.sin(phi_upper)
    phi_lower = math.atan2(h - kz, r - kr)
    rest_r0 = flat(knee0 - hip0).length
    rest_upper = math.atan2(knee0.z - hip0.z, rest_r0)
    rest_lower = math.atan2(foot.z - knee0.z, flat(foot - hip0).length - rest_r0)
    axis = Vector((0, 0, 1)).cross(d0.normalized())  # +angle about it tips the leg down
    yaw = Quaternion((0, 0, 1), psi)
    return {upper: yaw @ Quaternion(axis, -(phi_upper - rest_upper)),
            lower: yaw @ Quaternion(axis, -(phi_lower - rest_lower))}


def legs(sk, a, b, offset=Vector()):
    """World rotations of all six legs: tripod A at (dy, lift) a, tripod B at b."""
    world = {}
    for tripod, (dy, lift) in (('A', a), ('B', b)):
        for leg in TRIPOD[tripod]:
            world.update(solve_leg(sk, leg, dy, lift, offset))
    return world


def gait(sk, a, b, bob, wag):
    """Feet are solved for the bobbed body, so a planted foot stays on the floor; the tail wags."""
    offset = Vector((0, 0, bob))
    world = legs(sk, a, b, offset)
    world.update({'tail.1': rz(wag), 'tail.2': rz(wag * 1.6), 'tail.3': rz(wag * 2.0)})
    return sk.local(world, locations={'body': offset})


def strike(sk, tail, head, offset):
    """The tail pose with the body moved by `offset` while all six feet stay where they stand."""
    world = legs(sk, (0, 0), (0, 0), offset) if offset.length else {}
    world.update(tail)
    world['head'] = head
    return sk.local(world, locations={'body': offset})


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--rigged', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--test-out', required=True)
    args = p.parse_args(script_args())
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.rigged).resolve()))
    sk = Skeleton(export_armature())
    h, v = SWEEP / 2, SWEEP / (CYCLE / 2)  # half sweep; stance speed per frame
    poses = {
        # Tripod A lands in front as tripod B pushes off behind.
        'scuttle_contact': gait(sk, (h, 0), (-h, 0), 0, 0),
        # Tripod B lifts straight up (its foot keeps pace with the ground), swings forward, then comes down
        # ahead and settles back at ground speed, so no planted foot slides.
        'scuttle_down': gait(sk, (h - 3 * v, 0), (-h - 3 * v, 0.035), -0.008, 5),
        'scuttle_passing': gait(sk, (h - 6 * v, 0), (0, 0.05), 0, 8),
        'scuttle_up': gait(sk, (h - 9 * v, 0), (h + 3 * v, 0.03), 0.006, 5),
        'idle': sk.local({}),
        # Tail cocked back and up, body drawn back: the anticipation.
        'strike_ready': strike(sk, {'tail.1': rx(-20), 'tail.2': rx(-35), 'tail.3': rx(-45), 'stinger': rx(-50)},
                               rx(-8), Vector((0, 0.02, -0.015))),
        # The tail whips over the head; the body lunges forward over planted feet.
        'strike_hit': strike(sk, {'tail.1': rx(45), 'tail.2': rx(70), 'tail.3': rx(95), 'stinger': rx(120)},
                             rx(6), Vector((0, -0.04, 0))),
    }
    tests = {
        'legs-high': {k: v for leg in TRIPOD['A'] + TRIPOD['B'] for k, v in solve_leg(sk, leg, 0, 0.12).items()},
        'tail-curl': {'tail.1': rx(-40), 'tail.2': rx(-80), 'tail.3': rx(-120), 'stinger': rx(-150)},
        'body-twist': {'body': rz(25), 'head': rz(45)},
    }
    source = {'kind': 'json', 'author': 'agent',
              'note': 'No user was present: the agent authored this pose with author_poses.py.'}
    write_json(args.out, {'schema': 1, 'poses': {n: {'source': source, 'bones': b} for n, b in poses.items()}})
    write_json(args.test_out, {'schema': 1, 'poses': {n: {'source': source, 'bones': sk.local(w)}
                                                      for n, w in tests.items()}})
    print(f'pose-to-pose: wrote {len(poses)} poses -> {args.out}, {len(tests)} test poses -> {args.test_out}')


if __name__ == '__main__':
    run(main)
