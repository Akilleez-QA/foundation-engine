import {component, type ComponentType, type Entity} from '../core/ecs/world';

/** Absolute scalar intake guard. Scene limits may be raised up to this explicit ceiling. */
export const MAX_MODEL_POSE_LINK_NODES = 65536;
export interface ModelPoseLinkLimits {
  readonly maxLinks: number;
  readonly maxMappedNodesPerLink: number;
  readonly maxMappedNodesTotal: number;
  readonly maxRigNodesPerModel: number;
  readonly maxSkinJointsPerModel: number;
  readonly maxSkinVerticesPerModel: number;
  readonly restTolerance: number;
}
export function normalizeModelPoseLinkLimits(input: Partial<ModelPoseLinkLimits> = {}): ModelPoseLinkLimits {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('model pose link: invalid limits');
  const supplied = {
    maxLinks: input.maxLinks,
    maxMappedNodesPerLink: input.maxMappedNodesPerLink,
    maxMappedNodesTotal: input.maxMappedNodesTotal,
    maxRigNodesPerModel: input.maxRigNodesPerModel,
    maxSkinJointsPerModel: input.maxSkinJointsPerModel,
    maxSkinVerticesPerModel: input.maxSkinVerticesPerModel,
    restTolerance: input.restTolerance,
  };
  const result = {
    maxLinks: supplied.maxLinks === undefined ? 32 : supplied.maxLinks,
    maxMappedNodesPerLink: supplied.maxMappedNodesPerLink === undefined ? 128 : supplied.maxMappedNodesPerLink,
    maxMappedNodesTotal: supplied.maxMappedNodesTotal === undefined ? 1024 : supplied.maxMappedNodesTotal,
    maxRigNodesPerModel: supplied.maxRigNodesPerModel === undefined ? 512 : supplied.maxRigNodesPerModel,
    maxSkinJointsPerModel: supplied.maxSkinJointsPerModel === undefined ? 256 : supplied.maxSkinJointsPerModel,
    maxSkinVerticesPerModel: supplied.maxSkinVerticesPerModel === undefined ? 65536 : supplied.maxSkinVerticesPerModel,
    restTolerance: supplied.restTolerance === undefined ? 1e-6 : supplied.restTolerance,
  };
  for (const [key, value] of Object.entries(result)) {
    if (key === 'restTolerance' ? !Number.isFinite(value) || value < 0 : !Number.isSafeInteger(value) || value < 0)
      throw Error('model pose link: invalid limits');
  }
  if (result.maxMappedNodesPerLink > MAX_MODEL_POSE_LINK_NODES)
    throw Error('model pose link: mapping intake ceiling exceeded');
  return Object.freeze(result);
}
export interface ModelPoseLinkData {
  readonly source: Entity;
  readonly nodes: readonly {readonly source: string; readonly target: string}[];
  readonly inheritVisibility: boolean;
}
export interface ModelPoseLinkState {
  readonly status:
    | 'absent'
    | 'unlinked'
    | 'unresolved'
    | 'waiting'
    | 'ready'
    | 'invalid'
    | 'incompatible'
    | 'conflict'
    | 'cycle'
    | 'blocked'
    | 'over-budget';
  readonly reason:
    | null
    | 'mapping'
    | 'hierarchy'
    | 'rest'
    | 'bind'
    | 'skin'
    | 'animation-authority'
    | 'root-authority'
    | 'nonfinite'
    | 'capacity';
}
/** Detached bounded capture; owner checks source identity and self/cycle relationships. */
export function captureModelPoseLink(
  input: Partial<ModelPoseLinkData>,
  maxNodes = MAX_MODEL_POSE_LINK_NODES,
): ModelPoseLinkData {
  const {source, nodes, inheritVisibility} = input;
  if (
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 0 ||
    maxNodes > MAX_MODEL_POSE_LINK_NODES ||
    !Number.isSafeInteger(source) ||
    source! < 1 ||
    typeof inheritVisibility !== 'boolean' ||
    !Array.isArray(nodes)
  )
    throw Error('model pose link: invalid definition');
  const length = nodes.length;
  if (!Number.isSafeInteger(length) || length < 1 || length > maxNodes)
    throw Error('model pose link: mapping capacity');
  const captured: {readonly source: string; readonly target: string}[] = [],
    sources = new Set<string>(),
    targets = new Set<string>();
  for (let i = 0; i < length; i++) {
    const entry = nodes[i];
    if (!entry || typeof entry !== 'object') throw Error('model pose link: invalid mapping');
    const {source: from, target: to} = entry;
    if (
      typeof from !== 'string' ||
      !from ||
      from.length > 256 ||
      typeof to !== 'string' ||
      !to ||
      to.length > 256 ||
      sources.has(from) ||
      targets.has(to)
    )
      throw Error('model pose link: invalid mapping');
    sources.add(from);
    targets.add(to);
    captured.push(Object.freeze({source: from, target: to}));
  }
  return Object.freeze({source: source!, nodes: Object.freeze(captured), inheritVisibility});
}
const base = component<ModelPoseLinkData>('model-pose-link', {
  source: 0,
  nodes: Object.freeze([]),
  inheritVisibility: true,
});
export const ModelPoseLink: ComponentType<ModelPoseLinkData> = Object.assign(
  (input: Partial<ModelPoseLinkData> = {}) => ({type: ModelPoseLink, value: captureModelPoseLink(input)}),
  {id: base.id, initial: base.initial},
);
