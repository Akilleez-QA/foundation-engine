import { Matrix4 } from 'three';
export type SocketMatrix = readonly number[];
export interface SocketLod { readonly id: string; readonly sockets: Readonly<Record<string, SocketMatrix>> }
export interface Attachment { readonly child: string; readonly socket: string; readonly local: SocketMatrix }
export interface AttachmentFrame { readonly id: string; readonly matrix: SocketMatrix }
const identity = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function matrix(value: SocketMatrix): SocketMatrix {
  if (value.length !== 16 || !value.every(Number.isFinite) || value[3] !== 0 || value[7] !== 0 || value[11] !== 0 || value[15] !== 1) throw Error('socket transform must be a finite affine column-major matrix');
  return Object.freeze([...value]);
}
/** Named sockets validated across every retained LOD; never reparents a renderer object or moves simulation. */
export function createSocketRig(input: readonly SocketLod[], maxAttachments = 32) {
  if (!input.length || !Number.isSafeInteger(maxAttachments) || maxAttachments < 1) throw Error('invalid socket rig budget');
  const lods = new Map<string, Readonly<Record<string, SocketMatrix>>>();
  const names = Object.keys(input[0].sockets).sort();
  for (const lod of input) {
    if (!lod.id || lods.has(lod.id) || JSON.stringify(Object.keys(lod.sockets).sort()) !== JSON.stringify(names)) throw Error('each LOD must have unique id and identical socket names');
    lods.set(lod.id, Object.freeze(Object.fromEntries(names.map(name => {
      if (!name) throw Error('empty socket name'); return [name, matrix(lod.sockets[name])];
    }))));
  }
  const attached = new Map<string, Attachment>();
  return {
    attach(child: string, socket: string, local: SocketMatrix = identity): Attachment {
      if (!child || !names.includes(socket) || attached.has(child)) throw Error('invalid or already attached child/socket');
      if (attached.size >= maxAttachments) throw Error('attachment budget exceeded');
      const value = Object.freeze({ child, socket, local: matrix(local) }); attached.set(child, value); return value;
    },
    /** Returns the ownership record; caller explicitly restores world simulation after detach. */
    detach(child: string): Attachment | undefined { const value = attached.get(child); attached.delete(child); return value; },
    sample(child: string, lod: string, parent: AttachmentFrame): Readonly<{ child: string; frame: string; matrix: SocketMatrix }> {
      const attachment = attached.get(child), sockets = lods.get(lod);
      if (!attachment || !sockets || !parent.id) throw Error('unknown attachment, LOD or frame');
      const world = new Matrix4().fromArray(matrix(parent.matrix)).multiply(new Matrix4().fromArray(sockets[attachment.socket])).multiply(new Matrix4().fromArray(attachment.local));
      return Object.freeze({ child, frame: parent.id, matrix: matrix(world.elements) });
    },
    get size() { return attached.size; },
    clear() { const records = [...attached.values()]; attached.clear(); return records; },
  };
}
