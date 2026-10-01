// This schema and its aesthetic choices belong to this optional tool, not the engine.
export const initial = {version:1, parts:{form:'box'}, parameters:{scale:1,tint:0x75d8d0}};
export const limits = {maxBytes:4096,maxNodes:64,maxDepth:5,maxParts:8,maxParameters:8};
export const storageKey = 'appearance-preview|device|appearance.profile';
export function compatible(v) {
  return v?.version === 1 && v.parts && Object.keys(v.parts).length === 1 && ['box','sphere'].includes(v.parts.form)
    && v.parameters && Object.keys(v.parameters).length === 2 && Number.isFinite(v.parameters.scale)
    && v.parameters.scale >= .5 && v.parameters.scale <= 1.5
    && Number.isSafeInteger(v.parameters.tint) && v.parameters.tint >= 0 && v.parameters.tint <= 0xffffff;
}
