import { component, type ComponentType, type Entity } from '../core/ecs/world';

export interface ModelAttachmentData {
  readonly parent: Entity;
  readonly socket: string;
  readonly offset: readonly number[];
  readonly unavailable: 'hide' | 'hold';
  readonly inheritVisibility: boolean;
}
export interface ModelAttachmentState {
  readonly status: 'absent' | 'unattached' | 'unresolved' | 'waiting' | 'missing-socket' | 'ambiguous-socket' | 'blocked' | 'cycle' | 'invalid' | 'ready';
  /** Historical presentation retained by hold; this is not current dependency readiness. */
  readonly held: boolean;
}
const identity = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** Detached scalar capture, including raw ECS replacement data. No caller array methods are used. */
export function captureModelAttachment(input: Partial<ModelAttachmentData>): ModelAttachmentData {
  const { parent, socket, offset = identity, unavailable, inheritVisibility } = input;
  if (!Number.isSafeInteger(parent) || parent! < 1 || typeof socket !== 'string' || !socket || socket.length > 256
    || (unavailable !== 'hide' && unavailable !== 'hold') || typeof inheritVisibility !== 'boolean'
    || !Array.isArray(offset) || offset.length !== 16) throw Error('model attachment: invalid definition');
  const matrix: number[] = [];
  for (let i = 0; i < 16; i++) { const value = offset[i]; if (!Number.isFinite(value)) throw Error('model attachment: invalid matrix'); matrix.push(value); }
  if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) throw Error('model attachment: non-affine matrix');
  return Object.freeze({ parent: parent!, socket, offset: Object.freeze(matrix), unavailable, inheritVisibility });
}
const base = component<ModelAttachmentData>('model-attachment', { parent: 0, socket: '', offset: identity, unavailable: 'hide', inheritVisibility: true });
/** Presentation-only relation. Supply parent, socket and both policies; replace with world.add to edit. */
export const ModelAttachment: ComponentType<ModelAttachmentData> = Object.assign(
  (input: Partial<ModelAttachmentData> = {}) => ({ type: ModelAttachment, value: captureModelAttachment(input) }),
  { id: base.id, initial: base.initial },
);
