# Recipe: animate a model pose to pose

You decide the poses. The agent does the rest: rigging, in-betweens, timing, loop closure, export
and validation.

- **One-shot motion** (a wave, a strike, a jump): you pose a **start** and an **end**. The agent
  animates from one to the other.
- **Looping motion** (a walk cycle, a scuttle, an idle): break the loop into a few **key poses**. Each
  consecutive pair is a segment, and the segments chain into a closed loop. The last pose of the chain
  is the first pose of the next cycle.

The tools live in [`tools/pose-to-pose`](../../tools/pose-to-pose/README.md). They need Blender 5.2
(the 5.2.x LTS) and run headless. Nothing opens or saves your own Blender session.

## 1. Prepare the model

Rigging works far better on a model built from **logical separate parts** than on one merged
high-poly mesh. Make legs, claws, a tail, the head and so on separate low-poly objects with clean UVs,
sharing one packed texture atlas (or a few flat materials).

Choose where each model comes from:

| The model is… | Make it with | Then |
| --- | --- | --- |
| A simple form the engine can draw (a crate, a pillar, a gem) | A procedural `Shape` or `defineMesh` in code | No rig needed |
| A hard-surface prop or a creature you can describe in parts | Blender, through the [blender-asset skill](../../.claude/skills/blender-asset/SKILL.md): one rebuild script, parts named `asset_part` | Pose to pose, with `--kind rigid` for jointed parts or `--kind humanoid` |
| An organic character from an image or a prompt | An AI generator, then Blender cleanup | Pose to pose, after the checks below |

For generated or imported meshes:

- **Set a face target for each part before you start**: roughly 1,000 to 2,000 triangles for a small
  unit, a few hundred for a limb. One dense merged mesh is the slowest route to good weights.
- **Split into parts before rigging**, and keep them separate until after rigging, so each part
  follows the right bone and materials can still be reassigned.
- **Re-bake every generated part with one shared bake setup**, so tints and roughness match across
  parts and across assets.
- **When only a material change was asked for, keep the supplied geometry.**
- For team colour, give the part that should change colour its own material slot named `team`.
  Recolouring that one slot for each instance is not supported by the engine yet: a `Material` on a
  `Model` overrides all of its materials and has no colour field. The slot is ready for when it is.

The rig step starts with a **pre-rig check**: object count, triangles per part, non-manifold and loose
geometry, unapplied rotation or scale, and missing UVs. It warns on one dense merged mesh. Fix what it
reports before going on.

## 2. The agent rigs it, and you approve the test poses

```sh
blender --background --factory-startup --python-exit-code 1 --python tools/pose-to-pose/blender/rig.py -- \
  --input model.blend --kind humanoid --landmarks landmarks.json --name hero \
  --out work/rigged.blend --report work/rig-report.json
blender --background --factory-startup --python-exit-code 1 --python tools/pose-to-pose/blender/test_poses.py -- \
  --rigged work/rigged.blend --poses testposes.json --out work/testposes.png --report work/testposes.json
```

A humanoid gets a Rigify control rig plus a clean deform skeleton for the game. Jointed models and
creatures made of rigid parts use `--kind rigid` with a `skeleton.json`. Bad weights stop the rig step
with a report; they are never shipped.

**Your turn:** look at `testposes.png`. It shows each vertex coloured by the bone that moves it
(magenta means no bone), and extreme poses: deep elbow and knee bends, a spine twist, arms overhead,
and the tail or jaw if there is one. If anything tears, collapses or follows the wrong side, say so. If
it looks right, say so, and the agent records it:

```sh
node tools/pose-to-pose/review.mjs approve-rig --review review.json --test-report work/testposes.json --by "<your name>"
```

No clip is generated for a rig whose test poses you have not approved.

## 3. Pose the key poses in Blender

Open `work/rigged.blend` in Blender (save it under a new name first, for example `posed.blend`).

**With pose assets** (Blender 5.x Pose Library):

1. Select the rig called `rig` (the coloured control rig). For a rigid model, select the skeleton
   itself.
2. Switch to **Pose Mode** (Ctrl+Tab).
3. Pose it: rotate (R) and move (G) the controls. Rigify's IK hand and foot controls, `torso`,
   `chest`, `hips` and `head` are the quickest.
4. Press **A** to select all bones. A pose asset stores only the selected bones.
5. Open the **Asset Shelf** at the bottom of the 3D Viewport (the small arrow, or Shift+Space >
   Asset Shelf).
6. Click **Create Pose Asset**. Name it exactly as the definition will call it (`contact`, `down`,
   `passing`, `up`, `wave_start`…), and for **Library** choose **Current File**.
7. Repeat for every key pose. Press **Alt+G, Alt+R, Alt+S** to clear back to rest between poses.
8. Save the file (Ctrl+S).

