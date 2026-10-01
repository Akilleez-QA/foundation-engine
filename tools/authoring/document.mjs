// Creator schema: world-space metres, Y-up, Y rotation in radians. No runtime IDs.
export const documentId = 'manual-sample';
export const limits = {maxBytes: 8192, maxNodes: 256, maxDepth: 8};
export const initial = {id: documentId, objects: [
  {id: 'A', incarnation: 0, x: -2, y: 0, z: 0, ry: 0},
  {id: 'B', incarnation: 0, x: 2, y: 0, z: 1, ry: 0},
]};
const keysAre = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function validDocument(value) {
  if (!keysAre(value, ['id', 'objects']) || value.id !== documentId || !Array.isArray(value.objects) || value.objects.length > 2) return false;
  const ids = new Set();
  return value.objects.every(o => {
    if (!keysAre(o, ['id', 'incarnation', 'x', 'y', 'z', 'ry']) || !['A', 'B'].includes(o.id) || ids.has(o.id) || o.incarnation !== 0) return false;
    ids.add(o.id);
    return ['x', 'y', 'z', 'ry'].every(k => typeof o[k] === 'number' && Number.isFinite(o[k]))
      && ['x', 'z'].every(k => Math.abs(o[k]) <= 4) && Math.abs(o.y) <= 2 && Math.abs(o.ry) <= Math.PI * 2;
  });
}
export function parseDocument(raw) {
  if (!validDocument(raw) || new TextEncoder().encode(JSON.stringify(raw)).length > limits.maxBytes) throw Error('Invalid creator document');
  return structuredClone(raw);
}
export const storageKey = 'manual-authoring|device|authoring.document';
