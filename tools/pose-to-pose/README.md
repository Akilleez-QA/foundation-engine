# Pose-to-pose rigging and animation

A headless Blender pipeline for the creator's key poses. **The person decides the poses; the agent does
the rest:** rigging, in-betweens, timing, loop closure, export and validation.

- **One-shot motion** (a wave, an attack): the person poses a start and an end; the agent animates
  from one to the other.
- **Looping motion** (a walk): the loop is broken into key poses. Each consecutive pair is a segment and
  the segments chain into a closed loop, for example contact → down → passing → up → contact (mirrored
  for the other side). The last pose of the chain is the first pose of the next cycle.

This page is the tool reference: what each script does, its formats and its checks.

Everything runs with Blender 5.2 in the background (`blender --background --factory-startup
--python-exit-code 1 --python <script> -- <args>`). No add-on is installed, no MCP server is used and
no user Blender session is opened or saved: each script reads the files it is given and writes only
its named outputs. Rigify ships with Blender. GameRig is not installed here, so the deform skeleton
comes from the built-in deform-only flatten (see [rig](#1-rig)).

## Files

| File | Role |
| --- | --- |
| `blender/rig.py` | Pre-rig check, skeleton, binding, weight validation |
| `blender/test_poses.py` | Rig gate: weight colours and extreme test poses on one sheet, plus a weight report |
| `blender/capture_poses.py` | The user's Blender pose assets and marker poses → `poses.json` |
| `blender/animate.py` | Generator: poses + `animations.json` → baked actions → GLB + clips manifest + provenance |
| `blender/verify.py` | Re-import from a copied folder; compare joints with the source; deformed-sole floor contact |
| `blender/contact_sheet.py` | Key poses and in-betweens of the exported GLB on one image |
| `blender/common.py`, `blender/render.py` | Shared helpers |
| `definition.mjs` | The `animations.json` contract in JavaScript (the validator's twin of `common.py`) |
| `validate.mjs` | Offline GLB validator against the definition |
| `review.mjs` | The review ledger: approve the rig, approve or unfreeze clips |
| `pipeline.mjs` | Runs a worked example end to end |
| `examples/robot/` | Worked example: an original low-poly humanoid with a wave and a mirrored walk |
| `examples/bug/` | Worked example: an original six-legged creature of rigid parts with a tripod scuttle and a tail strike |
| `game/public/models/` | The example's exported GLB, clips manifest, provenance and model contract |

## The steps

### 1. Rig

```sh
blender --background --factory-startup --python-exit-code 1 --python tools/pose-to-pose/blender/rig.py -- \
  --input model.blend --kind humanoid --landmarks landmarks.json --name hero \
  --out work/rigged.blend --report work/rig-report.json
```

- **Pre-rig check** on every mesh object: triangle count per part, non-manifold edges, loose vertices and
  edges, unapplied rotation or scale, missing UVs. It warns on one dense merged mesh (more than 20,000
  triangles in a single object): rigging works far better on separate low-poly parts. Negative scale
  and non-finite vertices are errors.
- **Humanoid** (`--kind humanoid`): adds Rigify's basic human metarig, removes the breast and pelvis
  helpers, sets one deform segment per limb bone, and fits it to `landmarks.json` (hips, neck, head,
  shoulder, elbow, wrist, hand tip, hip, knee, ankle, toe and heel; left side only, mirrored). Without
  landmarks it estimates them from the mesh bounds, which only suits a standard A- or T-pose. Rigify
  then generates the control rig. The exported skeleton is a deform-only flatten: every `DEF-` bone
  (prefix dropped) under a `root` bone, parented by the metarig hierarchy, each following the control
  rig through Copy Transforms so the user can pose with Rigify's controls. GameRig is detected but not
  driven by this script; installing an add-on is the creator's decision.
- **Binding**: automatic weights (bone heat), then cleaning, at most four influences and normalising.
  The weights are rejected when any vertex is unweighted, has more than four influences or does not
  sum to one, follows a bone more than a quarter of the model's height away, follows a bone on the
  opposite side, or when a limb or spine bone gets no vertices. Then it retries on a voxel-remeshed,
  watertight proxy and copies the weights back with a Data Transfer modifier (nearest face,
  interpolated). If that fails too, the step exits 1 with the problems listed in the report. It never
  writes a rig with rejected weights.
- **Rigid** (`--kind rigid --skeleton skeleton.json`): for mechanical models and creatures built from
  rigid parts. Each bone lists its head, tail, parent and the part objects it carries. Every part must
  map to exactly one bone. `--rigid-bind parent` (default) parents each part to its bone;
  `--rigid-bind merge` joins the parts into one skinned mesh with 100% single-bone weights (one draw
  call instead of one per part).

### 2. Test poses (the rig gate)

```sh
blender ... --python tools/pose-to-pose/blender/test_poses.py -- \
  --rigged work/rigged.blend --poses testposes.json --out work/testposes.png --report work/testposes.json
```

The sheet shows each vertex coloured by its dominant bone (magenta: no weights) and the test poses
from the front and three-quarter views. Use a test-pose file with extremes for the model (elbows and
knees at about 120°, a spine twist, arms overhead, a split; jaw and tail when present). Without one,
every bone is bent by `--angle` degrees four ways. The report counts unweighted and wrong-side
vertices (errors) and bones whose vertices form more than one island (for review), and carries the
rig hash. **The user looks at the sheet and approves it** before any clip is drafted:

```sh
node tools/pose-to-pose/review.mjs approve-rig --review review.json --test-report work/testposes.json --by "<name>"
```

### 3. Key poses

From Blender (see the recipe for the exact clicks): pose assets saved to the current file, or named
timeline markers on keyed frames. Capture writes them in deform-skeleton space:

```sh
blender ... --python tools/pose-to-pose/blender/capture_poses.py -- --blend posed.blend --out poses.json
```

From code or another tool, write `poses.json` directly:

```json
{
  "schema": 1,
  "poses": {
    "contact": {
      "source": {"kind": "json", "note": "who or what authored it"},
      "bones": {
        "thigh.L": {"euler": [-25, 0, 0]},
        "shin.L": {"rotation": [0.99, 0.12, 0, 0]},
        "spine": {"location": [0, -0.04, 0]},
        "tail.3": {"scale": 1.3}
      }
    }
  }
}
```

Each bone gives a bone-local rotation (`rotation` as a `[w, x, y, z]` quaternion, or `euler` in degrees
with an optional `order`), and optional `location` (metres, bone-local) and `scale`. These are the
same values as Blender's pose-mode transform fields. Bones not listed are at rest. Unknown bones are
errors.

### 4. Animation definition (`animations.json`)

```json
{
  "schema": 1,
  "fps": 30,
  "skeleton": {"maxBones": 64, "maxInfluences": 4, "root": "root"},
  "materials": {"team": "team"},
  "mirror": {"pairs": [[".L", ".R"]]},
  "clips": {
    "wave": {
      "playback": "hold",
      "controls": ["upper_arm.R", "forearm.R"],
      "keys": [{"pose": "wave_start"}, {"pose": "wave_end", "seconds": 0.6, "easing": "ease-in-out"}],
      "events": [{"name": "hand_up", "at": 0.5}]
    },
    "walk": {
      "playback": "loop",
      "repeatMirrored": true,
      "keys": [
        {"pose": "contact"},
        {"pose": "down", "frames": 3},
        {"pose": "passing", "frames": 5},
        {"pose": "up", "frames": 4},
        {"pose": "contact", "mirror": true, "frames": 4}
      ],
      "events": [{"name": "step_L", "at": 0.1, "floor": ["foot.L", "toe.L"]}],
      "rootMotion": {"stride": 1.0, "feet": [{"bone": "foot.L", "toe": "toe.L"}, {"bone": "foot.R", "toe": "toe.R"}]}
    },
    "walk_turn_left": {"derive": {"from": "walk", "turn": "left", "bone": "spine.001", "lean": 5, "twist": 6, "yawPerCycle": 20}}
  }
}
```

| Field | Meaning |
| --- | --- |
| `fps` | One sampling rate per GLB. A clip may repeat `fps`; a different value is an error (resample instead: changing fps alone changes speed). |
| `playback` | `loop`, `once` (play then hand back to the game) or `hold` (stay on the last frame). |
| `keys` | The pose sequence. Each key after the first gives the length of the segment ending at it, in `frames` or `seconds` (must land on whole frames), its `easing` (`linear`, `ease-in`, `ease-out`, `ease-in-out` or `{"bezier": [x1, y1, x2, y2]}`, a CSS-style timing curve), `mirror: true` to flip the pose's sides, `scale` (`{"bone": 1.3}`: per-key scale, for impact exaggeration) and `noise` (`{"seed": 1, "degrees": 3}`: a deterministic small rotation per bone, so a mirrored pose is not perfectly symmetric). |
| `repeatMirrored` | The keys are a half cycle ending on the mirror of the first pose; the generator appends the mirrored half, closing the loop. |
| loop closure | A loop must end on its first pose (same pose, same mirror). The generator copies the first frame onto the last exactly and makes the F-curves cyclic. |
| `speed` | Global time scale: all segment lengths are divided by it (for example 2 for a reference filmed at half speed). |
| `trim` | `{"start": f, "end": f}` cuts a one-shot clip to game length. Loops cannot be trimmed. |
| `events` | Named moments in seconds (`at`), frames derived. `floor` names bones whose deformed mesh must touch the floor then (checked by `verify.py`). |
| `controls` | Bones that must visibly move in this clip (more than 1° or 1 mm); the validator checks them. |
| `rootMotion` | In-place clips with declared travel. Loops: `stride` (metres per cycle) and optional `yawPerCycle`; one-shot clips: `delta` (`{"x", "z", "yaw"}`). `feet` enables the foot checks; `footSlideTolerance` (0.04 m), `contactHeight` (0.02 m) and `flatFootTolerance` (8°) may be set per clip. |
| `derive` | A turn variant of a walk: same keys, the named bone banked by `lean` and turned by `twist` degrees toward the turn, and `yawPerCycle` degrees of root yaw. Its root motion is an arc. |
| `skeleton`, `materials` | Limits (bones, influences per vertex), the required root bone, and required material slots (for example a `team` slot the game can recolour). |

Author walks **in place**: the character's hips stay over the origin and the planted foot moves back at
the declared stride. The game moves the character with the root-motion clip in the manifest, so the
feet do not slide.

### 5. Generate

```sh
blender ... --python tools/pose-to-pose/blender/animate.py -- \
  --rigged work/rigged.blend --poses poses.json --definition animations.json --out game/public/models/hero.glb
```

One slotted action per clip, created with the layer, strip and channelbag API (Blender 4.4+). Every
frame is baked: rotations by quaternion slerp along the shortest arc, locations and scales linearly,
with the segment's easing applied to time. Export: glTF Actions mode, sampling on, deform bones only,
four influences, no cameras or lights, Y up. Next to the GLB it writes:

- `hero.clips.json`, the manifest: per clip its name, playback, fps, frames, duration, keys with frames,
  events with seconds and frames, controls, root motion as an `@kits/animation` `RootClip`, the hashes
  of the poses it uses and `sampleSha256` (the identity a clip approval freezes);
- `hero.provenance.json`: Blender version, hashes of the GLB, manifest, inputs and scripts, bone and
  triangle counts, the rig hash and the review state.

**Review gate.** Unless `--no-review` is given, `review.json` beside the definition must approve the
rig with the current rig hash. While no clip is approved only one clip may be drafted. An approved clip
is frozen: if any later edit to a pose, timing or the rig changes its baked samples, export stops.
`review.mjs unfreeze` reopens a clip deliberately. Draft clips are recorded in the provenance and fail
the validator unless `--allow-draft` is given. `--no-review` is for unattended examples only; the
provenance records `review: off` and the validator fails it unless `--allow-unreviewed` is given.

### 6. Verify and validate

```sh
blender ... --python tools/pose-to-pose/blender/verify.py -- --glb hero.glb --rigged work/rigged.blend \
  --poses poses.json --definition animations.json --report work/verify.json
node tools/pose-to-pose/validate.mjs game/public/models/hero.glb --definition animations.json
```

`verify.py` copies the GLB to a fresh folder, imports it into an empty scene, checks clip count and
frame ranges, re-bakes every clip from the source with the generator's own code and compares joint
positions frame by frame in world space (tolerance 2 mm), and at each event with `floor` checks the
lowest deformed vertex around those bones is within 15 mm of the floor.

The repository's static model contract also applies: put `<model>.contract.json` beside the GLB
([model contracts](../../docs/guides/model-contracts.md)), with the `skin` key for joint and influence
limits, and `npm run check` checks it through `asset:verify`. The generator's provenance carries the
`tool` and `generator` fields that check requires. `validate.mjs` adds what a static contract cannot
see: the clips against their definition.

`validate.mjs` reads the GLB without Blender. It fails on: a missing or undeclared clip; a GLB, manifest
or definition that disagrees with the provenance; draft or unreviewed exports (unless allowed); external
buffers; too many bones; a missing root bone; more than four influences; weights that are negative,
non-finite or do not sum to one; NaN keys; key times not increasing; a duration that differs from the
definition by more than half a frame; a loop whose first and last keys differ (a seam pop); a
generator/validator disagreement about keys, events or playback; a control bone that does not move;
missing material slots; and, for clips with `rootMotion.feet`, foot sliding and the toes-up fault.

The foot checks sample the clip with three.js (the engine's runtime) over two cycles, apply the
manifest's root motion, and measure how far each contact point drifts while planted. The ankle counts
as planted only while the foot is flat (ankle and ball down, within `flatFootTolerance` of the rest
pitch); the ball is measured separately through heel-off. A foot that is never flat while down fails,
which catches retargeted feet that land toes-up. Heel-only contact has no joint and is left to the
deformed-sole check.

### 7. Look at it

```sh
blender ... --python tools/pose-to-pose/blender/contact_sheet.py -- --glb hero.glb --out walk.png --clip walk --view side
```

The sheet re-imports the shipped GLB. Key poses are labelled `KEY`, events `!`. The floor is striped
every 10 cm, so sliding shows. Look at it yourself, then show it to the person.

## Worked example

```sh
node tools/pose-to-pose/pipeline.mjs robot --sheets /tmp/robot-sheets
node tools/pose-to-pose/pipeline.mjs bug --sheets /tmp/bug-sheets
```

An original low-poly robot (190 vertices, three material slots including `team`) is built from
`landmarks.json` with a skin modifier, rigged as a humanoid (24 bones), given a one-shot `wave` from a
start and an end pose, and a 4-key-pose mirrored `walk` (stride 1 m per 32-frame cycle) with derived
`walk_turn_left` and `walk_turn_right`. **No user was present**, so the agent authored the key poses as
code (`examples/robot/author_poses.py` places the feet and hips and solves each leg) and the review
gate was off. Both facts are recorded in the provenance. On the recorded run, bone heat left the hips
bone without vertices, so the rig step used the voxel proxy; the re-import matched the source within
0.003 mm; both soles touched the floor at their step events; the walk's largest foot slide was 17 mm
and the turns' 31 mm. Re-running the pipeline produced byte-identical files.

The second example is a non-humanoid built the way rigging works best: 19 separate low-poly parts
(body, back plate, head, three tail segments, a stinger, and two segments for each of six legs), each
with box-projected UVs, sharing three materials (`shell`, `team`, `stinger`). It is rigged with
`--kind rigid` (25 bones, including a contact bone at each foot tip), so every part follows one bone
with no weights. `scuttle` is a 4-key-pose tripod gait (front and rear legs of one side with the middle
leg of the other), mirrored into a closed 24-frame loop with a stride of 0.24 m. The swing feet lift
straight off and settle back at ground speed, so the six planted feet slide at most 5 mm. `strike` is a
one-shot: idle, a cocked tail, a tail whip over the head with the body lunging over planted feet, back
to idle. The stinger is scaled to 1.5 and the last tail segment to 1.15 on the hit key (impact
exaggeration), and the clip has an `impact` event at 0.4333 s. Both soles touched the floor at their
events, and two runs were byte-identical. As with the robot, the poses are agent-authored and the
review gate was off.

## Limits

- Blender runs locally. CI has no Blender: it validates the checked-in outputs with `validate.mjs` and its
  tests. The Python scripts were exercised with Blender 5.2.1 LTS only.
- In-betweens are forward-kinematic interpolation of local rotations. There is no IK or foot locking
  between keys; add a key pose where a contact must hold exactly.
- Rebuild scripts must be deterministic to re-export byte for byte. Two Blender operations were not, on
  this machine: Smart UV Project and bmesh's UV-sphere primitive (whose pole merge orders faces
  differently between runs). The creature builds its UVs and ellipsoids explicitly instead.
- The humanoid fit expects a symmetric, upright model facing −Y in an A- or T-pose. Fingers, face and
  twist bones are not generated.
- Turn variants are an approximation: a lean and twist on one bone plus root yaw. The validator measures
  their foot slide like any other clip.
- Validation and verification prove the files match the definition. They do not prove the motion
  looks good: that is the person's call, from the sheets and the game.