**Or with markers on the timeline:** key the whole pose on a frame (select all, press I), add a marker
there (M in the timeline), and rename it to the pose name (F2). One marker per pose.

Tell the agent the file is saved. It captures the poses:

```sh
blender --background --factory-startup --python-exit-code 1 --python tools/pose-to-pose/blender/capture_poses.py -- \
  --blend posed.blend --out poses.json
```

Poses can also come from code or another tool, as a `poses.json` with each bone's local rotation and
location ([format](../../tools/pose-to-pose/README.md#3-key-poses)), or from a reference clip
(section 7).

## 4. The definition file

`animations.json` sits beside the model. It lists each clip's pose sequence, timing and behaviour:

```json
{
  "schema": 1,
  "fps": 30,
  "skeleton": {"maxBones": 64, "maxInfluences": 4, "root": "root"},
  "mirror": {"pairs": [[".L", ".R"]]},
  "clips": {
    "wave": {
      "playback": "hold",
      "controls": ["upper_arm.R", "forearm.R"],
      "keys": [{"pose": "wave_start"}, {"pose": "wave_end", "seconds": 0.6, "easing": "ease-in-out"}],
      "events": [{"name": "hand_up", "at": 0.5}]
    },
    "walk_cycle": {
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
    }
  }
}
```

- **`playback`**: `loop`, `once` (the game takes over after it), or `hold` (stay on the last frame).
- **`keys`**: the poses in order. Each key after the first gives the length of the segment that ends
  there, in `frames` or `seconds`, plus its `easing`: `linear`, `ease-in`, `ease-out`, `ease-in-out`,
  or Bézier handles `{"bezier": [x1, y1, x2, y2]}`.
- **`mirror: true`** on a key uses the pose with left and right swapped.
- **`scale`** on a key exaggerates an impact, for example `{"stinger": 1.5}` on the hit.
- **`noise`** (`{"seed": 1, "degrees": 3}`) keeps a mirrored pose from looking perfectly symmetric.
  Posing it asymmetrically yourself is just as good.
- **`events`** are named moments in seconds; the frame numbers are derived from them. The game uses
  them to fire effects and sounds from the animation's clock.
- **`controls`**: the parts that must visibly move.
- **`rootMotion`**: how far the clip travels (see below).
- **`speed`** retimes everything. **`trim`** cuts a one-shot clip to game length.
- **`derive`** makes turn-left and turn-right variants of a walk cycle.

Every field is described in the [tool reference](../../tools/pose-to-pose/README.md#4-animation-definition-animationsjson).

### Breaking a loop into key poses: a walk cycle

A walk cycle is two steps, and the second is the first one mirrored. So you only pose half a cycle,
four key poses, starting with the left foot in front:

| Key pose | The legs | The body |
| --- | --- | --- |
| **contact** | Left heel just touches the floor in front; right foot behind on its toes | Hips at middle height; arms swing opposite the legs |
| **down** | Left foot flat, knee bent, taking the weight; right toes leave the floor | **Lowest** hips |
| **passing** | Left leg straight under the body; right foot passes it, lifted, knee bent | Hips rising; arms by the sides |
| **up** | Left heel starts to lift; right leg reaches forward | **Highest** hips |

Then comes **contact, mirrored**: the right heel strikes in front. `repeatMirrored: true` appends the
mirrored half (down, passing and up with the sides swapped), and the chain closes on the first
contact. The last pose of the chain is the first pose of the next cycle. The generator makes the first
and last frames identical and the curves cyclic, so there is no pop at the seam.

**Pose walks in place.** The hips stay over the same spot and the planted foot slides back under the
body. The game moves the character by the declared `stride` (metres per full cycle). The planted foot
then stays put in the world: no foot sliding. Spacing feet consistently across the poses (the
planted foot moves back by the same amount per frame) is what makes the stride match. The validator
measures the slide.

## 5. The agent generates, checks and shows

```sh
blender --background --factory-startup --python-exit-code 1 --python tools/pose-to-pose/blender/animate.py -- \
  --rigged work/rigged.blend --poses poses.json --definition animations.json --out game/public/models/hero.glb
blender --background --factory-startup --python-exit-code 1 --python tools/pose-to-pose/blender/verify.py -- \
  --glb game/public/models/hero.glb --rigged work/rigged.blend --poses poses.json --definition animations.json \
  --report work/verify.json
node tools/pose-to-pose/validate.mjs game/public/models/hero.glb --definition animations.json --allow-draft
blender --background --factory-startup --python-exit-code 1 --python tools/pose-to-pose/blender/contact_sheet.py -- \
  --glb game/public/models/hero.glb --out work/walk_cycle.png --clip walk_cycle --view side
```

- **Generate.** One clip per definition entry, every frame baked, exported with clip names exactly as
  written. Beside the GLB go a manifest (`hero.clips.json`: durations, events, root motion) and a
  provenance receipt.
- **Verify.** The GLB is re-imported from a copied folder and compared with the source, frame by
  frame. The deformed foot mesh must touch the floor at each `floor` event.
- **Validate.** Clip names, durations, loop seams, bone and influence limits, NaN keys, the parts that
  must move, foot sliding against the stride, and feet that land toes-up.
- **Look.** The contact sheet shows key poses and in-betweens on a striped floor. The agent looks at it
  first, then shows you.

**One clip first.** Until you approve a clip, the generator drafts only one. Pick the most
representative, usually the walk cycle. Watch it, say what to change ("the foot slides at frames
12 to 14", "the arms swing too far"), and approve it when it is right:

```sh
node tools/pose-to-pose/review.mjs approve-clip --review review.json --manifest game/public/models/hero.clips.json --clip walk_cycle --by "<your name>"
```

After that the agent drafts the rest. **An approved clip is frozen.** If a later pose or timing edit
would change it, the export stops instead of silently changing a clip you signed off. Reopening one
is explicit: `review.mjs unfreeze --clip walk_cycle --by "<your name>" --reason "…"`.

## 6. Use it in the game

Declare and show the model as in [load a model](load-a-model.md). Read the manifest beside it as JSON
for what the clips mean:

- **Root motion:** `createRootMotion(clip.rootMotion.clip, true)` from `@kits/animation`, advanced by
  the clip's time, with `applyRootMotion` from `@kits/locomotion`, moves the character by the stride.
- **Events:** `createMarkerTrack(defineMarkerClip({id, duration, markers: events.map(e => ({id: e.name, at: e.at}))}), {action, loop})`,
  advanced by the clip's time, fires each event exactly once per playing.

The [pose-to-pose sample game](../../tools/pose-to-pose/game/main.ts) does both. Run it with
`npm run play -- --game tools/pose-to-pose/game`.

## 7. Key poses from a reference clip (optional)

A filmed clip or an AI-generated video can supply the key poses:

1. The agent records the take in a ledger (source, prompt, provider, plan or licence) and cuts a
   contact sheet of frames stamped with their time: `reference.mjs add`, then `reference.mjs sheet`.
2. You, or the agent with your sign-off, pick the key frames and say which pose each one is.
3. The agent poses the rig to match each frame. It renders the reference frame beside the posed rig
   from the same view with `pose_compare.py`.
4. **You approve each match.** Agents judge 3D poses from pictures poorly, so the generator refuses a
   matched pose until you have approved it (`reference.mjs approve-pose`).
5. A reference recorded at half speed is retimed later with the clip's `speed`. `trim` cuts the
   result to game length.

The commands are in the [tool reference](../../tools/pose-to-pose/README.md#3b-key-poses-from-a-reference-clip).

For good reference footage, use a plain background, even front light, a camera at chest height 2 to
3 m away, fitted clothes that contrast with the background, and one action per clip.

**Generated motion (optional, not required).** NVIDIA's Kimodo can propose motion from text. If you
use it:

- leave its foot-contact post-processing (foot IK and locking) on;
- follow its prompt rules: start with "A person…", give one or two behaviours per prompt, keep each
  prompt to 10 s or less, and do not let constraints contradict the text;
- treat its output as reference for key poses that you approve, like any other clip;
- record in the provenance that its code is Apache-2.0 and its weights are under the NVIDIA Open
  Model License. Use the SOMA or G1 weights only: the SMPL-X weights are research-only, with no
  commercial use.

MotionBricks is an early preview built around one robot skeleton. Watch it; it is not part of this
pipeline.

## Licences

- **No Mixamo characters or animations in the repository.** Their terms do not allow redistributing
  the files in a public source repository.
- **CC0 models from Quaternius and Kenney are fine.** Record the source URL and `CC0-1.0` in
  `defineAsset` and in the provenance.
- **Reference clips are inputs only. Do not commit them.** If one must be committed, record its
  source and terms first (the ledger refuses to add an in-repository file without a licence).
- **Check each generator's output terms before shipping.** Tripo's free plan makes outputs public
  under CC BY 4.0 with no commercial use (paid plans grant commercial rights). Some video services'
  entry plans are not commercially usable either. Record the service, plan and date in the ledger and
  the provenance.
- Agent-made rigs, poses and clips of your own model take your game's licence. Say in the provenance
  that an agent assisted. Copyright in AI-assisted output varies by jurisdiction.

## Further reading

- [Tool reference](../../tools/pose-to-pose/README.md): every script, format and check.
- [Runtime pose chains](../research/runtime-pose-chains.md): whether the engine should interpolate key
  poses at runtime instead (not built).
- [Model contracts](../guides/model-contracts.md): the static checks `npm run check` runs on every
  contracted GLB, including the `skin` limits.
