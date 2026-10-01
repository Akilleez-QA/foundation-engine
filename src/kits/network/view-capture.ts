import { createAuthoredDocument, type DocumentValue } from '../authoring/document';
import type { ViewEntity, ViewFrame, ViewLimits, ViewUnavailableFrame } from './view-types';
export function captureViewLimits(input: ViewLimits): ViewLimits {
  const limits = { maxBytes: input.maxBytes, maxNodes: input.maxNodes, maxDepth: input.maxDepth,
    maxEntities: input.maxEntities, maxIdentityLength: input.maxIdentityLength };
  if (!Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0) || limits.maxIdentityLength > 256) throw Error('network view: invalid limits');
  return Object.freeze(limits);
}
export function viewIdentity(value: unknown, limits: ViewLimits): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limits.maxIdentityLength;
}
function record(value: DocumentValue): value is { readonly [key: string]: DocumentValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: { readonly [key: string]: DocumentValue }, names: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === names.length && names.every(name => Object.hasOwn(value, name));
}
function integer(value: DocumentValue | undefined, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function entities(value: DocumentValue | undefined, limits: ViewLimits): boolean {
  if (!Array.isArray(value) || value.length > limits.maxEntities) return false;
  const ids = new Set<string>();
  for (const entity of value) {
    if (!record(entity) || !keys(entity, ['id', 'incarnation', 'fields'])
      || !viewIdentity(entity.id, limits) || !integer(entity.incarnation) || ids.has(entity.id)) return false;
    ids.add(entity.id);
  }
  return true;
}
function capture(json: string, limits: ViewLimits, validate: (value: DocumentValue) => boolean) {
  const document = createAuthoredDocument({ id: 'network-view', json, limits,
    validate: (value): value is DocumentValue => validate(value) });
  const { value, bytes } = document.read(); document.dispose();
  return { value, bytes };
}
export function captureViewFrame(json: string, limits: ViewLimits): { value: ViewFrame | ViewUnavailableFrame; bytes: number } {
  const result = capture(json, limits, value => {
    if (!record(value) || value.v !== 1 || !viewIdentity(value.session, limits) || !integer(value.sequence, 1)) return false;
    if (value.type === 'view') return keys(value, ['v', 'type', 'session', 'sequence', 'worldRevision', 'entities'])
      && integer(value.worldRevision) && entities(value.entities, limits);
    return value.type === 'view-unavailable' && keys(value, ['v', 'type', 'session', 'sequence', 'reason'])
      && viewIdentity(value.reason, limits);
  });
  return result as { value: ViewFrame | ViewUnavailableFrame; bytes: number };
}
export function captureViewProjection(json: string, limits: ViewLimits): {
  readonly worldRevision: number; readonly entities: readonly ViewEntity[];
} {
  const result = capture(json, limits, value => record(value) && keys(value, ['worldRevision', 'entities'])
    && integer(value.worldRevision) && entities(value.entities, limits));
  return result.value as { readonly worldRevision: number; readonly entities: readonly ViewEntity[] };
}
