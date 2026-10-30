# Compatible weighted model parts

A model pose link lets an optional weighted part follow another model’s current pose while keeping its own skeleton and resource lifetime. Creators choose what those parts mean, which assets are compatible, and their supported devices and budgets. This is a strict compatible-rig framework, not automatic retargeting or a character taxonomy.

Enable preparation explicitly on a scene with `modelPoseLinks: {}`. Without that scene option, ordinary models do not incur rig capture or vertex validation. Use `ModelPoseLink({ source, nodes, inheritVisibility })` on the destination model entity. Each `nodes` entry names one source and one target node. Supply the complete destination joint hierarchy, including non-bone ancestors; the loaded instance root is paired implicitly. The source can contain extra unrelated branches, and skin palette indices may differ.

```ts
ModelPoseLink({
  source: sourceEntity,
  nodes: [
    { source: 'pivot', target: 'pivot' },
    { source: 'joint-a', target: 'joint-a' },
    { source: 'joint-b', target: 'joint-b' },
  ],
  inheritVisibility: true,
});
```

The scene owner captures the instantiated baseline before playback. Names must be unique, mapped parent relationships and rest matrices must agree, and every destination skin joint must have a corresponding source joint with compatible inverse bind and mesh bind matrices. All source skin occurrences of that joint must agree. The engine never repairs inverse binds or mutates shared geometry to make an incompatible part fit. A source model’s readiness alone does not establish compatibility.

The supported subset uses finite, invertible rest and bind transforms, automatically updated native local and world matrices, attached skin binding, and four-component skin indices and normalized weights. It validates each vertex’s indices and finite weights, rejecting repeated nonzero influences and nonfinite positions. Relevant morph targets, GPU-only buffers, more than 32 vertex attribute names, and additional influence sets are unsupported. Nonidentity matching asset roots, local scale, and independently ordered skin palettes are supported. Bind and hierarchy conversion, arbitrary retargeting, and unnamed required ancestor mappings are not.

A linked part receives source local position, quaternion, and scale, plus the source’s finalized root placement. Its own `Transform` remains unchanged. The part must have no native clip or authored `Model.pose` override while linked: conflicts are observable failures. A model cannot have both a rigid attachment and a pose link driving its root. Rigid and weighted dependencies require one parent-first scene reconciliation; mixed cycles are failures. This policy establishes a single pose authority without prescribing gameplay rules.

Read `ctx.modelPoseLinkState(entity)` for observed state, separately from `ctx.modelState(entity)`. Waiting, invalid, incompatible, conflicted, over-budget, or blocked parts remain hidden. Reads do not load, validate, or redraw. Changing either adopted instance invalidates the previous mapping. Removing the link restores the part’s ordinary authored/native pose, including scale. No last-deformation hold or automatic retry is promised.

Use an existing authored appearance document and edit session for accepted/candidate composition. Prepare a separate bounded candidate group, wait for every required model and pose link, preview, then commit that same candidate’s document. Cancel or rejection retires the candidate while keeping the accepted group. Save creator selections and mapping descriptions, not live native objects. Reload must repeat compatibility checks against actual assets.

## Configurable work limits

| Scene `modelPoseLinks` option | Default |
| --- | ---: |
| `maxLinks` | 32 |
| `maxMappedNodesPerLink` | 128 |
| `maxMappedNodesTotal` | 1024 |
| `maxRigNodesPerModel` | 512 |
| `maxSkinJointsPerModel` | 256 |
| `maxSkinVerticesPerModel` | 65536 |
| `restTolerance` | 0.000001 |

The per-link mapping limit counts explicit named mapping entries. The total mapped-node limit counts actual copy pairs, including one implicit instance-root pair for every admitted link. Counts must be nonnegative safe integers. Zero disables the relevant admission. Skin joint and vertex counts sum across all meshes in a model, including repeated geometry. Vertex totals are admitted before scanning vertex data. Traversals use captured scalar counts and attribute references; changed counts or references refuse capture rather than increasing the admitted scan. Snapshots retain node, bind and hierarchy facts, not copies of whole vertex arrays. `restTolerance` is the creator-selected finite nonnegative absolute tolerance for rest/bind comparisons; it does not weaken vertex-weight validity checks. Raising it intentionally broadens accepted asset differences.

The component constructor has an explicit absolute guard of 65,536 mapping entries, independent of the default scene limit of 128. Configurations above that constructor ceiling are rejected rather than silently capped. An owner applies its configured per-link bound when capturing raw ECS data. Structural checks happen on baseline/relation changes; no rig name or geometry scanning belongs in the per-frame pose-copy path. Existing instance and resident-resource budgets also apply to accepted and candidate groups. These counts are admission estimates and work bounds, not physical-device timing guarantees.

## Verification scope

Helper tests exercise actual CPU weighted deformation for single-joint and mixed influences, reordered palettes, scale and nonidentity roots; loaded rest/bind/hierarchy refusals; bounded geometry intake; detached snapshots; and restoration without asset mutation. Native matrices must be current before CPU skinning observations. Rigid cached bounds cannot prove deformation.

Owner regressions in `src/author/model-pose-link-runtime.test.ts` exercise combined rigid/weighted ordering, stale adoption, callback invalidation, source identity, unlink restoration and actual weighted coordinates. The original GLB consumer in `tools/weighted-appearance` adds native preview/cancel/commit/undo, save failure/reload and incompatible or newer restore workflows. Run `npm run test:weighted-appearance-browser` for its rendered desktop evidence; CI runs it separately from template count gates. Its bounded dev-only `skinVertices` probes observe cached runtime matrices without updating or repairing pose.

Passing these named checks does not certify all imported assets, phone/tablet experience, physical-device memory, sustained GPU timing or concurrent-writer persistence. Independent skeletons duplicate palette work; no claim of outperforming shared palettes is made.
