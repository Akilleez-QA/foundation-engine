# Pose-to-pose pipeline: recorded evidence (2026-10-03)

Scope: `tools/pose-to-pose` (rig, rig test poses, capture, generator, verify, contact sheets, validator,
review ledger) and its worked robot example. Engine playback in a browser is recorded separately when
that fixture lands.

## Environment

- Blender 5.2.1 LTS (`/usr/bin/blender`), always `--background --factory-startup --python-exit-code 1`.
  Bundled Rigify; GameRig not installed (deform-only flatten used); no add-on installed; no MCP server.
- Node 22.23.3 for the validator and tests.
- Linux desktop, Workbench renders in background mode.

## Commands

```sh
node tools/pose-to-pose/pipeline.mjs robot --work <scratch>/work-robot --sheets <scratch>
node tools/pose-to-pose/validate.mjs tools/pose-to-pose/game/public/models/pose-robot.glb \
  --definition tools/pose-to-pose/examples/robot/animations.json --allow-unreviewed
npm run asset:verify -- tools/pose-to-pose/game/public/models/pose-robot.glb
node --test scripts/asset-verify.test.mjs
npm run check   # typecheck, lints, asset:verify --all, and the affected tests
```

## Results

| Check | Result |
| --- | --- |
| Pre-rig check | 1 object, 190 vertices, no warnings after the builder deletes a loose vertex the skin modifier left |
| Rig | Rigify basic human fitted to `landmarks.json`; 24 deform bones under `root` |
| Weights | Bone heat rejected: the hips bone (`spine`) got no vertices. Voxel proxy plus Data Transfer accepted: 0 unweighted, 0 over four influences, 0 unnormalised, 0 far or wrong-side vertices |
| Rig test poses | 3 extreme poses (elbows and knees 120°, arms overhead with a spine twist, a split) from two views; no problems; every bone one weight island |
| Generator | `wave` (hold, 18 frames), `walk` (loop, 32 frames, 4 key poses mirrored), `walk_turn_left`, `walk_turn_right`; GLB 184,984 bytes, sha256 `52d2658c…aa69` |
| Verify (copied folder) | Joint positions match the source within 0.003 mm on every frame of every clip; sole floor height 0.0 m at `step_L` and `step_R` |
| Validator | Passes with `--allow-unreviewed`; fails without it (review gate off) |
| Foot slide (`walk`) | 17 mm ankle while flat, 3.5 mm ball through heel-off, 13 flat frames per foot per cycle, tolerance 40 mm |
| Foot slide (turns, 20° per cycle) | 31 mm outer foot, 10 mm inner foot |
| Static contract | `pose-robot.contract.json` passes `asset:verify`: 376 triangles, 758 vertices, 3 materials (`body`, `team`, `visor`), size 1.459 × 1.640 × 0.294 m, 4 clips, skin of 24 joints under `root`, at most 4 influences |
| `skin` contract key | 7 new tests in `scripts/asset-verify.test.mjs` (84 pass): the robot passes; too many joints, a second influence set, too many influences, weights summing to 0.5, a missing root and a root that does not hold every joint are rejected; more than four influences cannot be declared |
| Determinism | Two complete pipeline runs (rig, poses, export) produced byte-identical GLB, manifest and provenance |
| Review gate (scratch copy, not a user approval) | No ledger: export refused. Rig approved, two clips: refused (one representative clip first). One clip: exported as a draft; validator fails it without `--allow-draft`. Clip approved, second clip drafted: exported. A pose edit reaching the approved clip: refused as frozen |
| Pose capture (scratch) | A pose asset made on the Rigify `head` control and a marker pose captured as `spine.006` rotations in deform space |

### Creature example (rigid parts)

| Check | Result |
| --- | --- |
| Pre-rig check | 19 objects, 350 triangles, no warnings |
| Rig | `--kind rigid`: 25 bones (6 foot-tip contact bones without parts); every part parented to one bone |
| Rig test poses | Parts coloured by bone, plus legs raised, a tail curl and a body twist; no problems |
| Clips | `scuttle` (loop, 24 frames, tripod gait mirrored, stride 0.24 m) and `strike` (once, 30 frames, stinger scaled 1.5 at the hit, `impact` at 0.4333 s); GLB 137,032 bytes |
| Verify (copied folder) | Joint error 0.0 m; deformed parts at the floor events at 8.9 mm (`step_A`, `step_B`) and 7.1 mm (`planted`), tolerance 15 mm |
| Foot slide | 4.3 to 4.6 mm for each of the six feet, tolerance 20 mm |
| Static contract | `pose-bug.contract.json` passes `asset:verify`: 350 triangles, 732 vertices, 19 primitives, 3 materials, size 0.63 × 0.58 × 0.67 m |
| Determinism | Byte-identical after replacing Smart UV Project and bmesh's UV sphere, both of which varied between runs |

The checks caught two of the agent's own mistakes on the way. The validator refused part objects that
shared their bones' names, which would make engine name lookups ambiguous. The contract's size bound,
the floor check and the test-pose sheet all caught legs flattened by a floor clamp that read stale
world matrices.

Contact sheets of the key poses and in-betweens were rendered with `contact_sheet.py` and inspected:
the wave raises the right arm from the side through horizontal to overhead; the `walk` clip shows heel
contact, the lowest hips at `down`, the swing foot passing under the body and the highest hips at
`up`, mirrored in the second half and closing on the first pose.

## Not verified

- No person posed or approved anything: the example's key poses are agent-authored code and its review
  gate was off. Both are recorded in its provenance.
- No browser or engine playback in this record. CI runs no Blender; it runs the validator tests on the
  checked-in GLB.
- Only Blender 5.2.1 LTS. Cross-version byte identity is not claimed.
- Visual quality of the motion is a judgement for the person, not a check.
